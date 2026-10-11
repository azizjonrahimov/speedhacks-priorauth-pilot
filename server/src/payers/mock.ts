// Mock payer with chaos mode. Decision comes from the rules engine result, not randomness:
//   approved (A1)  if policy logic satisfied and nothing unresolved
//   pended   (A4)  if unresolved criteria remain (or with probability p_pend when satisfied)
//   denied   (A3)  otherwise, with a specific reason (CMS-0057-F)
// Chaos: each submit fails with p_500 (HTTP 500) or p_timeout (hang then timeout).
import { randomUUID } from "node:crypto";
import type { PasBundle } from "../fhir/pasBundle.js";
import { PayerError, type PayerAdapter, type PayerResponse, type SubmitContext } from "./types.js";

export interface ChaosConfig {
  p500: number;
  pTimeout: number;
  pPend: number;
  timeoutMs?: number;
}

export class MockPayerAdapter implements PayerAdapter {
  readonly name = "mock" as const;
  private pended = new Map<string, PayerResponse>();
  constructor(
    private chaos: ChaosConfig,
    private rng: () => number = Math.random,
  ) {}

  private decide(ctx: SubmitContext): PayerResponse {
    const ref = `MOCK-${ctx.caseId.replace(/^pa_/, "").toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
    if (ctx.satisfied && ctx.unresolved.length === 0) {
      if (this.rng() < this.chaos.pPend) {
        const r: PayerResponse = { status: "pended", adjudication: "A4", reference: ref, reason: `Pended for medical director review under ${ctx.policyId}; decision due within ${ctx.expedited ? "72 hours" : "7 calendar days"} (CMS-0057-F).` };
        this.pended.set(ref, r);
        return r;
      }
      return { status: "approved", adjudication: "A1", reference: ref, reason: null };
    }
    if (ctx.unresolved.length > 0 && ctx.unresolved.length < 3) {
      const r: PayerResponse = {
        status: "pended",
        adjudication: "A4",
        reference: ref,
        reason: `Additional information required under ${ctx.policyId}: ${ctx.unresolvedTexts.join("; ")}. Decision due within ${ctx.expedited ? "72 hours" : "7 calendar days"} of receipt (CMS-0057-F).`,
      };
      this.pended.set(ref, r);
      return r;
    }
    return {
      status: "denied",
      adjudication: "A3",
      reference: ref,
      reason: `Not medically necessary under ${ctx.policyId}: documentation does not establish ${ctx.unresolvedTexts.slice(0, 3).join("; ")}. You may resubmit with the missing documentation or request a peer-to-peer review.`,
    };
  }

  async submit(_bundle: PasBundle, ctx: SubmitContext): Promise<PayerResponse> {
    const r = this.rng();
    if (r < this.chaos.p500) {
      await new Promise((res) => setTimeout(res, 30 + Math.random() * 70));
      throw new PayerError("http_500", "mock payer: 500 Internal Server Error (chaos)", 500);
    }
    if (r < this.chaos.p500 + this.chaos.pTimeout) {
      await new Promise((res) => setTimeout(res, this.chaos.timeoutMs ?? 3000));
      throw new PayerError("timeout", "mock payer: request timed out (chaos)");
    }
    await new Promise((res) => setTimeout(res, 120 + Math.random() * 250));
    return this.decide(ctx);
  }

  async inquire(reference: string, ctx: SubmitContext): Promise<PayerResponse> {
    const p = this.pended.get(reference);
    if (!p) return { status: "submitted", adjudication: null, reference, reason: null };
    // a pended case resolves to approved when nothing is unresolved, else denied
    return ctx.unresolved.length === 0
      ? { status: "approved", adjudication: "A1", reference, reason: null }
      : { status: "denied", adjudication: "A3", reference, reason: `Requested information not received: ${ctx.unresolvedTexts.join("; ")}.` };
  }
}
