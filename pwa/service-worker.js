// The build supplies an exact list of versioned static files.
const prefix = "gather-shell-";
const version = /* GATHER_SHELL_VERSION */ "";
const assets = /* GATHER_SHELL_ASSETS */ [];
const cacheName = prefix + version;
const paths = new Set(assets);
const home = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      try {
        for (const path of assets) {
          const response = await fetch(path, {
            cache: "reload",
            credentials: "same-origin",
            redirect: "error",
          });
          if (!response.ok || response.headers.get("x-gather-shell") !== "1") {
            await response.body?.cancel();
            throw new Error("Gather’s app files are unavailable.");
          }
          // Consume each response before opening the next connection.
          await cache.put(path, response);
        }
      } catch (error) {
        await caches.delete(cacheName);
        throw error;
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith(prefix) && name !== cacheName)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.search
  )
    return;

  if (request.mode === "navigate" && ["/", home].includes(url.pathname)) {
    event.respondWith(
      (async () => {
        // Honor an online sign-in page, redirect or denial. While authorized,
        // use the installed HTML and its matching bundles until the next activation.
        const response = await fetch(request, {
          cache: "no-store",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(4000)]),
        }).catch(() => null);
        if (
          response &&
          (!response.ok ||
            response.redirected ||
            response.headers.get("x-gather-shell") !== "1")
        )
          return response;
        const cache = await caches.open(cacheName);
        const cached = await cache.match(home);
        if (!cached) return response || Response.error();
        void response?.body?.cancel().catch(() => {});
        return cached;
      })(),
    );
  } else if (
    request.mode !== "navigate" &&
    url.pathname !== home &&
    paths.has(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(cacheName);
        return (await cache.match(url.pathname)) || fetch(request);
      })(),
    );
  }
});
