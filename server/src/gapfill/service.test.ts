// Gap-fill retry policy with a fake Dial client: no-answer → retry after delay → no-answer → gap.unresolved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import notes from "../seed/notes.json" with { type: "json" };
import { findPolicy } from "../rules/engine.js";
import type { Criterion } from "../domain/types.js";
import type { DialClientLike } from "./dial.js";

process.env.GAPFILL_RETRY_MS = "80";

let app: Awaited<ReturnType<typeof buildApp>>;
const placed: { idempotencyKey?: string; to: string; outboundInstruction: string }[] = [];
let callSeq = 0;
const terminated = new Set<string>();

const fakeDial: DialClientLike = {
  makeCall: async (p) => {
    placed.push({ idempotencyKey: p.idempotencyKey, to: p.to, outboundInstruction: p.outboundInstruction });
    const id = `call_${++callSeq}`;
    // the "physician" never picks up: terminate as no-answer shortly after and emit call.ended
    setTimeout(() => {
      terminated.add(id);
      app.ctx.dial.events.emit("call.ended", { type: "call.ended", data: { callId: id, status: "Terminated", terminationType: "no-answer", durationSeconds: 0 } });
    }, 30);
    return { id, status: { state: "Queued" } } as never;
  },
  getCall: async (id) =>
    ({
      id,
      status: { state: terminated.has(id) ? "Terminated" : "Ringing" },
      terminationType: terminated.has(id) ? "no-answer" : null,
      duration: 0,
      transcript: null,
      transcriptTurns: null,
      failureReason: null,
    }) as never,
  sendMessage: async () => ({ id: "msg_1", deliveryState: "pending" }) as never,
  newEventsConnection: async () => {
    throw new Error("not used in tests");
  },
};

beforeAll(async () => {
  config.physicianPhone = "+14155550100";
  app = await buildApp({ dbPath: ":memory:", logger: false, dialClient: fakeDial });
});
afterAll(async () => {
  await app.close();
});

describe("gap-fill call retry policy", () => {
  it("places the call with an idempotency key, retries once, then marks the gap unresolved for manual entry", async () => {
    const n = notes.notes[2];
    const created = await app.inject({ method: "POST", url: "/cases", payload: { note: n.text, cpt: n.cpt, insurer: n.insurer, patient: n.patient, physician: n.physician } });
    const id = created.json().case.id as string;
    await app.inject({ method: "POST", url: `/cases/${id}/screen` });
    const p = findPolicy(n.insurer, n.cpt)!;
    const criteria: Criterion[] = p.criteria.map((r) => ({
      id: r.id, text: r.text, kind: r.kind, group: r.group, params: r.params,
      status: r.id === "aetna-73721-c2" ? "unclear" : r.group === "red_flag_any_of" ? "missing" : "met",
      evidence_quote: null, char_start: null, char_end: null, evidence_source: null, reasoning: "t", confidence: 0.8,
      question_if_missing: r.id === "aetna-73721-c2" ? "How many weeks of physical therapy has the patient completed?" : null,
      verifier: { quote_verified: false, deterministic_check: null },
    }));
    app.ctx.ledger.appendEvent(id, "evidence.scored", { criteria, facts: [], overall: "needs_info", red_flags: [] }, "llm");
    app.ctx.ledger.appendEvent(id, "gap.question_generated", { criterion_id: "aetna-73721-c2", question: "How many weeks of physical therapy has the patient completed?" }, "llm");

    const r = await app.inject({ method: "POST", url: `/cases/${id}/gapfill/call` });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ call_id: "call_1", status: "queued", attempt: 1 });
    expect(placed[0].idempotencyKey).toBe(`${id}:gapfill:1`);
    expect(placed[0].outboundInstruction).toContain("How many weeks of physical therapy");
    expect(placed[0].outboundInstruction).toContain("Marcus Lindqvist");

    // a second concurrent call request is refused while one is in flight
    const dup = await app.inject({ method: "POST", url: `/cases/${id}/gapfill/call` });
    expect(dup.statusCode).toBe(409);

    // wait for: no-answer → retry_scheduled (80 ms) → call 2 → no-answer → gap.unresolved
    const deadline = Date.now() + 8000;
    let detail = (await app.inject({ method: "GET", url: `/cases/${id}` })).json().case;
    while (Date.now() < deadline && detail.state === "calling") {
      await new Promise((res) => setTimeout(res, 100));
      detail = (await app.inject({ method: "GET", url: `/cases/${id}` })).json().case;
    }
    const types = detail.timeline.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["call.placed", "call.failed", "call.retry_scheduled", "gap.unresolved"]));
    expect(types.filter((t: string) => t === "call.placed")).toHaveLength(2);
    expect(placed[1].idempotencyKey).toBe(`${id}:gapfill:2`);
    expect(detail.state).toBe("needs_info");
    expect(detail.call.status).toBe("unresolved");
    expect(detail.gaps[0]).toMatchObject({ criterion_id: "aetna-73721-c2", status: "unresolved" });
    expect(detail.call.to_masked).toBe("+1415***0100");
  }, 15000);
});
