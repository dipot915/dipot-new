const SUPABASE_URL = "https://weuiojthjzbsgwivfmiv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tqNLg9hnr3OrZw2nUT8hTA_oisfQ6Hi";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: "Dipot", message: event.data ? event.data.text() : "" }; }

  const title = data.title || "Dipot";
  const options = {
    body: data.message || "",
    icon: data.icon || undefined,
    image: data.image || undefined,
    badge: data.icon || undefined,
    data: { url: data.url || "https://dipot.vercel.app/", notification_id: data.notification_id || null }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "https://dipot.vercel.app/";
  const notification_id = event.notification.data && event.notification.data.notification_id;

  event.waitUntil((async () => {
    // Best-effort click tracking — never blocks opening the link
    if (notification_id) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/notification_clicks`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + SUPABASE_ANON_KEY
          },
          body: JSON.stringify({ notification_id })
        });
      } catch (e) {}
    }
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.includes("dipot.vercel.app") && "focus" in client) {
        client.navigate(url);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
