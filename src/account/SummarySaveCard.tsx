import { ArrowRight, Bookmark, Check, LogIn } from "lucide-react";
import { useId } from "react";
import { ReceiptNameDialog } from "./ReceiptDialogs";
import type { ReceiptSave } from "./use-receipt-save";

export function SummarySaveCard({
  signedIn,
  finalized,
  receiptSave,
  onSignIn,
  onOpenLibrary,
}: {
  signedIn: boolean;
  finalized: boolean;
  receiptSave: ReceiptSave;
  onSignIn: () => void;
  onOpenLibrary: () => void;
}) {
  const title = useId();
  return (
    <section className="panel summary-save-card" aria-labelledby={title}>
      <span className="icon-disc summary-save-icon">
        {receiptSave.saved ? (
          <Check size={22} aria-hidden="true" />
        ) : (
          <Bookmark size={22} aria-hidden="true" />
        )}
      </span>
      <div className="summary-save-copy">
        <h2 id={title}>Keep this receipt</h2>
        <p role="status">
          {receiptSave.saved
            ? finalized
              ? "Receipt saved to your Library."
              : "Draft saved to your Library."
            : "Save the items and everyone’s share together."}
        </p>
      </div>
      {receiptSave.saved ? (
        <button
          type="button"
          className="button button-outline"
          onClick={onOpenLibrary}
        >
          View Library <ArrowRight size={17} aria-hidden="true" />
        </button>
      ) : signedIn ? (
        <button
          type="button"
          className="button button-primary"
          disabled={receiptSave.saving}
          onClick={() => void receiptSave.save()}
        >
          <Bookmark size={17} aria-hidden="true" />
          {receiptSave.saving
            ? "Saving…"
            : finalized
              ? "Save receipt"
              : "Save draft"}
        </button>
      ) : (
        <button
          type="button"
          className="button button-primary"
          onClick={onSignIn}
        >
          <LogIn size={17} aria-hidden="true" /> Sign in to save
        </button>
      )}
      {receiptSave.error && (
        <p className="summary-save-error" role="alert">
          {receiptSave.error}
        </p>
      )}
      {receiptSave.duplicateTitle && (
        <ReceiptNameDialog
          key={receiptSave.duplicateTitle}
          title={receiptSave.duplicateTitle}
          onSave={(name) => void receiptSave.save(name)}
          onCancel={receiptSave.cancelName}
        />
      )}
    </section>
  );
}
