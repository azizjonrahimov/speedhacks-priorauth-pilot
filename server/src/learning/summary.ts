// "What I learned": a human-readable self-review of the lessons table, written by Claude.
// Input is the lessons table only (templated, PHI-free) plus aggregate counts, so no patient data
// can reach the model or the summary. Cached in SQLite; regenerated when the lessons change or daily.
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { completeText } from "../llm/client.js";
import type { Lesson, LessonsStore } from "./lessons.js";
import type { Learning } from "./metric.js";

export interface LessonsSummary {
  text: string;
  generator: "llm" | "template";
  generated_at: string;
  lessons_hash: string;
  lessons_count: number;
  stale: boolean;
}

const SYSTEM = `You are the self-review module of a prior-authorization copilot. Write a short "What I learned" note for the clinic's staff and engineers.
Use ONLY the lessons and counts provided; do not invent incidents, numbers or policies.
Structure, plain text, no markdown headers, at most about 180 words:
1) One sentence summary of how many lessons exist and from what kinds of feedback.
2) Up to 4 bullet lines ("- ") naming the most frequent mistakes by policy and criterion id and what the system now does differently (it injects these lessons into scoring prompts and call scripts automatically).
3) One sentence on whether the learning metric shows improvement, or that there is not enough data yet.
4) One sentence recommending what a human should review next.`;

export function lessonsHash(lessons: Lesson[]): string {
  return createHash("sha1").update(JSON.stringify(lessons.map((l) => [l.id, l.count]))).digest("hex").slice(0, 12);
}

export function templateSummary(lessons: Lesson[], learning: Learning | null): string {
  if (lessons.length === 0) return "No lessons yet: no reviewer overrides, rejected quotes, verifier mismatches or call oversteps have been recorded.";
  const byKind = lessons.reduce<Record<string, number>>((m, l) => ((m[l.kind] = (m[l.kind] ?? 0) + l.count), m), {});
  const top = lessons.slice(0, 4).map((l) => `- ${l.policy_id} / ${l.criterion_id} (${l.kind}, ${l.count}x): now injected as a rule into ${l.kind === "call_overstep" ? "call scripts" : "scoring prompts"}.`);
  const trend = learning?.trend.direction && learning.trend.direction !== "insufficient_data" ? `Override rate with lessons applied vs without: ${learning.trend.with_lessons} vs ${learning.trend.without_lessons} (${learning.trend.direction}).` : "Not enough cases yet to measure whether lessons reduce overrides.";
  return [`${lessons.length} lessons recorded (${Object.entries(byKind).map(([k, v]) => `${k}: ${v}`).join(", ")}).`, ...top, trend, `Next: a reviewer should check the top lesson's criterion wording in the policy rules.`].join("\n");
}

export class LessonsSummarizer {
  constructor(
    private db: Database.Database,
    private lessons: LessonsStore,
  ) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS lessons_summary (id INTEGER PRIMARY KEY CHECK (id = 1), text TEXT NOT NULL, generator TEXT NOT NULL, generated_at TEXT NOT NULL, lessons_hash TEXT NOT NULL, lessons_count INTEGER NOT NULL)`);
  }

  cached(): LessonsSummary | null {
    const row = this.db.prepare("SELECT * FROM lessons_summary WHERE id = 1").get() as Omit<LessonsSummary, "stale"> | undefined;
    if (!row) return null;
    const current = lessonsHash(this.lessons.list());
    const ageMs = Date.now() - Date.parse(row.generated_at);
    return { ...row, generator: row.generator as LessonsSummary["generator"], stale: row.lessons_hash !== current || ageMs > 24 * 3600_000 };
  }

  async generate(learning: Learning | null, log?: { warn: (o: object, m: string) => void }): Promise<LessonsSummary> {
    const lessons = this.lessons.list();
    const hash = lessonsHash(lessons);
    let text: string;
    let generator: LessonsSummary["generator"] = "llm";
    if (lessons.length === 0) {
      text = templateSummary(lessons, learning);
      generator = "template";
    } else {
      const input = {
        lessons: lessons.slice(0, 20).map((l) => ({ policy: l.policy_id, criterion: l.criterion_id, kind: l.kind, direction: l.direction, count: l.count, last_seen: l.last_seen, rule: l.summary })),
        learning: learning && { override_rate: learning.override_rate, with_lessons: learning.trend.with_lessons, without_lessons: learning.trend.without_lessons, direction: learning.trend.direction, cases_scored: learning.cases_scored },
      };
      try {
        text = (await completeText(SYSTEM, `LESSONS AND COUNTS (JSON):\n${JSON.stringify(input, null, 1)}`, 800)).trim();
        if (!text) throw new Error("empty summary");
      } catch (e) {
        log?.warn({ error: String((e as Error).message).slice(0, 160) }, "lessons summary LLM failed; using template");
        text = templateSummary(lessons, learning);
        generator = "template";
      }
    }
    const generated_at = new Date().toISOString();
    this.db
      .prepare("INSERT INTO lessons_summary (id, text, generator, generated_at, lessons_hash, lessons_count) VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text, generator=excluded.generator, generated_at=excluded.generated_at, lessons_hash=excluded.lessons_hash, lessons_count=excluded.lessons_count")
      .run(text, generator, generated_at, hash, lessons.length);
    return { text, generator, generated_at, lessons_hash: hash, lessons_count: lessons.length, stale: false };
  }
}
