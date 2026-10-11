// Pure verification layer. The LLM is never trusted for (a) quotes or (b) numeric thresholds.
//  - every evidence_quote must be an exact substring of its source (whitespace-normalized);
//    otherwise the criterion is downgraded to `unclear` and an evidence.quote_rejected event is emitted.
//  - deterministic params (min_weeks, min_bmi, min_age, ...) are re-checked in code from the facts.
import type { Criterion, CriterionStatus, Fact } from "../domain/types.js";
import type { RuleCriterion } from "../rules/engine.js";

export interface QuoteMatch {
  ok: boolean;
  char_start: number;
  char_end: number;
  quote: string; // the exact text as it appears in the source
}

/** Build a whitespace-normalized view of `text` with a map back to original offsets. */
function normalizedView(text: string): { norm: string; map: number[] } {
  const map: number[] = [];
  let norm = "";
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!lastSpace) {
        norm += " ";
        map.push(i);
      }
      lastSpace = true;
    } else {
      norm += ch.toLowerCase();
      map.push(i);
      lastSpace = false;
    }
  }
  return { norm, map };
}

const cache = new WeakMap<object, { norm: string; map: number[] }>();
const keyFor = new Map<string, object>();
function viewOf(text: string) {
  let k = keyFor.get(text);
  if (!k) {
    k = {};
    keyFor.set(text, k);
    if (keyFor.size > 200) keyFor.delete(keyFor.keys().next().value as string);
  }
  let v = cache.get(k);
  if (!v) {
    v = normalizedView(text);
    cache.set(k, v);
  }
  return v;
}

/**
 * Locate `quote` in `source`. Exact match first; then whitespace/case-insensitive;
 * then with surrounding quotes/ellipses stripped. `hint` picks the nearest occurrence.
 */
export function locateQuote(source: string, quote: string | null | undefined, hint?: number | null): QuoteMatch {
  const miss: QuoteMatch = { ok: false, char_start: -1, char_end: -1, quote: quote ?? "" };
  if (!quote) return miss;
  let q = quote.trim().replace(/^["'“”‘’…\s]+|["'“”‘’…\s]+$/g, "");
  if (q.length < 3) return miss;

  const pick = (positions: number[], len: number) => {
    if (positions.length === 0) return -1;
    if (hint == null || hint < 0) return positions[0];
    return positions.reduce((best, p) => (Math.abs(p - hint) < Math.abs(best - hint) ? p : best), positions[0]);
  };
  const allIndexes = (hay: string, needle: string) => {
    const out: number[] = [];
    let i = hay.indexOf(needle);
    while (i >= 0 && out.length < 50) {
      out.push(i);
      i = hay.indexOf(needle, i + 1);
    }
    return out;
  };

  // 1. exact
  let pos = pick(allIndexes(source, q), q.length);
  if (pos >= 0) return { ok: true, char_start: pos, char_end: pos + q.length, quote: source.slice(pos, pos + q.length) };

  // 2. normalized whitespace + case
  const sv = viewOf(source);
  const qn = normalizedView(q).norm;
  if (qn.length >= 3) {
    const idxs = allIndexes(sv.norm, qn).map((i) => sv.map[i]);
    pos = pick(idxs, qn.length);
    if (pos >= 0) {
      const normStart = sv.norm.indexOf(qn, 0);
      // find the normalized index whose mapped original equals pos
      let ni = normStart;
      for (const i of allIndexes(sv.norm, qn)) if (sv.map[i] === pos) ni = i;
      const endOrig = sv.map[ni + qn.length - 1] + 1;
      return { ok: true, char_start: pos, char_end: endOrig, quote: source.slice(pos, endOrig) };
    }
  }
  return miss;
}

export interface VerifiedQuote {
  verified: boolean;
  evidence_quote: string | null;
  char_start: number | null;
  char_end: number | null;
  evidence_source: Fact["source"] | null;
}

/** Verify a quote against the note, then against non-note facts (phone call / manual answers). */
export function verifyEvidenceQuote(note: string, facts: Fact[], quote: string | null | undefined, hint?: number | null): VerifiedQuote {
  const none: VerifiedQuote = { verified: false, evidence_quote: null, char_start: null, char_end: null, evidence_source: null };
  if (!quote) return none;
  const m = locateQuote(note, quote, hint);
  if (m.ok) return { verified: true, evidence_quote: m.quote, char_start: m.char_start, char_end: m.char_end, evidence_source: "note" };
  for (const f of facts) {
    if (f.source === "note") continue;
    const fm = locateQuote(f.quote, quote);
    if (fm.ok || locateQuote(quote, f.quote).ok) {
      return { verified: true, evidence_quote: fm.ok ? fm.quote : f.quote, char_start: null, char_end: null, evidence_source: f.source };
    }
  }
  return { ...none, evidence_quote: null };
}

// ---------- deterministic re-checks ----------

const WEEKS_PER: Record<string, number> = { weeks: 1, days: 1 / 7, months: 4.345, years: 52.18 };

export function factWeeks(f: Fact): number | null {
  const ext = f as Fact & { unit?: string; date_start?: string | null; date_end?: string | null; negated?: boolean };
  if (ext.negated) return null;
  if (ext.date_start && ext.date_end) {
    const a = Date.parse(ext.date_start);
    const b = Date.parse(ext.date_end);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) return (b - a) / (7 * 86400000);
  }
  if (typeof f.value === "number" && ext.unit && WEEKS_PER[ext.unit]) return f.value * WEEKS_PER[ext.unit];
  return null;
}

function numericFact(facts: Fact[], kind: Fact["kind"], unit?: string): Fact | null {
  const c = facts.filter((f) => f.kind === kind && typeof f.value === "number" && !(f as { negated?: boolean }).negated);
  const withUnit = unit ? c.filter((f) => (f as { unit?: string }).unit === unit) : c;
  const pool = withUnit.length ? withUnit : c;
  return pool.sort((a, b) => (b.value as number) - (a.value as number))[0] ?? null;
}

export function ageFromDob(dob: string | undefined, at = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (!Number.isFinite(d.getTime())) return null;
  let age = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) age--;
  return age;
}

export interface DeterministicResult {
  check: null | { passed: boolean; detail: string };
  status_override: CriterionStatus | null; // when the code disagrees with the LLM
  evidence_fact: Fact | null; // fact that proves it (for upgrades)
}

export function deterministicCheck(rule: RuleCriterion, llmStatus: CriterionStatus, facts: Fact[], patientDob?: string): DeterministicResult {
  const none: DeterministicResult = { check: null, status_override: null, evidence_fact: null };
  const p = rule.params as Record<string, number | boolean | undefined>;
  switch (rule.kind) {
    case "conservative_therapy_duration": {
      const min = Number(p.min_weeks ?? 0);
      const cands = facts.filter((f) => (f.kind === "therapy" || f.kind === "duration") && factWeeks(f) != null);
      if (cands.length === 0) {
        if (llmStatus === "met") return { check: { passed: false, detail: "LLM said met but no therapy duration fact could be verified" }, status_override: "unclear", evidence_fact: null };
        return none;
      }
      const best = cands.reduce((a, b) => (factWeeks(b)! > factWeeks(a)! ? b : a));
      const wk = factWeeks(best)!;
      const passed = wk + 1e-9 >= min;
      const detail = `${wk.toFixed(1)} weeks documented vs ${min} required`;
      if (passed && llmStatus !== "met") return { check: { passed, detail }, status_override: "met", evidence_fact: best };
      if (!passed && llmStatus === "met") return { check: { passed, detail }, status_override: "missing", evidence_fact: best };
      return { check: { passed, detail }, status_override: null, evidence_fact: best };
    }
    case "bmi_threshold": {
      const min = Number(p.min_bmi ?? 0);
      const exclusive = Boolean(p.exclusive);
      const alt = p.alt_min_bmi != null ? Number(p.alt_min_bmi) : null;
      const bmiFact = numericFact(facts, "bmi");
      if (!bmiFact) {
        if (llmStatus === "met") return { check: { passed: false, detail: "LLM said met but no BMI fact found" }, status_override: "unclear", evidence_fact: null };
        return none;
      }
      const bmi = bmiFact.value as number;
      const primary = exclusive ? bmi > min : bmi >= min;
      const hasComorb = facts.some((f) => f.kind === "comorbidity" && !(f as { negated?: boolean }).negated);
      const altOk = alt != null && bmi >= alt && (!p.alt_requires_comorbidity || hasComorb);
      const passed = primary || altOk;
      const detail = `BMI ${bmi} vs ${exclusive ? ">" : ">="} ${min}${alt != null ? ` (or >= ${alt} with comorbidity: ${hasComorb ? "yes" : "no"})` : ""}`;
      if (passed && llmStatus !== "met") return { check: { passed, detail }, status_override: "met", evidence_fact: bmiFact };
      if (!passed && llmStatus === "met") return { check: { passed, detail }, status_override: "missing", evidence_fact: bmiFact };
      return { check: { passed, detail }, status_override: null, evidence_fact: bmiFact };
    }
    case "age_threshold": {
      const min = Number(p.min_age ?? 0);
      const ageFact = numericFact(facts, "age");
      const age = ageFact ? (ageFact.value as number) : ageFromDob(patientDob);
      if (age == null) {
        if (llmStatus === "met") return { check: { passed: false, detail: "no age fact or DOB" }, status_override: "unclear", evidence_fact: null };
        return none;
      }
      const passed = age >= min;
      const detail = `age ${age} vs >= ${min}${ageFact ? "" : " (from DOB)"}`;
      if (passed && llmStatus !== "met") return { check: { passed, detail }, status_override: "met", evidence_fact: ageFact };
      if (!passed && llmStatus === "met") return { check: { passed, detail }, status_override: "missing", evidence_fact: ageFact };
      return { check: { passed, detail }, status_override: null, evidence_fact: ageFact };
    }
    case "comorbidity": {
      const onlyBelow = p.required_only_if_bmi_below != null ? Number(p.required_only_if_bmi_below) : null;
      if (onlyBelow != null) {
        const bmiFact = numericFact(facts, "bmi");
        if (bmiFact && (bmiFact.value as number) >= onlyBelow) {
          return { check: { passed: true, detail: `BMI ${bmiFact.value} >= ${onlyBelow}: comorbidity not required` }, status_override: llmStatus === "met" ? null : "not_applicable", evidence_fact: null };
        }
      }
      return none;
    }
    default:
      return none;
  }
}

/** Merge rule + LLM output + verification into the final Criterion. */
export function finalizeCriterion(
  rule: RuleCriterion,
  llm: { status: CriterionStatus; evidence_quote: string | null; reasoning: string; confidence: number; question_if_missing: string | null } | null,
  note: string,
  facts: Fact[],
  patientDob: string | undefined,
  onQuoteRejected: (criterionId: string, quote: string) => void,
): Criterion {
  let status: CriterionStatus = llm?.status ?? "missing";
  let reasoning = llm?.reasoning ?? "Not addressed by the model.";
  let confidence = llm?.confidence ?? 0;
  const q = verifyEvidenceQuote(note, facts, llm?.evidence_quote);
  let quote_verified = q.verified;
  let evidence: VerifiedQuote = q;

  if (llm?.evidence_quote && !q.verified) {
    onQuoteRejected(rule.id, llm.evidence_quote);
    if (status === "met") {
      status = "unclear";
      reasoning += " [verifier: evidence quote was not found verbatim in the note; downgraded to unclear]";
      confidence = Math.min(confidence, 0.4);
    }
  }
  if (status === "met" && !quote_verified) {
    // met must always be backed by a verified quote
    status = "unclear";
    reasoning += " [verifier: no verifiable evidence quote; downgraded to unclear]";
  }

  const det = deterministicCheck(rule, status, facts, patientDob);
  if (det.status_override) {
    reasoning += ` [code check: ${det.check?.detail}; status set to ${det.status_override}]`;
    status = det.status_override;
    if (det.status_override === "met" && det.evidence_fact) {
      const vf = det.evidence_fact;
      evidence = {
        verified: true,
        evidence_quote: vf.quote,
        char_start: vf.source === "note" ? vf.char_start : null,
        char_end: vf.source === "note" ? vf.char_end : null,
        evidence_source: vf.source,
      };
      quote_verified = true;
      confidence = Math.max(confidence, 0.9);
    }
  }

  const needsQuestion = status === "missing" || status === "unclear";
  return {
    id: rule.id,
    text: rule.text,
    kind: rule.kind,
    group: rule.group,
    params: rule.params,
    status,
    evidence_quote: evidence.evidence_quote,
    char_start: evidence.char_start,
    char_end: evidence.char_end,
    evidence_source: evidence.evidence_source,
    reasoning,
    confidence,
    question_if_missing: needsQuestion ? llm?.question_if_missing?.trim() || rule.question_if_missing : null,
    verifier: { quote_verified, deterministic_check: det.check },
  };
}
