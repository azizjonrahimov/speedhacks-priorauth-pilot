// Event-sourced case ledger on SQLite. Every state change is an appended event; the
// `cases` row only caches the folded snapshot for list queries.
import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { foldCase } from "../domain/fold.js";
import { nextState } from "../domain/stateMachine.js";
import { AppError, type Actor, type CaseDetail, type CaseSummary, type EventType, type LedgerEvent, type State } from "../domain/types.js";

export class Ledger {
  readonly db: Database.Database;
  readonly bus = new EventEmitter();

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        state TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        state TEXT NOT NULL,
        UNIQUE(case_id, seq)
      );
      CREATE INDEX IF NOT EXISTS events_case ON events(case_id, seq);
    `);
    this.bus.setMaxListeners(100);
  }

  listEvents(caseId: string): LedgerEvent[] {
    const rows = this.db
      .prepare("SELECT seq, case_id, type, payload_json, at, actor, state FROM events WHERE case_id = ? ORDER BY seq")
      .all(caseId) as { seq: number; case_id: string; type: EventType; payload_json: string; at: string; actor: Actor; state: State }[];
    return rows.map((r) => ({
      seq: r.seq,
      case_id: r.case_id,
      type: r.type,
      payload: JSON.parse(r.payload_json),
      at: r.at,
      actor: r.actor,
      state: r.state,
    }));
  }

  currentState(caseId: string): State | null {
    const row = this.db.prepare("SELECT state FROM events WHERE case_id = ? ORDER BY seq DESC LIMIT 1").get(caseId) as
      | { state: State }
      | undefined;
    return row?.state ?? null;
  }

  /** Append one event (validated against the state machine), refresh the snapshot, broadcast. */
  appendEvent(caseId: string, type: EventType, payload: Record<string, unknown>, actor: Actor = "system"): LedgerEvent {
    const tx = this.db.transaction(() => {
      const current = this.currentState(caseId);
      const state = nextState(current, type, payload);
      const seqRow = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM events WHERE case_id = ?").get(caseId) as { m: number };
      const seq = seqRow.m + 1;
      const at = new Date().toISOString();
      this.db
        .prepare("INSERT INTO events (case_id, seq, type, payload_json, at, actor, state) VALUES (?,?,?,?,?,?,?)")
        .run(caseId, seq, type, JSON.stringify(payload), at, actor, state);
      const ev: LedgerEvent = { seq, case_id: caseId, type, payload, at, actor, state };
      const snapshot = foldCase(this.listEvents(caseId));
      if (!snapshot) throw new AppError(500, "internal", "fold produced no case");
      this.db
        .prepare(
          "INSERT INTO cases (id, created_at, updated_at, state, snapshot_json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, state=excluded.state, snapshot_json=excluded.snapshot_json",
        )
        .run(caseId, snapshot.created_at, snapshot.updated_at, snapshot.state, JSON.stringify(snapshot));
      return ev;
    });
    const ev = tx();
    // Emit outside the transaction so listeners see committed data.
    setImmediate(() => this.bus.emit("event", ev));
    return ev;
  }

  getCase(caseId: string): CaseDetail | null {
    return foldCase(this.listEvents(caseId));
  }

  requireCase(caseId: string): CaseDetail {
    const c = this.getCase(caseId);
    if (!c) throw new AppError(404, "not_found", `case ${caseId} not found`);
    return c;
  }

  listCases(): CaseSummary[] {
    const rows = this.db.prepare("SELECT snapshot_json FROM cases ORDER BY created_at DESC").all() as { snapshot_json: string }[];
    return rows.map((r) => {
      const c = JSON.parse(r.snapshot_json) as CaseDetail;
      return {
        id: c.id,
        patient_name: c.patient_name,
        cpt: c.cpt,
        cpt_label: c.cpt_label,
        insurer: c.insurer,
        state: c.state,
        overall: c.overall,
        expedited: c.expedited,
        review_seconds: c.review?.review_seconds ?? null,
        created_at: c.created_at,
        updated_at: c.updated_at,
      };
    });
  }

  allCases(): CaseDetail[] {
    const rows = this.db.prepare("SELECT snapshot_json FROM cases ORDER BY created_at DESC").all() as { snapshot_json: string }[];
    return rows.map((r) => JSON.parse(r.snapshot_json) as CaseDetail);
  }

  close() {
    this.db.close();
  }
}
