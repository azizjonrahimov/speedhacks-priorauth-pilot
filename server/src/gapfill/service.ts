// Gap-fill orchestration: one call per attempt, max 2 attempts, 60 s between.
//   call.placed → (call.status …) → call.ended → call.parsed → evidence.rescored
//   busy/no-answer/failed → call.failed → call.retry_scheduled → (attempt 2) → gap.unresolved
import type { AppContext } from "../app.js";
import { config } from "../config.js";
import { AppError, type CaseDetail, type Fact } from "../domain/types.js";
import { rescoreWithFacts } from "../evidence/pipeline.js";
import { recordScoring } from "../routes/evidence.js";
import { maskPhone } from "../util/redact.js";
import { manualAnswersToFacts, parseTranscriptAnswers } from "./parse.js";
import { buildCallScript } from "./script.js";

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

export const retryDelayMs = () => Number(process.env.GAPFILL_RETRY_MS ?? 60_000);
export const MAX_ATTEMPTS = 2;

function nextFactIndex(c: CaseDetail) {
  return c.facts.reduce((m, f) => Math.max(m, Number(f.id.replace(/^f/, "")) || 0), 0) + 1;
}

/** Place the gap-fill call and return immediately; completion is handled in the background. */
export async function startGapFillCall(ctx: AppContext, caseId: string, attempt: number, log: Log): Promise<{ call_id: string; attempt: number }> {
  const { ledger, dial } = ctx;
  const c = ledger.requireCase(caseId);
  if (!dial.available) throw new AppError(503, "dial_unavailable", "DIAL_API_KEY / DIAL_FROM_NUMBER_ID missing in server/.env; use POST /cases/:id/gapfill/manual");
  const gaps = c.gaps.filter((g) => g.status === "open" || g.status === "unresolved");
  if (gaps.length === 0) throw new AppError(409, "no_gaps", "no open gaps to fill");
  const to = config.physicianPhone || c.physician.phone;
  if (!to) throw new AppError(400, "bad_request", "no physician phone (set PHYSICIAN_PHONE in .env)");

  const script = buildCallScript(c, gaps);
  const idempotencyKey = `${c.id}:gapfill:${attempt}`;
  const call = await dial.placeCall({ to, instruction: script.instruction, idempotencyKey, maxSeconds: 240 });
  ledger.appendEvent(c.id, "call.placed", { call_id: call.id, attempt, to_masked: maskPhone(to), idempotency_key: idempotencyKey, questions: script.questions }, "dial");
  log.info({ case_id: c.id, call_id: call.id, attempt, to: maskPhone(to) }, "gap-fill call placed");

  void completeGapFillCall(ctx, c.id, call.id, attempt, script.questions, log).catch((e) => log.error({ case_id: c.id, error: String((e as Error).message).slice(0, 300) }, "gap-fill background failure"));
  return { call_id: call.id, attempt };
}

async function completeGapFillCall(ctx: AppContext, caseId: string, callId: string, attempt: number, questions: { criterion_id: string; question: string }[], log: Log) {
  const { ledger, dial } = ctx;
  let lastState = "";
  const ended = await dial
    .waitForCallEnd(callId, {
      onStatus: (state) => {
        if (state === lastState) return;
        lastState = state;
        const mapped = state === "In-Progress" ? "in_progress" : state === "Ringing" || state === "Queued" ? "queued" : null;
        if (mapped && ledger.currentState(caseId) === "calling") ledger.appendEvent(caseId, "call.status", { call_id: callId, status: mapped, dial_state: state }, "dial");
      },
    })
    .catch((e) => {
      log.warn({ case_id: caseId, call_id: callId, error: String((e as Error).message).slice(0, 200) }, "waitForCallEnd failed");
      return null;
    });

  const failed = !ended || ended.termination !== "completed" || ended.transcriptTurns.length === 0;
  if (!failed) {
    ledger.appendEvent(caseId, "call.ended", { call_id: callId, status: "ended", duration_seconds: ended.durationSeconds, end_reason: ended.termination, transcript: ended.transcriptTurns }, "dial");
    try {
      const c = ledger.requireCase(caseId);
      const parsed = await parseTranscriptAnswers(ended.transcriptTurns, questions, callId, nextFactIndex(c), log);
      const facts: Fact[] = [...c.facts, ...parsed.facts];
      ledger.appendEvent(caseId, "call.parsed", { call_id: callId, answers_count: parsed.answers.length, answers: parsed.answers, facts, transcript: ended.transcriptTurns }, "llm");
      if (parsed.answers.length === 0 && attempt < MAX_ATTEMPTS) {
        // physician reached but nothing usable (e.g. voicemail): treat like no-answer
        return scheduleRetryOrGiveUp(ctx, caseId, callId, attempt, "no_usable_answers", log);
      }
      const r = await rescoreWithFacts({ ...c, facts }, facts, null, log);
      recordScoring(ctx, ledger.requireCase(caseId), r, "evidence.rescored");
      log.info({ case_id: caseId, overall: r.overall, answers: parsed.answers.length }, "rescored after call");
    } catch (e) {
      log.error({ case_id: caseId, error: String((e as Error).message).slice(0, 300) }, "transcript parse / rescore failed");
      if (ledger.currentState(caseId) === "calling") ledger.appendEvent(caseId, "gap.unresolved", { criterion_ids: questions.map((q) => q.criterion_id), reason: "parse_failed" }, "system");
    }
    return;
  }

  const reason = !ended ? "timeout" : ended.termination === "completed" ? "no_transcript" : ended.termination;
  const status = reason === "no-answer" ? "no_answer" : reason === "busy" ? "no_answer" : "failed";
  ledger.appendEvent(caseId, "call.failed", { call_id: callId, attempt, reason, status, failure_reason: ended?.failureReason ?? null, duration_seconds: ended?.durationSeconds ?? null }, "dial");
  await scheduleRetryOrGiveUp(ctx, caseId, callId, attempt, reason, log);
}

async function scheduleRetryOrGiveUp(ctx: AppContext, caseId: string, callId: string, attempt: number, reason: string, log: Log) {
  const { ledger } = ctx;
  if (attempt < MAX_ATTEMPTS) {
    ledger.appendEvent(caseId, "call.retry_scheduled", { attempt: attempt + 1, in_seconds: Math.round(retryDelayMs() / 1000), after: reason }, "system");
    setTimeout(() => {
      if (ledger.currentState(caseId) !== "calling") return;
      startGapFillCall(ctx, caseId, attempt + 1, log).catch((e) => {
        log.error({ case_id: caseId, error: String((e as Error).message).slice(0, 300) }, "retry call failed to place");
        const c = ledger.requireCase(caseId);
        if (ledger.currentState(caseId) === "calling") ledger.appendEvent(caseId, "gap.unresolved", { criterion_ids: c.gaps.filter((g) => g.status === "open").map((g) => g.criterion_id), reason: "retry_place_failed" }, "system");
      });
    }, retryDelayMs()).unref();
    return;
  }
  const c = ledger.requireCase(caseId);
  ledger.appendEvent(caseId, "gap.unresolved", { criterion_ids: c.gaps.filter((g) => g.status === "open").map((g) => g.criterion_id), reason, last_call_id: callId }, "system");
  log.warn({ case_id: caseId, reason }, "gap unresolved after 2 attempts; manual entry required");
}

/** Staff-typed answers (fallback when the call cannot be completed). */
export async function applyManualAnswers(ctx: AppContext, caseId: string, answers: { criterion_id: string; answer: string }[], log: Log) {
  const { ledger } = ctx;
  const c = ledger.requireCase(caseId);
  const known = new Set(c.criteria.map((k) => k.id));
  const valid = answers.filter((a) => known.has(a.criterion_id) && a.answer.trim());
  if (valid.length === 0) throw new AppError(400, "bad_request", "answers must reference known criterion ids with non-empty text");
  const newFacts = manualAnswersToFacts(valid, nextFactIndex(c));
  const facts = [...c.facts, ...newFacts];
  ledger.appendEvent(caseId, "gap.manual_answered", { criterion_ids: valid.map((a) => a.criterion_id), answers: valid, facts }, "staff");
  const r = await rescoreWithFacts({ ...c, facts }, facts, null, log);
  recordScoring(ctx, ledger.requireCase(caseId), r, "evidence.rescored");
  return r;
}
