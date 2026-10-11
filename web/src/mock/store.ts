import type {
  Call,
  CaseDetail,
  CaseEvent,
  CaseSummary,
  CreateCaseBody,
  Criterion,
  CriterionStatus,
  Fact,
  Gap,
  Metrics,
  Overall,
  Packet,
  Payer,
  State,
  TranscriptTurn,
} from '@/api/types'
import { DEMO_NOTES, findPolicy, type CriterionDef, type PolicyDef } from './policies'

// ---------- event bus (stands in for SSE in mock mode) ----------
type Listener = (e: CaseEvent) => void
const listeners = new Set<Listener>()
export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ---------- store ----------
const cases = new Map<string, CaseDetail>()
let seq = 0
let idCounter = 1000
const timers = new Set<ReturnType<typeof setTimeout>>()

export class MockHttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const nowIso = () => new Date().toISOString()
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      timers.delete(t)
      resolve()
    }, ms)
    timers.add(t)
  })

function mask(phone: string) {
  return phone.length > 7 ? phone.slice(0, 5) + '***' + phone.slice(-4) : phone
}

function emit(c: CaseDetail, type: string, payload: Record<string, unknown>, actor: CaseEvent['actor'] = 'system', at?: string) {
  const ev: CaseEvent = { seq: ++seq, case_id: c.id, type, payload, at: at ?? nowIso(), actor, state: c.state }
  c.timeline.push(ev)
  c.updated_at = ev.at
  for (const fn of listeners) fn(ev)
  return ev
}

function setState(c: CaseDetail, s: State) {
  c.state = s
}

function getPolicy(c: CaseDetail): PolicyDef {
  const p = findPolicy(c.cpt, c.insurer)
  if (!p) throw new MockHttpError(400, 'bad_request', `No policy on file for ${c.insurer} ${c.cpt}`)
  return p
}

function summary(c: CaseDetail): CaseSummary {
  return {
    id: c.id,
    patient_name: c.patient_name,
    cpt: c.cpt,
    cpt_label: c.cpt_label,
    insurer: c.insurer,
    state: c.state,
    overall: c.overall,
    expedited: c.expedited,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }
}

// ---------- operations ----------
export function listCases(): CaseSummary[] {
  return [...cases.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(summary)
}

export function getCase(id: string): CaseDetail {
  const c = cases.get(id)
  if (!c) throw new MockHttpError(404, 'not_found', `Case ${id} not found`)
  return c
}

export function createCase(body: CreateCaseBody, at?: string): CaseDetail {
  const policy = findPolicy(body.cpt, body.insurer)
  const id = `c_${(idCounter++).toString(36)}`
  const ts = at ?? nowIso()
  const c: CaseDetail = {
    id,
    patient_name: body.patient.name,
    cpt: body.cpt,
    cpt_label: policy?.label ?? `CPT ${body.cpt}`,
    insurer: body.insurer,
    state: 'intake',
    overall: null,
    expedited: false,
    created_at: ts,
    updated_at: ts,
    note: body.note,
    patient: { ...body.patient, phone: mask(body.patient.phone) },
    physician: { ...body.physician, phone: mask(body.physician.phone) },
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
  }
  cases.set(id, c)
  emit(c, 'case.created', { cpt: c.cpt, insurer: c.insurer, patient_name: c.patient_name }, 'staff', ts)
  return c
}

export function screen(id: string, at?: string) {
  const c = getCase(id)
  const p = getPolicy(c)
  const redFlagDefs = p.criteria.filter((d) => d.group === 'red_flag_any_of')
  const red_flags = redFlagDefs.flatMap((d) => d.quotes.filter((q) => c.note.includes(q)))
  const expedited = red_flags.length > 0
  const policy = { id: p.policy_id, url: p.url, insurer: p.insurer, cpt: p.cpt, label: p.label }
  c.screening = { pa_required: p.pa_required, policy, red_flags, screened_at: at ?? nowIso(), expedited }
  c.red_flags = red_flags
  c.expedited = expedited
  if (!p.pa_required) c.overall = 'not_required'
  setState(c, 'screened')
  emit(c, 'screening.completed', { pa_required: p.pa_required, policy, red_flags, expedited }, 'system', at)
  return { pa_required: p.pa_required, policy, red_flags, expedited }
}

function scoreCriterion(def: CriterionDef, note: string): Criterion {
  const quote = def.quotes.find((q) => note.includes(q))
  const unclear = quote ? undefined : def.unclearQuotes?.find((q) => note.includes(q))
  const isRedFlag = def.group === 'red_flag_any_of'
  let status: CriterionStatus
  let confidence: number
  let reasoning: string
  if (quote) {
    status = 'met'
    confidence = 0.93
    reasoning = isRedFlag
      ? `The note documents a red-flag finding ("${quote}"), which triggers expedited review under the policy.`
      : `The note explicitly documents this requirement ("${quote}"). Quote verified against the raw note text.`
  } else if (unclear) {
    status = 'unclear'
    confidence = 0.52
    reasoning = `The note mentions "${unclear}" but does not specify duration, dates, or objective detail sufficient to satisfy the policy wording.`
  } else if (isRedFlag) {
    status = 'not_applicable'
    confidence = 0.88
    reasoning = 'No red-flag findings documented; standard review pathway applies.'
  } else {
    status = 'missing'
    confidence = 0.9
    reasoning = 'No statement in the note addresses this requirement.'
  }
  const ev = quote ?? unclear ?? null
  const char_start = ev ? note.indexOf(ev) : null
  return {
    id: def.id,
    text: def.text,
    kind: def.kind,
    group: def.group,
    params: def.params,
    status,
    evidence_quote: ev,
    char_start,
    char_end: ev && char_start !== null ? char_start + ev.length : null,
    evidence_source: ev ? 'note' : null,
    reasoning,
    confidence,
    question_if_missing: status === 'met' || status === 'not_applicable' ? null : def.question,
    verifier: {
      quote_verified: !!ev,
      deterministic_check:
        def.kind === 'conservative_therapy_duration' && quote
          ? { passed: true, detail: `Documented duration meets min ${JSON.stringify(def.params)}` }
          : null,
    },
  }
}

function computeOverall(c: CaseDetail): Overall {
  if (c.screening && !c.screening.pa_required) return 'not_required'
  if (c.criteria.some((k) => k.group === 'red_flag_any_of' && k.status === 'met')) return 'expedite'
  const open = c.criteria.filter(
    (k) => k.group !== 'red_flag_any_of' && (k.status === 'missing' || k.status === 'unclear'),
  )
  // any_of groups are satisfied if at least one member is met
  const anyOfMet = c.criteria.some((k) => k.group === 'any_of' && k.status === 'met')
  const blocking = open.filter((k) => !(k.group === 'any_of' && anyOfMet))
  return blocking.length ? 'needs_info' : 'ready'
}

function factsFromCriteria(c: CaseDetail, defs: CriterionDef[]): Fact[] {
  return c.criteria
    .filter((k) => k.status === 'met' && k.evidence_quote && k.evidence_source === 'note')
    .map((k, i) => {
      const def = defs.find((d) => d.id === k.id)!
      const kindMap: Record<string, Fact['kind']> = {
        conservative_therapy_duration: 'therapy',
        objective_finding: 'exam_finding',
        red_flag: 'red_flag',
        lab_or_imaging_done: 'lab_or_imaging',
        bmi_threshold: 'bmi',
        age_threshold: 'age',
        comorbidity: 'comorbidity',
        plan_of_care: 'other',
        symptom: 'symptom',
      }
      const num = k.evidence_quote!.match(/\d+(\.\d+)?/)
      return {
        id: `f${i + 1}`,
        kind: kindMap[def.kind as string] ?? 'other',
        label: def.factLabel,
        value: num ? Number(num[0]) : null,
        quote: k.evidence_quote!,
        char_start: k.char_start!,
        char_end: k.char_end!,
        source: 'note',
      }
    })
}

export function score(id: string, at?: string) {
  const c = getCase(id)
  if (c.state === 'intake') throw new MockHttpError(409, 'illegal_transition', 'Run screening before scoring')
  const p = getPolicy(c)
  c.criteria = p.criteria.map((d) => scoreCriterion(d, c.note))
  c.facts = factsFromCriteria(c, p.criteria)
  c.overall = computeOverall(c)
  c.red_flags = c.criteria.filter((k) => k.group === 'red_flag_any_of' && k.status === 'met').map((k) => k.evidence_quote!)
  c.expedited = c.red_flags.length > 0
  c.gaps = c.criteria
    .filter((k) => k.question_if_missing)
    .map((k) => ({ criterion_id: k.id, question: k.question_if_missing!, status: 'open', answer: null, answered_via: null }))
  emit(c, 'evidence.extracted', { facts_count: c.facts.length }, 'llm', at)
  setState(c, c.overall === 'needs_info' ? 'needs_info' : 'evidence_scored')
  const counts = {
    met: c.criteria.filter((k) => k.status === 'met').length,
    missing: c.criteria.filter((k) => k.status === 'missing').length,
    unclear: c.criteria.filter((k) => k.status === 'unclear').length,
  }
  emit(c, 'evidence.scored', { overall: c.overall, ...counts, red_flags: c.red_flags }, 'llm', at)
  for (const g of c.gaps) emit(c, 'gap.question_generated', { criterion_id: g.criterion_id, question: g.question }, 'llm', at)
  return { criteria: c.criteria, overall: c.overall, red_flags: c.red_flags, facts: c.facts }
}

function applyAnswers(
  c: CaseDetail,
  answers: { criterion_id: string; answer: string }[],
  via: 'phone_call' | 'manual',
  at?: string,
) {
  for (const a of answers) {
    const k = c.criteria.find((x) => x.id === a.criterion_id)
    if (!k) continue
    k.status = 'met'
    k.evidence_quote = a.answer
    k.char_start = null
    k.char_end = null
    k.evidence_source = via
    k.confidence = via === 'phone_call' ? 0.86 : 0.95
    k.reasoning =
      via === 'phone_call'
        ? `Physician confirmed by phone: "${a.answer}". Transcript quote verified.`
        : `Staff entered manually: "${a.answer}".`
    k.question_if_missing = null
    k.verifier = { quote_verified: true, deterministic_check: null }
    const g = c.gaps.find((x) => x.criterion_id === a.criterion_id)
    if (g) {
      g.status = 'answered'
      g.answer = a.answer
      g.answered_via = via
    }
  }
  c.overall = computeOverall(c)
  setState(c, 'evidence_rescored')
  emit(
    c,
    'evidence.rescored',
    {
      overall: c.overall,
      met: c.criteria.filter((k) => k.status === 'met').length,
      missing: c.criteria.filter((k) => k.status === 'missing').length,
      unclear: c.criteria.filter((k) => k.status === 'unclear').length,
    },
    'llm',
    at,
  )
}

/** Answers the physician would give for each open gap in the mock. */
function scriptedAnswer(c: CaseDetail, criterionId: string): string {
  const p = getPolicy(c)
  const def = p.criteria.find((d) => d.id === criterionId)
  switch (def?.kind) {
    case 'conservative_therapy_duration':
      return 'He completed 14 weeks of formal physical therapy at Bay Area Ortho PT, plus two corticosteroid injections, the last one in July.'
    case 'plan_of_care':
      return 'Yes, the psychological evaluation was completed on September 14th by Dr. Hughes, and she was cleared for surgery.'
    case 'symptom':
      return 'We administered the Epworth today; she scored 15, and her husband reports witnessed apneas most nights.'
    case 'objective_finding':
      return 'On exam there was a positive straight-leg raise on the left at about 40 degrees and a diminished Achilles reflex.'
    default:
      return 'Yes, that is documented in my chart and I can attest to it.'
  }
}

export function startCall(id: string) {
  const c = getCase(id)
  if (!c.criteria.length) throw new MockHttpError(409, 'illegal_transition', 'Score evidence before placing a call')
  const openGaps = c.gaps.filter((g) => g.status === 'open')
  if (!openGaps.length) throw new MockHttpError(409, 'illegal_transition', 'No open gaps to fill')
  const attempt = (c.call?.attempt ?? 0) + 1
  const call: Call = {
    call_id: `call_${Math.random().toString(36).slice(2, 10)}`,
    attempt,
    status: 'queued',
    to_masked: c.physician.phone,
    placed_at: nowIso(),
    ended_at: null,
    duration_seconds: null,
    end_reason: null,
    transcript: [],
    answers: [],
  }
  c.call = call
  setState(c, 'calling')
  emit(c, 'call.placed', { call_id: call.call_id, attempt, to_masked: call.to_masked, idempotency_key: `${c.id}:${attempt}` }, 'dial')
  void runCallScript(c, call, openGaps)
  return { call_id: call.call_id, status: 'queued' as const, attempt }
}

async function runCallScript(c: CaseDetail, call: Call, gaps: Gap[]) {
  const t0 = Date.now()
  const say = (speaker: TranscriptTurn['speaker'], text: string) => {
    call.transcript.push({ speaker, text, start_ms: Date.now() - t0 })
    emit(c, 'call.status', { call_id: call.call_id, status: call.status }, 'dial')
  }
  await sleep(1800)
  call.status = 'in_progress'
  emit(c, 'call.status', { call_id: call.call_id, status: 'in_progress' }, 'dial')
  await sleep(1200)
  say(
    'agent',
    `Hi, this is the PriorAuth Pilot assistant calling from your office on behalf of ${c.patient_name}'s ${c.cpt_label.toLowerCase()} authorization. Do you have a moment for ${gaps.length === 1 ? 'one quick question' : `${gaps.length} quick questions`}?`,
  )
  await sleep(2200)
  say('physician', 'Sure, go ahead.')
  const answers: Call['answers'] = []
  for (const g of gaps) {
    await sleep(1800)
    say('agent', g.question)
    await sleep(2600)
    const answer = scriptedAnswer(c, g.criterion_id)
    say('physician', answer)
    answers.push({ criterion_id: g.criterion_id, answer, confidence: 0.86 })
  }
  await sleep(1500)
  say('agent', 'Thank you, that is everything I needed. I will add this to the authorization packet. Have a good day.')
  await sleep(1200)
  call.status = 'ended'
  call.ended_at = nowIso()
  call.duration_seconds = Math.round((Date.now() - t0) / 1000)
  call.end_reason = 'completed'
  emit(c, 'call.ended', { call_id: call.call_id, status: 'ended', duration_seconds: call.duration_seconds, end_reason: 'completed' }, 'dial')
  await sleep(1400)
  call.answers = answers
  emit(c, 'call.parsed', { call_id: call.call_id, answers_count: answers.length }, 'llm')
  await sleep(800)
  applyAnswers(c, answers, 'phone_call')
}

export function manualAnswers(id: string, answers: { criterion_id: string; answer: string }[]) {
  const c = getCase(id)
  if (!c.criteria.length) throw new MockHttpError(409, 'illegal_transition', 'Score evidence first')
  emit(c, 'gap.manual_answered', { criterion_ids: answers.map((a) => a.criterion_id) }, 'staff')
  applyAnswers(c, answers, 'manual')
  return { criteria: c.criteria, overall: c.overall as Overall }
}

function buildLetter(c: CaseDetail): string {
  const p = c.screening?.policy
  const met = c.criteria.filter((k) => k.status === 'met' && k.group !== 'red_flag_any_of')
  const lines = [
    `${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    '',
    `${c.insurer} Utilization Management`,
    `RE: Prior authorization request — ${c.cpt_label} (CPT ${c.cpt})`,
    `Patient: ${c.patient_name}   DOB: ${c.patient.dob}   Member ID: ${c.patient.member_id}`,
    `Ordering physician: ${c.physician.name}   NPI: ${c.physician.npi}`,
    `Policy: ${p?.id ?? ''} (${p?.url ?? ''})`,
    '',
    'To whom it may concern,',
    '',
    `I am writing to request prior authorization for ${c.cpt_label.toLowerCase()} for the above patient. The clinical documentation satisfies each requirement of ${c.insurer} policy ${p?.id ?? ''} as follows:`,
    '',
    ...met.map((k, i) => `${i + 1}. ${k.text}\n   Documentation: "${k.evidence_quote}"${k.evidence_source === 'phone_call' ? ' (physician attestation by phone)' : k.evidence_source === 'manual' ? ' (staff-entered)' : ''}`),
    '',
    c.expedited
      ? `This request is EXPEDITED: ${c.red_flags.join('; ')}. Under CMS-0057-F a decision is requested within 72 hours.`
      : 'A standard-timeframe decision (7 calendar days under CMS-0057-F) is requested.',
    '',
    'Please contact our office with any questions.',
    '',
    'Sincerely,',
    c.physician.name,
    `NPI ${c.physician.npi}`,
  ]
  return lines.join('\n')
}

function buildBundle(c: CaseDetail) {
  const p = c.screening?.policy
  return {
    resourceType: 'Bundle',
    type: 'collection',
    id: `pas-${c.id}`,
    timestamp: nowIso(),
    entry: [
      {
        fullUrl: `urn:uuid:claim-${c.id}`,
        resource: {
          resourceType: 'Claim',
          id: `claim-${c.id}`,
          status: 'active',
          use: 'preauthorization',
          priority: { coding: [{ code: c.expedited ? 'stat' : 'normal' }] },
          patient: { reference: `Patient/${c.patient.member_id}` },
          provider: { reference: `Practitioner/${c.physician.npi}` },
          insurer: { display: c.insurer },
          item: [
            {
              sequence: 1,
              productOrService: { coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: c.cpt, display: c.cpt_label }] },
              extension: [{ url: 'http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-certificationType', valueCodeableConcept: { coding: [{ code: 'I', display: 'Initial' }] } }],
            },
          ],
          supportingInfo: c.criteria
            .filter((k) => k.status === 'met')
            .map((k, i) => ({ sequence: i + 1, category: { text: k.text }, valueString: k.evidence_quote })),
        },
      },
      {
        fullUrl: `urn:uuid:patient-${c.id}`,
        resource: {
          resourceType: 'Patient',
          id: c.patient.member_id,
          name: [{ text: c.patient_name }],
          birthDate: c.patient.dob,
          identifier: [{ system: `urn:${c.insurer.toLowerCase()}:member`, value: c.patient.member_id }],
        },
      },
      {
        fullUrl: `urn:uuid:practitioner-${c.id}`,
        resource: {
          resourceType: 'Practitioner',
          id: c.physician.npi,
          identifier: [{ system: 'http://hl7.org/fhir/sid/us-npi', value: c.physician.npi }],
          name: [{ text: c.physician.name }],
        },
      },
      {
        fullUrl: `urn:uuid:coverage-${c.id}`,
        resource: { resourceType: 'Coverage', id: `cov-${c.id}`, status: 'active', payor: [{ display: c.insurer }], subscriberId: c.patient.member_id },
      },
      {
        fullUrl: `urn:uuid:docref-${c.id}`,
        resource: {
          resourceType: 'DocumentReference',
          status: 'current',
          description: `Letter of medical necessity, policy ${p?.id ?? ''}`,
          content: [{ attachment: { contentType: 'application/pdf', url: `http://localhost:4000/packets/${c.id}.pdf` } }],
        },
      },
    ],
  }
}

export function generatePacket(id: string, at?: string): Packet {
  const c = getCase(id)
  if (!c.criteria.length) throw new MockHttpError(409, 'illegal_transition', 'Score evidence before generating a packet')
  const packet: Packet = {
    letter_text: buildLetter(c),
    pdf_url: `http://localhost:4000/packets/${c.id}.pdf`,
    fhir_bundle: buildBundle(c),
    generated_at: at ?? nowIso(),
  }
  c.packet = packet
  setState(c, 'packet_ready')
  emit(c, 'packet.generated', { pdf_url: packet.pdf_url, letter_chars: packet.letter_text.length, bundle_entries: 5 }, 'system', at)
  return packet
}

function adjudicate(c: CaseDetail): Pick<Payer, 'status' | 'adjudication' | 'reason'> {
  if (c.overall === 'ready' || c.overall === 'expedite') return { status: 'approved', adjudication: 'A1', reason: null }
  if (c.criteria.some((k) => k.status === 'unclear'))
    return { status: 'pended', adjudication: 'A4', reason: 'Additional documentation requested: duration of conservative therapy not quantified.' }
  return { status: 'denied', adjudication: 'A3', reason: 'Medical necessity criteria not met: conservative therapy requirement not documented.' }
}

export async function submit(id: string, opts?: { immediate?: boolean; at?: string }): Promise<Payer> {
  const c = getCase(id)
  if (!c.packet) throw new MockHttpError(409, 'illegal_transition', 'Generate the packet before submitting')
  const wait = (ms: number) => (opts?.immediate ? Promise.resolve() : sleep(ms))
  const t = opts?.at
  const payer: Payer = {
    adapter: 'davinci',
    status: 'submitted',
    adjudication: null,
    reference: null,
    reason: null,
    attempts: [],
    submitted_at: null,
    responded_at: null,
    sla: null,
  }
  c.payer = payer
  await wait(900)
  payer.attempts.push({ n: 1, at: t ?? nowIso(), outcome: 'http_500', ms: 842, status_code: 500, error: 'Upstream PAS server returned 500 Internal Server Error', backoff_ms: 1200 })
  emit(c, 'payer.attempt_failed', { n: 1, outcome: 'http_500', status_code: 500, error: 'Upstream PAS server returned 500', backoff_ms: 1200 }, 'payer', t)
  await wait(1200)
  await wait(700)
  payer.attempts.push({ n: 2, at: t ?? nowIso(), outcome: 'ok', ms: 613, status_code: 200 })
  payer.reference = `PA-${c.insurer.slice(0, 3).toUpperCase()}-${(Date.now() % 1_000_000).toString().padStart(6, '0')}`
  payer.submitted_at = t ?? nowIso()
  const due = new Date(Date.parse(payer.submitted_at) + (c.expedited ? 72 : 7 * 24) * 3600_000).toISOString()
  payer.sla = { kind: c.expedited ? 'expedited' : 'standard', decision_due_at: due }
  setState(c, 'submitted')
  emit(c, 'payer.submitted', { adapter: payer.adapter, reference: payer.reference, n_attempts: 2 }, 'payer', t)
  await wait(2600)
  const adj = adjudicate(c)
  Object.assign(payer, adj)
  payer.responded_at = t ?? nowIso()
  setState(c, adj.status as State)
  emit(c, 'payer.responded', { status: payer.status, adjudication: payer.adjudication, reference: payer.reference, reason: payer.reason }, 'payer', t)
  await wait(1200)
  const body =
    adj.status === 'approved'
      ? `Good news from ${c.physician.name.replace(/^Dr\.\s*/, 'Dr. ')}'s office: ${c.insurer} approved your ${c.cpt_label.toLowerCase()} (ref ${payer.reference}). We will call to schedule.`
      : adj.status === 'pended'
        ? `Update from your clinic: ${c.insurer} is reviewing your ${c.cpt_label.toLowerCase()} and asked for more information. We are handling it.`
        : `Update from your clinic: ${c.insurer} did not approve your ${c.cpt_label.toLowerCase()} yet. We are preparing an appeal and will call you.`
  c.notification = { channel: 'simulated', to_masked: c.patient.phone, sent_at: t ?? nowIso(), message_id: `sms_${Math.random().toString(36).slice(2, 8)}`, body, reply: null }
  emit(c, 'patient.notified', { channel: 'simulated', to_masked: c.patient.phone }, 'system', t)
  if (adj.status === 'approved') {
    await wait(2500)
    c.notification.reply = { body: 'Thank you!! 🙏', at: t ?? nowIso() }
    emit(c, 'patient.replied', { body: c.notification.reply.body }, 'system', t)
  }
  return payer
}

export function reviewComplete(id: string, opts?: { seconds?: number; at?: string }) {
  const c = getCase(id)
  const seconds = opts?.seconds ?? Math.max(60, Math.min(900, Math.round((Date.now() - Date.parse(c.created_at)) / 1000)))
  c.review = { review_seconds: seconds, completed_at: opts?.at ?? nowIso() }
  emit(c, 'review.completed', { review_seconds: seconds }, 'staff', opts?.at)
  if (c.state === 'approved' || c.state === 'denied' || c.state === 'pended') {
    setState(c, 'closed')
    emit(c, 'case.closed', {}, 'system', opts?.at)
  }
  return { review_seconds: seconds }
}

export function metrics(): Metrics {
  const all = [...cases.values()]
  const reviewed = all.filter((c) => c.review)
  const avg = reviewed.length ? Math.round(reviewed.reduce((s, c) => s + c.review!.review_seconds, 0) / reviewed.length) : 0
  const saved = reviewed.reduce((s, c) => s + Math.max(0, 24 * 60 - c.review!.review_seconds), 0) / 60
  return {
    cases: all.length,
    approved: all.filter((c) => c.payer?.status === 'approved').length,
    pended: all.filter((c) => c.payer?.status === 'pended').length,
    denied: all.filter((c) => c.payer?.status === 'denied').length,
    completed: reviewed.length,
    avg_review_seconds: avg,
    minutes_saved_total: Math.round(saved * 10) / 10,
    baseline_minutes: 24,
    baseline_source: 'CAQH Index 2024 (24 min per manual PA)',
  }
}

// ---------- seed ----------
function ago(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

async function seed() {
  if (cases.size) return
  const n = (i: number) => DEMO_NOTES[i]
  const mk = (i: number, at: string) =>
    createCase({ note: n(i).text, cpt: n(i).cpt, insurer: n(i).insurer, patient: n(i).patient, physician: n(i).physician }, at)

  // 1. approved + closed (yesterday)
  let c = mk(4, ago(26 * 60))
  screen(c.id, ago(26 * 60 - 1))
  score(c.id, ago(26 * 60 - 2))
  generatePacket(c.id, ago(26 * 60 - 4))
  await submit(c.id, { immediate: true, at: ago(26 * 60 - 5) })
  reviewComplete(c.id, { seconds: 251, at: ago(26 * 60 - 6) })

  // 2. gap -> phone call -> approved -> closed (this morning)
  c = mk(2, ago(190))
  screen(c.id, ago(189))
  score(c.id, ago(188))
  c.call = {
    call_id: 'call_seed2',
    attempt: 1,
    status: 'ended',
    to_masked: c.physician.phone,
    placed_at: ago(187),
    ended_at: ago(185),
    duration_seconds: 94,
    end_reason: 'completed',
    transcript: [
      { speaker: 'agent', text: 'Hi, this is the PriorAuth Pilot assistant calling about Harold Kim’s knee replacement authorization. Do you have a moment for one quick question?', start_ms: 0 },
      { speaker: 'physician', text: 'Sure.', start_ms: 6200 },
      { speaker: 'agent', text: 'How many weeks of non-operative treatment has the patient completed, including physical therapy, NSAIDs, or injections?', start_ms: 7900 },
      { speaker: 'physician', text: 'He completed 14 weeks of formal physical therapy at Bay Area Ortho PT, plus two corticosteroid injections, the last one in July.', start_ms: 14100 },
      { speaker: 'agent', text: 'Thank you, that is everything I needed.', start_ms: 24000 },
    ],
    answers: [{ criterion_id: 'cigna-27447-c2', answer: 'He completed 14 weeks of formal physical therapy at Bay Area Ortho PT, plus two corticosteroid injections, the last one in July.', confidence: 0.86 }],
  }
  emit(c, 'call.placed', { call_id: 'call_seed2', attempt: 1, to_masked: c.physician.phone }, 'dial', ago(187))
  emit(c, 'call.ended', { call_id: 'call_seed2', status: 'ended', duration_seconds: 94, end_reason: 'completed' }, 'dial', ago(185))
  emit(c, 'call.parsed', { call_id: 'call_seed2', answers_count: 1 }, 'llm', ago(185))
  applyAnswers(c, c.call.answers, 'phone_call', ago(184))
  generatePacket(c.id, ago(183))
  await submit(c.id, { immediate: true, at: ago(182) })
  reviewComplete(c.id, { seconds: 278, at: ago(180) })

  // 3. pended (unclear sleepiness) - submitted 70 min ago, review complete
  c = mk(5, ago(75))
  screen(c.id, ago(74))
  score(c.id, ago(73))
  generatePacket(c.id, ago(72))
  await submit(c.id, { immediate: true, at: ago(70) })
  reviewComplete(c.id, { seconds: 322, at: ago(69) })

  // 4. expedited brain MRI, packet ready, not yet submitted
  c = mk(1, ago(22))
  screen(c.id, ago(21))
  score(c.id, ago(20))
  generatePacket(c.id, ago(18))

  // 5. needs_info sleeve gastrectomy (fresh)
  c = mk(3, ago(6))
  screen(c.id, ago(5))
  score(c.id, ago(4))
}

export const ready: Promise<void> = seed()
