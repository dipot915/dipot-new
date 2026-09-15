const webpush = require("web-push");
const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Push service configuration is missing on the server." });
    }
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verify the caller's session and role — never trust a role sent from the browser
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData || !userData.user) return res.status(401).json({ error: "Invalid session" });

    const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", userData.user.id).single();
    if (!profile || !["owner", "admin"].includes(profile.role)) {
      return res.status(403).json({ error: "Not authorized to send notifications" });
    }

    const { title, message, image_url, icon_url, target_url, test } = req.body || {};
    if (!title || !message) return res.status(400).json({ error: "Title and message are required" });

    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return res.status(500).json({ error: "Push service configuration is missing on the server." });
    }
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@example.com",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    let query = supabaseAdmin.from("push_subscriptions").select("*").eq("status", "active").order("created_at", { ascending: false });
    if (test) query = query.limit(1);
    const { data: subs, error: subsErr } = await query;
    if (subsErr) return res.status(500).json({ error: subsErr.message });
    if (!subs || subs.length === 0) return res.status(200).json({ sent: 0, failed: 0, message: "No subscribers yet." });

    const { data: notifRow, error: notifErr } = await supabaseAdmin.from("notifications").insert({
      title, message,
      image_url: image_url || null,
      icon_url: icon_url || null,
      target_url: target_url || "https://dipot.vercel.app/",
      created_by: userData.user.id,
      status: "sending"
    }).select().single();
    if (notifErr) return res.status(500).json({ error: notifErr.message });

    const payload = JSON.stringify({
      title, message,
      icon: icon_url || undefined,
      image: image_url || undefined,
      url: target_url || "https://dipot.vercel.app/",
      notification_id: notifRow.id
    });

    let sentCount = 0, failedCount = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sentCount++;
      } catch (err) {
        failedCount++;
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabaseAdmin.from("push_subscriptions").update({ status: "inactive" }).eq("id", s.id);
        }
      }
    }));

    await supabaseAdmin.from("notifications").update({
      status: "completed",
      sent_at: new Date().toISOString(),
      total_sent: sentCount,
      total_failed: failedCount
    }).eq("id", notifRow.id);

    return res.status(200).json({ sent: sentCount, failed: failedCount });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unexpected server error" });
  }
};
