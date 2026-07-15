// Fidelis — tiny privacy-friendly event log. No cookies, no IP storage, no third parties.
// Events land in the Netlify function log: Netlify dashboard → Logs → Functions → track.
// `sid` is a random id generated per page load (never stored on the visitor's device),
// so funnels can be read per visit without identifying anyone.
const EVENTS = new Set([
  "quiz_started",
  "quiz_completed",
  "plan_generated",
  "hotel_veto_used",
  "booking_link_clicked",
  "plan_redone",
  "plan_copied",
  "trip_saved",
  "pdf_downloaded",
  "waitlist_signup",
]);

export default async (req) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  try {
    const raw = await req.text();
    if (raw.length <= 300) {
      const { event, sid } = JSON.parse(raw);
      if (EVENTS.has(event)) {
        console.log("EVENT", JSON.stringify({
          event,
          sid: String(sid || "").slice(0, 12),
          at: new Date().toISOString(),
        }));
      }
    }
  } catch { /* analytics must never break anything */ }
  return new Response(null, { status: 204 });
};
