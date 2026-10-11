// Proof tests for the self-improvement loop: reviewer override → lesson → injected into the next scoring
// prompt (+ lessons.applied event); call overstep (today's real transcript) → lesson → rule in the next call script.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import { llmHooks, type StructuredCall } from "../llm/client.js";
import notes from "../seed/notes.json" with { type: "json" };
import { findPolicy } from "../rules/engine.js";
import type { Criterion, TranscriptTurn } from "../domain/types.js";
import type { DialClientLike } from "../gapfill/dial.js";
import { detectOverstep } from "./overstep.js";
import { buildCallScript } from "../gapfill/script.js";
import { mapLedgerEvent } from "../keewano/catalog.js";

process.env.GAPFILL_RETRY_MS = "50";
const tick = () => new Promise((r) => setImmediate(r));

// Transcript of the live call placed 2026-10-11 20:26 PT (Dial call cmv49x6ef002s0fox0sat3msd), synthetic patient.
const LIVE_TRANSCRIPT: TranscriptTurn[] = [
  { speaker: "agent", text: "Hi, this is the prior-authorization assistant from the clinic. Am I speaking with Dr. Priya Raman?", start_ms: 0 },
  { speaker: "physician", text: "Yes. You are.", start_ms: 4200 },
  { speaker: "agent", text: "Thank you, Doctor. I'm calling about your patient Marcus Lindqvist. Aetna requires prior authorization for an MRI knee without contrast, and under Aetna CPB 0171 the visit note is missing one detail. This should only take a minute. For the form: how long has he been doing physical therapy and taking ibuprofen, and was he also using rest, ice, compression, and elevation, for at least three weeks?", start_ms: 6100 },
  { speaker: "physician", text: "About about five, six weeks of physical therapy from August twenty to October one.", start_ms: 31000 },
  { speaker: "agent", text: "Got it, about five to six weeks of PT from August 20 to October 1. I'll document that he was on ibuprofen and using conservative measures including rest, ice, compression, and elevation during that period. Thank you, that's everything I needed. We'll finish the packet and submit it today. Have a good day.", start_ms: 38000 },
];

const note3 = notes.notes[2];
const policy3 = findPolicy(note3.insurer, note3.cpt)!;
const C2 = "aetna-73721-c2";

// Fake Claude: records every structured call; returns a scoring where c2 is "unclear" unless told otherwise.
const calls: StructuredCall<unknown>[] = [];
let c2Status: "met" | "unclear" = "unclear";
function installFakeLlm() {
  llmHooks.structured = (async (call: StructuredCall<unknown>) => {
    calls.push(call);
    const usage = { input_tokens: 0, output_tokens: 0 };
    if (call.toolName === "record_facts") {
      return { data: { facts: [{ kind: "therapy", label: "PT, no duration", quote: "He has been doing physical therapy and taking ibuprofen", value_number: null, unit: "none", date_start: null, date_end: null, negated: false }] }, usage, attempts: 1, model: "fake" };
    }
    if (call.toolName === "record_answers") {
      return { data: { answers: [{ criterion_id: C2, answered: true, answer: "About 5-6 weeks of physical therapy from August 20 to October 1. Physician did not confirm ibuprofen or RICE (agent assumed this).", quote: "About about five, six weeks of physical therapy from August twenty to October one.", value_number: 6, unit: "weeks", date_start: "2026-08-20", date_end: "2026-10-01", confidence: 0.6 }] }, usage, attempts: 1, model: "fake" };
    }
    // score_criteria
    const criteria = policy3.criteria.map((r) => ({
      criterion_id: r.id,
      status: r.group === "red_flag_any_of" ? "missing" : r.id === C2 ? c2Status : "met",
      evidence_fact_ids: [],
      evidence_quote: r.id === "aetna-73721-c1" ? "persistent right knee pain and intermittent swelling" : r.id === "aetna-73721-c3" ? "no fracture, no loose body" : r.id === C2 && c2Status === "met" ? "About about five, six weeks of physical therapy from August twenty to October one." : null,
      reasoning: "fake",
      confidence: 0.8,
      question_if_missing: r.id === C2 && c2Status !== "met" ? "How many weeks of physical therapy has the patient completed?" : null,
    }));
    return { data: { criteria }, usage, attempts: 1, model: "fake" };
  }) as typeof llmHooks.structured;
}

let app: Awaited<ReturnType<typeof buildApp>>;
const placed: { idempotencyKey?: string; outboundInstruction: string }[] = [];
const fakeDial: DialClientLike = {
  makeCall: async (p) => {
    placed.push({ idempotencyKey: p.idempotencyKey, outboundInstruction: p.outboundInstruction });
    const id = `call_${placed.length}`;
    setTimeout(() => app.ctx.dial.events.emit("call.ended", { type: "call.ended", data: { callId: id } }), 20);
    return { id, status: { state: "Queued" } } as never;
  },
  getCall: async (id) =>
    ({ id, status: { state: "Terminated" }, terminationType: "completed", duration: 63, transcript: "x", failureReason: null, transcriptTurns: LIVE_TRANSCRIPT.map((t) => ({ speaker: t.speaker === "agent" ? "agent" : "user", text: t.text, startMs: t.start_ms, endMs: t.start_ms + 1000 })) }) as never,
  sendMessage: async () => ({ id: "m" }) as never,
  newEventsConnection: async () => {
    throw new Error("unused");
  },
};

beforeAll(async () => {
  config.physicianPhone = "+14155550100";
  installFakeLlm();
  app = await buildApp({ dbPath: ":memory:", logger: false, dialClient: fakeDial });
});
afterAll(async () => {
  delete llmHooks.structured;
  await app.close();
});
afterEach(() => {
  c2Status = "unclear";
});

async function newScoredCase() {
  const created = await app.inject({ method: "POST", url: "/cases", payload: { note: note3.text, cpt: note3.cpt, insurer: note3.insurer, patient: note3.patient, physician: note3.physician } });
  const id = created.json().case.id as string;
  await app.inject({ method: "POST", url: `/cases/${id}/screen` });
  const score = await app.inject({ method: "POST", url: `/cases/${id}/score` });
  expect(score.statusCode).toBe(200);
  return { id, score: score.json() };
}

describe("1. reviewer override", () => {
  it("records criterion.overridden by the reviewer, recomputes overall, and mirrors a PHI-free Keewano event", async () => {
    const { id, score } = await newScoredCase();
    expect(score.overall).toBe("needs_info");
    const bad = await app.inject({ method: "POST", url: `/cases/${id}/criteria/${C2}/override`, payload: { status: "great" } });
    expect(bad.statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: `/cases/${id}/criteria/${C2}/override`, payload: { status: "met", reason: "Marcus did 6 weeks of PT per chart at Bayview" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ overall: "ready", criterion: { id: C2, status: "met" } });
    const again = await app.inject({ method: "POST", url: `/cases/${id}/criteria/${C2}/override`, payload: { status: "met", reason: "again" } });
    expect(again.statusCode).toBe(409);

    const ev = app.ctx.ledger.listEvents(id).find((e) => e.type === "criterion.overridden")!;
    expect(ev.actor).toBe("reviewer");
    expect(ev.payload).toMatchObject({ criterion_id: C2, from_status: "unclear", to_status: "met", overall: "ready", policy_id: "Aetna CPB 0171" });
    const k = mapLedgerEvent(ev);
    expect(k).toEqual([expect.objectContaining({ eventTypeId: 2018, data: "Aetna CPB 0171|aetna-73721-c2|unclear>met" })]);
    expect(JSON.stringify(k)).not.toMatch(/Marcus|Bayview/);
    expect(app.ctx.ledger.requireCase(id).gaps.find((g) => g.criterion_id === C2)).toBeUndefined();
  });
});

describe("2. lessons memory", () => {
  it("derives a PHI-free override lesson with a count, served by GET /lessons, and rebuilds identically from the ledger", async () => {
    await tick();
    const res = (await app.inject({ method: "GET", url: "/lessons" })).json();
    const lesson = res.lessons.find((l: { kind: string }) => l.kind === "override");
    expect(lesson).toMatchObject({ policy_id: "Aetna CPB 0171", criterion_id: C2, direction: "under", count: 1 });
    expect(lesson.summary).toMatch(/MET when the model said missing\/unclear/);
    expect(lesson.summary).not.toMatch(/Marcus|Bayview|Lindqvist/);
    const before = app.ctx.lessons.list();
    app.ctx.lessons.rebuild();
    expect(app.ctx.lessons.list().map((l) => [l.id, l.count])).toEqual(before.map((l) => [l.id, l.count]));
  });
});

describe("3. closed loop into scoring", () => {
  it("injects the lesson into the next scoring prompt for the same policy and logs lessons.applied", async () => {
    await tick();
    calls.length = 0;
    const { id, score } = await newScoredCase();
    const scoring = calls.find((c) => c.toolName === "score_criteria")!;
    expect(scoring.lessons).toMatch(/KNOWN PITFALLS FOR THIS POLICY/);
    expect(scoring.lessons).toMatch(/\[aetna-73721-c2\] Reviewers have marked/);
    expect(scoring.system).not.toMatch(/KNOWN PITFALLS/); // static system prompt stays a cacheable prefix
    const applied = app.ctx.ledger.listEvents(id).find((e) => e.type === "lessons.applied")!;
    expect(applied.payload).toMatchObject({ count: 1, policy_id: "Aetna CPB 0171", pass: "evidence.scored" });
    expect((applied.payload.ids as string[])[0]).toBe("Aetna CPB 0171|aetna-73721-c2|override|under");
    expect(score.lessons_applied).toEqual(applied.payload.ids);
    expect(mapLedgerEvent(applied)).toEqual([expect.objectContaining({ eventTypeId: 2019, data: 1 })]);
  });

  it("does not inject lessons from another policy", async () => {
    calls.length = 0;
    const n = notes.notes[0]; // Aetna lumbar 72148, no lessons yet
    const created = await app.inject({ method: "POST", url: "/cases", payload: { note: n.text, cpt: n.cpt, insurer: n.insurer, patient: n.patient, physician: n.physician } });
    const id = created.json().case.id;
    await app.inject({ method: "POST", url: `/cases/${id}/screen` });
    await app.inject({ method: "POST", url: `/cases/${id}/score` });
    expect(calls.find((c) => c.toolName === "score_criteria")?.lessons).toBeUndefined();
    expect(app.ctx.ledger.listEvents(id).some((e) => e.type === "lessons.applied")).toBe(false);
  });
});

describe("4. closed loop into the call script", () => {
  it("detects today's overstep deterministically", () => {
    const o = detectOverstep(LIVE_TRANSCRIPT);
    expect(o).toEqual({ detected: true, turns: [4] });
    expect(detectOverstep(LIVE_TRANSCRIPT.slice(0, 4)).detected).toBe(false);
  });

  it("turns the overstep into a lesson and injects the rule into the NEXT call script for the policy", async () => {
    // first call: no learned rules yet
    const a = await newScoredCase();
    const r1 = await app.inject({ method: "POST", url: `/cases/${a.id}/gapfill/call` });
    expect(r1.statusCode).toBe(202);
    expect(placed.at(-1)!.outboundInstruction).not.toMatch(/LEARNED FROM PREVIOUS CALLS/);
    // wait for the call to complete, be parsed and rescored
    for (let i = 0; i < 100 && app.ctx.ledger.currentState(a.id) === "calling"; i++) await new Promise((r) => setTimeout(r, 30));
    const parsed = app.ctx.ledger.listEvents(a.id).find((e) => e.type === "call.parsed")!;
    expect(parsed.payload.overstep).toEqual({ detected: true, turns: [4] });
    await tick();
    const lesson = app.ctx.lessons.list({ kind: "call_overstep" })[0];
    expect(lesson).toMatchObject({ policy_id: "Aetna CPB 0171", criterion_id: C2, count: 1 });
    expect(lesson.summary).not.toMatch(/ibuprofen|Marcus|Raman/);

    // next call under the same policy carries the learned rule
    const b = await newScoredCase();
    const r2 = await app.inject({ method: "POST", url: `/cases/${b.id}/gapfill/call` });
    expect(r2.statusCode).toBe(202);
    const script = placed.at(-1)!.outboundInstruction;
    expect(script).toMatch(/LEARNED FROM PREVIOUS CALLS \(mandatory\)/);
    expect(script).toMatch(/Do NOT state that you will document, note or record anything/);
    expect(script).toMatch(/never say you will document/);
    expect(app.ctx.ledger.listEvents(b.id).some((e) => e.type === "lessons.applied" && e.payload.pass === "call_script")).toBe(true);
    for (let i = 0; i < 100 && app.ctx.ledger.currentState(b.id) === "calling"; i++) await new Promise((r) => setTimeout(r, 30));
  });

});

describe("5. learning metric", () => {
  it("computes override rates with vs without lessons and a trend direction", async () => {
    const { learningFrom } = await import("./metric.js");
    const improving = learningFrom({ cases_scored: 40, cases_overridden: 10, cases_with_lessons: 20, overridden_with_lessons: 2 }, 4, "keewano");
    expect(improving).toMatchObject({ override_rate: 0.25, lessons_count: 4, trend: { with_lessons: 0.1, without_lessons: 0.4, direction: "improving" } });
    expect(learningFrom({ cases_scored: 2, cases_overridden: 1, cases_with_lessons: 1, overridden_with_lessons: 0 }, 1, "local").trend.direction).toBe("insufficient_data");
    expect(learningFrom({ cases_scored: 0, cases_overridden: 0, cases_with_lessons: 0, overridden_with_lessons: 0 }, 0, "local").override_rate).toBeNull();
  });

  it("/metrics.keewano.learning falls back to the local ledger with the same definitions", async () => {
    const m = (await app.inject({ method: "GET", url: "/metrics" })).json();
    const l = m.keewano.learning;
    expect(l.source).toBe("local");
    expect(l.lessons_count).toBe(app.ctx.lessons.count());
    expect(l.lessons_count).toBeGreaterThanOrEqual(2); // override + call_overstep
    expect(l.cases_overridden).toBe(1);
    expect(l.cases_with_lessons).toBeGreaterThanOrEqual(2);
    expect(l.override_rate).toBeGreaterThan(0);
  });

  it("uses Keewano's counts when the learning columns exist there", async () => {
    const { KeewanoInsights } = await import("../keewano/insights.js");
    const { KeewanoQueryClient } = await import("../keewano/query.js");
    const mcp = async (body: any) => {
      if (body.method !== "tools/call") return { status: 200, json: { result: {} } };
      const sql = String(body.params.arguments.sqlQuery);
      const sc = /PA Criterion Override/.test(sql)
        ? { columns: ["cases_overridden", "cases_scored", "cases_with_lessons", "overridden_with_lessons"].map((name) => ({ name })), rows: [[9, 45, 12, 1]] }
        : /percentile_cont/.test(sql)
          ? { columns: [{ name: "median_review_s" }, { name: "cases_reviewed" }], rows: [[290, 41]] }
          : { columns: [{ name: "cases_with_call" }, { name: "cases_scored" }, { name: "synthetic_cases" }], rows: [[8, 45, 40]] };
      return { status: 200, json: { result: { content: [], structuredContent: sc } } };
    };
    const ins = new KeewanoInsights(new KeewanoQueryClient("kwpat-x", "84af1714-b5e0-4b78-bc57-9e0c6b9b2587", mcp), { info: () => {}, warn: () => {} });
    await ins.refreshAll();
    expect(ins.state.learning).toEqual({ cases_scored: 45, cases_overridden: 9, cases_with_lessons: 12, overridden_with_lessons: 1 });
    const app2 = await buildApp({ dbPath: ":memory:", logger: false, keewanoInsights: ins });
    const l = (await app2.inject({ method: "GET", url: "/metrics" })).json().keewano.learning;
    expect(l).toMatchObject({ source: "keewano", override_rate: 0.2, trend: { with_lessons: 0.083, without_lessons: 0.242, direction: "improving" } });
    await app2.close();
  });
});

describe("6. what I learned", () => {
  it("summarizes only the PHI-free lessons with Claude, caches it, and regenerates when lessons change", async () => {
    const prompts: string[] = [];
    llmHooks.completeText = async (_system, user) => {
      prompts.push(user);
      return "I have learned 2 lessons. - Aetna CPB 0171 / aetna-73721-c2: reviewers corrected under-calling; scoring now looks harder for therapy duration.";
    };
    try {
      const r1 = (await app.inject({ method: "GET", url: "/lessons/summary" })).json().summary;
      expect(r1).toMatchObject({ generator: "llm", stale: false });
      expect(r1.text).toMatch(/I have learned/);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatch(/aetna-73721-c2/);
      expect(prompts[0]).not.toMatch(/Marcus|Lindqvist|Bayview|Raman|ibuprofen/); // only templated lessons reach the model
      // cached while lessons are unchanged
      await app.inject({ method: "GET", url: "/lessons/summary" });
      expect(prompts).toHaveLength(1);
      // new lesson → stale → regenerated
      const { id } = await newScoredCase();
      await app.inject({ method: "POST", url: `/cases/${id}/criteria/aetna-73721-c1/override`, payload: { status: "unclear", reason: "swelling not documented as persistent" } });
      await tick();
      const r3 = (await app.inject({ method: "GET", url: "/lessons/summary" })).json().summary;
      expect(prompts).toHaveLength(2);
      expect(r3.lessons_count).toBe(app.ctx.lessons.count());
      // LLM failure → template, never an error
      llmHooks.completeText = async () => {
        throw new Error("boom");
      };
      const r4 = (await app.inject({ method: "GET", url: "/lessons/summary?refresh=1" })).json().summary;
      expect(r4.generator).toBe("template");
      expect(r4.text).toMatch(/lessons recorded/);
    } finally {
      delete llmHooks.completeText;
    }
  });
});

describe("4b. call script", () => {
  it("buildCallScript without lessons is unchanged", () => {
    const c = app.ctx.ledger.requireCase(app.ctx.ledger.listCases()[0].id);
    expect(buildCallScript(c, c.gaps).instruction).not.toMatch(/LEARNED/);
  });
});
