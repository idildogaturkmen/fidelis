// Fidelis — serverless brain. Builds prompts, calls the Anthropic API, returns JSON.
const API = "https://api.anthropic.com/v1/messages";

/* ---------- abuse protection ---------- */
const MAX_BODY_BYTES = 10_000; // real quiz payloads are ~1-2 KB
const RATE_LIMIT = 20; // requests per window per IP (a full plan = 2 requests)
const RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map(); // per-instance memory: resets on cold start, which is fine for basic protection

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) {
    for (const [k, v] of hits) if (!v.some(t => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  return recent.length > RATE_LIMIT;
}

/* ---------- input sanitizing: clamp everything the prompt is built from ---------- */
const str = (v, max) => (typeof v === "string" || typeof v === "number" ? String(v) : "").slice(0, max).trim();
const num = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt; };
const list = (v, max) => (Array.isArray(v) ? v.slice(0, 12).map(x => str(x, max)).filter(Boolean) : []);

function cleanForm(f) {
  if (!f || typeof f !== "object") return null;
  return {
    destination: str(f.destination, 120),
    flexible: !!f.flexible,
    origin: str(f.origin, 120),
    nights: num(f.nights, 1, 30, 4),
    timing: str(f.timing, 120),
    travelers: str(f.travelers, 40) || "Couple",
    groupSize: num(f.groupSize, 1, 20, 2),
    budget: str(f.budget, 40),
    budgetNumber: str(f.budgetNumber, 80),
    splurge: list(f.splurge, 40),
    vibes: list(f.vibes, 40),
    pace: num(f.pace, 1, 5, 3),
    dietary: str(f.dietary, 300),
    foodStyle: str(f.foodStyle, 40),
    stayType: list(f.stayType, 40),
    mustHaves: list(f.mustHaves, 40),
    roomNeeds: list(f.roomNeeds, 40),
    transport: str(f.transport, 40),
    occasion: str(f.occasion, 40),
    dealbreakers: str(f.dealbreakers, 600),
    brief: str(f.brief, 1500),
  };
}

function profileText(f, destOverride) {
  const dest = destOverride || f.destination || "(no destination — pick the best fit)";
  return [
    `Destination: ${dest}${f.flexible ? " (flexible — feel free to pick the best-fit destination)" : ""}`,
    `Traveling from: ${f.origin || "not specified"}`,
    `Length: ${f.nights} nights. Timing: ${f.timing || "flexible"}`,
    `Who: ${f.travelers}, ${f.groupSize} ${f.groupSize === 1 ? "person" : "people"}`,
    `Budget style: ${f.budget}${f.budgetNumber ? ` (roughly ${f.budgetNumber} total)` : ""}`,
    `Worth splurging on: ${(f.splurge || []).join(", ") || "no strong preference"}`,
    `Vibe: ${(f.vibes || []).join(", ") || "open to anything"}. Pace (1 relaxed – 5 packed): ${f.pace}`,
    `Food adventurousness: ${f.foodStyle}. Dietary needs: ${f.dietary || "none stated"}`,
    `Stay type: ${(f.stayType || []).join(", ") || "open"}. Must-haves: ${(f.mustHaves || []).join(", ") || "none stated"}`,
    `Room needs (hard requirements — never pick a hotel that can't meet them): ${(f.roomNeeds || []).join(", ") || "none stated"}`,
    `Getting around: ${f.transport || "no preference"}. Occasion: ${f.occasion || "not specified"}`,
    `Dealbreakers: ${f.dealbreakers || "none stated"}`,
    `Their own words (most important — honor this above all): "${f.brief || "nothing extra"}"`,
  ].join("\n");
}

function buildPrompt(action, f, body) {
  const destination = str(body.destination, 120);
  const profile = profileText(f, destination);
  const extraText = str(body.extra, 400);
  const extra = extraText
    ? `\nIMPORTANT adjustment from the traveler: "${extraText}". Honor it.` : "";

  if (action === "hotels") {
    return `You are Fidelis, an expert AI travel agent. A traveler filled out your intake quiz:

${profile}${extra}

Respond ONLY with valid JSON — no markdown, no preamble. Schema:
{"destination":"city, country you are planning for","tripTitle":"evocative title, max 6 words","summary":"2 warm sentences, second person, referencing their preferences","hotels":[3 items, best pick FIRST, each {"name":"the hotel's exact name as it appears on Google Maps","address":"street address","area":"neighborhood","pricePerNight":"e.g. $150-190","style":"3-word description","why":"1-2 sentences explaining why YOU chose it, referencing their stated preferences","matches":["2-3 of their must-haves or priorities it satisfies"]}]}
Be decisive — you are choosing FOR them. Every hotel must be a real, currently-operating, well-reviewed place you are confident exists and is findable on Google Maps — if unsure a place still operates, pick one you are sure about instead. Prices are honest estimates. Keep every string concise.`;
  }

  if (action === "days") {
    return `You are Fidelis, an expert AI travel agent. Traveler profile:

${profile}${extra}

They are staying at: ${str(body.hotelName, 120) || "a central hotel"} in ${destination}. Trip length: ${f.nights} nights.

Respond ONLY with valid JSON, no markdown. Schema:
{"days":[cover the WHOLE trip; if longer than 7 days, group some (e.g. "4-5"); each {"d":"1","title":"short day theme","morning":"specific, practical plan, under 30 words — name places, best times, how to get there","afternoon":"under 30 words","evening":"under 30 words","note":"one insider tip, under 20 words — timing tricks, dress codes, what to skip","bookings":[0-3 items ONLY where advance tickets or reservations genuinely matter, each {"what":"attraction or experience name","channel":"where locals actually book this — the official site or pass if one exists (e.g. 'muze.gov.tr', 'Müzekart', 'the venue's own site', 'call the restaurant'), else a trusted platform","tip":"under 12 words, e.g. 'timed entry — book 2-3 days ahead'"}]}],"food":[5 items, real places in ${destination}, each {"name":"the restaurant's exact name as it appears on Google Maps","address":"street address","type":"cuisine / meal","why":"under 15 words, tied to their tastes"}]}
Every restaurant must be a real, currently-operating place that locals and reputable travel guides consistently praise — never invent one; if unsure it still operates, choose one you are certain about. Favor beloved spots over tourist traps. Match their pace (${f.pace}/5) and vibes. Keep it tight.`;
  }

  if (action === "veto") {
    return `You are Fidelis, an AI travel agent. Traveler profile:

${profile}

They rejected these hotels: ${str(body.rejected, 500)}. Suggest ONE different real, currently-operating, well-reviewed hotel in ${destination} that fits their profile better — exact name as it appears on Google Maps. Respond ONLY with JSON, no markdown:
{"hotel":{"name":"","address":"street address","area":"","pricePerNight":"","style":"","why":"1-2 sentences","matches":["..."]}}`;
  }
  return null;
}

/* ---------- Anthropic call: log details, surface only friendly text ---------- */
class FriendlyError extends Error {}

async function askClaude(prompt, key) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    console.error(`Anthropic API ${res.status}:`, (await res.text()).slice(0, 600));
    throw new FriendlyError(
      res.status === 429 || res.status === 529
        ? "Your agent is juggling a lot of trips right now. Give it a minute, then try again."
        : "Your agent couldn't reach home base just now. Try again in a moment."
    );
  }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  if (s === -1 || e === -1) {
    console.error("Model returned no JSON:", clean.slice(0, 300));
    throw new FriendlyError("Your agent's notes got garbled in transit. Try again — it usually works on the second go.");
  }
  return JSON.parse(clean.slice(s, e + 1));
}

/* ---------- optional Places enrichment ----------
   When GOOGLE_MAPS_API_KEY is set (Netlify env var; needs "Places API (New)"
   enabled), every hotel/restaurant gets its canonical Google Maps URL and live
   rating. Best-effort: any failure leaves the search-link fallback in place. */
async function resolvePlaces(out, key, cityHint) {
  if (!key || !out) return out;
  const enrich = async (item) => {
    try {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.googleMapsUri,places.rating,places.userRatingCount",
        },
        body: JSON.stringify({
          textQuery: [item.name, item.address, cityHint].filter(Boolean).join(", "),
          pageSize: 1,
        }),
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return;
      const p = (await res.json()).places?.[0];
      if (!p) return;
      if (p.googleMapsUri) item.mapsUrl = p.googleMapsUri;
      if (p.rating) { item.rating = p.rating; item.ratingCount = p.userRatingCount; }
    } catch { /* enrichment must never break a plan */ }
  };
  const jobs = [];
  for (const h of out.hotels || []) jobs.push(enrich(h));
  if (out.hotel) jobs.push(enrich(out.hotel));
  for (const f of out.food || []) jobs.push(enrich(f));
  await Promise.all(jobs);
  return out;
}

const err = (status, error) => Response.json({ error }, { status });

export default async (req, context) => {
  if (req.method !== "POST") return err(405, "POST only");

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("ANTHROPIC_API_KEY is not set — add it in Netlify: Site settings → Environment variables.");
    return err(500, "fidelis isn't fully set up yet — the site owner needs to finish configuration.");
  }

  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  if (rateLimited(ip)) {
    return err(429, "That's a lot of trips in a short time! Give your agent a few minutes to catch its breath, then try again.");
  }

  if (!(req.headers.get("content-type") || "").includes("application/json")) {
    return err(400, "Requests must be JSON.");
  }

  let body;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return err(413, "That brief is a bit too long for your agent — trim it down and try again.");
    body = JSON.parse(raw);
  } catch {
    return err(400, "Requests must be valid JSON.");
  }

  const form = cleanForm(body.form);
  if (!form) return err(400, "Your quiz answers didn't come through — please start from the beginning.");

  try {
    const prompt = buildPrompt(body.action, form, body);
    if (!prompt) return err(400, "Unknown action");
    const out = await askClaude(prompt, key);
    await resolvePlaces(out, process.env.GOOGLE_MAPS_API_KEY, out.destination || str(body.destination, 120));
    return Response.json(out);
  } catch (e) {
    if (e instanceof FriendlyError) return err(502, e.message);
    console.error("plan.js error:", e);
    return err(500, "Your agent hit some turbulence — nothing's wrong with your answers. Try again in a moment.");
  }
};
