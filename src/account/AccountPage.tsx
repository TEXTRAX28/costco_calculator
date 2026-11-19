import { useEffect, useRef } from "react";
import { ArrowLeft, ShoppingBasket } from "lucide-react";
import LegalNotice from "../LegalNotice";
import type { AppState } from "../lib/model";
import { SignInForm } from "./SignInForm";
import { Library } from "./Library";
import type { SavedReceiptEntry } from "./client";
import type { useAccount } from "./use-account";
import type { ReceiptSave } from "./use-receipt-save";
import "./account.css";

export function AccountPage({
  account,
  draft,
  receiptSave,
  keepWorkspaceOpen,
  onReturn,
  onOpenReceipt,
  onUseGroup,
}: {
  account: ReturnType<typeof useAccount>;
  draft: AppState;
  receiptSave: ReceiptSave;
  keepWorkspaceOpen: boolean;
  onReturn: () => void;
  onOpenReceipt: (entry: SavedReceiptEntry) => void;
  onUseGroup: (names: string[]) => void;
}) {
  const page = useRef<HTMLElement>(null);
  const { session, availability } = account.status;
  const isLibrary = Boolean(session && account.route.view === "library");
  useEffect(() => {
    // Focus the page heading without opening the on-screen keyboard.
    page.current?.querySelector<HTMLElement>("#account-title")?.focus();
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [isLibrary, availability, account.loading]);

  return (
    <div className="account-shell">
      <header className="site-header account-header">
        <a
          href="/"
          className="brand"
          aria-label="Gather workspace"
          onClick={(event) => {
            event.preventDefault();
            onReturn();
          }}
        >
          <span className="brand-mark">
            <ShoppingBasket size={24} strokeWidth={1.8} aria-hidden="true" />
          </span>
          gather<span className="brand-dot">.</span>
        </a>
        <a
          className="text-button account-back"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            onReturn();
          }}
        >
          <ArrowLeft size={18} aria-hidden="true" />{" "}
          {session ? "Back to workspace" : "Continue as guest"}
        </a>
      </header>
      <main
        ref={page}
        className={
          isLibrary ? "account-main account-main-wide" : "account-main"
        }
        aria-labelledby="account-title"
      >
        {account.loading ? (
          <section className="account-card">
            <h1 id="account-title" tabIndex={-1}>
              Gather account
            </h1>
            <p role="status">Checking account access…</p>
          </section>
        ) : availability !== "ready" ? (
          <section className="account-card">
            <h1 id="account-title" tabIndex={-1}>
              Accounts unavailable
            </h1>
            <p role="status">
              You can still scan, enter and split receipts in the workspace.
            </p>
            <button
              className="button button-primary"
              onClick={() => void account.refresh()}
            >
              Check account access
            </button>
          </section>
        ) : isLibrary && session ? (
          <Library
            key={session.user.id}
            {...{
              account,
              session,
              draft,
              receiptSave,
              onOpenReceipt,
              onUseGroup,
            }}
          />
        ) : (
          <section className="account-card">
            <SignInForm
              account={account}
              keepWorkspaceOpen={keepWorkspaceOpen}
            />
          </section>
        )}
        <footer className="account-legal">
          <details>
            <summary>Privacy Policy</summary>
            <LegalNotice page="privacy" />
          </details>
          <details>
            <summary>Beta Terms</summary>
            <LegalNotice page="terms" />
          </details>
        </footer>
      </main>
    </div>
  );
}
