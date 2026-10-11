// Post-scoring flow without an LLM key: packet (template letter) → submit with chaos → review → metrics.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { config } from "../config.js";
import notes from "../seed/notes.json" with { type: "json" };
import { findPolicy } from "../rules/engine.js";
import type { Criterion } from "../domain/types.js";

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  config.chaos.p500 = 0.5;
  config.chaos.pTimeout = 0;
  config.chaos.pPend = 0;
  config.packetsDir = "./data/packets-test";
  app = await buildApp({ dbPath: ":memory:", logger: false });
});
afterAll(async () => {
  await app.close();
});

function metCriteria(insurer: string, cpt: string, note: string): Criterion[] {
  const p = findPolicy(insurer, cpt)!;
  return p.criteria.map((r) => ({
    id: r.id,
    text: r.text,
    kind: r.kind,
    group: r.group,
    params: r.params,
    status: r.group === "red_flag_any_of" ? "missing" : "met",
    evidence_quote: r.group === "red_flag_any_of" ? null : note.slice(0, 40),
    char_start: r.group === "red_flag_any_of" ? null : 0,
    char_end: r.group === "red_flag_any_of" ? null : 40,
    evidence_source: r.group === "red_flag_any_of" ? null : "note",
    reasoning: "test",
    confidence: 0.9,
    question_if_missing: null,
    verifier: { quote_verified: true, deterministic_check: null },
  }));
}

describe("packet → submit (chaos) → review → metrics", () => {
  it("runs the whole post-score flow and records every payer attempt as an event", async () => {
    const n = notes.notes[0];
    const created = await app.inject({ method: "POST", url: "/cases", payload: { note: n.text, cpt: n.cpt, insurer: n.insurer, patient: n.patient, physician: n.physician } });
    const id = created.json().case.id as string;
    await app.inject({ method: "POST", url: `/cases/${id}/screen` });

    // premature packet is refused by the state machine
    const early = await app.inject({ method: "POST", url: `/cases/${id}/packet` });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe("illegal_transition");

    // inject a scored result directly into the ledger (LLM not available in tests)
    const criteria = metCriteria(n.insurer, n.cpt, n.text);
    app.ctx.ledger.appendEvent(id, "evidence.scored", { criteria, facts: [], overall: "ready", red_flags: [], met: criteria.length, missing: 0, unclear: 0 }, "llm");

    const pk = await app.inject({ method: "POST", url: `/cases/${id}/packet`, headers: { host: "localhost:4000" } });
    expect(pk.statusCode).toBe(200);
    expect(pk.json().pdf_url).toBe(`http://localhost:4000/packets/${id}.pdf`);
    expect(pk.json().generator).toBe("template");
    expect(pk.json().letter_text).toContain("Aetna CPB 0236");
    expect(pk.json().fhir_bundle.entry[0].resource.resourceType).toBe("Claim");
    const pdf = await app.inject({ method: "GET", url: `/packets/${id}.pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");

    // submit with 50% chaos; retries must land a decision in nearly every run (5 attempts → 3% failure)
    let payer: Record<string, any> | null = null;
    for (let tries = 0; tries < 3; tries++) {
      const sub = await app.inject({ method: "POST", url: `/cases/${id}/submit` });
      expect(sub.statusCode).toBe(200);
      payer = sub.json().payer;
      if (payer!.status !== "failed") break;
    }
    expect(payer!.adapter).toBe("mock");
    expect(["approved", "pended"]).toContain(payer!.status);
    expect(payer!.attempts.length).toBeGreaterThanOrEqual(1);
    expect(payer!.attempts.at(-1).outcome).toBe("ok");
    expect(payer!.sla.kind).toBe("standard");

    const detail = (await app.inject({ method: "GET", url: `/cases/${id}` })).json().case;
    expect(["approved", "pended"]).toContain(detail.state);
    const types = detail.timeline.map((e: { type: string }) => e.type);
    expect(types).toContain("payer.submitted");
    expect(types).toContain("payer.responded");
    const failedEvents = types.filter((t: string) => t === "payer.attempt_failed").length;
    expect(failedEvents).toBe(payer!.attempts.filter((a: { outcome: string }) => a.outcome !== "ok").length);
    if (detail.state === "approved") {
      expect(detail.notification.channel).toBe("simulated");
      expect(detail.notification.body).toContain("approved");
    }

    const rv = await app.inject({ method: "POST", url: `/cases/${id}/review/complete` });
    expect(rv.statusCode).toBe(200);
    expect(rv.json().review_seconds).toBeGreaterThanOrEqual(1);

    const summary = (await app.inject({ method: "GET", url: "/cases" })).json().cases.find((s: { id: string }) => s.id === id);
    expect(summary.review_seconds).toBe(rv.json().review_seconds);

    if (detail.state === "pended") {
      const inq = await app.inject({ method: "POST", url: `/cases/${id}/inquire` });
      expect(inq.statusCode).toBe(200);
      expect(inq.json()).toMatchObject({ changed: true, payer: { status: "approved", adjudication: "A1" } });
    } else {
      const inq = await app.inject({ method: "POST", url: `/cases/${id}/inquire` });
      expect(inq.statusCode).toBe(409);
    }
    const closed = await app.inject({ method: "POST", url: `/cases/${id}/close` });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().case.state).toBe("closed");
    expect((await app.inject({ method: "POST", url: `/cases/${id}/close` })).statusCode).toBe(409);

    const m = (await app.inject({ method: "GET", url: "/metrics" })).json();
    expect(m.cases).toBe(1);
    expect(m.completed).toBe(1);
    expect(m.baseline_minutes).toBe(24);
    expect(m.minutes_saved_total).toBeGreaterThan(20);
    expect(m.baseline_source).toMatch(/CAQH/);
  });

  it("manual gap-fill is refused before scoring and submit is refused before packet", async () => {
    const n = notes.notes[2];
    const created = await app.inject({ method: "POST", url: "/cases", payload: { note: n.text, cpt: n.cpt, insurer: n.insurer, patient: n.patient, physician: n.physician } });
    const id = created.json().case.id as string;
    const man = await app.inject({ method: "POST", url: `/cases/${id}/gapfill/manual`, payload: { answers: [{ criterion_id: "x", answer: "y" }] } });
    expect(man.statusCode).toBe(409);
    const sub = await app.inject({ method: "POST", url: `/cases/${id}/submit` });
    expect(sub.statusCode).toBe(409);
    const call = await app.inject({ method: "POST", url: `/cases/${id}/gapfill/call` });
    expect(call.statusCode).toBe(409);
  });
});
