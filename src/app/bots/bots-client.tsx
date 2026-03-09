"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

interface BotConfig {
  id: string;
  platform: string;
  platformBotId: string;
  systemPrompt: string;
  llmProvider: string;
  hasLlmApiKey: boolean;
  isActive: boolean;
}

interface BotsProps {
  configs: BotConfig[];
}

export function BotsClient({ configs }: BotsProps) {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("bots.title")}</h1>
          <div className="flex gap-2 items-center">
            <LanguageSwitcher />
            <Link
              href="/dashboard"
              className="px-4 py-2 text-sm border rounded hover:bg-gray-100 transition-colors"
            >
              {t("common.back")}
            </Link>
          </div>
        </div>

        {configs.length === 0 ? (
          <div className="bg-white rounded-lg border p-6 text-center text-gray-500">
            <p>{t("bots.empty")}</p>
            <p className="text-sm mt-2">{t("bots.empty_hint")}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {configs.map((config) => (
              <BotConfigCard
                key={config.id}
                config={config}
                onUpdate={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BotConfigCard({
  config,
  onUpdate,
}: {
  config: BotConfig;
  onUpdate: () => void;
}) {
  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt);
  const [llmProvider, setLlmProvider] = useState(config.llmProvider);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [isActive, setIsActive] = useState(config.isActive);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { t } = useI18n();

  const platformName = config.platform === "line" ? "LINE" : "Telegram";

  const save = useCallback(async () => {
    setSaving(true);
    setMessage("");

    try {
      const body: Record<string, unknown> = {
        platform: config.platform,
        systemPrompt,
        llmProvider,
        isActive,
      };
      if (llmApiKey) {
        body.llmApiKey = llmApiKey;
      }

      const res = await fetch("/api/bot-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setMessage(t("common.saved"));
        setLlmApiKey("");
        onUpdate();
      } else {
        const data = await res.json();
        setMessage(data.error ?? t("common.save_failed"));
      }
    } catch {
      setMessage(t("common.save_failed"));
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(""), 3000);
    }
  }, [config.platform, systemPrompt, llmProvider, llmApiKey, isActive, onUpdate, t]);

  return (
    <div className="bg-white rounded-lg border p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{platformName} Bot</h2>
          <p className="text-sm text-gray-500">ID: {config.platformBotId}</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-sm text-gray-600">
            {isActive ? t("bots.active") : t("bots.inactive")}
          </span>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="w-4 h-4"
          />
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("bots.persona")}
        </label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={4}
          placeholder={t("bots.persona_placeholder")}
          className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-black"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("bots.llm_provider")}
        </label>
        <select
          value={llmProvider}
          onChange={(e) => setLlmProvider(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        >
          <option value="claude">Claude (Anthropic)</option>
          <option value="openai">GPT (OpenAI)</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("bots.llm_api_key")}
        </label>
        <input
          type="password"
          value={llmApiKey}
          onChange={(e) => setLlmApiKey(e.target.value)}
          placeholder={
            config.hasLlmApiKey ? t("bots.api_key_set") : t("bots.api_key_placeholder")
          }
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <p className="text-xs text-gray-400 mt-1">
          {t("bots.api_key_note")}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-black text-white text-sm rounded hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
        {message && (
          <span
            className={`text-sm ${message === t("common.saved") ? "text-green-600" : "text-red-600"}`}
          >
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
