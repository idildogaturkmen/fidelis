# fidelis

**Your trip, handled.** An AI travel agent for couples and friend groups who hate logistics: answer a short quiz about your tastes and budget, and fidelis plans and arranges the whole trip — one decisive hotel pick (with reasoning and one-tap veto), a day-by-day itinerary, and restaurants.

Live at [fidelisapp.netlify.app](https://fidelisapp.netlify.app).

## Stack

- `index.html` — static frontend, vanilla JS
- `netlify/functions/plan.js` — serverless function that calls the Anthropic API
- Deploys automatically to Netlify on every push to `main`

## Setup

The Anthropic API key lives **only** in Netlify environment variables (`ANTHROPIC_API_KEY`) — never in this repo.
