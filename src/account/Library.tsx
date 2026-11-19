import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Bookmark,
  Check,
  LogOut,
  ReceiptText,
  UsersRound,
} from "lucide-react";
import type { AppState } from "../lib/model";
import {
  AccountRequestError,
  accounts,
  type AccountEntry,
  type SavedReceiptEntry,
  type Session,
} from "./client";
import type { useAccount } from "./use-account";
import type { ReceiptSave } from "./use-receipt-save";

type Kind = "receipts" | "groups";

export function Library({
  account,
  session,
  draft,
  receiptSave,
  onOpenReceipt,
  onUseGroup,
}: {
  account: ReturnType<typeof useAccount>;
  session: Session;
  draft: AppState;
  receiptSave: ReceiptSave;
  onOpenReceipt: (entry: SavedReceiptEntry) => void;
  onUseGroup: (names: string[]) => void;
}) {
  const [entries, setEntries] = useState<Record<Kind, AccountEntry[]>>({
    receipts: [],
    groups: [],
  });
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const working = busy || receiptSave.saving;
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const groupSave = useRef<{ id: string; signature: string } | null>(null);

  function fail(reason: unknown) {
    if (!mounted.current) return;
    if (
      reason instanceof AccountRequestError &&
      reason.code === "session_required"
    )
      account.expired();
    else
      setError(
        reason instanceof Error
          ? reason.message
          : "Gather couldn’t finish the account request. Try again.",
      );
  }

  async function load() {
    try {
      const [receipts, groups] = await Promise.all([
        accounts.list("receipts"),
        accounts.list("groups"),
      ]);
      if (!mounted.current) return;
      account.touch(Math.max(receipts.expiresAt, groups.expiresAt));
      setEntries({ receipts: receipts.entries, groups: groups.entries });
    } catch (reason) {
      fail(reason);
    } finally {
      if (mounted.current) setInitializing(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
    // The library is keyed by user ID in AccountPage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (reason) {
      fail(reason);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function saveReceipt() {
    void run(async () => {
      const entry = await receiptSave.save();
      if (!mounted.current || !entry) return;
      setEntries((prior) => ({
        ...prior,
        receipts: [
          entry,
          ...prior.receipts.filter(({ id }) => id !== entry.id),
        ],
      }));
      setNotice("Receipt saved to your account.");
    });
  }

  function saveGroup(payload: { name: string; people: string[] }) {
    void run(async () => {
      const signature = JSON.stringify(payload);
      const previous = groupSave.current;
      const id =
        previous?.signature === signature ? previous.id : crypto.randomUUID();
      groupSave.current = { id, signature };
      const result = await accounts.save("groups", id, payload);
      if (!mounted.current) return;
      groupSave.current = null;
      account.touch(result.expiresAt);
      setEntries((prior) => ({
        ...prior,
        groups: [
          result.document,
          ...prior.groups.filter((item) => item.id !== id),
        ],
      }));
      setName("");
      setNotice("Split group saved to your account.");
    });
  }

  function open(kind: Kind, id: string) {
    void run(async () => {
      if (kind === "receipts") {
        const result = await accounts.receipt(id);
        if (!mounted.current) return;
        account.touch(result.expiresAt);
        onOpenReceipt(result.document);
      } else {
        const result = await accounts.group(id);
        if (!mounted.current) return;
        account.touch(result.expiresAt);
        onUseGroup(result.document.payload.people);
      }
    });
  }

  function remove(kind: Kind, entry: AccountEntry) {
    if (!window.confirm(`Remove “${entry.title}” from your saved ${kind}?`))
      return;
    void run(async () => {
      const result = await accounts.remove(kind, entry.id);
      if (!mounted.current) return;
      account.touch(result.expiresAt);
      if (kind === "receipts") receiptSave.forget(entry.id);
      setEntries((prior) => ({
        ...prior,
        [kind]: prior[kind].filter(({ id }) => id !== entry.id),
      }));
      setNotice("Saved entry removed.");
    });
  }

  function signOut(all: boolean) {
    void run(async () => {
      await accounts.signOut(all);
      if (mounted.current) account.signedOut();
    });
  }

  const people = draft.people.map(({ name }) => name.trim()).filter(Boolean);
  function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() && people.length) saveGroup({ name: name.trim(), people });
  }

  function list(kind: Kind) {
    return entries[kind].length ? (
      <ul className="saved-list">
        {entries[kind].map((entry) => (
          <li className="saved-entry" key={entry.id}>
            <div className="saved-entry-details">
              <span className="saved-entry-icon">
                {kind === "receipts" ? (
                  <ReceiptText size={19} aria-hidden="true" />
                ) : (
                  <UsersRound size={19} aria-hidden="true" />
                )}
              </span>
              <span>
                <strong>{entry.title}</strong>
                <time dateTime={new Date(entry.savedAt).toISOString()}>
                  {new Date(entry.savedAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </time>
              </span>
            </div>
            <div className="saved-actions">
              <button
                type="button"
                className="button button-outline saved-open"
                disabled={working}
                onClick={() => open(kind, entry.id)}
                aria-label={
                  kind === "receipts"
                    ? `Open receipt ${entry.title}`
                    : `Use group ${entry.title}`
                }
              >
                {kind === "receipts" ? "Open receipt" : "Use group"}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="text-button account-remove"
                disabled={working}
                onClick={() => remove(kind, entry)}
                aria-label={`Remove ${entry.title}`}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    ) : (
      <p className="account-empty">
        {initializing
          ? "Loading saved entries…"
          : `No saved ${kind === "receipts" ? "receipts" : "split groups"} yet.`}
      </p>
    );
  }

  return (
    <div className="account-library">
      <div className="account-library-head">
        <div>
          <h1 id="account-title" tabIndex={-1}>
            Your Library
          </h1>
          <p className="account-lead">{session.user.email}</p>
        </div>
        <button
          className="button button-outline"
          disabled={working}
          onClick={() => signOut(false)}
        >
          <LogOut size={18} aria-hidden="true" /> Sign out
        </button>
      </div>
      {error && (
        <div>
          <p role="alert" className="account-error">
            {error}
          </p>
          <button
            className="text-button"
            onClick={() => {
              setInitializing(true);
              void run(load);
            }}
            disabled={working}
          >
            Refresh saved entries
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className="account-library-grid" aria-busy={initializing || working}>
        <section className="account-panel" aria-labelledby="saved-receipts">
          <h2 id="saved-receipts">
            <ReceiptText size={21} aria-hidden="true" /> Saved receipts
          </h2>
          {list("receipts")}
          {draft.receipt.items.length > 0 && (
            <div className="library-save-current">
              <button
                type="button"
                className="button button-outline"
                disabled={initializing || working || receiptSave.saved}
                onClick={saveReceipt}
              >
                {receiptSave.saved ? (
                  <Check size={18} aria-hidden="true" />
                ) : (
                  <Bookmark size={18} aria-hidden="true" />
                )}
                {receiptSave.saving
                  ? "Saving…"
                  : receiptSave.saved
                    ? "Current receipt saved"
                    : "Save current receipt"}
              </button>
              {receiptSave.error && (
                <p className="account-error" role="alert">
                  {receiptSave.error}
                </p>
              )}
            </div>
          )}
        </section>
        <section className="account-panel" aria-labelledby="saved-groups">
          <h2 id="saved-groups">
            <UsersRound size={21} aria-hidden="true" /> Split groups
          </h2>
          {list("groups")}
          <form className="account-fields" onSubmit={submitGroup}>
            <label className="field" htmlFor="account-group-name">
              <span>Group name</span>
              <input
                id="account-group-name"
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!people.length || working}
              />
            </label>
            <button
              className="button button-outline"
              disabled={
                initializing || working || !people.length || !name.trim()
              }
            >
              Save people from this split
            </button>
          </form>
          {!people.length && (
            <p className="account-empty">
              Add people in the workspace to save them as a group.
            </p>
          )}
        </section>
      </div>
      <button
        type="button"
        className="text-button"
        disabled={working}
        onClick={() => signOut(true)}
      >
        Sign out on all devices
      </button>
    </div>
  );
}
