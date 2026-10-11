// Declarative rules engine: one entry per (insurer, CPT); group logic is evaluated
// deterministically from per-criterion statuses. The LLM never decides "overall".
import rulesJson from "./rules.json" with { type: "json" };
import type { Criterion, CriterionGroup, CriterionKind, CriterionStatus, Overall, PolicyRef } from "../domain/types.js";

export interface RuleCriterion {
  id: string;
  kind: CriterionKind;
  group: CriterionGroup;
  params: Record<string, unknown>;
  text: string;
  question_if_missing: string | null;
}

export interface Policy {
  insurer: string;
  cpt: string;
  label: string;
  policy_id: string;
  url: string;
  pa_required: boolean;
  source_note: string;
  red_flag_keywords: string[];
  criteria: RuleCriterion[];
}

const POLICIES: Policy[] = (rulesJson as { policies: Policy[] }).policies;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function listPolicies(): Policy[] {
  return POLICIES;
}

export function findPolicy(insurer: string, cpt: string): Policy | null {
  const i = norm(insurer);
  const c = norm(cpt);
  return (
    POLICIES.find((p) => norm(p.insurer) === i && norm(p.cpt) === c) ??
    // tolerate "BCBS SC" / "Blue Cross" style variants
    POLICIES.find((p) => norm(p.cpt) === c && (i.includes(norm(p.insurer).split(" ")[0]) || norm(p.insurer).includes(i.split(" ")[0]))) ??
    null
  );
}

export function cptLabel(insurer: string, cpt: string): string {
  return findPolicy(insurer, cpt)?.label ?? POLICIES.find((p) => norm(p.cpt) === norm(cpt))?.label ?? cpt;
}

export function policyRef(p: Policy): PolicyRef {
  return { id: p.policy_id, url: p.url, insurer: p.insurer, cpt: p.cpt, label: p.label };
}

/** Deterministic keyword scan of the note for the policy's red-flag phrases (pre-LLM). */
export function scanRedFlags(note: string, policy: Policy): string[] {
  const n = note.toLowerCase();
  const hits: string[] = [];
  for (const kw of policy.red_flag_keywords) {
    const idx = n.indexOf(kw.toLowerCase());
    if (idx < 0) continue;
    // Skip when the phrase is negated earlier in the same sentence ("denies saddle anesthesia, ..., fever", "no fever").
    const before = n.slice(Math.max(0, idx - 200), idx);
    if (/\b(denies|denied|no|without|negative for|not)\b[^.;]*$/.test(before)) continue;
    hits.push(kw);
  }
  return hits;
}

export interface Evaluation {
  overall: Overall;
  met: number;
  missing: number;
  unclear: number;
  not_applicable: number;
  red_flags_met: string[];
  satisfied: boolean; // policy logic satisfied (used by the mock payer)
  unresolved: string[]; // criterion ids still missing/unclear and blocking
}

/** Evaluate group logic from per-criterion statuses. Pure. */
export function evaluate(criteria: Pick<Criterion, "id" | "group" | "status" | "text">[], paRequired = true): Evaluation {
  const count = (s: CriterionStatus) => criteria.filter((c) => c.status === s).length;
  const red = criteria.filter((c) => c.group === "red_flag_any_of" && c.status === "met");
  const allOf = criteria.filter((c) => c.group === "all_of");
  const anyOf = criteria.filter((c) => c.group === "any_of");

  const allOfOk = allOf.every((c) => c.status === "met" || c.status === "not_applicable");
  const anyOfOk = anyOf.length === 0 || anyOf.some((c) => c.status === "met");
  const blocking = [
    ...allOf.filter((c) => c.status === "missing" || c.status === "unclear").map((c) => c.id),
    ...(anyOfOk ? [] : anyOf.filter((c) => c.status === "missing" || c.status === "unclear").map((c) => c.id)),
  ];

  let overall: Overall;
  let satisfied: boolean;
  if (!paRequired) {
    overall = "not_required";
    satisfied = true;
  } else if (red.length > 0) {
    overall = "expedite"; // stand-alone indication: no conservative-therapy trial required
    satisfied = true;
  } else if (allOfOk && anyOfOk) {
    overall = "ready";
    satisfied = true;
  } else {
    overall = "needs_info";
    satisfied = false;
  }
  return {
    overall,
    met: count("met"),
    missing: count("missing"),
    unclear: count("unclear"),
    not_applicable: count("not_applicable"),
    red_flags_met: red.map((c) => c.text),
    satisfied,
    unresolved: overall === "needs_info" ? blocking : [],
  };
}
