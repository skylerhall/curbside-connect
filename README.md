# Curbside Connect: customer notifications for waste haulers

**Live demo:** https://curbside-connect.onrender.com (free hosting, so the first load can take about a minute while it wakes up)

A working demo of an automated SMS/email system for waste haulers, shown here for a fictional hauler, **Kestrel Ridge Disposal**. Office staff use a dashboard to control billing reminders, next-day pickup reminders, holiday and weather schedule changes, and emergency alerts. Customers just get a text or email.

> **Everything is fictional:** the hauler, its towns and every customer. Phone numbers are in the reserved 555-01xx range and emails use `example.com`. Delivery is **simulated by default**: nothing leaves the server until you deliberately configure a provider *and* allowlist a recipient.

The product is generic and multi-tenant: every table is scoped to a hauler (tenant), and branding, templates, routes and automations are per-tenant settings. Kestrel Ridge is simply the first tenant.

## A 60-second tour

1. **Service schedule → Change a pickup.** Pick tomorrow, choose the route, and select "Snow and icy roads".
2. The system finds every affected customer, applies each person's consent and topic preferences, and shows the exact text and email they will get, plus who won't be reached and why.
3. **Notify.** Watch messages go Queued → Sent → Delivered live. Two fail on purpose (a dead number and a bounced inbox), just like real life.
4. **Delivery log.** Every attempt, its status timeline, and every customer who was skipped and why.

**Mistakes are handled, not just prevented:**
- **Undo window.** Every manual send waits 60 seconds (`SEND_HOLD_SECONDS`) with **Cancel** and **Send now**. Cancelled messages never reach a provider.
- **Corrections.** "Send a correction" on any past notification messages only the customers who actually received it, on the same channels, and can undo the schedule change in the same step.
- **Pre-send checks.** Warnings such as "new date is a Sunday", "moves the pickup earlier" or "this reminder says 'tomorrow' but it isn't" must be acknowledged before sending.

Also built: the holiday planner (applies a common hauler rule: a weekday holiday slides the rest of that week's pickups one day, with Friday moving to Saturday), evening pickup reminders with recycling-week awareness, billing reminders (upcoming, autopay heads-up, past due), weather/emergency alerts, route rebalancing with "your pickup day is changing" notices, editable templates with SMS cost warnings, STOP/START/HELP handling, a customer self-service preference page, and an audit trail.

## Run it locally

Requires **Node.js 22.18 or newer** ([nodejs.org](https://nodejs.org)); no database server is needed.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:4100. On first start, the fictional demo data loads automatically, including two weeks of message history. To start fresh before a meeting, use **Settings → Reset demo data** or run `npm run demo:reset`.

Optional: copy `.env.example` to `.env` to change settings (see [Configuration](#configuration)).

## Deploy it (hosted, password-protected)

The app is one Docker container: API, scheduler and dashboard. The database is a single SQLite file, and the demo re-seeds itself when the file is empty.

**Render (recommended, ~5 minutes)**

1. Push this repo to GitHub (already done if you're reading this there).
2. In Render: **New → Blueprint**, then pick this repo. It reads [`render.yaml`](render.yaml).
3. Leave the provider keys blank to stay in simulation mode. To lock the dashboard, add `DEMO_PASSWORD` in the service's Environment tab.
4. Deploy, then open the `.onrender.com` URL.

The blueprint uses Render's **Free** plan. It sleeps after 15 idle minutes, takes about a minute to wake, and resets the demo data on every wake-up or deploy. Anything you add (such as yourself as a demo contact) won't survive a sleep. To keep changes and stay awake, switch to **Starter** (~$7/mo) and add the 1 GB disk noted in `render.yaml`.

**Railway / Fly.io / any Docker host:** deploy the `Dockerfile`, mount a volume at `/app/data`, and optionally set `DEMO_PASSWORD`. The app listens on `$PORT` (default 4100) and exposes `GET /healthz`.

> Don't deploy to Vercel or Netlify. Serverless functions don't keep a database file or run the scheduler.

The public portfolio copy runs without a password because delivery is simulated. Set `DEMO_PASSWORD` before connecting a live provider. The customer preference links (`/p/…`) and provider webhooks stay public by design.

## Sending real messages

The safety model:

- `SMS_PROVIDER` / `EMAIL_PROVIDER` choose a live provider (`twilio` / `resend`). Without credentials, the app falls back to simulation and says so in Settings.
- Even when a provider is live, **only recipients on `LIVE_ALLOWLIST` get real messages**. Everyone else, including all fictional customers, stays simulated, so a single pitch campaign can text your phone while the other 149 sends are simulated.
- `LIVE_ALLOW_ALL=true` lifts the allowlist. Use it only in production with real, consented customers.

To show a real message during a pitch:

1. **Email (works today):** create a free [Resend](https://resend.com) account and set:
   - `EMAIL_PROVIDER=resend`
   - `RESEND_API_KEY=…`
   - `RESEND_FROM_EMAIL=onboarding@resend.dev`
   - `LIVE_ALLOWLIST=<the email you signed up with>`

   Resend's test sender only delivers to your own account email. Verify a domain to send to anyone else.
2. In the dashboard: **Customers → Add demo contact** with your email (and phone), on the route you'll change.
3. **SMS:** needs a paid Twilio account and a *verified* sender. Twilio trial accounts can only send Twilio's canned template text, so they can't send these messages. Plan days to weeks for approval. See [docs/GOING-LIVE.md](docs/GOING-LIVE.md).

## Configuration

All settings are environment variables; see [`.env.example`](.env.example) for the full list with comments.

| Variable | Default | Purpose |
|---|---|---|
| `DEMO_PASSWORD` | *(off)* | Locks the dashboard. **Set this on any hosted copy.** |
| `PORT` | `4100` | HTTP port |
| `DATABASE_PATH` | `./data/demo.db` | SQLite file (auto-created and seeded) |
| `PUBLIC_BASE_URL` | auto on Render/Railway | Used for preference links and webhooks |
| `SMS_PROVIDER` / `EMAIL_PROVIDER` | `simulated` | `twilio` / `resend` for live delivery |
| `LIVE_ALLOWLIST` | *(empty)* | Comma-separated phones/emails allowed to get real messages |
| `TWILIO_*`, `RESEND_*` | | Provider credentials (server-side only, never shown in the UI) |
| `SEND_HOLD_SECONDS` | `60` | Undo window before a manual send goes out (`0` = off). Automations aren't held. |
| `SIMULATED_DELIVERY_DELAY_MS` | `1200` | How long simulated messages take to "deliver" |
| `SCHEDULER_ENABLED` | `true` | Runs the 5 PM pickup and 9 AM billing automations |

## How it works

```
Billing / route data ──► Notification engine ──► Provider router ──► SMS / email ──► Customer
   (customers, routes,     • who is affected         • simulated (default)        │
    balances, schedule      • consent + topics        • Twilio (allowlisted)       ▼
    overrides)              • template rendering      • Resend (allowlisted)   status webhooks
                            • dedupe (no repeats)                               STOP replies
                            • audit trail ◄──────────── delivery status ◄──────────┘
```

- **`server/engine/plan.ts`**: turns a request ("Thursday's pickup moves to Friday") into a plan: affected customers, the channel each person gets, rendered text, and skip reasons. The same code powers the preview and the real send.
- **`server/engine/dispatch.ts`**: records the campaign and every message (including skipped customers), sends through providers, and tracks status.
- **`server/providers/`**: `simulated.ts`, `twilio.ts`, `resend.ts` implement one small interface. Adding SendGrid, Telnyx or Postmark means writing one new file.
- **`server/engine/schedule.ts`**: the service calendar and holiday slides. **`automations.ts`**: the daily jobs (idempotent, so a re-run never double-texts).
- **`web/`**: React dashboard (Vite + Tailwind). **`shared/`**: types and template rules used by both sides.

Stack: Node.js (TypeScript run natively, no build step for the server), Express, SQLite (`node:sqlite`, built into Node), React, Tailwind.

## Tests

```bash
npm test
```

30 tests cover the core flow end to end (schedule change → affected customers → consent filtering → send → delivery status → no double-sends), holiday slides and recycling weeks, billing targeting, STOP handling, tenant isolation, the live-send allowlist, the Twilio/Resend request formats and webhook signatures, a check that every default text fits in one SMS segment, and the safety features (undo window, cancel, corrections, pre-send warnings). `npm run typecheck` checks types.

## Demo-grade vs production

Already production-shaped: tenant isolation, provider abstraction, consent records, dedupe and idempotent jobs, webhook signature checks, the audit log, and credentials kept in the environment.

Still needed before real customers:

- **Data import** from the hauler's billing/routing system (Soft-Pak export or API), scheduled nightly.
- **Real user accounts** and roles instead of one shared password.
- **Postgres** instead of SQLite once there's more than one server. The SQL is portable; the schema is in `server/db/database.ts`.
- **A job queue** for large sends (thousands of messages) and per-tenant Twilio senders. Inbound STOP replies are currently routed to `DEFAULT_TENANT`.
- **SMS registration** (toll-free verification or A2P 10DLC) per hauler, quiet-hours rules, and the hauler's legal review of consent language. See [docs/GOING-LIVE.md](docs/GOING-LIVE.md).

## Project layout

```
server/            API, notification engine, providers, scheduler, SQLite
  engine/          plan → dispatch → status; schedule & holidays; automations; consent
  providers/       simulated, Twilio, Resend (+ router with live allowlist)
  http/            dashboard API, public preference page + webhooks, auth
web/src/           React dashboard (pages/, components/)
shared/            types + template catalog shared by server and dashboard
tests/             node:test suites
scripts/           demo reset, run-a-job (for external cron)
```
