# Going live: real SMS and email

The demo is safe by default: nothing is sent until a provider is configured *and* the recipient is allowlisted. This guide covers turning on real delivery, first for a pitch and then for production.

> Prices and timelines below were checked in October 2026 and change often. Confirm them on the provider's pricing page before quoting a client.

## Email with Resend (fastest)

1. Sign up at [resend.com](https://resend.com) and create an API key.
2. For a quick test, send from `onboarding@resend.dev`. Resend only delivers those test emails to **your own account email**.
3. For real use, verify a domain you control (Resend gives you SPF/DKIM DNS records). For a hauler in production, that means a subdomain of *their* domain (e.g. `notify.<hauler-domain>`), which needs their DNS access. Until then, use a domain you own.
4. Set:
   ```
   EMAIL_PROVIDER=resend
   RESEND_API_KEY=re_...
   RESEND_FROM_EMAIL=onboarding@resend.dev   # or alerts@your-verified-domain.com
   LIVE_ALLOWLIST=you@example.com
   ```
5. Optional, when hosted: add a webhook in Resend pointing to `https://<your-app>/api/webhooks/resend` and set `RESEND_WEBHOOK_SECRET` (starts with `whsec_`). Without it, the app polls Resend for delivery status instead.

Cost: the free tier allows 3,000 emails/month (100/day); Pro starts at $20/month for 50,000.

## SMS with Twilio (plan ahead)

**Trial accounts won't work for this demo.** Twilio trials can only send Twilio's pre-written template text to up to 5 verified numbers, and they expire after 30 days. To send these custom messages you need:

1. **An upgraded (paid) Twilio account.** Add a starting balance; about $20 covers months of testing.
2. **A sending number.**
   - **Toll-free number (recommended for a pilot):** about $2/month. Submit **toll-free verification** (free) describing the use case: "Account notifications and service updates for waste-collection customers who opted in". Approval usually takes days, sometimes a few weeks. Unverified toll-free numbers are blocked.
   - **Local 10-digit number (A2P 10DLC):** about $1.15/month plus brand registration (one-time) and a campaign fee (monthly). Approval typically takes 1 to 3 weeks. Unregistered 10DLC traffic is blocked by US carriers.
3. Set:
   ```
   SMS_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_FROM_NUMBER=+1888...     # or TWILIO_MESSAGING_SERVICE_SID=MG...
   LIVE_ALLOWLIST=+19705550123     # your phone
   ```
4. When hosted, set these in the Twilio console for the number:
   - **Messaging webhook (incoming):** `https://<your-app>/api/webhooks/twilio/inbound`. STOP/START replies then update consent in the app automatically.
   - Status callbacks are added automatically per message when `PUBLIC_BASE_URL` is known (it's automatic on Render and Railway). Locally, the app polls Twilio for status instead.

Twilio's built-in Advanced Opt-Out sends the STOP/HELP confirmation texts. The app records the change and replies with empty TwiML so customers aren't double-texted.

### What SMS really costs

About **$0.008 per segment** list price plus **about $0.003 in carrier fees**, so roughly **$0.011 per segment**. That's the default for `SMS_COST_PER_SEGMENT`.

- A segment is 160 plain characters. One curly quote, em dash or emoji switches the whole message to Unicode, which allows only 70 characters per segment. The template editor warns about this, and every default template fits in one segment (a test enforces it).
- Example: 5,000 customers × 3 texts/month = 15,000 segments, about **$165/month in SMS alone**. That's more than earlier estimates of "$10 to $75". Price SMS as a pass-through or include a capped allowance.

## Compliance checklist (not legal advice)

The hauler's attorney should review consent language before launch. The basics:

- **Consent first.** Texting customers with automated messages requires their prior express consent; marketing texts need *written* consent. Service and billing notices are informational, so keep them that way. Record when and how each customer opted in. The app stores this per customer (`consent_source`, `consent_events`).
- **Opt-out.** Honor STOP and similar replies, and any reasonable request to stop, promptly. The app turns SMS off instantly and logs it. Every default text ends with "Reply STOP to opt out" and identifies the sender.
- **Getting existing customers opted in.** Having a phone number in the billing system isn't the same as consent to texts. Run an opt-in drive: a bill insert, an email with the preference link, a website form, or a checkbox in the app. Carriers will also ask to see this opt-in flow during registration.
- **Timing.** Send between 8 AM and 9 PM local time; the default automations run at 9 AM and 5 PM. Emergencies are the exception.
- **Email.** Use authenticated sending (SPF/DKIM/DMARC). Each email includes a preference link in the footer.

## Production hardening (before real customers)

- Import customers, routes, balances and due dates from Soft-Pak (CSV export or API) on a nightly schedule.
- Replace the shared `DEMO_PASSWORD` with individual staff logins.
- Move from SQLite to Postgres and from the in-process scheduler to a job queue for large sends.
- Give each hauler its own Twilio sender and map inbound replies by the `To` number (currently `DEFAULT_TENANT`).
- Add quiet-hours enforcement and send-rate limits per tenant.
- Turn on backups and uptime monitoring.
