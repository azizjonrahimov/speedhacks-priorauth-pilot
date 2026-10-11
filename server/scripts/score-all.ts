// Runs the evidence pipeline on all 6 demo notes and prints a compact report.
// Usage: npx tsx scripts/score-all.ts [noteIndex]
import "dotenv/config";
import notes from "../src/seed/notes.json" with { type: "json" };
import { findPolicy, policyRef, scanRedFlags } from "../src/rules/engine.js";
import { scoreCase } from "../src/evidence/pipeline.js";
import type { CaseDetail } from "../src/domain/types.js";

const only = process.argv[2] != null ? Number(process.argv[2]) : null;
const log = { info: () => {}, warn: (o: object, m: string) => console.warn("  warn:", m, JSON.stringify(o)) };

let failures = 0;
for (const [i, n] of notes.notes.entries()) {
  if (only != null && i !== only) continue;
  const policy = findPolicy(n.insurer, n.cpt)!;
  const red = scanRedFlags(n.text, policy);
  const c: CaseDetail = {
    id: `demo_${i + 1}`,
    patient_name: n.patient.name,
    cpt: n.cpt,
    cpt_label: policy.label,
    insurer: n.insurer,
    state: "screened",
    overall: null,
    expedited: red.length > 0,
    created_at: "",
    updated_at: "",
    note: n.text,
    patient: n.patient,
    physician: n.physician,
    screening: { pa_required: true, policy: policyRef(policy), red_flags: red, screened_at: "" },
    facts: [],
    criteria: [],
    red_flags: red,
    gaps: [],
    call: null,
    packet: null,
    payer: null,
    notification: null,
    review: null,
    timeline: [],
  };
  const t0 = Date.now();
  try {
    const r = await scoreCase(c, log);
    const ms = Date.now() - t0;
    const expectOk = (n.expect === "meets" && r.overall === "ready") || (n.expect === "gap" && r.overall === "needs_info") || (n.expect === "red_flag" && r.overall === "expedite");
    if (!expectOk) failures++;
    console.log(`\n${expectOk ? "PASS" : "FAIL"} ${n.label}  → overall=${r.overall} expected=${n.expect}  (${ms} ms, facts=${r.facts.length}, rejected_facts=${r.rejectedFacts}, rejected_quotes=${r.rejectedQuotes.length})`);
    for (const cr of r.criteria) {
      const q = cr.evidence_quote ? ` "${cr.evidence_quote.slice(0, 70)}${cr.evidence_quote.length > 70 ? "…" : ""}"` : "";
      const det = cr.verifier.deterministic_check ? ` [code: ${cr.verifier.deterministic_check.detail}]` : "";
      console.log(`   ${cr.status.padEnd(14)} ${cr.id.padEnd(18)} conf=${cr.confidence.toFixed(2)}${q}${det}`);
      if (cr.question_if_missing) console.log(`      ? ${cr.question_if_missing}`);
      if (cr.char_start != null && n.text.slice(cr.char_start, cr.char_end!) !== cr.evidence_quote) {
        console.log("      !! OFFSET MISMATCH");
        failures++;
      }
    }
  } catch (e) {
    failures++;
    console.log(`\nFAIL ${n.label}: ${(e as Error).message}`);
  }
}
console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
