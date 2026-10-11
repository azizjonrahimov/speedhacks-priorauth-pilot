import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppContext } from "../app.js";
import { config } from "../config.js";
import { canTransition } from "../domain/stateMachine.js";
import { AppError, type Payer } from "../domain/types.js";
import { buildPasBundle } from "../fhir/pasBundle.js";
import { notifyPatientApproved } from "../notify/patient.js";
import { evaluate } from "../rules/engine.js";
import { DaVinciPasAdapter } from "../payers/davinci.js";
import { MockPayerAdapter } from "../payers/mock.js";
import { CircuitBreaker, submitWithRetry } from "../payers/submit.js";
import type { PayerAdapter, SubmitContext } from "../payers/types.js";

export function makeAdapters() {
  return {
    mock: new MockPayerAdapter({ p500: config.chaos.p500, pTimeout: config.chaos.pTimeout, pPend: config.chaos.pPend, timeoutMs: 2500 }),
    davinci: new DaVinciPasAdapter(),
  } as const;
}

export function registerSubmitRoutes(app: FastifyInstance, ctx: AppContext) {
  const { ledger } = ctx;
  const adapters = makeAdapters();
  // Threshold > maxAttempts (5): one submission can exhaust its retries without tripping the breaker;
  // the breaker opens on sustained failure across submissions and half-opens after the cooldown.
  const breakers = { mock: new CircuitBreaker(8, 20_000), davinci: new CircuitBreaker(6, 60_000) };

  app.post<{ Params: { id: string }; Querystring: { adapter?: string } }>("/cases/:id/submit", async (req) => {
    const c = ledger.requireCase(req.params.id);
    if (!canTransition(c.state, "payer.submitted")) throw new AppError(409, "illegal_transition", `cannot submit in state ${c.state} (generate the packet first)`);
    if (!c.packet) throw new AppError(409, "illegal_transition", "generate the packet first");
    const name = (req.query.adapter ?? config.payerAdapter) as "mock" | "davinci";
    const adapter: PayerAdapter = adapters[name] ?? adapters.mock;

    const ev = evaluate(c.criteria, c.screening?.pa_required ?? true);
    const sctx: SubmitContext = {
      caseId: c.id,
      satisfied: ev.satisfied,
      unresolved: ev.unresolved,
      unresolvedTexts: ev.unresolved.map((id) => c.criteria.find((k) => k.id === id)?.text ?? id),
      expedited: c.expedited,
      policyId: c.screening?.policy.id ?? "policy",
    };
    let pdfBase64: string | null = null;
    try {
      pdfBase64 = (await readFile(resolve(config.packetsDir, `${c.id}.pdf`))).toString("base64");
    } catch {
      /* no pdf */
    }
    const bundle = buildPasBundle({ c, letterText: c.packet.letter_text, pdfBase64 });

    const out = await submitWithRetry(adapter, bundle, sctx, {
      breaker: breakers[adapter.name],
      onAttempt: (a, final) => {
        if (a.outcome !== "ok") ledger.appendEvent(c.id, "payer.attempt_failed", { ...a, adapter: adapter.name, final, breaker: breakers[adapter.name].snapshot() }, "payer");
      },
    });

    const sla = { kind: c.expedited ? ("expedited" as const) : ("standard" as const), decision_due_at: new Date(Date.now() + (c.expedited ? 72 : 7 * 24) * 3600_000).toISOString() };
    if (!out.response) {
      // all attempts failed: stay in packet_ready so staff can resubmit; record a failed payer block
      ledger.appendEvent(c.id, "payer.submitted", { adapter: adapter.name, reference: null, n_attempts: out.attempts.length, sla, gave_up: out.gave_up_reason }, "payer");
      ledger.appendEvent(c.id, "payer.responded", { adapter: adapter.name, status: "failed", adjudication: null, reference: null, reason: `submission failed after ${out.attempts.length} attempt(s): ${out.gave_up_reason}; ${out.attempts.at(-1)?.error ?? ""}` }, "payer");
      const payer = ledger.requireCase(c.id).payer as Payer;
      return { payer: { ...payer, status: "failed", attempts: payer.attempts } };
    }

    const okAttempt = out.attempts[out.attempts.length - 1];
    ledger.appendEvent(c.id, "payer.submitted", { adapter: adapter.name, reference: out.response.reference, n_attempts: out.attempts.length, sla, attempt: okAttempt }, "payer");
    const status = out.response.status === "submitted" ? "pended" : out.response.status;
    ledger.appendEvent(c.id, "payer.responded", { adapter: adapter.name, status, adjudication: out.response.adjudication, reference: out.response.reference, reason: out.response.reason, raw: adapter.name === "davinci" ? out.response.raw ?? null : undefined }, "payer");
    req.log.info({ case_id: c.id, adapter: adapter.name, status, adjudication: out.response.adjudication, attempts: out.attempts.length }, "payer responded");

    if (status === "approved") await notifyPatientApproved(ctx, ledger.requireCase(c.id), req.log);
    return { payer: ledger.requireCase(c.id).payer };
  });

  /** Re-check a pended case with the payer (mock resolves it; davinci tries $inquire). */
  app.post<{ Params: { id: string } }>("/cases/:id/inquire", async (req) => {
    const c = ledger.requireCase(req.params.id);
    if (c.state !== "pended" || !c.payer?.reference) throw new AppError(409, "illegal_transition", "only pended cases with a reference can be inquired");
    const adapter: PayerAdapter = adapters[c.payer.adapter] ?? adapters.mock;
    const ev = evaluate(c.criteria, true);
    const r = await adapter.inquire(c.payer.reference, { caseId: c.id, satisfied: ev.satisfied, unresolved: ev.unresolved, unresolvedTexts: ev.unresolved.map((id) => c.criteria.find((k) => k.id === id)?.text ?? id), expedited: c.expedited, policyId: c.screening?.policy.id ?? "" });
    if (r.status === "submitted") return { payer: c.payer, changed: false };
    ledger.appendEvent(c.id, "payer.responded", { adapter: adapter.name, status: r.status, adjudication: r.adjudication, reference: r.reference, reason: r.reason }, "payer");
    if (r.status === "approved") await notifyPatientApproved(ctx, ledger.requireCase(c.id), req.log);
    return { payer: ledger.requireCase(c.id).payer, changed: true };
  });
}
