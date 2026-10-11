import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";
import type { CaseDetail, Criterion } from "../domain/types.js";
import { AppError } from "../domain/types.js";
import { scoreCase, type AppliedLesson, type ScoringResult } from "../evidence/pipeline.js";
import { canTransition } from "../domain/stateMachine.js";
import { evaluate } from "../rules/engine.js";
import { parseBody } from "./cases.js";

/** Lessons to inject when scoring this case (top N for its policy), as the pipeline expects them. */
export function lessonsForCase(ctx: AppContext, c: CaseDetail, n = 5): AppliedLesson[] {
  const policyId = c.screening?.policy.id;
  if (!policyId) return [];
  return ctx.lessons.forScoring(policyId, n).map((l) => ({ id: l.id, criterion_id: l.criterion_id, summary: l.summary, count: l.count }));
}

/** Append the events produced by one scoring pass. Shared by /score, call parsing and /gapfill/manual. */
export function recordScoring(ctx: AppContext, c: CaseDetail, r: ScoringResult, kind: "evidence.scored" | "evidence.rescored") {
  const { ledger } = ctx;
  if (r.lessonsApplied.length > 0) {
    // the timeline shows the system learning: which past mistakes shaped this scoring pass
    ledger.appendEvent(c.id, "lessons.applied", { ids: r.lessonsApplied, count: r.lessonsApplied.length, policy_id: c.screening?.policy.id ?? null, pass: kind }, "system");
  }
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
      lessons_applied: r.lessonsApplied,
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

const overrideSchema = z.object({
  status: z.enum(["met", "missing", "unclear", "not_applicable"]),
  reason: z.string().min(3).max(500),
});

export function registerEvidenceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { ledger } = ctx;

  app.post<{ Params: { id: string } }>("/cases/:id/score", async (req) => {
    const c = ledger.requireCase(req.params.id);
    if (!c.screening) throw new AppError(409, "illegal_transition", "screen the case before scoring (POST /cases/:id/screen)");
    if (!c.screening.pa_required) throw new AppError(409, "not_required", "prior authorization is not required for this policy");
    if (!canTransition(c.state, "evidence.scored")) throw new AppError(409, "illegal_transition", `cannot score in state ${c.state}`);
    const t0 = Date.now();
    const lessons = lessonsForCase(ctx, c);
    const r = await scoreCase(c, req.log, lessons);
    req.log.info({ case_id: c.id, ms: Date.now() - t0, facts: r.facts.length, overall: r.overall, rejected_quotes: r.rejectedQuotes.length, rejected_facts: r.rejectedFacts, lessons: lessons.length }, "scored");
    recordScoring(ctx, c, r, "evidence.scored");
    return { criteria: r.criteria, overall: r.overall, red_flags: r.red_flags, facts: r.facts, expedited: r.expedited, lessons_applied: r.lessonsApplied };
  });

  // Reviewer correction: the human is the ground truth. Recomputes overall deterministically and
  // becomes a lesson (derived) + a Keewano event (mirrored by the sink).
  app.post<{ Params: { id: string; criterion_id: string } }>("/cases/:id/criteria/:criterion_id/override", async (req) => {
    const c = ledger.requireCase(req.params.id);
    if (!canTransition(c.state, "criterion.overridden")) throw new AppError(409, "illegal_transition", `cannot override criteria in state ${c.state} (score first; not after submission)`);
    const body = parseBody(overrideSchema, req.body);
    const target = c.criteria.find((k) => k.id === req.params.criterion_id);
    if (!target) throw new AppError(404, "not_found", `criterion ${req.params.criterion_id} not on this case`);
    if (target.status === body.status) throw new AppError(409, "no_change", `criterion is already ${body.status}`);
    const criteria: Criterion[] = c.criteria.map((k) =>
      k.id === target.id
        ? {
            ...k,
            status: body.status,
            reasoning: `${k.reasoning} [reviewer override: ${k.status} → ${body.status}]`,
            question_if_missing: body.status === "missing" || body.status === "unclear" ? (k.question_if_missing ?? null) : null,
            confidence: 1,
          }
        : k,
    );
    const ev = evaluate(criteria, c.screening?.pa_required ?? true);
    ledger.appendEvent(
      c.id,
      "criterion.overridden",
      {
        criterion_id: target.id,
        from_status: target.status,
        to_status: body.status,
        reason: body.reason, // stays in the ledger only; never copied into lessons or Keewano
        policy_id: c.screening?.policy.id ?? null,
        overall_before: c.overall,
        overall: ev.overall,
        criteria,
      },
      "reviewer",
    );
    const after = ledger.requireCase(c.id);
    return { criterion: after.criteria.find((k) => k.id === target.id), overall: after.overall, criteria: after.criteria };
  });

  app.get<{ Querystring: { policy_id?: string; kind?: string } }>("/lessons", async (req) => {
    const kind = req.query.kind as "override" | "quote_rejected" | "call_overstep" | "verifier_mismatch" | undefined;
    const lessons = ctx.lessons.list({ policy_id: req.query.policy_id, kind });
    return { lessons, total: lessons.length, total_occurrences: lessons.reduce((s, l) => s + l.count, 0) };
  });
}
