// Backfill deterministic SYNTHETIC PA history into Keewano.
//   npx tsx scripts/keewano-backfill.ts --dry-run      (default: prints the plan, sends nothing)
//   npx tsx scripts/keewano-backfill.ts --send         (needs KEEWANO_API_KEY; KEEWANO_PAT enables the idempotency check)
//   options: --n 40  --force (skip the already-backfilled check)
// Idempotent: deterministic case ids/UUIDs/timestamps, and before sending it asks Keewano (via the PAT) whether
// synthetic cases already exist; if so it does nothing unless --force.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { buildSyntheticCases, summarize } from "../src/keewano/backfill.js";
import { CATALOG, catalogHash } from "../src/keewano/catalog.js";
import { fetchTransport, INGEST_URL, REGISTER_URL } from "../src/keewano/sink.js";
import { KeewanoQueryClient, rowObject } from "../src/keewano/query.js";

const args = process.argv.slice(2);
const send = args.includes("--send");
const force = args.includes("--force");
const n = Number(args[args.indexOf("--n") + 1]) || 40;
const apiKey = process.env.KEEWANO_API_KEY ?? "";
const pat = process.env.KEEWANO_PAT ?? "";

const cases = buildSyntheticCases(n);
const plan = summarize(cases);
console.log("synthetic plan:", JSON.stringify(plan));
console.log("first case:", JSON.stringify({ case_id: cases[0].case_id, summary: cases[0].summary, first_events: cases[0].events.slice(0, 3) }));

if (!send) {
  console.log("dry run: nothing sent (pass --send to upload)");
  process.exit(0);
}
if (!apiKey) {
  console.log("KEEWANO_API_KEY missing: backfill stays dark (the kwpat- token cannot ingest)");
  process.exit(1);
}

if (pat && !force) {
  try {
    const q = new KeewanoQueryClient(pat, process.env.KEEWANO_PROJECT_ID || null);
    const r = await q.sql(`SELECT count(DISTINCT user_id) AS synthetic FROM events WHERE "PA Data Origin" = 'synthetic'`, 1);
    const existing = Number(rowObject(r).synthetic ?? 0);
    if (existing > 0) {
      console.log(`already backfilled: Keewano has ${existing} synthetic case(s); nothing sent (use --force to resend)`);
      process.exit(0);
    }
  } catch (e) {
    const msg = String((e as Error).message);
    if (!/unknown column/i.test(msg)) {
      console.log(`idempotency check failed (${msg.slice(0, 120)}); refusing to send without --force`);
      process.exit(1);
    }
    // unknown column = nothing of ours ingested yet: safe to send
  }
} else if (!pat && !force) {
  console.log("KEEWANO_PAT missing: cannot check for an earlier backfill; pass --force to send anyway");
  process.exit(1);
}

const hash = catalogHash();
const reg = await fetchTransport(REGISTER_URL, { customEventsHash: hash, eventTypes: CATALOG }, apiKey, 10_000);
console.log("register custom events:", reg.status, reg.text.slice(0, 120));
if (reg.status >= 300) process.exit(1);

const sessionId = randomUUID();
let ok = 0;
let failed = 0;
for (const [i, c] of cases.entries()) {
  const r = await fetchTransport(INGEST_URL, { installId: c.installId, dataSessionId: sessionId, batch: i + 1, customEventsHash: hash, events: c.events }, apiKey, 10_000);
  if (r.status >= 200 && r.status < 300) ok++;
  else {
    failed++;
    if (failed <= 3) console.log(`case ${c.case_id}: HTTP ${r.status} ${r.text.slice(0, 120)}`);
  }
}
console.log(`backfill done: ${ok} case(s) sent, ${failed} failed. Queryable in about 5 minutes; check with POST /keewano/refresh.`);
process.exit(failed ? 1 : 0);
