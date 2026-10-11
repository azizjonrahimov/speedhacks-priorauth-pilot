import { describe, expect, it } from "vitest";
import { canTransition, nextState } from "./stateMachine.js";

describe("stateMachine", () => {
  it("walks the happy path", () => {
    let s = nextState(null, "case.created");
    expect(s).toBe("intake");
    s = nextState(s, "screening.completed", { pa_required: true });
    expect(s).toBe("screened");
    s = nextState(s, "evidence.extracted");
    expect(s).toBe("screened");
    s = nextState(s, "evidence.scored", { overall: "needs_info" });
    expect(s).toBe("evidence_scored");
    s = nextState(s, "gap.question_generated", { criterion_id: "x" });
    expect(s).toBe("needs_info");
    s = nextState(s, "call.placed", { call_id: "c1" });
    expect(s).toBe("calling");
    s = nextState(s, "call.ended", {});
    expect(s).toBe("calling");
    s = nextState(s, "call.parsed", {});
    s = nextState(s, "evidence.rescored", { overall: "ready" });
    expect(s).toBe("evidence_rescored");
    s = nextState(s, "packet.generated", {});
    expect(s).toBe("packet_ready");
    s = nextState(s, "payer.attempt_failed", {});
    expect(s).toBe("packet_ready");
    s = nextState(s, "payer.submitted", {});
    expect(s).toBe("submitted");
    s = nextState(s, "payer.responded", { status: "pended" });
    expect(s).toBe("pended");
    s = nextState(s, "payer.responded", { status: "approved" });
    expect(s).toBe("approved");
    s = nextState(s, "patient.notified", {});
    expect(s).toBe("approved");
    s = nextState(s, "review.completed", { review_seconds: 120 });
    expect(s).toBe("approved");
    s = nextState(s, "case.closed", {});
    expect(s).toBe("closed");
  });

  it("supports the direct path with no gaps", () => {
    let s = nextState(null, "case.created");
    s = nextState(s, "screening.completed", {});
    s = nextState(s, "evidence.scored", { overall: "ready" });
    s = nextState(s, "packet.generated", {});
    expect(s).toBe("packet_ready");
  });

  it("falls back to needs_info when the call cannot be completed", () => {
    let s: ReturnType<typeof nextState> = "calling";
    s = nextState(s, "call.failed", { reason: "no_answer" });
    s = nextState(s, "call.retry_scheduled", {});
    s = nextState(s, "call.placed", {});
    s = nextState(s, "call.failed", {});
    s = nextState(s, "gap.unresolved", {});
    expect(s).toBe("needs_info");
    s = nextState(s, "gap.manual_answered", {});
    s = nextState(s, "evidence.rescored", {});
    expect(s).toBe("evidence_rescored");
  });

  it("rejects illegal transitions", () => {
    expect(() => nextState("intake", "packet.generated")).toThrow(/not allowed/);
    expect(() => nextState("intake", "payer.submitted")).toThrow(/not allowed/);
    expect(() => nextState("calling", "packet.generated")).toThrow(/not allowed/);
    expect(() => nextState("screened", "call.placed")).toThrow(/not allowed/);
    expect(() => nextState(null, "screening.completed")).toThrow(/before case.created/);
    expect(() => nextState("intake", "case.created")).toThrow(/already exists/);
    expect(() => nextState("submitted", "payer.responded", { status: "weird" })).toThrow(/needs status/);
    expect(canTransition("closed", "payer.submitted")).toBe(false);
    expect(canTransition("packet_ready", "payer.submitted")).toBe(true);
  });

  it("denied is terminal except close", () => {
    const s = nextState("submitted", "payer.responded", { status: "denied" });
    expect(s).toBe("denied");
    expect(canTransition(s, "payer.submitted")).toBe(false);
    expect(canTransition(s, "case.closed")).toBe(true);
  });
});
