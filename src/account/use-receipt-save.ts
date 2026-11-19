import { useMemo, useRef, useState } from "react";
import type { AppState } from "../lib/model";
import {
  AccountRequestError,
  accounts,
  type AccountEntry,
  type SavedReceipt,
} from "./client";
import { receiptToSave } from "./receipt-copy";
import type { useAccount } from "./use-account";

type Attempt = {
  owner: string;
  signature: string;
  id: string;
  phase: "saving" | "saved" | "error";
  entry?: AccountEntry;
  message?: string;
};

export function useReceiptSave(
  account: ReturnType<typeof useAccount>,
  draft: AppState,
  finalized: boolean,
) {
  const owner = account.status.session?.user.id;
  const canPrepare = Boolean(
    owner &&
    draft.receipt.items.length &&
    (draft.step === "summary" || account.route.view === "library"),
  );
  const copy = useMemo(
    () => (canPrepare ? receiptToSave(draft, finalized) : null),
    [canPrepare, draft, finalized],
  );
  const signature = useMemo(() => (copy ? JSON.stringify(copy) : ""), [copy]);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const latest = useRef<Attempt | null>(null);
  const matches = (value: Attempt | null) =>
    value && value.owner === owner && value.signature === signature
      ? value
      : null;
  const current = matches(attempt);

  function remember(value: Attempt | null) {
    latest.current = value;
    setAttempt(value);
  }

  async function save() {
    if (!owner || !canPrepare || latest.current?.phase === "saving") return;
    const previous = matches(latest.current);
    if (previous?.phase === "saved") return previous.entry;
    // Retry with the same ID if the save succeeded but the response was lost.
    const pending = {
      owner,
      signature,
      id: previous?.id || crypto.randomUUID(),
    };
    if (!copy) {
      remember({
        ...pending,
        phase: "error",
        message: "Check the receipt details before saving this copy.",
      });
      return;
    }
    remember({ ...pending, phase: "saving" });
    try {
      const { document, expiresAt } = await accounts.save(
        "receipts",
        pending.id,
        copy,
      );
      account.touch(expiresAt);
      remember({ ...pending, phase: "saved", entry: document });
      return document;
    } catch (reason) {
      if (
        reason instanceof AccountRequestError &&
        reason.code === "session_required"
      )
        account.expired();
      remember({
        ...pending,
        phase: "error",
        message:
          reason instanceof Error
            ? reason.message
            : "Gather couldn’t save this receipt. Try again.",
      });
    }
  }

  return {
    save,
    saved: current?.phase === "saved",
    saving: attempt?.phase === "saving",
    error: current?.message,
    markOpened(entry: AccountEntry, opened: SavedReceipt | null) {
      if (!owner || !opened || latest.current?.phase === "saving") return;
      remember({
        owner,
        signature: JSON.stringify(opened),
        id: entry.id,
        phase: "saved",
        entry,
      });
    },
    forget(id: string) {
      if (latest.current?.owner === owner && latest.current?.id === id)
        remember(null);
    },
  };
}

export type ReceiptSave = ReturnType<typeof useReceiptSave>;
