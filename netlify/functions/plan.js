// Fidelis — serverless brain. Builds prompts, calls the Anthropic API, returns JSON.
const API = "https://api.anthropic.com/v1/messages";

/* ---------- abuse protection ---------- */
const MAX_BODY_BYTES = 10_000; // real quiz payloads are ~1-2 KB
const RATE_LIMIT = 30; // requests per window per IP (a 3-city trip = 7 requests)
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
    transport: list(f.transport, 40),
    occasion: str(f.occasion, 40),
    arrivalTime: str(f.arrivalTime, 30),
    departureTime: str(f.departureTime, 30),
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
    `Arrives day 1: ${f.arrivalTime || "time not specified"}. Departs last day: ${f.departureTime || "time not specified"}`,
    `Who: ${f.travelers}, ${f.groupSize} ${f.groupSize === 1 ? "person" : "people"}`,
    `Budget style: ${f.budget}${f.budgetNumber ? ` (roughly ${f.budgetNumber} total)` : ""}`,
    `Worth splurging on: ${(f.splurge || []).join(", ") || "no strong preference"}`,
    `Vibe: ${(f.vibes || []).join(", ") || "open to anything"}. Pace (1 relaxed – 5 packed): ${f.pace}`,
    `Food adventurousness: ${f.foodStyle}. Dietary needs: ${f.dietary || "none stated"}`,
    `Stay type: ${(f.stayType || []).join(", ") || "open"}. Must-haves: ${(f.mustHaves || []).join(", ") || "none stated"}`,
    `Room needs (hard requirements — never pick a hotel that can't meet them): ${(f.roomNeeds || []).join(", ") || "none stated"}`,
    `Getting around (respect this mix — cluster stops so the plan flows with these modes): ${(f.transport || []).join(", ") || "no preference"}. Occasion: ${f.occasion || "not specified"}`,
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
  const nights = num(body.nights, 1, 30, f.nights); // per-city override on multi-city trips
  const route = str(body.route, 300);

  if (action === "split") {
    const cities = Array.isArray(body.cities) ? body.cities.slice(0, 6).map(c => str(c, 60)).filter(Boolean) : [];
    if (cities.length < 2) return null;
    return `You are Fidelis, an expert AI travel agent. A traveler is planning ONE multi-city trip: ${cities.join(" → ")}. Total: ${f.nights} nights. Their profile:

${profile}${extra}

Decide how to split the nights (weight each city by how much it deserves for THEIR interests) and how to travel between cities. Reorder cities only if the route is clearly smarter. Respond ONLY with valid JSON, no markdown:
{"tripTitle":"evocative title, max 6 words","summary":"2 warm sentences, second person, about the whole route","cities":[in travel order, each {"name":"city, country","nights":N,"why":"under 12 words — why this many nights"}],"legs":[one per hop between consecutive cities, each {"from":"city","to":"city","mode":"train/bus/flight/ferry","duration":"e.g. ~2h40","tip":"under 15 words — real operators + where to book, e.g. 'ÖBB Railjet; book on oebb.at or omio'"}]}
Nights must sum to exactly ${f.nights}. Every leg must be a route that actually runs.`;
  }

  if (action === "hotels") {
    return `You are Fidelis, an expert AI travel agent. A traveler filled out your intake quiz:

${profile}${extra}
${route ? `\nThis stay is one leg of a multi-city trip (${route}). Plan hotels for ${destination} ONLY — ${nights} night${nights === 1 ? "" : "s"} there.\n` : ""}
Respond ONLY with valid JSON — no markdown, no preamble. Schema:
{"destination":"city, country you are planning for","tripTitle":"evocative title, max 6 words","summary":"2 warm sentences, second person, referencing their preferences","hotels":[3 items, best pick FIRST, each {"name":"the hotel's exact name as it appears on Google Maps","address":"street address","area":"neighborhood","pricePerNight":"e.g. $150-190","style":"3-word description","why":"1-2 sentences explaining why YOU chose it, referencing their stated preferences","matches":["2-3 of their must-haves or priorities it satisfies"]}]}
Be decisive — you are choosing FOR them. Every hotel must be a real, currently-operating, well-reviewed place you are confident exists and is findable on Google Maps — if unsure a place still operates, pick one you are sure about instead. Prices are honest estimates. Keep every string concise.`;
  }

  if (action === "days") {
    const isFirst = body.isFirstCity !== false;
    const isLast = body.isLastCity !== false;
    const prevCity = str(body.prevCity, 60), nextCity = str(body.nextCity, 60);
    const inboundMode = str(body.inboundMode, 20), outboundMode = str(body.outboundMode, 20);
    const arrivalRule = isFirst
      ? `- Day 1 must match their arrival time (${f.arrivalTime || "unspecified"}). Evening or late-night arrival = ONLY the transfer in, an easy near-hotel dinner, and rest — nothing ambitious. Any arrival: budget the airport-to-city transfer and, for international arrivals, a passport-queue buffer before the first real activity.`
      : `- Day 1 starts with the ${inboundMode || "journey"} in from ${prevCity || "the previous city"} — budget that arrival and hotel drop-off before any activity.`;
    const departureRule = isLast
      ? `- The final day must respect their departure time (${f.departureTime || "unspecified"}). Early-morning = nothing after breakfast and checkout; midday = at most one light stop near the hotel.`
      : `- The final day must include catching the onward ${outboundMode || "transport"} to ${nextCity || "the next city"} — plan around it, nothing ambitious after midday.`;
    return `You are Fidelis, an expert AI travel agent. Traveler profile:

${profile}${extra}
${route ? `\nThis is the ${destination} leg of a multi-city trip (${route}).\n` : ""}
They are staying at: ${str(body.hotelName, 120) || "a central hotel"} in ${destination}. This stay: ${nights} night${nights === 1 ? "" : "s"}.

Respond ONLY with valid JSON, no markdown. Schema:
{"days":[cover all ${nights} night${nights === 1 ? "" : "s"} of this stay; if longer than 7 days, group some (e.g. "4-5"); each {"d":"1","title":"short day theme","morning":"specific, practical plan, under 30 words — name places, best times, how to get there","afternoon":"under 30 words","evening":"under 30 words","note":"one insider tip, under 20 words — timing tricks, dress codes, what to skip","bookings":[0-3 items ONLY where advance tickets or reservations genuinely matter, each {"what":"attraction or experience name","channel":"where locals actually book this — the official site or pass if one exists (e.g. 'muze.gov.tr', 'Müzekart', 'the venue's own site', 'call the restaurant'), else a trusted platform","tip":"under 12 words, e.g. 'timed entry — book 2-3 days ahead'","urgency":"ONLY for places famous for selling out: the honest lead time, e.g. 'often sold out 4+ weeks ahead' — omit this field otherwise","officialSite":"full official booking URL ONLY if it is world-famous and you are completely certain — omit if any doubt"}]}]}
REALISM RULES (these build trust — never break them):
- Attractions famous for selling out (Vatican Museums, Colosseum, Alhambra, Anne Frank House, the Last Supper, Sagrada Família, Uffizi, hot tasting-menu restaurants, and the like) MUST appear in bookings with an honest "urgency" — a plan that assumes you can walk in is a broken plan. Never invent URLs; omit officialSite unless certain.
${arrivalRule}
${departureRule}
DENSITY BY PACE — their pace is ${f.pace}/5; hit this density honestly: 1-2 = one or two anchor activities per day with long, unhurried meals; 3 = two or three; 4 = three to five; 5 = four to six, packed, with quick meals. At pace 4-5, name multiple specific stops within each day-part; at pace 1-2, leave real gaps to wander.
Match their vibes. Keep it tight.`;
  }

  if (action === "eat") {
    return `You are Fidelis, an expert AI travel agent. Traveler profile:

${profile}${extra}
${route ? `\nThis is the ${destination} leg of a multi-city trip (${route}) — ${nights} night${nights === 1 ? "" : "s"} there.\n` : ""}
Pick where they'll eat in ${destination}, and what's worth knowing. Respond ONLY with valid JSON, no markdown:
{"food":[5 items, real places in ${destination}, each {"name":"the restaurant's exact name as it appears on Google Maps","address":"street address","type":"cuisine / meal","why":"under 15 words, tied to their tastes"}],"worthKnowing":[0-3 items ONLY when you are confident, each {"item":"city tourist card/pass (e.g. Vienna City Card), or a real seasonal event during their dates","verdict":"under 16 words — for a pass: is it honestly worth it for a ${nights}-night visit at pace ${f.pace}/5; for an event: what and when"}]}
Every restaurant must be a real, currently-operating place that locals and reputable travel guides consistently praise — never invent one; if unsure it still operates, choose one you are certain about. Favor beloved spots over tourist traps. worthKnowing: only passes that genuinely exist and events you are sure recur during their timing — never invent one; omit the array entirely when unsure.`;
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

async function askClaude(prompt, key, maxTokens) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens || 2500,
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
    // days and eat run in parallel client-side — each must stay well under
    // Netlify's function time limit (one combined call was timing out)
    const budgets = { days: 2600, eat: 1400, hotels: 2200, split: 1600, veto: 900 };
    const out = await askClaude(prompt, key, budgets[body.action]);
    await resolvePlaces(out, process.env.GOOGLE_MAPS_API_KEY, out.destination || str(body.destination, 120));
    return Response.json(out);
  } catch (e) {
    if (e instanceof FriendlyError) return err(502, e.message);
    console.error("plan.js error:", e);
    return err(500, "Your agent hit some turbulence — nothing's wrong with your answers. Try again in a moment.");
  }
};
