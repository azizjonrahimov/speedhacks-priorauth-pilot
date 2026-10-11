// Case state = fold(events). Pure; no I/O.
import type {
  Call,
  CaseDetail,
  CreateCaseInput,
  Criterion,
  Fact,
  Gap,
  LedgerEvent,
  Notification,
  Overall,
  Packet,
  Payer,
  PayerAttempt,
  PolicyRef,
} from "./types.js";

function blank(id: string, at: string, input: CreateCaseInput, cptLabel: string): CaseDetail {
  return {
    id,
    patient_name: input.patient.name,
    cpt: input.cpt,
    cpt_label: cptLabel,
    insurer: input.insurer,
    state: "intake",
    overall: null,
    expedited: false,
    review_seconds: null,
    created_at: at,
    updated_at: at,
    note: input.note,
    patient: input.patient,
    physician: input.physician,
    screening: null,
    facts: [],
    criteria: [],
    red_flags: [],
    gaps: [],
    call: null,
    packet: null,
    payer: null,
    notification: null,
    review: null,
    timeline: [],
  };
}

// Gaps are derived from missing/unclear criteria. Answered/unresolved gaps from earlier
// passes are kept (so the UI can show how each gap was filled); open gaps whose criterion
// is now met disappear.
function gapsFromCriteria(criteria: Criterion[], prev: Gap[]): Gap[] {
  const out: Gap[] = prev.filter((g) => g.status !== "open");
  const have = new Set(out.map((g) => g.criterion_id));
  for (const c of criteria) {
    if ((c.status === "missing" || c.status === "unclear") && c.question_if_missing && !have.has(c.id)) {
      out.push({ criterion_id: c.id, question: c.question_if_missing, status: "open", answer: null, answered_via: null });
    }
  }
  return out;
}

export function foldCase(events: LedgerEvent[]): CaseDetail | null {
  if (events.length === 0) return null;
  let c: CaseDetail | null = null;
  for (const ev of events) {
    const p = ev.payload as Record<string, any>;
    if (ev.type === "case.created") {
      c = blank(ev.case_id, ev.at, p.input as CreateCaseInput, String(p.cpt_label ?? p.input?.cpt ?? ""));
    }
    if (!c) continue;
    switch (ev.type) {
      case "screening.completed":
        c.screening = {
          pa_required: Boolean(p.pa_required),
          policy: p.policy as PolicyRef,
          red_flags: (p.red_flags as string[]) ?? [],
          screened_at: ev.at,
        };
        c.cpt_label = (p.policy as PolicyRef)?.label ?? c.cpt_label;
        c.red_flags = c.screening.red_flags;
        if (p.expedited) c.expedited = true;
        if (!p.pa_required) c.overall = "not_required";
        break;
      case "evidence.extracted":
        c.facts = (p.facts as Fact[]) ?? c.facts;
        break;
      case "evidence.scored":
      case "evidence.rescored":
        c.criteria = (p.criteria as Criterion[]) ?? c.criteria;
        if (p.facts) c.facts = p.facts as Fact[];
        c.overall = (p.overall as Overall) ?? c.overall;
        c.red_flags = (p.red_flags as string[]) ?? c.red_flags;
        if (p.expedited) c.expedited = true;
        c.gaps = gapsFromCriteria(c.criteria, c.gaps);
        break;
      case "criterion.overridden":
        c.criteria = (p.criteria as Criterion[]) ?? c.criteria;
        c.overall = (p.overall as Overall) ?? c.overall;
        c.gaps = gapsFromCriteria(c.criteria, c.gaps);
        break;
      case "gap.question_generated": {
        const g = c.gaps.find((x) => x.criterion_id === p.criterion_id);
        if (g) g.question = String(p.question);
        else c.gaps.push({ criterion_id: String(p.criterion_id), question: String(p.question), status: "open", answer: null, answered_via: null });
        break;
      }
      case "call.placed":
        c.call = {
          call_id: String(p.call_id),
          attempt: Number(p.attempt ?? 1),
          status: "queued",
          to_masked: String(p.to_masked ?? ""),
          placed_at: ev.at,
          ended_at: null,
          duration_seconds: null,
          end_reason: null,
          transcript: [],
          answers: [],
        };
        break;
      case "call.status":
        if (c.call && c.call.call_id === p.call_id) c.call.status = (p.status as Call["status"]) ?? c.call.status;
        break;
      case "call.ended":
        if (c.call && c.call.call_id === p.call_id) {
          c.call.status = (p.status as Call["status"]) ?? "ended";
          c.call.ended_at = ev.at;
          c.call.duration_seconds = (p.duration_seconds as number) ?? null;
          c.call.end_reason = (p.end_reason as string) ?? null;
          if (p.transcript) c.call.transcript = p.transcript as Call["transcript"];
        }
        break;
      case "call.failed":
        if (c.call) {
          c.call.status = (p.status as Call["status"]) ?? "failed";
          c.call.ended_at = ev.at;
          c.call.end_reason = String(p.reason ?? "failed");
        }
        break;
      case "call.parsed":
        if (c.call) {
          c.call.answers = (p.answers as Call["answers"]) ?? [];
          if (p.transcript) c.call.transcript = p.transcript as Call["transcript"];
          for (const a of c.call.answers) {
            const g = c.gaps.find((x) => x.criterion_id === a.criterion_id);
            if (g) {
              g.status = "answered";
              g.answer = a.answer;
              g.answered_via = "phone_call";
            }
          }
        }
        if (p.facts) c.facts = p.facts as Fact[];
        break;
      case "gap.unresolved":
        if (c.call) c.call.status = "unresolved";
        for (const id of (p.criterion_ids as string[]) ?? []) {
          const g = c.gaps.find((x) => x.criterion_id === id);
          if (g) g.status = "unresolved";
        }
        break;
      case "gap.manual_answered":
        for (const a of (p.answers as { criterion_id: string; answer: string }[]) ?? []) {
          const g = c.gaps.find((x) => x.criterion_id === a.criterion_id);
          if (g) {
            g.status = "answered";
            g.answer = a.answer;
            g.answered_via = "manual";
          }
        }
        if (p.facts) c.facts = p.facts as Fact[];
        break;
      case "packet.generated":
        c.packet = {
          letter_text: String(p.letter_text ?? ""),
          pdf_url: String(p.pdf_url ?? ""),
          fhir_bundle: (p.fhir_bundle as object) ?? {},
          generated_at: ev.at,
        } satisfies Packet;
        break;
      case "payer.attempt_failed": {
        const attempt: PayerAttempt = {
          n: Number(p.n),
          at: ev.at,
          outcome: p.outcome,
          ms: Number(p.ms ?? 0),
          status_code: p.status_code,
          error: p.error,
          backoff_ms: p.backoff_ms,
        };
        if (!c.payer) c.payer = emptyPayer(String(p.adapter ?? "mock"));
        c.payer.attempts.push(attempt);
        break;
      }
      case "payer.submitted":
        if (!c.payer) c.payer = emptyPayer(String(p.adapter ?? "mock"));
        c.payer.adapter = (p.adapter as Payer["adapter"]) ?? c.payer.adapter;
        c.payer.status = "submitted";
        c.payer.reference = (p.reference as string) ?? null;
        c.payer.submitted_at = ev.at;
        c.payer.sla = (p.sla as Payer["sla"]) ?? null;
        if (p.attempt) c.payer.attempts.push({ ...(p.attempt as PayerAttempt), at: ev.at });
        break;
      case "payer.responded":
        if (!c.payer) c.payer = emptyPayer(String(p.adapter ?? "mock"));
        c.payer.status = p.status as Payer["status"];
        c.payer.adjudication = (p.adjudication as Payer["adjudication"]) ?? null;
        c.payer.reference = (p.reference as string) ?? c.payer.reference;
        c.payer.reason = (p.reason as string) ?? null;
        c.payer.responded_at = ev.at;
        break;
      case "patient.notified":
        c.notification = {
          channel: p.channel as Notification["channel"],
          to_masked: String(p.to_masked ?? ""),
          sent_at: ev.at,
          message_id: (p.message_id as string) ?? null,
          body: String(p.body ?? ""),
          reply: null,
        };
        break;
      case "patient.replied":
        if (c.notification) c.notification.reply = { body: String(p.body ?? ""), at: ev.at };
        break;
      case "review.completed":
        c.review = { review_seconds: Number(p.review_seconds), completed_at: ev.at };
        c.review_seconds = c.review.review_seconds;
        break;
      default:
        break;
    }
    c.state = ev.state;
    c.updated_at = ev.at;
    c.timeline.push(ev);
  }
  return c;
}

function emptyPayer(adapter: string): Payer {
  return {
    adapter: adapter === "davinci" ? "davinci" : "mock",
    status: "submitted",
    adjudication: null,
    reference: null,
    reason: null,
    attempts: [],
    submitted_at: null,
    responded_at: null,
    sla: null,
  };
}
