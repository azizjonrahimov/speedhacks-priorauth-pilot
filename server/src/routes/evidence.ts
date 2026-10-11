import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import type { CaseDetail } from "../domain/types.js";
import { AppError } from "../domain/types.js";
import { scoreCase, type ScoringResult } from "../evidence/pipeline.js";
import { canTransition } from "../domain/stateMachine.js";

/** Append the events produced by one scoring pass. Shared by /score, call parsing and /gapfill/manual. */
export function recordScoring(ctx: AppContext, c: CaseDetail, r: ScoringResult, kind: "evidence.scored" | "evidence.rescored") {
  const { ledger } = ctx;
  if (kind === "evidence.scored") ledger.appendEvent(c.id, "evidence.extracted", { facts_count: r.facts.length, rejected_facts: r.rejectedFacts, facts: r.facts }, "llm");
  for (const rq of r.rejectedQuotes) ledger.appendEvent(c.id, "evidence.quote_rejected", { criterion_id: rq.criterion_id, rejected_quote: rq.quote }, "system");
  ledger.appendEvent(
    c.id,
    kind,
    {
      overall: r.overall,
      met: r.summary.met,
      missing: r.summary.missing,
      unclear: r.summary.unclear,
      not_applicable: r.summary.not_applicable,
      red_flags: r.red_flags,
      expedited: r.expedited,
      criteria: r.criteria,
      facts: r.facts,
    },
    "llm",
  );
  if (r.overall === "needs_info") {
    for (const cr of r.criteria) {
      if ((cr.status === "missing" || cr.status === "unclear") && cr.question_if_missing) {
        const st = ledger.currentState(c.id);
        if (canTransition(st, "gap.question_generated")) {
          ledger.appendEvent(c.id, "gap.question_generated", { criterion_id: cr.id, question: cr.question_if_missing }, "llm");
        }
      }
    }
  }
}

export function registerEvidenceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { ledger } = ctx;

  app.post<{ Params: { id: string } }>("/cases/:id/score", async (req) => {
    const c = ledger.requireCase(req.params.id);
    if (!c.screening) throw new AppError(409, "illegal_transition", "screen the case before scoring (POST /cases/:id/screen)");
    if (!c.screening.pa_required) throw new AppError(409, "not_required", "prior authorization is not required for this policy");
    if (!canTransition(c.state, "evidence.scored")) throw new AppError(409, "illegal_transition", `cannot score in state ${c.state}`);
    const t0 = Date.now();
    const r = await scoreCase(c, req.log);
    req.log.info({ case_id: c.id, ms: Date.now() - t0, facts: r.facts.length, overall: r.overall, rejected_quotes: r.rejectedQuotes.length, rejected_facts: r.rejectedFacts }, "scored");
    recordScoring(ctx, c, r, "evidence.scored");
    return { criteria: r.criteria, overall: r.overall, red_flags: r.red_flags, facts: r.facts, expedited: r.expedited };
  });
}
