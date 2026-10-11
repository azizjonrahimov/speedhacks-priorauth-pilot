// The learning-effect metric: does injecting lessons reduce reviewer overrides?
// override_rate = cases with ≥1 reviewer override / cases scored; split by whether lessons were applied.
import type { CaseDetail } from "../domain/types.js";

export const LEARNING_SQL = `SELECT
  count(DISTINCT user_id) FILTER (WHERE "PA Criterion Override" IS NOT NULL) AS cases_overridden,
  count(DISTINCT user_id) FILTER (WHERE "PA Score Overall" IS NOT NULL) AS cases_scored,
  count(DISTINCT user_id) FILTER (WHERE "PA Lessons Applied" IS NOT NULL) AS cases_with_lessons,
  count(DISTINCT user_id) FILTER (WHERE "PA Lessons Applied" IS NOT NULL AND "PA Criterion Override" IS NOT NULL) AS overridden_with_lessons
FROM events`;

export interface LearningCounts {
  cases_scored: number;
  cases_overridden: number;
  cases_with_lessons: number;
  overridden_with_lessons: number;
}

export interface Learning extends LearningCounts {
  source: "keewano" | "local";
  override_rate: number | null;
  lessons_count: number;
  trend: {
    with_lessons: number | null; // override rate among cases scored WITH lessons injected
    without_lessons: number | null; // override rate among cases scored without
    direction: "improving" | "worse" | "flat" | "insufficient_data";
  };
}

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);

export function learningFrom(counts: LearningCounts, lessonsCount: number, source: Learning["source"]): Learning {
  const withoutDen = counts.cases_scored - counts.cases_with_lessons;
  const withoutNum = counts.cases_overridden - counts.overridden_with_lessons;
  const withL = rate(counts.overridden_with_lessons, counts.cases_with_lessons);
  const withoutL = rate(withoutNum, withoutDen);
  let direction: Learning["trend"]["direction"] = "insufficient_data";
  if (withL != null && withoutL != null && counts.cases_with_lessons >= 3 && withoutDen >= 3) {
    direction = withL < withoutL - 0.02 ? "improving" : withL > withoutL + 0.02 ? "worse" : "flat";
  }
  return { ...counts, source, override_rate: rate(counts.cases_overridden, counts.cases_scored), lessons_count: lessonsCount, trend: { with_lessons: withL, without_lessons: withoutL, direction } };
}

/** Same definitions computed from this server's ledger (fallback before Keewano has the new columns). */
export function localLearningCounts(cases: CaseDetail[]): LearningCounts {
  const scored = cases.filter((c) => c.timeline.some((e) => e.type === "evidence.scored"));
  const overridden = scored.filter((c) => c.timeline.some((e) => e.type === "criterion.overridden"));
  const withLessons = scored.filter((c) => c.timeline.some((e) => e.type === "lessons.applied"));
  return {
    cases_scored: scored.length,
    cases_overridden: overridden.length,
    cases_with_lessons: withLessons.length,
    overridden_with_lessons: withLessons.filter((c) => c.timeline.some((e) => e.type === "criterion.overridden")).length,
  };
}
