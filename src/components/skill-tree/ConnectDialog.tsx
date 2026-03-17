"use client";

/**
 * 連接 / 中斷 App 對話框
 * - oauth2：確認後用新分頁開 OAuth（不離開技能樹），完成後自動刷新
 * - bot_token / api_key：在彈窗裡顯示輸入框
 */

import { useState } from 'react';
import { SkillNode } from '@/data/skillTreeData';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  node: SkillNode;
  isConnected: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (appName: string, authType: string) => void;
  onDisconnect: (appName: string) => void;
}

export function ConnectDialog({ node, isConnected, open, onOpenChange, onConnect, onDisconnect }: Props) {
  const [loading, setLoading] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');
  const authType = node.authType ?? 'oauth2';

  /* 連接確認 */
  const handleConnect = async () => {
    setLoading(true);

    if (authType === 'oauth2') {
      /* OAuth → 新分頁開啟授權頁，關閉對話框 */
      onConnect(node.id, authType);
      setLoading(false);
      onOpenChange(false);
      return;
    }

    /* bot_token / api_key → 送 token 到後端 */
    if (!tokenInput.trim()) {
      setTokenError('請輸入 Token');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/connect/${node.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setTokenInput('');
      setLoading(false);
      onOpenChange(false);
      /* 觸發頁面刷新（ConnectDialog 關閉後 focus 事件會觸發 refreshData） */
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : '連接失敗');
      setLoading(false);
    }
  };

  /* 中斷確認 */
  const handleDisconnect = async () => {
    setLoading(true);
    await onDisconnect(node.id);
    setLoading(false);
  };

  /* 描述文字 */
  const getDescription = () => {
    if (isConnected) {
      return `中斷後，${node.label} 的所有技能將回到未解鎖狀態。`;
    }
    switch (authType) {
      case 'oauth2':
        return `將在新視窗開啟 OAuth 授權頁面連接 ${node.label}，授權完成後技能樹會自動更新。`;
      case 'bot_token':
        return `請輸入 ${node.label} 的 Bot Token 來連接。`;
      case 'api_key':
        return `請輸入 ${node.label} 的 API Key 來連接。`;
      default:
        return `連接 ${node.label} 以解鎖相關技能。`;
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!loading) { onOpenChange(v); setTokenError(''); } }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-gray-900">
            {isConnected ? `中斷 ${node.label}？` : `連接 ${node.label}`}
          </DialogTitle>
          <DialogDescription>{getDescription()}</DialogDescription>
        </DialogHeader>

        {/* bot_token / api_key 輸入框 */}
        {!isConnected && authType !== 'oauth2' && (
          <div className="space-y-2 py-2">
            <input
              type="text"
              value={tokenInput}
              onChange={e => { setTokenInput(e.target.value); setTokenError(''); }}
              placeholder={authType === 'bot_token' ? 'Bot Token' : 'API Key'}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1D9E75] focus:border-transparent font-mono"
            />
            {tokenError && (
              <p className="text-xs text-red-500">{tokenError}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          {isConnected ? (
            <Button variant="destructive" onClick={handleDisconnect} disabled={loading}>
              {loading ? '處理中…' : '確認中斷'}
            </Button>
          ) : (
            <Button onClick={handleConnect} disabled={loading}>
              {loading ? '處理中…' : authType === 'oauth2' ? '開啟授權' : '連接'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
