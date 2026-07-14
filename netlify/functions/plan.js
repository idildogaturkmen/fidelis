// Fidelis — serverless brain. Builds prompts, calls the Anthropic API, returns JSON.
const API = "https://api.anthropic.com/v1/messages";

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
    `Dealbreakers: ${f.dealbreakers || "none stated"}`,
    `Their own words (most important — honor this above all): "${f.brief || "nothing extra"}"`,
  ].join("\n");
}

function buildPrompt(action, body) {
  const f = body.form;
  const profile = profileText(f, body.destination);
  const extra = body.extra
    ? `\nIMPORTANT adjustment from the traveler: "${body.extra}". Honor it.` : "";

  if (action === "hotels") {
    return `You are Fidelis, an expert AI travel agent. A traveler filled out your intake quiz:

${profile}${extra}

Respond ONLY with valid JSON — no markdown, no preamble. Schema:
{"destination":"city, country you are planning for","tripTitle":"evocative title, max 6 words","summary":"2 warm sentences, second person, referencing their preferences","hotels":[3 items, best pick FIRST, each {"name":"real currently-operating hotel","area":"neighborhood","pricePerNight":"e.g. $150-190","style":"3-word description","why":"1-2 sentences explaining why YOU chose it, referencing their stated preferences","matches":["2-3 of their must-haves or priorities it satisfies"]}]}
Be decisive — you are choosing FOR them. Prices are honest estimates. Keep every string concise.`;
  }

  if (action === "days") {
    return `You are Fidelis, an expert AI travel agent. Traveler profile:

${profile}${extra}

They are staying at: ${body.hotelName || "a central hotel"} in ${body.destination}. Trip length: ${f.nights} nights.

Respond ONLY with valid JSON, no markdown. Schema:
{"days":[cover the WHOLE trip; if longer than 7 days, group some (e.g. "4-5"); each {"d":"1","title":"short day theme","morning":"specific plan, under 22 words","afternoon":"under 22 words","evening":"under 22 words","note":"one insider tip, under 18 words"}],"food":[5 items, real places in ${body.destination}, each {"name":"restaurant name","type":"cuisine / meal","why":"under 15 words, tied to their tastes"}]}
Match their pace (${f.pace}/5) and vibes. Keep it tight.`;
  }

  if (action === "veto") {
    return `You are Fidelis, an AI travel agent. Traveler profile:

${profile}

They rejected these hotels: ${body.rejected}. Suggest ONE different real, currently-operating hotel in ${body.destination} that fits their profile better. Respond ONLY with JSON, no markdown:
{"hotel":{"name":"","area":"","pricePerNight":"","style":"","why":"1-2 sentences","matches":["..."]}}`;
  }
  return null;
}

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
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("Model returned no JSON");
  return JSON.parse(clean.slice(s, e + 1));
}

export default async (req) => {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json(
    { error: "Missing ANTHROPIC_API_KEY — add it in Netlify: Site settings → Environment variables." },
    { status: 500 }
  );
  try {
    const body = await req.json();
    const prompt = buildPrompt(body.action, body);
    if (!prompt) return Response.json({ error: "Unknown action" }, { status: 400 });
    const out = await askClaude(prompt, key);
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
};
