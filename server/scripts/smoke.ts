// End-to-end smoke test against a RUNNING server. Usage:
//   npx tsx scripts/smoke.ts [noteIndex=2] [--all] [--call]      (API_URL env overrides http://127.0.0.1:4000)
// Stops gracefully at the first step the server reports as unavailable (503) and prints why.
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const args = process.argv.slice(2);
const all = args.includes("--all");
const doCall = args.includes("--call");
const idx = Number(args.find((a) => /^\d+$/.test(a)) ?? 2);

async function j<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(API + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: r.status, data };
}

async function runNote(i: number) {
  const notes = (await j("GET", "/demo/notes")).data.notes;
  const n = notes[i];
  console.log(`\n=== ${n.label} (${n.insurer} ${n.cpt}) expect=${n.expect}`);
  const created = await j("POST", "/cases", { note: n.text, cpt: n.cpt, insurer: n.insurer, patient: n.patient, physician: n.physician });
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.data)}`);
  const id = created.data.case.id;
  console.log(`case ${id} state=${created.data.case.state} label="${created.data.case.cpt_label}" phone=${created.data.case.patient.phone}`);

  const scr = await j("POST", `/cases/${id}/screen`);
  console.log(`screen: pa_required=${scr.data.pa_required} policy=${scr.data.policy.id} red_flags=${JSON.stringify(scr.data.red_flags)} expedited=${scr.data.expedited}`);

  const sc = await j("POST", `/cases/${id}/score`);
  if (sc.status !== 200) {
    console.log(`score: HTTP ${sc.status} ${JSON.stringify(sc.data)}`);
    return;
  }
  console.log(`score: overall=${sc.data.overall} facts=${sc.data.facts.length} red_flags=${JSON.stringify(sc.data.red_flags)}`);
  for (const c of sc.data.criteria) {
    const q = c.evidence_quote ? ` "${String(c.evidence_quote).slice(0, 60)}…"` : "";
    const det = c.verifier?.deterministic_check ? ` [code: ${c.verifier.deterministic_check.detail}]` : "";
    console.log(`   ${String(c.status).padEnd(14)} ${String(c.id).padEnd(18)} ${Number(c.confidence).toFixed(2)}${q}${det}`);
    if (c.char_start != null && n.text.slice(c.char_start, c.char_end) !== c.evidence_quote) console.log("      !! OFFSET MISMATCH");
    if (c.question_if_missing) console.log(`      ? ${c.question_if_missing}`);
  }

  let detail = (await j("GET", `/cases/${id}`)).data.case;
  if (detail.state === "needs_info") {
    if (doCall) {
      const call = await j("POST", `/cases/${id}/gapfill/call`);
      console.log(`gapfill/call: HTTP ${call.status} ${JSON.stringify(call.data)}`);
      if (call.status === 202) {
        // wait up to 6 minutes for the call to resolve
        for (let t = 0; t < 72; t++) {
          await new Promise((r) => setTimeout(r, 5000));
          detail = (await j("GET", `/cases/${id}`)).data.case;
          process.stdout.write(`   call status=${detail.call?.status} state=${detail.state}\r\n`);
          if (detail.state !== "calling") break;
        }
        console.log(`   answers=${JSON.stringify(detail.call?.answers)} overall=${detail.overall}`);
      }
    }
    if (detail.state === "needs_info") {
      const answers = detail.gaps.filter((g: any) => g.status === "open").map((g: any) => ({ criterion_id: g.criterion_id, answer: "Yes. The patient completed about eight weeks of formal physical therapy, twice weekly, from early July through the end of August, plus daily NSAIDs." }));
      const man = await j("POST", `/cases/${id}/gapfill/manual`, { answers });
      console.log(`gapfill/manual: HTTP ${man.status} overall=${man.data.overall ?? JSON.stringify(man.data)}`);
      for (const c of man.data.criteria ?? []) console.log(`   ${String(c.status).padEnd(14)} ${String(c.id).padEnd(18)} src=${c.evidence_source}`);
    }
  }

  const pk = await j("POST", `/cases/${id}/packet`);
  console.log(`packet: HTTP ${pk.status} ${pk.status === 200 ? `pdf=${pk.data.pdf_url} letter_chars=${pk.data.letter_text.length} bundle_entries=${pk.data.fhir_bundle.entry?.length}` : JSON.stringify(pk.data)}`);
  if (pk.status !== 200) return;

  const sub = await j("POST", `/cases/${id}/submit`);
  console.log(`submit: HTTP ${sub.status} ${sub.status === 200 ? `status=${sub.data.payer.status} adj=${sub.data.payer.adjudication} ref=${sub.data.payer.reference} attempts=${sub.data.payer.attempts.map((a: any) => a.outcome).join(",")} reason=${sub.data.payer.reason ?? ""}` : JSON.stringify(sub.data)}`);

  const rv = await j("POST", `/cases/${id}/review/complete`);
  console.log(`review/complete: HTTP ${rv.status} ${JSON.stringify(rv.data)}`);
  detail = (await j("GET", `/cases/${id}`)).data.case;
  console.log(`final state=${detail.state} notification=${detail.notification?.channel ?? "none"} timeline=${detail.timeline.map((e: any) => e.type).join(" → ")}`);
}

const health = await j("GET", "/health");
if (health.status !== 200) {
  console.error(`server not reachable at ${API}`);
  process.exit(1);
}
if (all) for (let i = 0; i < 6; i++) await runNote(i);
else await runNote(idx);
const m = await j("GET", "/metrics");
console.log(`\nmetrics: ${JSON.stringify(m.data)}`);
