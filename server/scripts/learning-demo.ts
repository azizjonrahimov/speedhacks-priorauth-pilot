// Live demo of the self-improvement loop against a running server (default :4100), with real Claude.
//   1. score note 3 → reviewer overrides the therapy-duration criterion → lesson appears
//   2. score note 3 again as a new case → lessons.applied in the timeline, pitfalls in the prompt
//   3. GET /lessons, /metrics.keewano.learning, /lessons/summary (Claude-written)
const API = process.env.API_URL ?? "http://127.0.0.1:4100";
const j = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: (await r.json()) as any };
};
const notes = (await j("GET", "/demo/notes")).data.notes;
const n = notes[2];
const C2 = "aetna-73721-c2";
async function scored() {
  const c = (await j("POST", "/cases", { note: n.text, cpt: n.cpt, insurer: n.insurer, patient: n.patient, physician: n.physician })).data.case;
  await j("POST", `/cases/${c.id}/screen`);
  const s = await j("POST", `/cases/${c.id}/score`);
  return { id: c.id as string, s: s.data };
}
const a = await scored();
const c2a = a.s.criteria?.find((k: any) => k.id === C2);
console.log(`case A ${a.id}: overall=${a.s.overall} c2=${c2a?.status} lessons_applied=${JSON.stringify(a.s.lessons_applied)}`);
const ov = await j("POST", `/cases/${a.id}/criteria/${C2}/override`, { status: c2a?.status === "met" ? "unclear" : "met", reason: "Reviewer confirmed from the PT referral" });
console.log(`override: HTTP ${ov.status} overall=${ov.data.overall}`);
await new Promise((r) => setTimeout(r, 300));
const lessons = (await j("GET", "/lessons")).data;
console.log(`lessons: ${lessons.total}`, JSON.stringify(lessons.lessons.map((l: any) => ({ id: l.id, count: l.count }))));
const b = await scored();
const ev = (await j("GET", `/cases/${b.id}/events`)).data.events;
const applied = ev.find((e: any) => e.type === "lessons.applied");
console.log(`case B ${b.id}: overall=${b.s.overall} c2=${b.s.criteria?.find((k: any) => k.id === C2)?.status} lessons_applied=${JSON.stringify(b.s.lessons_applied)}`);
console.log(`timeline B: ${ev.map((e: any) => e.type).join(" → ")}`);
console.log(`lessons.applied payload: ${JSON.stringify(applied?.payload)}`);
console.log(`metrics.keewano.learning: ${JSON.stringify((await j("GET", "/metrics")).data.keewano.learning)}`);
const sum = await j("GET", "/lessons/summary?refresh=1");
console.log(`summary (${sum.data.summary?.generator}):\n${sum.data.summary?.text}`);
