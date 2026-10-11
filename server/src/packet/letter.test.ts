import { describe, expect, it } from "vitest";
import { checkLetterQuotes, templateLetter } from "./letter.js";
import { manualAnswersToFacts } from "../gapfill/parse.js";
import type { CaseDetail } from "../domain/types.js";

const c = {
  id: "pa_1",
  note: "Completed 8 weeks of conservative therapy. Diminished right ankle reflex (1+).",
  cpt: "72148",
  cpt_label: "MRI lumbar spine",
  insurer: "Aetna",
  expedited: false,
  red_flags: [],
  patient: { name: "D O", dob: "1979-03-14", member_id: "M", phone: "" },
  physician: { name: "Dr. P R", npi: "1", phone: "" },
  screening: { policy: { id: "Aetna CPB 0236", url: "https://x" } },
  facts: [{ id: "f9", kind: "therapy", label: "x", value: 8, quote: "we did about eight weeks of PT", char_start: -1, char_end: -1, source: "phone_call" }],
  criteria: [
    { id: "c1", text: "6 weeks of conservative therapy", status: "met", evidence_quote: "Completed 8 weeks of conservative therapy", evidence_source: "note", verifier: { quote_verified: true, deterministic_check: { passed: true, detail: "8 vs 6" } } },
  ],
} as unknown as CaseDetail;

describe("letter verifier", () => {
  it("accepts quotes from the note, call facts and criteria text; rejects invented ones", () => {
    const good = 'The note states "Completed 8 weeks of conservative therapy" and the physician confirmed "about eight weeks of PT". Criterion: "6 weeks of conservative therapy".';
    expect(checkLetterQuotes(good, c)).toEqual({ ok: true, bad: [] });
    const bad = 'The note states "Completed 12 weeks of conservative therapy and injections".';
    expect(checkLetterQuotes(bad, c).bad).toHaveLength(1);
  });
  it("template letter is facts-only and cites the policy", () => {
    const t = templateLetter(c);
    expect(t).toContain("Aetna CPB 0236");
    expect(t).toContain("Completed 8 weeks of conservative therapy");
    expect(checkLetterQuotes(t, c).ok).toBe(true);
  });
});

describe("manual answers → facts", () => {
  it("extracts weeks/months/BMI numbers deterministically", () => {
    const f = manualAnswersToFacts(
      [
        { criterion_id: "a", answer: "About eight weeks of PT starting July" },
        { criterion_id: "b", answer: "Program ran 4 months" },
        { criterion_id: "c", answer: "BMI was 33.2 at baseline" },
        { criterion_id: "d", answer: "X-rays done, negative" },
      ],
      5,
    );
    expect(f.map((x) => x.id)).toEqual(["f5", "f6", "f7", "f8"]);
    expect(f[0]).toMatchObject({ kind: "therapy", value: 8, unit: "weeks", source: "manual" });
    expect(f[1]).toMatchObject({ kind: "therapy", value: 4, unit: "months" });
    expect(f[2]).toMatchObject({ kind: "bmi", value: 33.2 });
    expect(f[3]).toMatchObject({ kind: "other", value: null });
  });
});
