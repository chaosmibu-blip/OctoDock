// ============================================================
// B4: Per-app Circuit Breaker
// 當某個 App 的 API 連續失敗時自動斷路，避免雪崩
// 狀態機：CLOSED → OPEN → HALF_OPEN → CLOSED
// 只有 5xx 和 timeout 計入失敗，4xx 不計入（用戶端錯誤不該斷路）
// ============================================================

/** 斷路器狀態 */
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** 單一 App 的斷路器實例 */
interface CircuitBreakerInstance {
  state: CircuitState;
  failureCount: number;    // 連續失敗次數
  lastFailureAt: number;   // 最近一次失敗的時間戳
  lastStateChange: number; // 最近一次狀態變更的時間戳
}

/** 斷路器可調參數 */
const FAILURE_THRESHOLD = parseInt(process.env.CB_FAILURE_THRESHOLD ?? "5", 10);
const RESET_TIMEOUT_MS = parseInt(process.env.CB_RESET_TIMEOUT_MS ?? "30000", 10);

/** Per-app 斷路器狀態，key 為 appName */
const breakers = new Map<string, CircuitBreakerInstance>();

/** 取得或建立 app 的斷路器實例 */
function getBreaker(appName: string): CircuitBreakerInstance {
  let breaker = breakers.get(appName);
  if (!breaker) {
    breaker = {
      state: "CLOSED",
      failureCount: 0,
      lastFailureAt: 0,
      lastStateChange: Date.now(),
    };
    breakers.set(appName, breaker);
  }
  return breaker;
}

/**
 * 檢查是否允許請求通過
 * CLOSED：放行
 * OPEN：超過 resetTimeout 才放一個請求（轉 HALF_OPEN），否則直接拒絕
 * HALF_OPEN：放行（試探）
 *
 * @returns null 表示允許，否則回傳錯誤訊息
 */
export function checkCircuitBreaker(appName: string): { blocked: true; retryAfterMs: number } | null {
  const breaker = getBreaker(appName);

  if (breaker.state === "CLOSED") return null;

  if (breaker.state === "OPEN") {
    const elapsed = Date.now() - breaker.lastStateChange;
    if (elapsed >= RESET_TIMEOUT_MS) {
      // 超過冷卻時間，轉 HALF_OPEN 放一個請求試探
      breaker.state = "HALF_OPEN";
      breaker.lastStateChange = Date.now();
      return null;
    }
    // 還在冷卻期，直接拒絕
    return { blocked: true, retryAfterMs: RESET_TIMEOUT_MS - elapsed };
  }

  // HALF_OPEN：放行試探請求
  return null;
}

/**
 * 記錄操作成功
 * HALF_OPEN 成功 → 回到 CLOSED
 */
export function recordSuccess(appName: string): void {
  const breaker = getBreaker(appName);
  if (breaker.state === "HALF_OPEN" || breaker.failureCount > 0) {
    breaker.state = "CLOSED";
    breaker.failureCount = 0;
    breaker.lastStateChange = Date.now();
  }
}

/**
 * 記錄操作失敗（只有 5xx / timeout / network 類才應該呼叫）
 * 連續失敗達到閾值 → 轉 OPEN
 * HALF_OPEN 失敗 → 直接回 OPEN
 */
export function recordFailure(appName: string): void {
  const breaker = getBreaker(appName);

  if (breaker.state === "HALF_OPEN") {
    // 試探失敗，直接回 OPEN
    breaker.state = "OPEN";
    breaker.lastStateChange = Date.now();
    return;
  }

  breaker.failureCount++;
  breaker.lastFailureAt = Date.now();

  if (breaker.failureCount >= FAILURE_THRESHOLD) {
    breaker.state = "OPEN";
    breaker.lastStateChange = Date.now();
  }
}

/**
 * 判斷一個錯誤是否應該計入 circuit breaker 失敗
 * 只有服務端錯誤（5xx）和網路/超時錯誤才計入
 * 用戶端錯誤（4xx）不計入，否則打錯參數就會斷路
 */
export function isCircuitBreakerRelevant(errorMessage: string): boolean {
  // 5xx
  if (/(?:HTTP|status|Error)\s*:?\s*5\d{2}/i.test(errorMessage)) return true;
  // 網路 / 超時
  if (/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|timeout/i.test(errorMessage)) return true;
  return false;
}

/** B5: 取得所有斷路器狀態（供 health endpoint 用） */
export function getAllBreakerStates(): Record<string, { state: CircuitState; failureCount: number }> {
  const states: Record<string, { state: CircuitState; failureCount: number }> = {};
  for (const [appName, breaker] of breakers) {
    states[appName] = { state: breaker.state, failureCount: breaker.failureCount };
  }
  return states;
}
