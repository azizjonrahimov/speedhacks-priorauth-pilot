import { describe, expect, it } from "vitest";
import { deterministicCheck, factWeeks, finalizeCriterion, locateQuote, verifyEvidenceQuote } from "./verify.js";
import type { Fact } from "../domain/types.js";
import type { RuleCriterion } from "../rules/engine.js";

const note = "TREATMENT TO DATE: Completed 8 weeks of conservative therapy\nbeginning 07/28/2026:  naproxen 500 mg twice daily.\nEXAM: Diminished right ankle reflex (1+).";

describe("locateQuote", () => {
  it("finds exact substrings with correct offsets", () => {
    const m = locateQuote(note, "Diminished right ankle reflex");
    expect(m.ok).toBe(true);
    expect(note.slice(m.char_start, m.char_end)).toBe("Diminished right ankle reflex");
  });
  it("tolerates whitespace/case differences and strips wrapping quotes", () => {
    const m = locateQuote(note, '"completed 8 weeks of conservative therapy beginning 07/28/2026: naproxen"');
    expect(m.ok).toBe(true);
    expect(note.slice(m.char_start, m.char_end)).toBe("Completed 8 weeks of conservative therapy\nbeginning 07/28/2026:  naproxen");
  });
  it("rejects paraphrases", () => {
    expect(locateQuote(note, "eight weeks of PT").ok).toBe(false);
    expect(locateQuote(note, "").ok).toBe(false);
  });
});

const fact = (over: Partial<Fact> & Record<string, unknown>): Fact => ({
  id: "f1",
  kind: "therapy",
  label: "x",
  value: null,
  quote: "Completed 8 weeks of conservative therapy",
  char_start: 19,
  char_end: 60,
  source: "note",
  ...over,
});

describe("deterministic checks", () => {
  const rule: RuleCriterion = { id: "c", kind: "conservative_therapy_duration", group: "all_of", params: { min_weeks: 6 }, text: "6 weeks", question_if_missing: "How long?" };
  it("computes weeks from value/unit and from dates", () => {
    expect(factWeeks(fact({ value: 8, unit: "weeks" }))).toBe(8);
    expect(factWeeks(fact({ value: 2, unit: "months" }))).toBeCloseTo(8.69, 1);
    expect(factWeeks(fact({ value: null, date_start: "2026-08-04", date_end: "2026-09-22" }))).toBeCloseTo(7, 0);
    expect(factWeeks(fact({ value: 8, unit: "weeks", negated: true }))).toBeNull();
  });
  it("upgrades to met when facts prove the threshold, downgrades when they do not", () => {
    expect(deterministicCheck(rule, "unclear", [fact({ value: 8, unit: "weeks" })])).toMatchObject({ status_override: "met", check: { passed: true } });
    expect(deterministicCheck(rule, "met", [fact({ value: 3, unit: "weeks" })])).toMatchObject({ status_override: "missing", check: { passed: false } });
    expect(deterministicCheck(rule, "met", [])).toMatchObject({ status_override: "unclear" });
    expect(deterministicCheck(rule, "missing", [])).toMatchObject({ status_override: null, check: null });
  });
  it("checks BMI with the alternate comorbidity branch", () => {
    const bmiRule: RuleCriterion = { id: "b", kind: "bmi_threshold", group: "all_of", params: { min_bmi: 30, alt_min_bmi: 27, alt_requires_comorbidity: true }, text: "bmi", question_if_missing: null };
    const bmi28 = fact({ id: "f2", kind: "bmi", value: 28, unit: "kg/m2", quote: "BMI 28" });
    const htn = fact({ id: "f3", kind: "comorbidity", value: null, quote: "hypertension" });
    expect(deterministicCheck(bmiRule, "met", [bmi28]).status_override).toBe("missing");
    expect(deterministicCheck(bmiRule, "missing", [bmi28, htn]).status_override).toBe("met");
    expect(deterministicCheck(bmiRule, "met", [fact({ kind: "bmi", value: 33, unit: "kg/m2" })]).check?.passed).toBe(true);
    const strict: RuleCriterion = { ...bmiRule, params: { min_bmi: 45, exclusive: true } };
    expect(deterministicCheck(strict, "met", [fact({ kind: "bmi", value: 45, unit: "kg/m2" })]).status_override).toBe("missing");
    expect(deterministicCheck(strict, "unclear", [fact({ kind: "bmi", value: 47.1, unit: "kg/m2" })]).status_override).toBe("met");
  });
  it("uses DOB for age and marks comorbidity not applicable above the BMI cutoff", () => {
    const ageRule: RuleCriterion = { id: "a", kind: "age_threshold", group: "all_of", params: { min_age: 18 }, text: "age", question_if_missing: null };
    expect(deterministicCheck(ageRule, "missing", [], "1984-09-30").status_override).toBe("met");
    expect(deterministicCheck(ageRule, "met", [], "2015-01-01").status_override).toBe("missing");
    const com: RuleCriterion = { id: "k", kind: "comorbidity", group: "all_of", params: { required_only_if_bmi_below: 30 }, text: "c", question_if_missing: null };
    expect(deterministicCheck(com, "missing", [fact({ kind: "bmi", value: 33, unit: "kg/m2" })]).status_override).toBe("not_applicable");
  });
});

describe("finalizeCriterion", () => {
  const rule: RuleCriterion = { id: "c2", kind: "objective_finding", group: "all_of", params: {}, text: "reflex changes", question_if_missing: "Any reflex changes?" };
  it("keeps met when the quote verifies, with offsets into the raw note", () => {
    const rejected: string[] = [];
    const c = finalizeCriterion(rule, { status: "met", evidence_quote: "Diminished right ankle reflex (1+)", reasoning: "r", confidence: 0.9, question_if_missing: null }, note, [], undefined, (id) => rejected.push(id));
    expect(c.status).toBe("met");
    expect(rejected).toEqual([]);
    expect(note.slice(c.char_start!, c.char_end!)).toBe("Diminished right ankle reflex (1+)");
    expect(c.verifier.quote_verified).toBe(true);
    expect(c.question_if_missing).toBeNull();
  });
  it("downgrades met → unclear and reports the rejected quote when the quote is invented", () => {
    const rejected: string[] = [];
    const c = finalizeCriterion(rule, { status: "met", evidence_quote: "absent Achilles reflex", reasoning: "r", confidence: 0.9, question_if_missing: null }, note, [], undefined, (id) => rejected.push(id));
    expect(c.status).toBe("unclear");
    expect(rejected).toEqual(["c2"]);
    expect(c.evidence_quote).toBeNull();
    expect(c.question_if_missing).toBe("Any reflex changes?");
  });
  it("accepts quotes from phone-call facts and marks the source", () => {
    const callFact = fact({ id: "f9", source: "phone_call", call_id: "call_1", quote: "we did about eight weeks of PT", char_start: -1, char_end: -1 });
    const v = verifyEvidenceQuote(note, [callFact], "about eight weeks of PT");
    expect(v).toMatchObject({ verified: true, evidence_source: "phone_call", char_start: null });
  });
});
