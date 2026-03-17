import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { eq } from "drizzle-orm";

// ============================================================
// Paddle Webhook 處理器
// Paddle 是 OctoDock 網站端的收款平台（費率 5% + $0.50）
// 不需要海外公司，Paddle 是 Merchant of Record，處理全球稅務
//
// Paddle 在以下事件時發送 webhook：
//   subscription.created — 用戶新建訂閱
//   subscription.updated — 方案變更、續費
//   subscription.cancelled — 用戶取消
//   subscription.past_due — 付款失敗
//
// 環境變數：
//   PADDLE_WEBHOOK_SECRET — 驗證 webhook 簽名
//   PADDLE_API_KEY — Paddle API（未來用於主動查詢）
// ============================================================

/** POST /api/webhooks/paddle — 接收 Paddle webhook */
export async function POST(req: NextRequest) {
  const body = await req.text();

  // 驗證 webhook 簽名
  const signature = req.headers.get("paddle-signature");
  if (!verifyPaddleSignature(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(body) as PaddleEvent;

  try {
    await handlePaddleEvent(event);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Paddle webhook error:", error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

// ============================================================
// Paddle 事件類型
// ============================================================

interface PaddleEvent {
  event_type: string;
  data: {
    id: string; // subscription ID
    customer_id: string;
    status: string; // 'active' | 'past_due' | 'cancelled'
    items: Array<{
      price: {
        id: string;
        product_id: string;
      };
    }>;
    current_billing_period?: {
      starts_at: string;
      ends_at: string;
    };
    custom_data?: {
      user_id?: string; // OctoDock user ID，在 checkout 時帶入
    };
    cancelled_at?: string;
  };
}

// ============================================================
// 事件處理
// ============================================================

/** 根據事件類型分派處理 */
async function handlePaddleEvent(event: PaddleEvent): Promise<void> {
  const { event_type, data } = event;

  switch (event_type) {
    // ── 新建訂閱 ──
    case "subscription.created":
    case "subscription.updated": {
      const userId = data.custom_data?.user_id;
      if (!userId) {
        console.error("Paddle webhook: missing user_id in custom_data");
        return;
      }

      // 從 Paddle product ID 判斷方案（需要在 Paddle 後台設定 product）
      const plan = mapPaddleProductToPlan(data.items[0]?.price?.product_id);

      // Upsert 訂閱記錄
      await db
        .insert(subscriptions)
        .values({
          userId,
          plan,
          status: data.status === "active" ? "active" : "past_due",
          provider: "paddle",
          providerSubscriptionId: data.id,
          providerCustomerId: data.customer_id,
          currentPeriodStart: data.current_billing_period?.starts_at
            ? new Date(data.current_billing_period.starts_at)
            : null,
          currentPeriodEnd: data.current_billing_period?.ends_at
            ? new Date(data.current_billing_period.ends_at)
            : null,
        })
        .onConflictDoUpdate({
          target: [subscriptions.userId],
          set: {
            plan,
            status: data.status === "active" ? "active" : "past_due",
            providerSubscriptionId: data.id,
            providerCustomerId: data.customer_id,
            currentPeriodStart: data.current_billing_period?.starts_at
              ? new Date(data.current_billing_period.starts_at)
              : undefined,
            currentPeriodEnd: data.current_billing_period?.ends_at
              ? new Date(data.current_billing_period.ends_at)
              : undefined,
            updatedAt: new Date(),
          },
        });

      break;
    }

    // ── 取消訂閱 ──
    case "subscription.cancelled": {
      if (data.custom_data?.user_id) {
        await db
          .update(subscriptions)
          .set({
            status: "cancelled",
            cancelledAt: data.cancelled_at ? new Date(data.cancelled_at) : new Date(),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, data.custom_data.user_id));
      }
      break;
    }

    // ── 付款失敗 ──
    case "subscription.past_due": {
      if (data.custom_data?.user_id) {
        await db
          .update(subscriptions)
          .set({
            status: "past_due",
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, data.custom_data.user_id));
      }
      break;
    }

    default:
      // 其他事件不處理
      console.log(`Paddle webhook: unhandled event ${event_type}`);
  }
}

// ============================================================
// 輔助函式
// ============================================================

/**
 * 驗證 Paddle webhook 簽名
 * Paddle 用 HMAC-SHA256 簽名，secret 在 Paddle 後台設定
 */
function verifyPaddleSignature(
  body: string,
  signature: string | null,
): boolean {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) {
    // 沒設定 secret → 拒絕所有 webhook（防止 production 意外未設定時被偽造）
    console.error("[SECURITY] PADDLE_WEBHOOK_SECRET not set — rejecting webhook");
    return false;
  }
  if (!signature) return false;

  // Paddle signature 格式：ts=timestamp;h1=hash
  const parts = signature.split(";");
  const ts = parts.find((p) => p.startsWith("ts="))?.slice(3);
  const h1 = parts.find((p) => p.startsWith("h1="))?.slice(3);
  if (!ts || !h1) return false;

  const payload = `${ts}:${body}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(h1), Buffer.from(expected));
}

/**
 * 將 Paddle product ID 對應到 OctoDock 方案名稱
 * 需要在 Paddle 後台建立 product 時記下 ID
 */
function mapPaddleProductToPlan(productId: string | undefined): string {
  // TODO: 在 Paddle 後台建立 product 後，填入對應的 ID
  const mapping: Record<string, string> = {
    // "pro_xxxx": "pro",
    // "team_xxxx": "team",
  };

  return mapping[productId ?? ""] ?? "pro";
}
