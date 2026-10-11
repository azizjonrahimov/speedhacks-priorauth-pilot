import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "../app.js";
import { AppError, type CaseDetail, type CreateCaseInput } from "../domain/types.js";
import { cptLabel, findPolicy, policyRef, scanRedFlags } from "../rules/engine.js";
import { maskPhone, registerName } from "../util/redact.js";

const personSchema = z.object({ name: z.string().min(1), phone: z.string().default("") });
export const createCaseSchema = z.object({
  note: z.string().min(20, "note must be at least 20 characters"),
  cpt: z.string().min(1),
  insurer: z.string().min(1),
  patient: personSchema.extend({ dob: z.string().default(""), member_id: z.string().default("") }),
  physician: personSchema.extend({ npi: z.string().default("") }),
});

export function newCaseId() {
  return `pa_${randomBytes(4).toString("hex")}`;
}

/** Mask phones before a case leaves the server. */
export function publicCase(c: CaseDetail): CaseDetail {
  return {
    ...c,
    patient: { ...c.patient, phone: maskPhone(c.patient.phone) },
    physician: { ...c.physician, phone: maskPhone(c.physician.phone) },
  };
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new AppError(400, "bad_request", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export function registerCaseRoutes(app: FastifyInstance, ctx: AppContext) {
  const { ledger } = ctx;

  app.post("/cases", async (req, reply) => {
    const input = parseBody(createCaseSchema, req.body) as CreateCaseInput;
    registerName(input.patient.name);
    registerName(input.physician.name);
    const id = newCaseId();
    ledger.appendEvent(
      id,
      "case.created",
      { input, cpt_label: cptLabel(input.insurer, input.cpt), cpt: input.cpt, insurer: input.insurer, patient_name: input.patient.name },
      "staff",
    );
    reply.status(201);
    return { case: publicCase(ledger.requireCase(id)) };
  });

  app.get("/cases", async () => ({ cases: ledger.listCases() }));

  app.get<{ Params: { id: string } }>("/cases/:id", async (req) => ({ case: publicCase(ledger.requireCase(req.params.id)) }));

  app.get<{ Params: { id: string } }>("/cases/:id/events", async (req) => {
    ledger.requireCase(req.params.id);
    return { events: ledger.listEvents(req.params.id) };
  });

  app.post<{ Params: { id: string } }>("/cases/:id/screen", async (req) => {
    const c = ledger.requireCase(req.params.id);
    const policy = findPolicy(c.insurer, c.cpt);
    if (!policy) {
      const ref = { id: "NONE", url: "", insurer: c.insurer, cpt: c.cpt, label: c.cpt_label };
      ledger.appendEvent(c.id, "screening.completed", { pa_required: false, policy: ref, red_flags: [], expedited: false });
      return { pa_required: false, policy: ref, red_flags: [], expedited: false };
    }
    const red_flags = scanRedFlags(c.note, policy);
    const expedited = red_flags.length > 0;
    const ref = policyRef(policy);
    ledger.appendEvent(c.id, "screening.completed", { pa_required: policy.pa_required, policy: ref, red_flags, expedited });
    return { pa_required: policy.pa_required, policy: ref, red_flags, expedited };
  });
}
