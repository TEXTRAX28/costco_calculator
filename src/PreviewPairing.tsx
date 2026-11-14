import { useEffect, useId, useRef, useState, type FormEvent } from "react";

export default function PreviewPairing({ onPaired }: { onPaired: () => void }) {
  const inputId = useId();
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; invalid?: boolean }>();

  useEffect(() => () => request.current?.abort(), []);

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") ?? "");
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(undefined);
    const unavailable =
      "Gather could not sign in. Check that the preview is running and try again.";
    try {
      const response = await fetch("/pair", {
        method: "POST",
        headers: { accept: "application/json" },
        body: new URLSearchParams({ code }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      if (response.status === 204) {
        form.reset();
        onPaired();
        return;
      }
      const result = await response.json().catch(() => null);
      if (typeof result?.error !== "string") throw new Error();
      setError({
        message: result.error.slice(0, 300),
        invalid: response.status === 401,
      });
    } catch {
      if (!controller.signal.aborted) setError({ message: unavailable });
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <form
      className="preview-pairing"
      action="/pair"
      method="post"
      onSubmit={(event) => void pair(event)}
    >
      <div className={`field${error?.invalid ? " field-invalid" : ""}`}>
        <label htmlFor={inputId}>Access code</label>
        <input
          id={inputId}
          type="password"
          name="code"
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={12}
          readOnly={pending}
          aria-invalid={error?.invalid || undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={() => setError(undefined)}
        />
        {error && (
          <small id={`${inputId}-error`} className="field-error" role="alert">
            {error.message}
          </small>
        )}
      </div>
      <button
        type="submit"
        className="button button-outline"
        disabled={pending}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
