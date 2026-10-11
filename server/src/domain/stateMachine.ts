// Explicit state machine. Every ledger event is a transition request; illegal ones throw.
//
//   intake → screened → evidence_scored → needs_info → calling → evidence_rescored
//         → packet_ready → submitted → pended | approved | denied → closed
//
// `expedited` (red flags) is a boolean flag on the case, not a state: it is set by
// screening.completed / evidence.scored payloads and only changes the SLA.

import { AppError, type EventType, type State } from "./types.js";

type Payload = Record<string, unknown>;
type Rule = {
  from: readonly State[] | "*";
  to: (current: State, payload: Payload) => State;
};

const same = (s: State) => s;

const RULES: Record<EventType, Rule> = {
  "case.created": { from: [] as State[], to: () => "intake" }, // handled specially: only legal when no state yet
  "screening.completed": { from: ["intake", "screened"], to: () => "screened" },
  "evidence.extracted": { from: ["screened", "evidence_scored", "needs_info", "calling", "evidence_rescored"], to: same },
  "evidence.scored": { from: ["screened", "evidence_scored", "needs_info"], to: () => "evidence_scored" },
  "evidence.quote_rejected": { from: "*", to: same },
  "gap.question_generated": { from: ["evidence_scored", "needs_info", "evidence_rescored"], to: () => "needs_info" },
  "call.placed": { from: ["needs_info", "calling"], to: () => "calling" },
  "call.status": { from: ["calling"], to: same },
  "call.ended": { from: ["calling"], to: same },
  "call.failed": { from: ["calling"], to: same },
  "call.retry_scheduled": { from: ["calling"], to: same },
  "call.parsed": { from: ["calling"], to: same },
  "gap.unresolved": { from: ["calling"], to: () => "needs_info" },
  "gap.manual_answered": { from: ["needs_info", "evidence_rescored", "evidence_scored"], to: same },
  "evidence.rescored": { from: ["calling", "needs_info", "evidence_rescored", "evidence_scored"], to: () => "evidence_rescored" },
  "packet.generated": {
    from: ["evidence_scored", "evidence_rescored", "needs_info", "packet_ready"],
    to: () => "packet_ready",
  },
  "payer.attempt_failed": { from: ["packet_ready", "submitted"], to: same },
  "payer.submitted": { from: ["packet_ready"], to: () => "submitted" },
  "payer.responded": {
    from: ["submitted", "pended"],
    to: (_c, p) => {
      const s = p.status;
      if (s === "approved" || s === "denied" || s === "pended") return s;
      if (s === "failed") return "packet_ready"; // circuit gave up: staff may resubmit
      throw new AppError(400, "bad_request", `payer.responded needs status approved|denied|pended|failed, got ${String(s)}`);
    },
  },
  "patient.notified": { from: ["approved", "denied", "pended", "closed"], to: same },
  "patient.replied": { from: "*", to: same },
  "review.completed": {
    from: ["packet_ready", "submitted", "pended", "approved", "denied", "closed"],
    to: same,
  },
  "case.closed": { from: ["approved", "denied", "pended"], to: () => "closed" },
};

export function nextState(current: State | null, type: EventType, payload: Payload = {}): State {
  const rule = RULES[type];
  if (!rule) throw new AppError(400, "bad_request", `unknown event type ${type}`);
  if (type === "case.created") {
    if (current !== null) throw new AppError(409, "illegal_transition", "case already exists");
    return "intake";
  }
  if (current === null) throw new AppError(409, "illegal_transition", `event ${type} before case.created`);
  if (rule.from !== "*" && !rule.from.includes(current)) {
    throw new AppError(409, "illegal_transition", `event ${type} not allowed in state ${current}`);
  }
  return rule.to(current, payload);
}

export function canTransition(current: State | null, type: EventType, payload: Payload = {}): boolean {
  try {
    nextState(current, type, payload);
    return true;
  } catch {
    return false;
  }
}

/** Which states may legally receive this event (for docs / UI hints). */
export function allowedFrom(type: EventType): readonly State[] | "*" {
  return RULES[type].from;
}
