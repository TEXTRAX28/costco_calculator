import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Eye, EyeOff, LoaderCircle, LogIn, MailCheck } from "lucide-react";
import { z } from "zod";
import { AccountRequestError, accounts } from "./client";
import type { useAccount } from "./use-account";

type Mode = "sign-in" | "register" | "recover" | "resend" | "reset" | "verify";
const heading: Record<Mode, string> = {
  "sign-in": "Sign in",
  register: "Create your account",
  recover: "Reset your password",
  resend: "Resend verification email",
  reset: "Choose a new password",
  verify: "Verify your email",
};
const actions: Record<Mode, string> = {
  "sign-in": "Sign in",
  register: "Create account",
  recover: "Send reset link",
  resend: "Send verification link",
  reset: "Save new password",
  verify: "Verify email",
};
const delivery: Record<"register" | "resend" | "recover", string> = {
  register:
    "If this address can be registered, a verification email is on its way. Check your inbox and spam folder.",
  resend:
    "If the details match an unverified account, a new link is on its way.",
  recover:
    "If an account can be recovered with that address, a reset link is on its way.",
};

export function SignInForm({
  account,
  keepWorkspaceOpen,
}: {
  account: ReturnType<typeof useAccount>;
  keepWorkspaceOpen: boolean;
}) {
  const link = account.route.action;
  const [mode, setMode] = useState<Mode>(
    link?.kind === "verifyEmail"
      ? "verify"
      : link?.kind === "resetPassword"
        ? "reset"
        : "sign-in",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [googleUrl, setGoogleUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AccountRequestError | null>(null);
  const [notice, setNotice] = useState("");
  const loading = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const changed = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (changed.current) headingRef.current?.focus();
  }, [mode]);
  useLayoutEffect(() => {
    if (!error || pending) return;
    if (error.code === "expired_link") headingRef.current?.focus();
    else if (error.field === "email") emailRef.current?.focus();
    else if (error.field === "password") passwordRef.current?.focus();
    else errorRef.current?.focus();
  }, [error, pending]);

  const returnTo = account.route.view === "library" ? "/?account=1" : "/";
  const newPassword = mode === "register" || mode === "reset";
  const needsEmail = mode !== "reset" && mode !== "verify";
  const needsPassword = mode !== "recover" && mode !== "verify";

  function switchTo(next: Mode) {
    changed.current = true;
    setMode(next);
    setPassword("");
    setShown(false);
    setGoogleUrl("");
    setError(null);
    setNotice("");
    if (account.route.action) account.go("/auth", true);
  }

  function explain(reason: unknown) {
    const issue =
      reason instanceof AccountRequestError
        ? reason
        : new AccountRequestError(
            "Gather couldn’t finish this request. Try again.",
          );
    setError(issue);
  }

  async function perform(operation: () => Promise<void>) {
    if (loading.current) return;
    loading.current = true;
    setPending(true);
    setNotice("");
    setError(null);
    try {
      await operation();
    } catch (reason) {
      if (mounted.current) explain(reason);
    } finally {
      loading.current = false;
      if (mounted.current) {
        setPending(false);
        setShown(false);
        setPassword("");
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading.current) return;
    if (needsEmail && !z.email().safeParse(email.trim()).success)
      return explain(
        new AccountRequestError(
          "Enter a valid email address.",
          "invalid",
          "email",
        ),
      );
    if (needsPassword && !password)
      return explain(
        new AccountRequestError("Enter your password.", "invalid", "password"),
      );
    if (
      newPassword &&
      (Array.from(password).length < 15 || Array.from(password).length > 128)
    )
      return explain(
        new AccountRequestError(
          "Use 15 to 128 characters.",
          "invalid",
          "password",
        ),
      );
    void perform(async () => {
      if (mode === "sign-in") {
        const result = await accounts.signIn(email, password, returnTo);
        if (mounted.current)
          account.signedIn(result.session, result.destination);
        return;
      }
      if (mode === "verify" || mode === "reset") {
        if (!link?.code)
          throw new AccountRequestError(
            "This link is invalid or has expired.",
            "expired_link",
          );
        if (mode === "verify") await accounts.verify(link.code);
        else await accounts.reset(link.code, password);
        if (mounted.current) {
          switchTo("sign-in");
          setNotice(
            mode === "verify"
              ? "Email verified. You can sign in."
              : "Password updated. Sign in with your new password.",
          );
          if (mode === "reset") void account.refresh();
        }
        return;
      }
      await accounts.mail(mode, email, password);
      if (mounted.current) setNotice(delivery[mode]);
    });
  }

  if (link?.kind === "invalid" || error?.code === "expired_link")
    return (
      <div className="account-form-content">
        <h1 id="account-title" tabIndex={-1} ref={headingRef}>
          This link can’t be used
        </h1>
        <p role="alert">
          The link is invalid or has expired. Request a new one from Gather.
        </p>
        <button
          className="button button-primary"
          onClick={() =>
            switchTo(link?.kind === "verifyEmail" ? "resend" : "recover")
          }
        >
          Request a new link
        </button>
        <button className="text-button" onClick={() => switchTo("sign-in")}>
          Back to sign in
        </button>
      </div>
    );

  return (
    <div className="account-form-content">
      <h1 id="account-title" tabIndex={-1} ref={headingRef}>
        {heading[mode]}
      </h1>
      <p className="account-lead">
        {mode === "sign-in"
          ? "Open the receipts and split groups you’ve saved to Gather."
          : mode === "register"
            ? "Verify your email to start saving receipts and split groups."
            : mode === "verify"
              ? "Confirm this email address before signing in."
              : mode === "resend"
                ? "Enter the email and password you used to create your account."
                : mode === "recover"
                  ? "We’ll send a reset link if this address has an account."
                  : "Choose a passphrase you can remember or use your password manager."}
      </p>
      {(notice || account.status.notice) && (
        <p className="notice" role="status">
          {notice || account.status.notice}
        </p>
      )}
      {account.route.message && !error && (
        <p className="notice warning" role="status">
          {account.route.message}
        </p>
      )}
      {error && !error.field && (
        <p className="account-error" role="alert" tabIndex={-1} ref={errorRef}>
          {error.message}
        </p>
      )}
      <form noValidate onSubmit={submit}>
        <fieldset
          className="account-fields"
          disabled={pending}
          aria-busy={pending}
        >
          {needsEmail && (
            <div className="field">
              <label htmlFor="account-email">Email address</label>
              <input
                id="account-email"
                name="email"
                type="email"
                ref={emailRef}
                autoComplete={mode === "recover" ? "email" : "username"}
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error?.field === "email") setError(null);
                }}
                aria-invalid={error?.field === "email" || undefined}
                aria-describedby={
                  error?.field === "email" ? "account-email-error" : undefined
                }
              />
              {error?.field === "email" && (
                <span
                  className="account-error"
                  id="account-email-error"
                  role="alert"
                >
                  {error.message}
                </span>
              )}
            </div>
          )}
          {needsPassword && (
            <div className="field">
              <label htmlFor="account-password">
                {mode === "reset" ? "New password" : "Password"}
              </label>
              <div className="account-password">
                <input
                  id="account-password"
                  name="password"
                  type={shown ? "text" : "password"}
                  ref={passwordRef}
                  autoComplete={
                    newPassword ? "new-password" : "current-password"
                  }
                  required
                  maxLength={256}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error?.field === "password") setError(null);
                  }}
                  aria-invalid={error?.field === "password" || undefined}
                  aria-describedby={
                    [
                      newPassword && "account-password-hint",
                      error?.field === "password" && "account-password-error",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShown(!shown)}
                  aria-label={shown ? "Hide password" : "Show password"}
                >
                  {shown ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                  {shown ? "Hide" : "Show"}
                </button>
              </div>
              {newPassword && (
                <small id="account-password-hint">
                  15 to 128 characters. Spaces are welcome.
                </small>
              )}
              {error?.field === "password" && (
                <span
                  className="account-error"
                  id="account-password-error"
                  role="alert"
                >
                  {error.message}
                </span>
              )}
            </div>
          )}
          <button
            type="submit"
            className="button button-primary account-submit"
          >
            {pending ? (
              <LoaderCircle
                size={18}
                className="account-spinner"
                aria-hidden="true"
              />
            ) : mode === "verify" ? (
              <MailCheck size={18} aria-hidden="true" />
            ) : (
              <LogIn size={18} aria-hidden="true" />
            )}
            {pending ? "Please wait…" : actions[mode]}
          </button>
          {mode === "sign-in" && account.status.google && (
            <button
              type="button"
              className="button button-outline"
              onClick={() => {
                void perform(async () => {
                  const url = await accounts.startGoogle(returnTo);
                  if (mounted.current) {
                    if (keepWorkspaceOpen) setGoogleUrl(url);
                    else window.location.assign(url);
                  }
                });
              }}
            >
              Continue with Google
            </button>
          )}
        </fieldset>
      </form>
      {mode === "sign-in" && googleUrl && (
        <div>
          {account.status.session ? (
            <p role="status">
              You’re signed in. Return to the workspace to pick up your draft.
            </p>
          ) : (
            <>
              <p className="account-lead">
                Keep this tab open to preserve your in-progress receipt.
              </p>
              <a
                className="text-button"
                href={googleUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Google sign-in in a new tab
              </a>
            </>
          )}
        </div>
      )}
      <div className="account-form-links">
        {mode === "sign-in" ? (
          <>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => switchTo("recover")}
            >
              Forgot password?
            </button>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => switchTo("register")}
            >
              Create an account
            </button>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => switchTo("resend")}
            >
              Resend verification email
            </button>
          </>
        ) : (
          <button
            type="button"
            className="text-button"
            disabled={pending}
            onClick={() => switchTo("sign-in")}
          >
            Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}
