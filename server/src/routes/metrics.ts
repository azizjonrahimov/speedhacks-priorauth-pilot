import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { canTransition } from "../domain/stateMachine.js";
import { AppError } from "../domain/types.js";

export const BASELINE_MINUTES = 24;
export const BASELINE_SOURCE = "CAQH Index: ~24 minutes of staff time per manual prior authorization; AMA 2023 survey: 40 PAs/physician/week, ~13 hours/week.";

export function computeMetrics(ctx: AppContext) {
  const cases = ctx.ledger.allCases();
  const reviewed = cases.filter((c) => c.review);
  const avg = reviewed.length ? reviewed.reduce((s, c) => s + (c.review?.review_seconds ?? 0), 0) / reviewed.length : 0;
  const avgMin = avg / 60;
  const minutes_saved_total = Math.max(0, Math.round(reviewed.length * (BASELINE_MINUTES - avgMin) * 10) / 10);
  return {
    cases: cases.length,
    approved: cases.filter((c) => c.payer?.status === "approved" || c.state === "approved").length,
    pended: cases.filter((c) => c.state === "pended").length,
    denied: cases.filter((c) => c.state === "denied").length,
    completed: reviewed.length,
    expedited: cases.filter((c) => c.expedited).length,
    calls_placed: cases.filter((c) => c.call).length,
    avg_review_seconds: Math.round(avg),
    minutes_saved_total,
    baseline_minutes: BASELINE_MINUTES,
    baseline_source: BASELINE_SOURCE,
    payer_attempts: cases.reduce((s, c) => s + (c.payer?.attempts.length ?? 0), 0),
    payer_retries: cases.reduce((s, c) => s + (c.payer?.attempts.filter((a) => a.outcome !== "ok").length ?? 0), 0),
  };
}

export function registerMetricsRoutes(app: FastifyInstance, ctx: AppContext) {
  const { ledger } = ctx;
  app.get("/metrics", async () => computeMetrics(ctx));

  app.post<{ Params: { id: string } }>("/cases/:id/review/complete", async (req) => {
    const c = ledger.requireCase(req.params.id);
    if (!canTransition(c.state, "review.completed")) throw new AppError(409, "illegal_transition", `cannot complete review in state ${c.state} (packet must exist)`);
    const review_seconds = Math.max(1, Math.round((Date.now() - Date.parse(c.created_at)) / 1000));
    ledger.appendEvent(c.id, "review.completed", { review_seconds, baseline_minutes: BASELINE_MINUTES, minutes_saved: Math.round((BASELINE_MINUTES - review_seconds / 60) * 10) / 10 }, "staff");
    return { review_seconds };
  });

  app.post<{ Params: { id: string } }>("/cases/:id/close", async (req) => {
    const c = ledger.requireCase(req.params.id);
    if (!canTransition(c.state, "case.closed")) throw new AppError(409, "illegal_transition", `cannot close in state ${c.state}`);
    ledger.appendEvent(c.id, "case.closed", {}, "staff");
    return { case: ledger.requireCase(c.id) };
  });
}
