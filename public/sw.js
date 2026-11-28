// NEXUS app shell service worker. It only shows a static offline page when a page cannot load. It never stores
// responses from the app, so no private record is ever kept on the device by this worker.
const CACHE = "nexus-shell-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([OFFLINE, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

// Phone notifications: the push carries no content. Fetch the member's own unread messages with their session.
self.addEventListener("push", event => {
  event.waitUntil(fetch("/api/push", { credentials: "same-origin", cache: "no-store" })
    .then(response => response.ok ? response.json() : [])
    .then(messages => messages.length
      ? Promise.all(messages.map(m => self.registration.showNotification(m.title, { body: m.body, data: m.url, icon: "/icons/icon-192.png", tag: m.id })))
      : self.registration.showNotification("NEXUS", { body: "Open NEXUS for a new update.", data: "/", icon: "/icons/icon-192.png" })));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = typeof event.notification.data === "string" && event.notification.data.startsWith("/") ? event.notification.data : "/";
  event.waitUntil(self.clients.matchAll({ type: "window" }).then(windows => {
    const open = windows.find(w => new URL(w.url).pathname === url);
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
