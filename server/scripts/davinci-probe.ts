// Sends a real PAS bundle (built from demo note 1) to the live Da Vinci reference server and prints the raw reply.
import "dotenv/config";
import notes from "../src/seed/notes.json" with { type: "json" };
import { buildPasBundle } from "../src/fhir/pasBundle.js";
import { findPolicy, policyRef } from "../src/rules/engine.js";
import type { CaseDetail } from "../src/domain/types.js";

const base = process.env.DAVINCI_URL ?? "https://prior-auth.davinci.hl7.org/fhir";
const n = notes.notes[0];
const policy = findPolicy(n.insurer, n.cpt)!;
const c = { id: "pa_probe01", cpt: n.cpt, cpt_label: policy.label, insurer: n.insurer, expedited: false, patient: n.patient, physician: n.physician, screening: { policy: policyRef(policy) }, criteria: [], facts: [] } as unknown as CaseDetail;
const bundle = buildPasBundle({ c, letterText: "Probe letter." });
console.log(`POST ${base}/Claim/$submit  (${bundle.entry.length} entries, ${JSON.stringify(bundle).length} bytes)`);
const t0 = Date.now();
const r = await fetch(`${base}/Claim/$submit`, { method: "POST", headers: { "content-type": "application/fhir+json", accept: "application/fhir+json" }, body: JSON.stringify(bundle) });
const text = await r.text();
console.log(`HTTP ${r.status} in ${Date.now() - t0} ms; location=${r.headers.get("location")}`);
console.log(text.slice(0, 3000));
