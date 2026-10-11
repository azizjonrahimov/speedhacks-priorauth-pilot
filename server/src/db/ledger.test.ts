import { describe, expect, it } from "vitest";
import { Ledger } from "./ledger.js";
import type { CreateCaseInput } from "../domain/types.js";

const input: CreateCaseInput = {
  note: "Patient reports 8 weeks of low back pain.",
  cpt: "72148",
  insurer: "Aetna",
  patient: { name: "Test Patient", dob: "1980-01-01", member_id: "M1", phone: "+14155550100" },
  physician: { name: "Dr Test", npi: "1234567890", phone: "+14155550101" },
};

describe("ledger + fold", () => {
  it("appends events, folds state and keeps a timeline", () => {
    const l = new Ledger(":memory:");
    const id = "pa_test1";
    const e1 = l.appendEvent(id, "case.created", { input, cpt_label: "MRI lumbar spine" });
    expect(e1.seq).toBe(1);
    expect(e1.state).toBe("intake");
    l.appendEvent(id, "screening.completed", {
      pa_required: true,
      policy: { id: "CPB 0236", url: "u", insurer: "Aetna", cpt: "72148", label: "MRI lumbar spine w/o contrast" },
      red_flags: [],
      expedited: false,
    });
    const criteria = [
      {
        id: "c1",
        text: "6 weeks conservative therapy",
        kind: "conservative_therapy_duration",
        group: "all_of",
        params: { min_weeks: 6 },
        status: "missing",
        evidence_quote: null,
        char_start: null,
        char_end: null,
        evidence_source: null,
        reasoning: "no therapy documented",
        confidence: 0.9,
        question_if_missing: "How many weeks of conservative therapy?",
        verifier: { quote_verified: false, deterministic_check: null },
      },
    ];
    l.appendEvent(id, "evidence.scored", { criteria, facts: [], overall: "needs_info", red_flags: [] }, "llm");
    const c = l.requireCase(id);
    expect(c.state).toBe("evidence_scored");
    expect(c.overall).toBe("needs_info");
    expect(c.gaps).toHaveLength(1);
    expect(c.gaps[0].question).toMatch(/weeks/);
    expect(c.timeline).toHaveLength(3);
    expect(c.cpt_label).toBe("MRI lumbar spine w/o contrast");
    expect(l.listCases()[0]).toMatchObject({ id, state: "evidence_scored", patient_name: "Test Patient" });
    expect(l.listEvents(id).map((e) => e.type)).toEqual(["case.created", "screening.completed", "evidence.scored"]);
  });

  it("refuses illegal events and leaves the ledger untouched", () => {
    const l = new Ledger(":memory:");
    const id = "pa_test2";
    l.appendEvent(id, "case.created", { input, cpt_label: "x" });
    expect(() => l.appendEvent(id, "payer.submitted", {})).toThrow(/not allowed/);
    expect(l.listEvents(id)).toHaveLength(1);
    expect(() => l.requireCase("nope")).toThrow(/not found/);
  });

  it("folds call, packet, payer and review", () => {
    const l = new Ledger(":memory:");
    const id = "pa_test3";
    l.appendEvent(id, "case.created", { input, cpt_label: "x" });
    l.appendEvent(id, "screening.completed", { pa_required: true, policy: { id: "p", url: "", insurer: "Aetna", cpt: "72148", label: "x" }, red_flags: [] });
    l.appendEvent(id, "evidence.scored", { criteria: [], facts: [], overall: "needs_info", red_flags: [] });
    l.appendEvent(id, "gap.question_generated", { criterion_id: "c1", question: "Q?" });
    l.appendEvent(id, "call.placed", { call_id: "call_1", attempt: 1, to_masked: "+1415***0101" }, "dial");
    l.appendEvent(id, "call.ended", { call_id: "call_1", status: "ended", duration_seconds: 42, end_reason: "completed" }, "dial");
    l.appendEvent(id, "call.parsed", { call_id: "call_1", answers: [{ criterion_id: "c1", answer: "8 weeks", confidence: 0.9 }] }, "llm");
    l.appendEvent(id, "evidence.rescored", { criteria: [], facts: [], overall: "ready", red_flags: [] });
    l.appendEvent(id, "packet.generated", { letter_text: "Dear payer", pdf_url: "http://x/packets/pa_test3.pdf", fhir_bundle: { resourceType: "Bundle" } });
    l.appendEvent(id, "payer.attempt_failed", { n: 1, outcome: "http_500", ms: 12, status_code: 500, backoff_ms: 200 }, "payer");
    l.appendEvent(id, "payer.submitted", { adapter: "mock", reference: "REF1", attempt: { n: 2, outcome: "ok", ms: 30 } }, "payer");
    l.appendEvent(id, "payer.responded", { status: "approved", adjudication: "A1", reference: "REF1", reason: null }, "payer");
    l.appendEvent(id, "patient.notified", { channel: "simulated", to_masked: "+1415***0100", body: "hi" });
    l.appendEvent(id, "review.completed", { review_seconds: 300 }, "staff");
    const c = l.requireCase(id);
    expect(c.state).toBe("approved");
    expect(c.call?.status).toBe("ended");
    expect(c.call?.answers[0].answer).toBe("8 weeks");
    expect(c.gaps[0]).toMatchObject({ status: "answered", answered_via: "phone_call" });
    expect(c.packet?.pdf_url).toContain("pa_test3.pdf");
    expect(c.payer?.attempts.map((a) => a.outcome)).toEqual(["http_500", "ok"]);
    expect(c.payer?.adjudication).toBe("A1");
    expect(c.notification?.channel).toBe("simulated");
    expect(c.review?.review_seconds).toBe(300);
  });

  it("broadcasts appended events on the bus", async () => {
    const l = new Ledger(":memory:");
    const seen: string[] = [];
    l.bus.on("event", (e) => seen.push(e.type));
    l.appendEvent("pa_bus", "case.created", { input, cpt_label: "x" });
    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual(["case.created"]);
  });
});
