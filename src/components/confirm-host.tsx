"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { registerConfirmHost, type ConfirmRequest } from "@/lib/confirm";

export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    registerConfirmHost((r) => {
      setReason("");
      setRequest(r);
    });
    return () => registerConfirmHost(null);
  }, []);

  function finish(confirmed: boolean) {
    request?.resolve(confirmed ? { reason: reason.trim() } : null);
    setRequest(null);
  }

  const minLength = request?.reason?.minLength ?? 0;
  const tooShort = reason.trim().length < minLength;

  return (
    <Dialog open={request !== null} onOpenChange={(open) => { if (!open) finish(false); }}>
      {request && (
        <DialogContent className="max-w-md">
          <DialogTitle>{request.title}</DialogTitle>
          {request.body && <p className="mb-3 text-sm text-muted-foreground">{request.body}</p>}
          {request.reason && (
            <label className="mb-3 block space-y-1 text-sm">
              <span className="text-muted-foreground">{request.reason.label}</span>
              <textarea
                className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={reason}
                maxLength={500}
                placeholder={request.reason.placeholder}
                onChange={(e) => setReason(e.target.value)}
              />
              {minLength > 0 && (
                <span className="block text-xs text-muted-foreground">
                  Minimum {minLength} znaków, teraz {reason.trim().length}.
                </span>
              )}
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => finish(false)}>Anuluj</Button>
            <Button
              size="sm"
              variant={request.destructive ? "destructive" : "default"}
              disabled={tooShort}
              onClick={() => finish(true)}
            >
              {request.confirmLabel}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
