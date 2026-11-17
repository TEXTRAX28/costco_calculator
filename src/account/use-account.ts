import { useCallback, useEffect, useRef, useState } from "react";
import { accounts, type AccountStatus, type Session } from "./client";

type Route = {
  view: "workspace" | "access" | "library";
  action?: { kind: "verifyEmail" | "resetPassword" | "invalid"; code: string };
  message?: string;
};

export function readAccountRoute(): Route {
  const { pathname, search } = window.location;
  const query = new URLSearchParams(search);
  if (pathname === "/auth/action") {
    const kind = query.get("mode");
    const value = query.get("oobCode") || "";
    const valid =
      (kind === "verifyEmail" || kind === "resetPassword") &&
      query.getAll("oobCode").length === 1 &&
      query.getAll("mode").length === 1 &&
      /^[A-Za-z0-9_-]{1,1024}$/.test(value);
    if (search) history.replaceState(null, "", "/auth/action");
    return {
      view: "access",
      action: valid ? { kind, code: value } : { kind: "invalid", code: "" },
    };
  }
  if (pathname === "/auth") {
    const status = query.get("status");
    const message =
      status === "cancelled"
        ? "Google sign-in was cancelled."
        : status === "unavailable"
          ? "Google sign-in is temporarily unavailable. Try again or use email."
          : status === "failed"
            ? "Google sign-in couldn’t be completed. Start again from Gather."
            : "";
    if (search) history.replaceState(null, "", "/auth");
    return { view: "access", message };
  }
  return { view: query.get("account") === "1" ? "library" : "workspace" };
}

const checking: AccountStatus = {
  availability: "disabled",
  session: null,
  google: false,
};
const expiredNotice =
  "Your session ended. Sign in again to open saved entries.";

export function useAccount(initial: Route) {
  const [route, setRoute] = useState(initial);
  const [status, setStatus] = useState(checking);
  const [loading, setLoading] = useState(true);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestVersion.current;
    try {
      const latest = await accounts.status();
      if (requestId === requestVersion.current) {
        setStatus((prior) => ({
          ...latest,
          notice:
            prior.session && !latest.session ? expiredNotice : prior.notice,
        }));
      }
    } catch {
      if (requestId === requestVersion.current)
        setStatus({
          availability: "unavailable",
          session: null,
          google: false,
        });
    } finally {
      if (requestId === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const popped = () => setRoute(readAccountRoute());
    const revisit = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("popstate", popped);
    window.addEventListener("online", revisit);
    window.addEventListener("pageshow", revisit);
    document.addEventListener("visibilitychange", revisit);
    return () => {
      requestVersion.current++;
      window.removeEventListener("popstate", popped);
      window.removeEventListener("online", revisit);
      window.removeEventListener("pageshow", revisit);
      document.removeEventListener("visibilitychange", revisit);
    };
  }, [refresh]);

  const expiresAt = status.session?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(
      () => {
        setStatus((prior) =>
          prior.session?.expiresAt === expiresAt
            ? { ...prior, session: null, notice: expiredNotice }
            : prior,
        );
        void refresh();
      },
      Math.min(2_147_483_647, Math.max(500, expiresAt - Date.now() + 500)),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, refresh]);

  function go(path: "/auth" | "/" | "/?account=1", replace = false) {
    history[replace ? "replaceState" : "pushState"](null, "", path);
    setRoute(readAccountRoute());
  }

  return {
    route,
    status,
    loading,
    go,
    refresh,
    signedIn(session: Session, destination: "/" | "/?account=1") {
      requestVersion.current++;
      setStatus((prior) => ({ ...prior, session, notice: "" }));
      go(destination, true);
    },
    signedOut() {
      requestVersion.current++;
      setStatus((prior) => ({
        ...prior,
        session: null,
        notice: "You’re signed out. Your draft is still on this device.",
      }));
      go("/auth", true);
    },
    expired() {
      requestVersion.current++;
      setStatus((prior) => ({
        ...prior,
        session: null,
        notice: expiredNotice,
      }));
    },
    touch(time: number) {
      setStatus((prior) =>
        prior.session && time > prior.session.expiresAt
          ? { ...prior, session: { ...prior.session, expiresAt: time } }
          : prior,
      );
    },
  };
}
