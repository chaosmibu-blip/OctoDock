import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";

// ============================================================
// 綠界 ECPay Webhook 處理器
// ECPay 是台灣企業客戶的收款渠道（費率 2.75%，只收台幣）
//
// 綠界付款完成後會發送 PaymentInfoURL / ReturnURL 通知
// 格式：application/x-www-form-urlencoded
//
// 環境變數：
//   ECPAY_MERCHANT_ID — 綠界特店編號
//   ECPAY_HASH_KEY — 綠界 HashKey
//   ECPAY_HASH_IV — 綠界 HashIV
// ============================================================

/** POST /api/webhooks/ecpay — 接收綠界付款結果通知 */
export async function POST(req: NextRequest) {
  // 綠界用 form-urlencoded 格式
  const formData = await req.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = value.toString();
  });

  // 驗證 CheckMacValue
  if (!verifyEcpayCheckMac(params)) {
    return new Response("0|CheckMacValue Error", { status: 400 });
  }

  try {
    await handleEcpayNotification(params);
    // 綠界要求回傳 "1|OK" 表示收到
    return new Response("1|OK");
  } catch (error) {
    console.error("ECPay webhook error:", error);
    return new Response("0|Error", { status: 500 });
  }
}

// ============================================================
// 綠界通知處理
// ============================================================

/**
 * 處理綠界的付款結果通知
 * RtnCode = 1 表示付款成功
 */
async function handleEcpayNotification(
  params: Record<string, string>,
): Promise<void> {
  const rtnCode = params.RtnCode; // "1" = 成功
  const merchantTradeNo = params.MerchantTradeNo; // 我們的訂單編號
  const tradeNo = params.TradeNo; // 綠界交易編號

  // 訂單編號格式：AGENTDOCK_{userId}_{timestamp}
  const userId = extractUserIdFromTradeNo(merchantTradeNo);
  if (!userId) {
    console.error("ECPay webhook: cannot extract userId from", merchantTradeNo);
    return;
  }

  if (rtnCode === "1") {
    // 付款成功 → 啟用訂閱
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1); // 月訂閱

    await db
      .insert(subscriptions)
      .values({
        userId,
        plan: "pro",
        status: "active",
        provider: "ecpay",
        providerSubscriptionId: tradeNo,
        providerCustomerId: merchantTradeNo,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      })
      .onConflictDoUpdate({
        target: [subscriptions.userId],
        set: {
          plan: "pro",
          status: "active",
          provider: "ecpay",
          providerSubscriptionId: tradeNo,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          updatedAt: now,
        },
      });
  } else {
    // 付款失敗
    console.log(`ECPay payment failed: ${merchantTradeNo}, RtnCode: ${rtnCode}, Msg: ${params.RtnMsg}`);
  }
}

// ============================================================
// 輔助函式
// ============================================================

/**
 * 從訂單編號提取 userId
 * 訂單編號格式：AD{userId前8碼}{timestamp}
 */
function extractUserIdFromTradeNo(tradeNo: string): string | null {
  // 格式由建立訂單時決定，這裡做反向解析
  // 實際格式需要跟建立訂單的邏輯一致
  if (!tradeNo || !tradeNo.startsWith("AD")) return null;
  // userId 前 8 碼在 AD 後面
  const shortId = tradeNo.slice(2, 10);
  // TODO: 從 DB 用前 8 碼模糊查找 userId
  // 暫時回傳 null，等建立訂單邏輯確定後再完善
  return null;
}

/**
 * 驗證綠界的 CheckMacValue
 * 綠界用 SHA256 + 特定的排序和編碼規則產生檢查碼
 */
function verifyEcpayCheckMac(params: Record<string, string>): boolean {
  const hashKey = process.env.ECPAY_HASH_KEY;
  const hashIV = process.env.ECPAY_HASH_IV;

  if (!hashKey || !hashIV) {
    console.warn("ECPay credentials not set, skipping verification");
    return true;
  }

  const receivedMac = params.CheckMacValue;
  if (!receivedMac) return false;

  // 1. 移除 CheckMacValue 本身
  const filtered = { ...params };
  delete filtered.CheckMacValue;

  // 2. 按照 key 字母排序
  const sorted = Object.keys(filtered)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => `${key}=${filtered[key]}`)
    .join("&");

  // 3. 前後加上 HashKey 和 HashIV
  const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIV}`;

  // 4. URL encode 並轉小寫
  const encoded = encodeURIComponent(raw).toLowerCase();

  // 5. SHA256 hash 並轉大寫
  const computed = crypto
    .createHash("sha256")
    .update(encoded)
    .digest("hex")
    .toUpperCase();

  return computed === receivedMac.toUpperCase();
}
