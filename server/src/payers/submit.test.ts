import { describe, expect, it } from "vitest";
import { CircuitBreaker, submitWithRetry } from "./submit.js";
import { MockPayerAdapter } from "./mock.js";
import { PayerError, type PayerAdapter, type SubmitContext } from "./types.js";
import type { PasBundle } from "../fhir/pasBundle.js";

const bundle = {} as PasBundle;
const ctx: SubmitContext = { caseId: "pa_x", satisfied: true, unresolved: [], unresolvedTexts: [], expedited: false, policyId: "P" };
const noSleep = async () => {};

function seq(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("submitWithRetry", () => {
  it("retries 500s with exponential backoff and succeeds", async () => {
    let calls = 0;
    const adapter: PayerAdapter = {
      name: "mock",
      submit: async () => {
        calls++;
        if (calls < 3) throw new PayerError("http_500", "boom", 500);
        return { status: "approved", adjudication: "A1", reference: "R", reason: null };
      },
      inquire: async () => ({ status: "submitted", adjudication: null, reference: null, reason: null }),
    };
    const seen: string[] = [];
    const out = await submitWithRetry(adapter, bundle, ctx, { sleep: noSleep, rng: () => 0.5, onAttempt: (a) => seen.push(a.outcome) });
    expect(out.response?.status).toBe("approved");
    expect(seen).toEqual(["http_500", "http_500", "ok"]);
    expect(out.attempts[0].backoff_ms).toBe(300);
    expect(out.attempts[1].backoff_ms).toBe(600);
    expect(out.attempts[2].backoff_ms).toBeUndefined();
  });

  it("gives up after maxAttempts and does not retry non-retryable errors", async () => {
    const always500: PayerAdapter = { name: "mock", submit: async () => { throw new PayerError("http_500", "x", 500); }, inquire: async () => ({ status: "submitted", adjudication: null, reference: null, reason: null }) };
    const out = await submitWithRetry(always500, bundle, ctx, { sleep: noSleep, policy: { maxAttempts: 3 } });
    expect(out.response).toBeNull();
    expect(out.attempts).toHaveLength(3);
    expect(out.gave_up_reason).toBe("max_attempts");
    const bad: PayerAdapter = { ...always500, submit: async () => { throw new PayerError("error", "bundle rejected", 400); } };
    const out2 = await submitWithRetry(bad, bundle, ctx, { sleep: noSleep });
    expect(out2.attempts).toHaveLength(1);
    expect(out2.gave_up_reason).toBe("non_retryable");
  });

  it("opens the circuit after consecutive failures and reports circuit_open", async () => {
    let t = 0;
    const breaker = new CircuitBreaker(2, 1000, () => t);
    const always500: PayerAdapter = { name: "mock", submit: async () => { throw new PayerError("http_500", "x", 500); }, inquire: async () => ({ status: "submitted", adjudication: null, reference: null, reason: null }) };
    const out = await submitWithRetry(always500, bundle, ctx, { sleep: noSleep, breaker, policy: { maxAttempts: 5 } });
    expect(out.attempts.map((a) => a.outcome)).toEqual(["http_500", "http_500", "circuit_open"]);
    expect(breaker.state).toBe("open");
    t = 2000;
    expect(breaker.state).toBe("half_open");
  });

  it("mock chaos: with p500=0.5 the retry layer still lands a decision from the rules result", async () => {
    const adapter = new MockPayerAdapter({ p500: 0.5, pTimeout: 0, pPend: 0 }, seq([0.1, 0.2, 0.9, 0.9, 0.9]));
    const out = await submitWithRetry(adapter, bundle, ctx, { sleep: noSleep });
    expect(out.attempts.map((a) => a.outcome)).toEqual(["http_500", "http_500", "ok"]);
    expect(out.response).toMatchObject({ status: "approved", adjudication: "A1" });
    const denied = await new MockPayerAdapter({ p500: 0, pTimeout: 0, pPend: 0 }, () => 0.9).submit(bundle, { ...ctx, satisfied: false, unresolved: ["a", "b", "c"], unresolvedTexts: ["x", "y", "z"] });
    expect(denied).toMatchObject({ status: "denied", adjudication: "A3" });
    expect(denied.reason).toMatch(/Not medically necessary/);
    const pended = await new MockPayerAdapter({ p500: 0, pTimeout: 0, pPend: 0 }, () => 0.9).submit(bundle, { ...ctx, satisfied: false, unresolved: ["a"], unresolvedTexts: ["6 weeks PT"] });
    expect(pended).toMatchObject({ status: "pended", adjudication: "A4" });
  });
});
