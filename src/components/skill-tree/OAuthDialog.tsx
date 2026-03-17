"use client";

/** OAuth 連接對話框 — 點擊 App 節點時彈出，模擬連接 / 中斷流程 */

import { useState } from 'react';
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
  appLabel: string;
  isConnected: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function OAuthDialog({ appLabel, isConnected, open, onOpenChange, onConfirm }: Props) {
  const [loading, setLoading] = useState(false);

  /* 模擬 OAuth 授權延遲 */
  const handleConfirm = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onConfirm();
      onOpenChange(false);
    }, 1000);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!loading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle className="text-gray-900">
            {isConnected ? `中斷 ${appLabel}？` : `連接 ${appLabel}？`}
          </DialogTitle>
          <DialogDescription>
            {isConnected
              ? `中斷後，${appLabel} 的所有技能將回到未解鎖狀態。`
              : `模擬 OAuth 授權流程，連接 ${appLabel} 以解鎖相關技能。`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading ? '處理中…' : isConnected ? '確認中斷' : '確認連接'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
