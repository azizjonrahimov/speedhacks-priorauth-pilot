// Lessons memory: a table DERIVED from the ledger (never written directly). Each lesson is keyed by
// (policy_id, criterion_id, kind) and carries a templated, PHI-free summary, a count and last_seen.
// Updated incrementally on every ledger event and fully rebuildable from history (rebuild()).
import type Database from "better-sqlite3";
import type { Ledger } from "../db/ledger.js";
import type { Criterion, LedgerEvent } from "../domain/types.js";
import { findPolicy } from "../rules/engine.js";

export type LessonKind = "override" | "quote_rejected" | "call_overstep" | "verifier_mismatch";

export interface Lesson {
  id: string; // `${policy_id}|${criterion_id}|${kind}|${direction}`
  policy_id: string;
  criterion_id: string;
  kind: LessonKind;
  direction: string; // override: "under" (model said not met, reviewer met) | "over" (model met, reviewer not); else "-"
  summary: string; // templated, PHI-free, phrased as an instruction to the model or the voice agent
  count: number;
  first_seen: string;
  last_seen: string;
}

const short = (s: string, n = 110) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** Templated lesson text. No note text, no quotes, no names: only policy ids, criterion ids/texts and statuses. */
export function lessonSummary(kind: LessonKind, critText: string, direction: string): string {
  const c = short(critText);
  switch (kind) {
    case "override":
      return direction === "under"
        ? `Reviewers have marked "${c}" as MET when the model said missing/unclear. Look harder for EXPLICIT supporting evidence: compute durations from stated start/end dates, accept clinically equivalent wording, and check phone/manual facts. Do NOT infer or estimate a value the note does not state; if the specific fact is absent, it stays unclear.`
        : `Reviewers have REJECTED "met" for "${c}". Require explicit, specific documentation (numbers, dates, named findings) before marking it met; vague mentions are "unclear".`;
    case "quote_rejected":
      return `For "${c}", the model has cited quotes that were not verbatim in the note. Copy evidence character for character from the note; if unsure, use a shorter exact phrase.`;
    case "verifier_mismatch":
      return `For "${c}", the model's status disagreed with the code check of the numeric threshold. Compute the duration/value from the facts (dates, weeks, BMI, age) and compare to the threshold exactly before choosing a status.`;
    case "call_overstep":
      return `On calls about "${c}", the voice agent stated it would document things the physician never said. Ask about each item explicitly, one at a time, and never say you will document, note or record anything the physician did not confirm in their own words.`;
  }
}

export class LessonsStore {
  private db: Database.Database;
  private onChange: ((l: Lesson) => void)[] = [];

  constructor(private ledger: Ledger) {
    this.db = ledger.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        criterion_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        direction TEXT NOT NULL,
        summary TEXT NOT NULL,
        count INTEGER NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lessons_cursor (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
  }

  /** Subscribe to the ledger bus: every appended event may create or bump a lesson. */
  attach() {
    this.ledger.bus.on("event", (ev: LedgerEvent) => {
      try {
        this.ingest(ev);
      } catch {
        /* lessons are derived data: never break the ledger */
      }
    });
    return this;
  }

  onLesson(fn: (l: Lesson) => void) {
    this.onChange.push(fn);
  }

  private policyFor(caseId: string): { policyId: string; texts: Map<string, string> } | null {
    const c = this.ledger.getCase(caseId);
    if (!c?.screening) return null;
    const pol = findPolicy(c.insurer, c.cpt);
    const texts = new Map((pol?.criteria ?? []).map((k) => [k.id, k.text]));
    return { policyId: c.screening.policy.id, texts };
  }

  private bump(policyId: string, criterionId: string, kind: LessonKind, direction: string, critText: string, at: string) {
    const id = `${policyId}|${criterionId}|${kind}|${direction}`;
    const summary = lessonSummary(kind, critText, direction);
    this.db
      .prepare(
        `INSERT INTO lessons (id, policy_id, criterion_id, kind, direction, summary, count, first_seen, last_seen)
         VALUES (?,?,?,?,?,?,1,?,?)
         ON CONFLICT(id) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen, summary = excluded.summary`,
      )
      .run(id, policyId, criterionId, kind, direction, summary, at, at);
    const l = this.get(id);
    if (l) for (const fn of this.onChange) fn(l);
  }

  /** Derive lessons from one event. Pure function of the event + the case's policy. */
  ingest(ev: LedgerEvent) {
    const p = ev.payload as Record<string, any>;
    switch (ev.type) {
      case "criterion.overridden": {
        const pol = this.policyFor(ev.case_id);
        if (!pol) return;
        const from = String(p.from_status);
        const to = String(p.to_status);
        const direction = to === "met" && from !== "met" ? "under" : from === "met" && to !== "met" ? "over" : "-";
        if (direction === "-") return;
        this.bump(pol.policyId, String(p.criterion_id), "override", direction, pol.texts.get(String(p.criterion_id)) ?? String(p.criterion_id), ev.at);
        return;
      }
      case "evidence.quote_rejected": {
        const pol = this.policyFor(ev.case_id);
        if (!pol) return;
        this.bump(pol.policyId, String(p.criterion_id), "quote_rejected", "-", pol.texts.get(String(p.criterion_id)) ?? String(p.criterion_id), ev.at);
        return;
      }
      case "evidence.scored":
      case "evidence.rescored": {
        const pol = this.policyFor(ev.case_id);
        if (!pol) return;
        for (const k of (p.criteria as Criterion[] | undefined) ?? []) {
          // the code check overrode the model's status → the model got a numeric threshold wrong
          if (k.verifier?.deterministic_check && /\[code check: .*status set to/.test(k.reasoning ?? "")) {
            this.bump(pol.policyId, k.id, "verifier_mismatch", "-", pol.texts.get(k.id) ?? k.text, ev.at);
          }
        }
        return;
      }
      case "call.parsed": {
        if (!p.overstep?.detected) return;
        const pol = this.policyFor(ev.case_id);
        if (!pol) return;
        const ids: string[] = (p.answers as { criterion_id: string }[] | undefined)?.map((a) => a.criterion_id) ?? [];
        const targets = ids.length ? ids : ["*"];
        for (const cid of targets) this.bump(pol.policyId, cid, "call_overstep", "-", cid === "*" ? "this policy" : (pol.texts.get(cid) ?? cid), ev.at);
        return;
      }
      default:
        return;
    }
  }

  /** Recompute the whole table from the ledger (proves lessons are pure derived data). */
  rebuild() {
    this.db.exec("DELETE FROM lessons");
    const rows = this.db.prepare("SELECT DISTINCT case_id FROM events").all() as { case_id: string }[];
    for (const { case_id } of rows) for (const ev of this.ledger.listEvents(case_id)) this.ingest(ev);
  }

  get(id: string): Lesson | null {
    return (this.db.prepare("SELECT * FROM lessons WHERE id = ?").get(id) as Lesson | undefined) ?? null;
  }

  list(filter: { policy_id?: string; kind?: LessonKind } = {}): Lesson[] {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.policy_id) (where.push("policy_id = ?"), args.push(filter.policy_id));
    if (filter.kind) (where.push("kind = ?"), args.push(filter.kind));
    return this.db.prepare(`SELECT * FROM lessons ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY count DESC, last_seen DESC`).all(...args) as Lesson[];
  }

  /** Top lessons for scoring a case under this policy (model-facing kinds only). */
  forScoring(policyId: string, n = 5): Lesson[] {
    return this.list({ policy_id: policyId }).filter((l) => l.kind !== "call_overstep").slice(0, n);
  }

  /** Rules for the next call script under this policy. */
  forCalls(policyId: string, n = 3): Lesson[] {
    return this.list({ policy_id: policyId, kind: "call_overstep" }).slice(0, n);
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM lessons").get() as { n: number }).n;
  }
}
