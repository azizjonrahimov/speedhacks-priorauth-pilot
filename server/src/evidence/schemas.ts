import { z } from "zod";

export const factKind = z.enum(["symptom", "duration", "therapy", "exam_finding", "lab_or_imaging", "bmi", "age", "comorbidity", "red_flag", "other"]);
export const unitEnum = z.enum(["weeks", "days", "months", "years", "kg/m2", "years_old", "sessions", "none"]);

export const extractedFactSchema = z.object({
  kind: factKind,
  label: z.string().describe("Short human label, e.g. 'Physical therapy, 8 weeks' or 'Diminished right ankle reflex'"),
  quote: z.string().describe("VERBATIM substring of the note, copied character for character. Never paraphrase."),
  value_number: z.number().nullable().describe("Numeric value when the fact is quantitative (weeks of therapy, BMI, age, number of sessions); else null"),
  unit: unitEnum.describe("Unit for value_number; 'none' when not numeric"),
  date_start: z.string().nullable().describe("ISO date YYYY-MM-DD when the note gives a start date for this therapy/symptom; else null"),
  date_end: z.string().nullable().describe("ISO date YYYY-MM-DD when the note gives an end date; else null"),
  negated: z.boolean().describe("true when the note explicitly DENIES or rules out this finding (e.g. 'denies saddle anesthesia', 'no fever')"),
});
export type ExtractedFact = z.infer<typeof extractedFactSchema>;

export const extractFactsOutput = z.object({
  facts: z.array(extractedFactSchema),
});
export type ExtractFactsOutput = z.infer<typeof extractFactsOutput>;

export const criterionStatus = z.enum(["met", "missing", "unclear", "not_applicable"]);

export const scoredCriterionSchema = z.object({
  criterion_id: z.string(),
  status: criterionStatus.describe("met = documented and satisfied; missing = not documented at all; unclear = mentioned but insufficient (e.g. therapy mentioned without duration); not_applicable = the criterion's branch does not apply to this patient"),
  evidence_fact_ids: z.array(z.string()).describe("ids of the facts that support this status (may be empty)"),
  evidence_quote: z.string().nullable().describe("VERBATIM substring of the note (or of a phone-call/manual fact quote) that best supports the status; null when nothing supports it"),
  reasoning: z.string().describe("One or two sentences, clinical and specific"),
  confidence: z.number().min(0).max(1),
  question_if_missing: z.string().nullable().describe("When status is missing/unclear: ONE concise question to ask the ordering physician by phone that would resolve it. Else null."),
});
export type ScoredCriterion = z.infer<typeof scoredCriterionSchema>;

export const scoreCriteriaOutput = z.object({
  criteria: z.array(scoredCriterionSchema),
});
export type ScoreCriteriaOutput = z.infer<typeof scoreCriteriaOutput>;

export const transcriptAnswerSchema = z.object({
  criterion_id: z.string(),
  answered: z.boolean().describe("true if the physician gave a usable answer to this question"),
  answer: z.string().describe("The physician's answer, as a short clinical statement in their words; empty string if not answered"),
  quote: z.string().describe("VERBATIM substring of the transcript supporting the answer; empty string if not answered"),
  value_number: z.number().nullable().describe("Numeric value if the answer is quantitative (weeks, BMI, age); else null"),
  unit: unitEnum,
  date_start: z.string().nullable(),
  date_end: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export const parseTranscriptOutput = z.object({ answers: z.array(transcriptAnswerSchema) });
export type ParseTranscriptOutput = z.infer<typeof parseTranscriptOutput>;
