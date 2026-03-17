"use client";

/**
 * 連接 / 中斷 App 對話框
 * - oauth2：確認後導向 /api/connect/{app}
 * - bot_token / api_key：顯示輸入框（TODO：未來實作）
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
  const authType = node.authType ?? 'oauth2';

  /* 連接確認 */
  const handleConnect = () => {
    setLoading(true);
    onConnect(node.id, authType);
    /* oauth2 會直接跳轉，不需要手動關閉 */
    if (authType !== 'oauth2') {
      setLoading(false);
      onOpenChange(false);
    }
  };

  /* 中斷確認 */
  const handleDisconnect = async () => {
    setLoading(true);
    await onDisconnect(node.id);
    setLoading(false);
  };

  /* 根據認證方式決定顯示內容 */
  const getDescription = () => {
    if (isConnected) {
      return `中斷後，${node.label} 的所有技能將回到未解鎖狀態。`;
    }
    switch (authType) {
      case 'oauth2':
        return `將透過 OAuth 授權連接 ${node.label}，授權後即可解鎖相關技能。`;
      case 'bot_token':
        return `需要提供 ${node.label} 的 Bot Token 來連接。請到對應平台取得 Token。`;
      case 'api_key':
        return `需要提供 ${node.label} 的 API Key 來連接。`;
      default:
        return `連接 ${node.label} 以解鎖相關技能。`;
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!loading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-gray-900">
            {isConnected ? `中斷 ${node.label}？` : `連接 ${node.label}`}
          </DialogTitle>
          <DialogDescription>{getDescription()}</DialogDescription>
        </DialogHeader>

        {/* 非 OAuth 認證的輸入區（未來擴展） */}
        {!isConnected && authType !== 'oauth2' && (
          <div className="py-2">
            <p className="text-xs text-gray-400 font-mono">
              {authType === 'bot_token' ? 'Bot Token' : 'API Key'} 輸入功能開發中，請至 Dashboard 連接。
            </p>
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
            <Button onClick={handleConnect} disabled={loading || (authType !== 'oauth2')}>
              {loading ? '處理中…' : authType === 'oauth2' ? '前往授權' : '連接'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
