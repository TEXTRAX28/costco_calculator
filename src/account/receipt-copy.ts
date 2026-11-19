import { calculateSplit } from "../lib/engine";
import {
  appSchema,
  finalStamp,
  receiptStamp,
  type AppState,
} from "../lib/model";
import { prepareSavedReceiptReview } from "../lib/receipt-reconciliation";
import type { SavedReceipt } from "./client";

export function receiptToSave(
  state: AppState,
  finalized: boolean,
): SavedReceipt | null {
  const parsed = appSchema.safeParse({
    ...state,
    receipt: { ...state.receipt, rawText: "" },
    reviewedStamp: "",
    finalizedStamp: "",
    step: "review",
  });
  if (!parsed.success) return null;
  const copy = parsed.data;
  // Match the reviewed receipt after the server's schema normalizes field order.
  if (state.reviewedStamp === receiptStamp(state.receipt))
    copy.reviewedStamp = receiptStamp(copy.receipt);
  return { ...copy, ...(finalized ? { savedAsFinal: true } : {}) };
}

export function reopenSavedReceipt(saved: SavedReceipt): AppState {
  const { savedAsFinal, ...draft } = saved;
  const state = prepareSavedReceiptReview(draft);
  const stillFinal =
    savedAsFinal &&
    calculateSplit(state, { readingNotes: "advisory" }).canFinalize;
  return {
    ...state,
    step: "review",
    finalizedStamp: stillFinal ? finalStamp(state) : "",
  };
}
