// Mirrors ../NOTES.md "## API contract" (backend is the source of truth).
// Unknown string values are tolerated via `(string & {})` so the UI never crashes on new enum members.

export type State =
  | 'intake'
  | 'screened'
  | 'evidence_scored'
  | 'needs_info'
  | 'calling'
  | 'evidence_rescored'
  | 'packet_ready'
  | 'submitted'
  | 'pended'
  | 'approved'
  | 'denied'
  | 'closed'
  | (string & {})

export type Overall = 'ready' | 'needs_info' | 'expedite' | 'not_required' | (string & {})

export type CriterionStatus = 'met' | 'missing' | 'unclear' | 'not_applicable' | (string & {})

export interface Patient {
  name: string
  dob: string
  member_id: string
  phone: string
}

export interface Physician {
  name: string
  npi: string
  phone: string
}

export interface Policy {
  id: string
  url: string
  insurer: string
  cpt: string
  label: string
}

export interface Screening {
  pa_required: boolean
  policy: Policy
  red_flags: string[]
  screened_at: string
  expedited?: boolean
}

export type FactKind =
  | 'symptom'
  | 'duration'
  | 'therapy'
  | 'exam_finding'
  | 'lab_or_imaging'
  | 'bmi'
  | 'age'
  | 'comorbidity'
  | 'red_flag'
  | 'other'
  | (string & {})

export type EvidenceSource = 'note' | 'phone_call' | 'manual'

export interface Fact {
  id: string
  kind: FactKind
  label: string
  value: string | number | null
  quote: string
  char_start: number
  char_end: number
  source: EvidenceSource
  call_id?: string
}

export type CriterionKind =
  | 'conservative_therapy_duration'
  | 'objective_finding'
  | 'red_flag'
  | 'lab_or_imaging_done'
  | 'bmi_threshold'
  | 'age_threshold'
  | 'comorbidity'
  | 'plan_of_care'
  | 'symptom'
  | (string & {})

export type CriterionGroup = 'all_of' | 'any_of' | 'red_flag_any_of' | (string & {})

export interface Criterion {
  id: string
  text: string
  kind: CriterionKind
  group: CriterionGroup
  params: Record<string, unknown>
  status: CriterionStatus
  evidence_quote: string | null
  char_start: number | null
  char_end: number | null
  evidence_source: EvidenceSource | null
  reasoning: string
  confidence: number
  question_if_missing: string | null
  verifier: {
    quote_verified: boolean
    deterministic_check: null | { passed: boolean; detail: string }
  }
}

export interface Gap {
  criterion_id: string
  question: string
  status: 'open' | 'answered' | 'unresolved' | (string & {})
  answer: string | null
  answered_via: 'phone_call' | 'manual' | null
}

export type CallStatus =
  | 'queued'
  | 'in_progress'
  | 'ended'
  | 'no_answer'
  | 'failed'
  | 'unresolved'
  | (string & {})

export interface TranscriptTurn {
  speaker: 'agent' | 'physician' | (string & {})
  text: string
  start_ms: number
}

export interface Call {
  call_id: string
  attempt: number
  status: CallStatus
  to_masked: string
  placed_at: string
  ended_at: string | null
  duration_seconds: number | null
  end_reason: string | null
  transcript: TranscriptTurn[]
  answers: { criterion_id: string; answer: string; confidence: number }[]
}

export interface Packet {
  letter_text: string
  pdf_url: string
  fhir_bundle: unknown
  generated_at: string
}

export type AttemptOutcome = 'ok' | 'http_500' | 'timeout' | 'circuit_open' | 'error' | (string & {})

export interface SubmitAttempt {
  n: number
  at: string
  outcome: AttemptOutcome
  ms: number
  status_code?: number
  error?: string
  backoff_ms?: number
}

export type Adjudication = 'A1' | 'A2' | 'A3' | 'A4' | (string & {})

export interface Payer {
  adapter: 'mock' | 'davinci' | (string & {})
  status: 'submitted' | 'approved' | 'denied' | 'pended' | 'failed' | (string & {})
  adjudication: Adjudication | null
  reference: string | null
  reason: string | null
  attempts: SubmitAttempt[]
  submitted_at: string | null
  responded_at: string | null
  sla: { kind: 'expedited' | 'standard'; decision_due_at: string } | null
}

export interface Notification {
  channel: 'sms' | 'simulated' | (string & {})
  to_masked: string
  sent_at: string
  message_id: string | null
  body: string
  reply: null | { body: string; at: string }
}

export type EventType =
  | 'case.created'
  | 'screening.completed'
  | 'evidence.extracted'
  | 'evidence.scored'
  | 'evidence.quote_rejected'
  | 'gap.question_generated'
  | 'call.placed'
  | 'call.status'
  | 'call.ended'
  | 'call.failed'
  | 'call.retry_scheduled'
  | 'call.parsed'
  | 'gap.unresolved'
  | 'gap.manual_answered'
  | 'evidence.rescored'
  | 'packet.generated'
  | 'payer.attempt_failed'
  | 'payer.submitted'
  | 'payer.responded'
  | 'patient.notified'
  | 'patient.replied'
  | 'review.completed'
  | 'case.closed'
  | 'hello'
  | (string & {})

export type Actor = 'system' | 'staff' | 'llm' | 'dial' | 'payer' | (string & {})

export interface CaseEvent {
  seq: number
  case_id: string
  type: EventType
  payload: Record<string, unknown>
  at: string
  actor: Actor
  state: State
}

/** SSE envelope is identical to CaseEvent. */
export type StreamEvent = CaseEvent

export interface CaseSummary {
  id: string
  patient_name: string
  cpt: string
  cpt_label: string
  insurer: string
  state: State
  overall: Overall | null
  expedited: boolean
  created_at: string
  updated_at: string
}

export interface CaseDetail extends CaseSummary {
  note: string
  patient: Patient
  physician: Physician
  screening: Screening | null
  facts: Fact[]
  criteria: Criterion[]
  red_flags: string[]
  gaps: Gap[]
  call: Call | null
  packet: Packet | null
  payer: Payer | null
  notification: Notification | null
  review: null | { review_seconds: number; completed_at: string }
  timeline: CaseEvent[]
}

export interface Metrics {
  cases: number
  approved: number
  pended: number
  denied: number
  completed: number
  avg_review_seconds: number
  minutes_saved_total: number
  baseline_minutes: number
  baseline_source: string
}

export interface PolicyListItem {
  insurer: string
  cpt: string
  label: string
  policy_id: string
  url: string
  criteria_count: number
  pa_required: boolean
}

export interface DemoNote {
  id: string
  label: string
  cpt: string
  insurer: string
  text: string
  patient: Patient
  physician: Physician
  expect: 'meets' | 'gap' | 'red_flag' | (string & {})
}

export interface CreateCaseBody {
  note: string
  cpt: string
  insurer: string
  patient: Patient
  physician: Physician
}

export interface ScreenResult {
  pa_required: boolean
  policy: Policy
  red_flags: string[]
  expedited: boolean
}

export interface ScoreResult {
  criteria: Criterion[]
  overall: Overall
  red_flags: string[]
  facts: Fact[]
}

export interface ManualGapfillResult {
  criteria: Criterion[]
  overall: Overall
}

export interface CallStarted {
  call_id: string
  status: 'queued' | (string & {})
  attempt: number
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}

export const BASELINE_MINUTES = 24
export const BASELINE_SOURCE = 'CAQH Index 2024'
