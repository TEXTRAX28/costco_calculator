import { useEffect, useState } from "react";

export default function AppUpdate() {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (
      !import.meta.env.PROD ||
      !window.isSecureContext ||
      !navigator.serviceWorker
    )
      return;
    const workers = navigator.serviceWorker;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    let disposed = false;

    const checkWaiting = () => {
      setWaiting(Boolean(registration?.waiting && workers.controller));
    };
    const watchInstallation = () => {
      installing?.removeEventListener("statechange", checkWaiting);
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", checkWaiting);
      checkWaiting();
    };
    const checkForUpdate = () => {
      if (!document.hidden) void registration?.update().catch(() => {});
    };
    void workers
      .register("/sw.js", { updateViaCache: "none" })
      .then((result) => {
        if (disposed) return;
        registration = result;
        registration.addEventListener("updatefound", watchInstallation);
        workers.addEventListener("controllerchange", checkWaiting);
        document.addEventListener("visibilitychange", checkForUpdate);
        watchInstallation();
      })
      .catch(() => {
        // Standalone and online workflows remain available if caching is denied.
      });

    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", watchInstallation);
      installing?.removeEventListener("statechange", checkWaiting);
      workers.removeEventListener("controllerchange", checkWaiting);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);

  return waiting ? (
    <p className="notice" role="status">
      An update is ready. Finish your receipt, then close all Gather windows and
      reopen the app to update.
    </p>
  ) : null;
}
