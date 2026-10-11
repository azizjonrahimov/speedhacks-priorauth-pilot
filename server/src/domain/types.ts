// Shared domain types. Mirrors ../NOTES.md "## API contract" exactly.

export const STATES = [
  "intake",
  "screened",
  "evidence_scored",
  "needs_info",
  "calling",
  "evidence_rescored",
  "packet_ready",
  "submitted",
  "pended",
  "approved",
  "denied",
  "closed",
] as const;
export type State = (typeof STATES)[number];

export const EVENT_TYPES = [
  "case.created",
  "screening.completed",
  "evidence.extracted",
  "evidence.scored",
  "evidence.quote_rejected",
  "gap.question_generated",
  "call.placed",
  "call.status",
  "call.ended",
  "call.failed",
  "call.retry_scheduled",
  "call.parsed",
  "gap.unresolved",
  "gap.manual_answered",
  "evidence.rescored",
  "packet.generated",
  "payer.attempt_failed",
  "payer.submitted",
  "payer.responded",
  "patient.notified",
  "patient.replied",
  "review.completed",
  "case.closed",
  "criterion.overridden",
  "lessons.applied",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type Actor = "system" | "staff" | "llm" | "dial" | "payer" | "reviewer";

export type Overall = "ready" | "needs_info" | "expedite" | "not_required";
export type CriterionStatus = "met" | "missing" | "unclear" | "not_applicable";
export type CriterionKind =
  | "conservative_therapy_duration"
  | "objective_finding"
  | "red_flag"
  | "lab_or_imaging_done"
  | "bmi_threshold"
  | "age_threshold"
  | "comorbidity"
  | "plan_of_care"
  | "symptom";
export type CriterionGroup = "all_of" | "any_of" | "red_flag_any_of";
export type FactKind =
  | "symptom"
  | "duration"
  | "therapy"
  | "exam_finding"
  | "lab_or_imaging"
  | "bmi"
  | "age"
  | "comorbidity"
  | "red_flag"
  | "other";
export type FactSource = "note" | "phone_call" | "manual";

export interface Person {
  name: string;
  phone: string;
}
export interface Patient extends Person {
  dob: string;
  member_id: string;
}
export interface Physician extends Person {
  npi: string;
}

export interface PolicyRef {
  id: string;
  url: string;
  insurer: string;
  cpt: string;
  label: string;
}

export interface Fact {
  id: string;
  kind: FactKind;
  label: string;
  value: string | number | null;
  quote: string;
  char_start: number;
  char_end: number;
  source: FactSource;
  call_id?: string;
}

export interface Criterion {
  id: string;
  text: string;
  kind: CriterionKind;
  group: CriterionGroup;
  params: Record<string, unknown>;
  status: CriterionStatus;
  evidence_quote: string | null;
  char_start: number | null;
  char_end: number | null;
  evidence_source: FactSource | null;
  reasoning: string;
  confidence: number;
  question_if_missing: string | null;
  verifier: {
    quote_verified: boolean;
    deterministic_check: null | { passed: boolean; detail: string };
  };
}

export interface Gap {
  criterion_id: string;
  question: string;
  status: "open" | "answered" | "unresolved";
  answer: string | null;
  answered_via: "phone_call" | "manual" | null;
}

export type CallStatus = "queued" | "in_progress" | "ended" | "no_answer" | "failed" | "unresolved";
export interface TranscriptTurn {
  speaker: "agent" | "physician";
  text: string;
  start_ms: number;
}
export interface Call {
  call_id: string;
  attempt: number;
  status: CallStatus;
  to_masked: string;
  placed_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  end_reason: string | null;
  transcript: TranscriptTurn[];
  answers: { criterion_id: string; answer: string; confidence: number }[];
}

export interface Packet {
  letter_text: string;
  pdf_url: string;
  fhir_bundle: object;
  generated_at: string;
}

export type Adjudication = "A1" | "A2" | "A3" | "A4";
export type PayerStatus = "submitted" | "approved" | "denied" | "pended" | "failed";
export type AttemptOutcome = "ok" | "http_500" | "timeout" | "circuit_open" | "error";
export interface PayerAttempt {
  n: number;
  at: string;
  outcome: AttemptOutcome;
  ms: number;
  status_code?: number;
  error?: string;
  backoff_ms?: number;
}
export interface Payer {
  adapter: "mock" | "davinci";
  status: PayerStatus;
  adjudication: Adjudication | null;
  reference: string | null;
  reason: string | null;
  attempts: PayerAttempt[];
  submitted_at: string | null;
  responded_at: string | null;
  sla: { kind: "expedited" | "standard"; decision_due_at: string } | null;
}

export interface Notification {
  channel: "sms" | "simulated";
  to_masked: string;
  sent_at: string;
  message_id: string | null;
  body: string;
  reply: null | { body: string; at: string };
}

export interface LedgerEvent {
  seq: number;
  case_id: string;
  type: EventType;
  payload: Record<string, unknown>;
  at: string;
  actor: Actor;
  state: State;
}

export interface CaseSummary {
  id: string;
  patient_name: string;
  cpt: string;
  cpt_label: string;
  insurer: string;
  state: State;
  overall: Overall | null;
  expedited: boolean;
  review_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface CaseDetail extends CaseSummary {
  note: string;
  patient: Patient;
  physician: Physician;
  screening: null | { pa_required: boolean; policy: PolicyRef; red_flags: string[]; screened_at: string };
  facts: Fact[];
  criteria: Criterion[];
  red_flags: string[];
  gaps: Gap[];
  call: Call | null;
  packet: Packet | null;
  payer: Payer | null;
  notification: Notification | null;
  review: null | { review_seconds: number; completed_at: string };
  timeline: LedgerEvent[];
}

export interface CreateCaseInput {
  note: string;
  cpt: string;
  insurer: string;
  patient: Patient;
  physician: Physician;
}

export class AppError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
