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

## Branded sign-in email (2 minutes)

Supabase → **Authentication → Email Templates** → paste this into **both**
"Confirm signup" and "Magic Link" (subject and body):

**Subject:** `Your fidelis sign-in link ✈️`

```html
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0F2830;">
  <div style="font-size: 26px; font-weight: bold;">fide<span style="color:#2E8FAD;">lis</span></div>
  <p style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #14586E; margin-top: 2px;">your trip, handled</p>
  <p style="font-size: 16px; line-height: 1.6; margin-top: 24px;">One tap and you're in — your saved trips will be waiting for you.</p>
  <p style="margin: 28px 0;">
    <a href="{{ .ConfirmationURL }}" style="background: #0F2830; color: #F5F3EB; text-decoration: none; font-weight: bold; padding: 14px 26px; border-radius: 999px; display: inline-block;">Sign in to fidelis</a>
  </p>
  <p style="font-size: 13px; color: #5E7A80; line-height: 1.5;">Didn't request this? You can safely ignore it — nobody can sign in without this email.</p>
</div>
```

To make the email arrive *from* fidelis instead of Supabase, later add custom
SMTP (Supabase → Authentication → SMTP settings; Resend has a free tier).

## Affiliate/commission notes (when you're ready)

- **Booking.com** and **GetYourGuide** both have partner programs. The link
  builders live in one place in `index.html` (`bookingLink`, `gygLink`) — once
  you have partner IDs, each is a one-line change to become commissionable.
