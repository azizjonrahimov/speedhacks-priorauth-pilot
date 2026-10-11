import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { canTransition } from "../domain/stateMachine.js";
import { AppError } from "../domain/types.js";
import { applyManualAnswers, startGapFillCall } from "../gapfill/service.js";
import { parseBody } from "./cases.js";

const manualSchema = z.object({ answers: z.array(z.object({ criterion_id: z.string(), answer: z.string() })).min(1) });

export function registerGapfillRoutes(app: FastifyInstance, ctx: AppContext) {
  const { ledger } = ctx;

  app.post<{ Params: { id: string } }>("/cases/:id/gapfill/call", async (req, reply) => {
    const c = ledger.requireCase(req.params.id);
    if (!canTransition(c.state, "call.placed")) throw new AppError(409, "illegal_transition", `cannot place a call in state ${c.state} (score first; needs_info required)`);
    const attempt = (c.call?.attempt ?? 0) + 1;
    if (c.call && c.call.status === "queued" && c.state === "calling") throw new AppError(409, "call_in_progress", `call ${c.call.call_id} is already in progress`);
    const r = await startGapFillCall(ctx, c.id, Math.min(attempt, 2), req.log);
    reply.status(202);
    return { call_id: r.call_id, status: "queued", attempt: r.attempt };
  });

  app.post<{ Params: { id: string } }>("/cases/:id/gapfill/manual", async (req) => {
    const c = ledger.requireCase(req.params.id);
    if (!canTransition(c.state, "gap.manual_answered")) throw new AppError(409, "illegal_transition", `cannot enter manual answers in state ${c.state}`);
    const body = parseBody(manualSchema, req.body);
    const r = await applyManualAnswers(ctx, c.id, body.answers, req.log);
    return { criteria: r.criteria, overall: r.overall, red_flags: r.red_flags, facts: r.facts };
  });
}
