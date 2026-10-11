# PriorAuth Pilot

**SpeedHacks hackathon, October 11, 2026.** Challenge: *give people their time back.*

PriorAuth Pilot is a prior-authorization copilot for small medical practices. It reads a visit note, proves each payer criterion with a quote verified against the note, phones the ordering physician for anything missing, assembles the submission packet, submits it, and learns from reviewer corrections so the next case is scored better.

Manual prior authorization costs about 24 minutes of staff time per request (CAQH Index). In our runs the staff review step takes about 5 minutes, measured live.

## What works today

| Step | Status |
|---|---|
| Screening against 6 insurer policies | Real, rules engine |
| Evidence extraction and criterion scoring | Real, Claude Sonnet 5.5, two passes |
| Quote verification | Real, every quote must be a verbatim substring of the note; numeric criteria also get a deterministic code check |
| Physician gap-fill phone call | Real, Dial voice agent, tested live today (63 s call, answer parsed, case rescored) |
| Appeal letter, PDF, HL7 FHIR Da Vinci PAS bundle | Real |
| Payer submission | Live HL7 Da Vinci reference server accepts the bundle and returns *pended*. Approved and denied paths use a mock adapter with injected failures, retries and a circuit breaker |
| Patient notification | Simulated (SMS needs a second Dial number) |
| Live analytics | Real, Keewano. Median review time and call share are queried live and drive the "minutes saved" figure |
| Self-improvement | Real. Reviewer overrides, rejected quotes, verifier mismatches and voice-agent oversteps become lessons that are injected into future scoring prompts and call scripts |
| Sign-in | Demo-only local auth |

The dashboard history includes 40 clearly labelled synthetic cases backfilled into Keewano so the median has a base. Live cases are tagged separately.

## Partner tools

- **Dial**: outbound voice call to the physician, transcript, event stream.
- **Keewano**: event ledger mirror, live SQL over MCP for metrics and the learning-effect measurement.
- **Anthropic Claude**: extraction, scoring, letter writing, transcript parsing, lessons summary.
- **HL7 Da Vinci PAS**: standards-based prior-auth bundle and live reference-server submission.

## Run it

Requires Node 24.

```bash
# backend, port 4000
cd server
npm ci
cp .env.example .env   # fill ANTHROPIC_API_KEY, DIAL_*, KEEWANO_* (optional)
npm run dev
npm test

# frontend, port 5173
cd web
npm ci
npm run dev
```

Without keys: screening, packet template letters, mock payer and the full UI work. Scoring needs `ANTHROPIC_API_KEY`; the phone call needs `DIAL_API_KEY`, `DIAL_FROM_NUMBER_ID`, `PHYSICIAN_PHONE`; live analytics need `KEEWANO_API_KEY` and `KEEWANO_PAT`. Every Dial call is real and billed.

Sign in with the "Continue with demo account" button.

## Repo layout

- `server/` Fastify + SQLite event ledger, state machine, rules, evidence pipeline, Dial, packet, payer adapters, Keewano sink, learning loop. `server/RESEARCH.md` records the design decisions.
- `web/` Vite + React + TypeScript, Tailwind, shadcn. Landing, demo auth, dashboard, intake, case view, lessons.

## What we would build next

1. A no-inference guard for criteria that have no numeric code check (today only numeric criteria have a verifier backstop).
2. Call-script rule: never state that something will be documented unless the physician said it. Today's live call surfaced this; the parser caught it and it is now a learned lesson, but it should be a hard rule.
3. Real payer connectivity beyond the Da Vinci reference server, and a second Dial number for patient SMS.
4. Reviewer accounts with real authentication.

## Honest limits

Payer approval and denial are mocked. Patient texts are simulated. The learning-effect trend needs at least three cases on each side before it claims improvement, and it does not yet.
