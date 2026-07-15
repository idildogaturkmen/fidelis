# fidelis — backend setup (one-time, ~15 minutes)

The site works without any of this, but these three steps light up saving,
share links, accounts, the database waitlist, exact Google Maps place links,
and live ratings.

## 1. Supabase (saving, share links, accounts, waitlist) — free tier

1. Go to [supabase.com](https://supabase.com) → **New project** (any name, e.g. `fidelis`).
   Pick a strong database password and store it in a password manager — you won't need it day-to-day.
2. When the project is ready: **SQL Editor → New query** → paste the whole
   contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. **Authentication → URL Configuration** → set **Site URL** to
   `https://fidelisapp.netlify.app` (magic sign-in links redirect here).
4. **Project Settings → API** → copy two values:
   - **Project URL** (like `https://abcd1234.supabase.co`)
   - **anon public** key
5. Paste them into `index.html` at the top of the config block
   (`SUPABASE_URL` / `SUPABASE_ANON_KEY`), commit, push.

> The **anon public** key is designed to be public — all protection comes from
> the row-level-security policies in `schema.sql`. **Never** put the
> `service_role` key anywhere in this repo or the site.

## 2. Google Places API (exact Maps links + live ratings) — optional

Without this, Maps buttons fall back to search links (usually right, sometimes
a "partial match" list). With it, every hotel/restaurant links to its exact
Google Maps page and shows its live rating.

1. [console.cloud.google.com](https://console.cloud.google.com) → create a
   project → enable billing (Google gives monthly free credit that comfortably
   covers early usage).
2. **APIs & Services → Library** → enable **Places API (New)**.
3. **Credentials → Create credentials → API key**. Edit the key →
   **API restrictions** → restrict it to *Places API (New)* only.
4. Netlify → **Site configuration → Environment variables** → add
   `GOOGLE_MAPS_API_KEY` = your key → **Deploys → Trigger deploy**.

## 3. Waitlist fallback (only if skipping Supabase for now)

Netlify → **Site configuration → Forms → Enable form detection**, then
redeploy. Once Supabase is configured the waitlist writes to the database
instead and this toggle stops mattering.

## Affiliate/commission notes (when you're ready)

- **Booking.com** and **GetYourGuide** both have partner programs. The link
  builders live in one place in `index.html` (`bookingLink`, `gygLink`) — once
  you have partner IDs, each is a one-line change to become commissionable.
