/**
 * U24: OAuth Authorize Page
 * GET /oauth/authorize — 授權同意頁面
 *
 * 流程：
 * 1. 外部 AI 平台 redirect 到這裡
 * 2. 如果用戶未登入 → 先登入（Google OAuth）
 * 3. 顯示授權同意頁面
 * 4. 用戶點同意 → 產生 auth code → redirect 回外部平台
 */
"use client";

import { useSearchParams } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { useState, Suspense } from "react";

function AuthorizeContent() {
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const scope = searchParams.get("scope") ?? "mcp";
  const responseType = searchParams.get("response_type");

  // 驗證必填參數
  if (!clientId || !redirectUri || responseType !== "code") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Invalid Request</h1>
          <p className="text-gray-400">
            Missing required parameters: client_id, redirect_uri, response_type=code
          </p>
        </div>
      </div>
    );
  }

  // 未登入 → 導向 Google OAuth
  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
        <div className="max-w-md w-full p-8 bg-gray-900 rounded-2xl shadow-xl text-center">
          <div className="text-6xl mb-4">🐙</div>
          <h1 className="text-2xl font-bold mb-2">OctoDock</h1>
          <p className="text-gray-400 mb-6">請先登入以授權存取</p>
          <button
            onClick={() => signIn("google", { callbackUrl: window.location.href })}
            className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition"
          >
            使用 Google 帳號登入
          </button>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
        <p>Loading...</p>
      </div>
    );
  }

  // 已登入 → 顯示授權頁面
  const handleAuthorize = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
          state,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error_description ?? data.error ?? "Authorization failed");
        setIsLoading(false);
        return;
      }

      // Redirect 回外部平台（帶 auth code）
      window.location.href = data.redirect_url;
    } catch (_err) {
      setError("Network error. Please try again.");
      setIsLoading(false);
    }
  };

  const handleDeny = () => {
    // 拒絕 → redirect 回去帶 error
    const url = new URL(redirectUri);
    url.searchParams.set("error", "access_denied");
    if (state) url.searchParams.set("state", state);
    window.location.href = url.toString();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
      <div className="max-w-md w-full p-8 bg-gray-900 rounded-2xl shadow-xl">
        <div className="text-center mb-6">
          <div className="text-6xl mb-4">🐙</div>
          <h1 className="text-2xl font-bold">Authorize Access</h1>
        </div>

        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <p className="text-gray-300 mb-2">
            <strong>{clientId}</strong> wants to access your OctoDock account.
          </p>
          <p className="text-sm text-gray-400">
            This will allow the application to use all your connected apps through OctoDock.
          </p>
        </div>

        <div className="mb-6 text-sm text-gray-400">
          <p>Logged in as: <strong>{session?.user?.email}</strong></p>
          <p>Scope: <strong>{scope}</strong></p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleDeny}
            className="flex-1 py-3 px-6 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition"
          >
            拒絕
          </button>
          <button
            onClick={handleAuthorize}
            disabled={isLoading}
            className="flex-1 py-3 px-6 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg font-medium transition"
          >
            {isLoading ? "處理中..." : "同意授權"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
        <p>Loading...</p>
      </div>
    }>
      <AuthorizeContent />
    </Suspense>
  );
}
