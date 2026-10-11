// Two-pass LLM evidence pipeline with code verification.
//   pass 1  extractFacts(note)            → typed facts with verbatim quotes (offsets recomputed in code)
//   pass 2  scoreCriteria(facts, criteria) → met | missing | unclear | not_applicable per criterion
//   verify  every quote must be a substring; numeric thresholds re-checked from facts
//   rules   group logic evaluated deterministically → overall
import type { CaseDetail, Criterion, Fact, Overall } from "../domain/types.js";
import { structured } from "../llm/client.js";
import { evaluate, findPolicy, type Policy, type RuleCriterion } from "../rules/engine.js";
import { extractFactsOutput, scoreCriteriaOutput, type ExtractedFact } from "./schemas.js";
import { finalizeCriterion, locateQuote } from "./verify.js";

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

const EXTRACT_SYSTEM = `You are a clinical documentation analyst extracting facts from a physician's visit note for a prior-authorization review.
Rules:
- Extract EVERY clinically relevant fact: symptoms (with duration), therapies tried (with duration, dates, sessions), exam findings, labs/imaging done with results, BMI, age, comorbidities, and red-flag phrases.
- "quote" MUST be copied verbatim from the note, character for character, including punctuation. Never paraphrase, never merge two separate sentences.
- Keep quotes short (one clause or sentence) but complete enough to be self-explanatory.
- If the note explicitly denies a finding ("denies saddle anesthesia", "no fever"), still extract it with negated=true.
- For durations, fill value_number and unit (e.g. 8 weeks). If the note gives start/end dates, fill date_start/date_end as ISO dates.
- For therapies mentioned WITHOUT any duration or dates, set value_number=null and unit="none" (do not guess).
- Never invent facts that are not in the note.`;

const SCORE_SYSTEM = `You are a utilization-review nurse mapping extracted clinical facts to an insurer's published medical-necessity criteria.
For each criterion decide:
- "met": the facts clearly satisfy it, and you can cite a verbatim quote.
- "unclear": the topic is mentioned but the documentation is insufficient (e.g. therapy mentioned without duration or dates, finding implied but not stated).
- "missing": nothing in the note addresses it.
- "not_applicable": the criterion's branch does not apply (e.g. injury-only requirement for a non-injury presentation; a "required only if BMI < 30" criterion when BMI is 33).
Rules:
- evidence_quote MUST be a verbatim substring of the note (or of a fact whose source is phone_call/manual). Never paraphrase. If unsure, choose a shorter quote that you are certain appears verbatim.
- A negated fact (negated=true) does NOT satisfy a criterion; for red-flag criteria, a negated fact means the red flag is absent → status "missing" (that is good news for the patient).
- Red-flag criteria are "met" only when the note affirmatively documents the red flag.
- question_if_missing: for missing/unclear criteria, write ONE spoken-language question for a phone call to the ordering physician that would resolve it, specific to this patient (mention the relevant therapy/finding). Otherwise null.
- Be strict about numbers: if a criterion requires N weeks and the note documents fewer or none, do not mark it met.
- Return exactly one entry per criterion id, in the same order.`;

function factsForPrompt(facts: Fact[]) {
  return facts.map((f) => {
    const x = f as Fact & { unit?: string; date_start?: string | null; date_end?: string | null; negated?: boolean };
    return {
      id: f.id,
      kind: f.kind,
      label: f.label,
      quote: f.quote,
      value_number: typeof f.value === "number" ? f.value : null,
      unit: x.unit ?? "none",
      date_start: x.date_start ?? null,
      date_end: x.date_end ?? null,
      negated: Boolean(x.negated),
      source: f.source,
    };
  });
}

export function toFacts(note: string, extracted: ExtractedFact[], startIndex = 1, log?: Log): { facts: Fact[]; rejected: number } {
  const facts: Fact[] = [];
  let rejected = 0;
  let n = startIndex;
  for (const e of extracted) {
    const m = locateQuote(note, e.quote);
    if (!m.ok) {
      rejected++;
      continue; // a fact whose quote is not in the note is not a fact
    }
    facts.push({
      id: `f${n++}`,
      kind: e.kind,
      label: e.label,
      value: e.value_number ?? (e.date_start && e.date_end ? `${e.date_start}..${e.date_end}` : null),
      quote: m.quote,
      char_start: m.char_start,
      char_end: m.char_end,
      source: "note",
      ...(e.unit !== "none" ? { unit: e.unit } : {}),
      ...(e.date_start ? { date_start: e.date_start } : {}),
      ...(e.date_end ? { date_end: e.date_end } : {}),
      ...(e.negated ? { negated: true } : {}),
    } as Fact);
  }
  if (rejected) log?.warn({ rejected }, "facts rejected: quote not found in note");
  return { facts, rejected };
}

export async function extractFacts(note: string, policy: Policy, log?: Log): Promise<{ facts: Fact[]; rejected: number; usage: object }> {
  const r = await structured(
    {
      toolName: "record_facts",
      description: "Record the clinical facts extracted from the note.",
      schema: extractFactsOutput,
      system: EXTRACT_SYSTEM,
      user: `The procedure under review is ${policy.label} (${policy.cpt}) for insurer ${policy.insurer}. The policy criteria concern: ${policy.criteria.map((c) => c.kind.replace(/_/g, " ")).filter((v, i, a) => a.indexOf(v) === i).join(", ")}.\n\nVISIT NOTE (between <note> tags):\n<note>\n${note}\n</note>`,
    },
    log,
  );
  const { facts, rejected } = toFacts(note, r.data.facts, 1, log);
  return { facts, rejected, usage: r.usage };
}

export async function scoreCriteria(
  note: string,
  facts: Fact[],
  rules: RuleCriterion[],
  patientDob: string | undefined,
  log?: Log,
): Promise<{ criteria: Criterion[]; rejectedQuotes: { criterion_id: string; quote: string }[]; usage: object }> {
  const r = await structured(
    {
      toolName: "score_criteria",
      description: "Record the status of every policy criterion.",
      schema: scoreCriteriaOutput,
      system: SCORE_SYSTEM,
      user: `CRITERIA (JSON):\n${JSON.stringify(
        rules.map((c) => ({ id: c.id, kind: c.kind, group: c.group, params: c.params, text: c.text })),
        null,
        1,
      )}\n\nEXTRACTED FACTS (JSON):\n${JSON.stringify(factsForPrompt(facts), null, 1)}\n\nFULL NOTE (for verbatim quoting):\n<note>\n${note}\n</note>${
        facts.some((f) => f.source !== "note")
          ? "\n\nFacts with source phone_call or manual come from a follow-up with the ordering physician; their quote text is also valid evidence."
          : ""
      }`,
    },
    log,
  );
  const byId = new Map(r.data.criteria.map((c) => [c.criterion_id, c]));
  const rejectedQuotes: { criterion_id: string; quote: string }[] = [];
  const criteria = rules.map((rule) =>
    finalizeCriterion(rule, byId.get(rule.id) ?? null, note, facts, patientDob, (criterion_id, quote) => rejectedQuotes.push({ criterion_id, quote })),
  );
  return { criteria, rejectedQuotes, usage: r.usage };
}

export interface ScoringResult {
  facts: Fact[];
  criteria: Criterion[];
  overall: Overall;
  red_flags: string[];
  expedited: boolean;
  rejectedQuotes: { criterion_id: string; quote: string }[];
  rejectedFacts: number;
  summary: { met: number; missing: number; unclear: number; not_applicable: number };
}

/** Full scoring from the note (pass 1 + pass 2 + verification + rules). */
export async function scoreCase(c: CaseDetail, log?: Log): Promise<ScoringResult> {
  const policy = findPolicy(c.insurer, c.cpt);
  if (!policy) throw Object.assign(new Error(`no policy for ${c.insurer} ${c.cpt}`), { statusCode: 409, code: "no_policy" });
  const ex = await extractFacts(c.note, policy, log);
  return rescoreWithFacts(c, ex.facts, policy, log, ex.rejected);
}

/** Pass 2 only, with a given fact set (used after phone-call / manual answers). */
export async function rescoreWithFacts(c: CaseDetail, facts: Fact[], policy: Policy | null = null, log?: Log, rejectedFacts = 0): Promise<ScoringResult> {
  const pol = policy ?? findPolicy(c.insurer, c.cpt);
  if (!pol) throw Object.assign(new Error(`no policy for ${c.insurer} ${c.cpt}`), { statusCode: 409, code: "no_policy" });
  const sc = await scoreCriteria(c.note, facts, pol.criteria, c.patient.dob, log);
  const ev = evaluate(sc.criteria, pol.pa_required);
  const red_flags = Array.from(new Set([...(c.screening?.red_flags ?? []), ...ev.red_flags_met]));
  return {
    facts,
    criteria: sc.criteria,
    overall: ev.overall,
    red_flags,
    expedited: ev.red_flags_met.length > 0 || c.expedited,
    rejectedQuotes: sc.rejectedQuotes,
    rejectedFacts,
    summary: { met: ev.met, missing: ev.missing, unclear: ev.unclear, not_applicable: ev.not_applicable },
  };
}
