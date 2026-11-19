import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import {
  MAX_RECEIPT_TITLE_LENGTH,
  receiptTitleKey,
} from "../lib/receipt-title.mjs";
import type { AccountEntry, ReceiptNameChoice } from "./client";

function ReceiptDialog({
  title,
  description,
  children,
  onCancel,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    panel.showModal();
    panel
      .querySelector<HTMLButtonElement>("[data-receipt-dialog-cancel]")
      ?.focus();
    return () => panel.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="receipt-library-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {children}
    </dialog>
  );
}

export function ReceiptNameDialog({
  title,
  onSave,
  onCancel,
}: {
  title: string;
  onSave: (name: ReceiptNameChoice) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(title);
  const trimmed = name.trim();
  const sameName = receiptTitleKey(trimmed) === receiptTitleKey(title);
  return (
    <ReceiptDialog
      title="This receipt name is already used"
      description={`Your Library already has a receipt named “${title}”. Do you want to use the same name again?`}
      onCancel={onCancel}
    >
      <form
        className="receipt-name-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed)
            onSave({
              title: trimmed,
              ...(sameName ? { allowDuplicateTitle: true } : {}),
            });
        }}
      >
        <label className="field">
          <span>Receipt name</span>
          <input
            maxLength={MAX_RECEIPT_TITLE_LENGTH}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="receipt-dialog-actions">
          <button
            type="button"
            className="button button-outline"
            data-receipt-dialog-cancel
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={!trimmed}
          >
            <Bookmark size={17} aria-hidden="true" />
            {sameName ? "Keep both receipts" : "Save with new name"}
          </button>
        </div>
      </form>
    </ReceiptDialog>
  );
}

export function DeleteReceiptDialog({
  entry,
  onDelete,
  onCancel,
}: {
  entry: AccountEntry;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const saved = new Date(entry.savedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <ReceiptDialog
      title="Are you sure you want to delete this receipt?"
      description={`“${entry.title}”, saved ${saved}, will be removed from your Library.`}
      onCancel={onCancel}
    >
      <div className="receipt-dialog-actions">
        <button
          type="button"
          className="button button-outline"
          data-receipt-dialog-cancel
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button receipt-delete-confirm"
          onClick={onDelete}
        >
          <Trash2 size={17} aria-hidden="true" /> Delete receipt
        </button>
      </div>
    </ReceiptDialog>
  );
}
