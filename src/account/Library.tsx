import { useEffect, useRef, useState, type FormEvent } from "react";
import { FolderOpen, LogOut, ReceiptText, UsersRound } from "lucide-react";
import type { AppState } from "../lib/model";
import {
  AccountRequestError,
  accounts,
  type AccountEntry,
  type Session,
} from "./client";
import type { useAccount } from "./use-account";

type Kind = "receipts" | "groups";

export function Library({
  account,
  session,
  draft,
  onOpenReceipt,
  onUseGroup,
}: {
  account: ReturnType<typeof useAccount>;
  session: Session;
  draft: AppState;
  onOpenReceipt: (draft: AppState) => void;
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
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const saveId = useRef<
    Partial<Record<Kind, { id: string; signature: string }>>
  >({});

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

  function save(kind: Kind, payload: unknown) {
    void run(async () => {
      const signature = JSON.stringify(payload);
      const previous = saveId.current[kind];
      const id =
        previous?.signature === signature ? previous.id : crypto.randomUUID();
      saveId.current[kind] = { id, signature };
      const result = await accounts.save(kind, id, payload);
      if (!mounted.current) return;
      delete saveId.current[kind];
      account.touch(result.expiresAt);
      setEntries((prior) => ({
        ...prior,
        [kind]: [
          result.document,
          ...prior[kind].filter((item) => item.id !== id),
        ],
      }));
      if (kind === "groups") setName("");
      setNotice(
        kind === "receipts"
          ? "Receipt saved to your account."
          : "Split group saved to your account.",
      );
    });
  }

  function open(kind: Kind, id: string) {
    void run(async () => {
      if (kind === "receipts") {
        const result = await accounts.receipt(id);
        if (!mounted.current) return;
        account.touch(result.expiresAt);
        onOpenReceipt(result.document.payload);
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
    if (name.trim() && people.length)
      save("groups", { name: name.trim(), people });
  }

  function list(kind: Kind) {
    return entries[kind].length ? (
      <ul className="saved-list">
        {entries[kind].map((entry) => (
          <li key={entry.id}>
            <div>
              <strong>{entry.title}</strong>
              <time dateTime={new Date(entry.savedAt).toISOString()}>
                {new Date(entry.savedAt).toLocaleDateString()}
              </time>
            </div>
            <div className="saved-actions">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => open(kind, entry.id)}
                aria-label={`Open ${entry.title}`}
              >
                {kind === "receipts" ? "Open copy" : "Use"}
              </button>
              <button
                className="text-button account-remove"
                disabled={busy}
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
            Your account
          </h1>
          <p className="account-lead">{session.user.email}</p>
        </div>
        <button
          className="button button-outline"
          disabled={busy}
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
            disabled={busy}
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
      <div className="account-library-grid" aria-busy={initializing || busy}>
        <section className="account-panel" aria-labelledby="saved-receipts">
          <h2 id="saved-receipts">
            <ReceiptText size={21} aria-hidden="true" /> Saved receipts
          </h2>
          {list("receipts")}
          <p className="account-lead">
            Save the current receipt details and split. Original photos and PDFs
            stay on this device.
          </p>
          <button
            className="button button-primary"
            disabled={busy || !draft.receipt.items.length}
            onClick={() =>
              save("receipts", {
                ...draft,
                receipt: { ...draft.receipt, rawText: "" },
              })
            }
          >
            <FolderOpen size={18} aria-hidden="true" /> Save current receipt
          </button>
          {!draft.receipt.items.length && (
            <p className="account-empty">
              Add a receipt in the workspace to save it here.
            </p>
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
                disabled={!people.length || busy}
              />
            </label>
            <button
              className="button button-outline"
              disabled={busy || !people.length || !name.trim()}
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
        disabled={busy}
        onClick={() => signOut(true)}
      >
        Sign out on all devices
      </button>
    </div>
  );
}
