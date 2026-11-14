import { useCallback, useEffect, useRef, useState } from "react";
import { openaiConfiguration, ScanAccessError } from "./openai";

export function useScanConnection() {
  const pending = useRef<AbortController | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [checking, setChecking] = useState(online);
  const [signIn, setSignIn] = useState<ScanAccessError["recovery"] | null>(
    null,
  );
  const [config, setConfig] = useState<Awaited<
    ReturnType<typeof openaiConfiguration>
  > | null>(null);

  const check = useCallback(async () => {
    pending.current?.abort();
    pending.current = null;
    const available = navigator.onLine;
    setOnline(available);
    setChecking(available);
    if (!available) {
      setConfig(null);
      setSignIn(null);
      return;
    }
    const request = new AbortController();
    pending.current = request;
    try {
      const status = await openaiConfiguration(
        AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
      );
      if (!request.signal.aborted) {
        setConfig(status);
        setSignIn(null);
      }
    } catch (error) {
      if (!request.signal.aborted) {
        setConfig(null);
        setSignIn(error instanceof ScanAccessError ? error.recovery : null);
      }
    } finally {
      if (!request.signal.aborted) setChecking(false);
      if (pending.current === request) pending.current = null;
    }
  }, []);

  useEffect(() => {
    const connectivity = () => void check();
    const foreground = () => {
      if (!document.hidden) connectivity();
    };
    void check();
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      pending.current?.abort();
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [check]);

  return { online, checking, signIn, config, check };
}
