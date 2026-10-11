// Fire-and-forget mirror of every ledger event into Keewano REST ingest.
// Never throws into the ledger, never blocks appendEvent; inert without KEEWANO_API_KEY.
import { randomUUID } from "node:crypto";
import type { LedgerEvent } from "../domain/types.js";
import { CATALOG, caseUuid, catalogHash, mapLedgerEvent, type KeewanoEvent } from "./catalog.js";

export const INGEST_URL = "https://api.keewano.com/event/ingress/v1/json/in";
export const REGISTER_URL = "https://api.keewano.com/event/ingress/v1/json/custom";

export type Transport = (url: string, body: unknown, apiKey: string, timeoutMs: number) => Promise<{ status: number; text: string }>;

export const fetchTransport: Transport = async (url, body, apiKey, timeoutMs) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "k-token": apiKey }, body: JSON.stringify(body), signal: ctrl.signal });
    return { status: r.status, text: (await r.text()).slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
};

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

export interface SinkStats {
  enabled: boolean;
  registered: boolean;
  queued: number;
  sent_batches: number;
  sent_events: number;
  failed_batches: number;
  dropped_events: number;
  last_error: string | null;
}

export class KeewanoSink {
  private queue: { installId: string; ev: KeewanoEvent }[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private batchNo = 0;
  private readonly sessionId = randomUUID();
  private readonly hash = catalogHash();
  private readonly warned = new Set<string>();
  readonly stats: SinkStats;

  constructor(
    private apiKey: string,
    private log: Log,
    private transport: Transport = fetchTransport,
    private opts = { flushMs: 2000, maxBatch: 20, maxQueue: 500, timeoutMs: 5000 },
  ) {
    this.stats = { enabled: apiKey.length > 0, registered: false, queued: 0, sent_batches: 0, sent_events: 0, failed_batches: 0, dropped_events: 0, last_error: null };
  }

  get enabled() {
    return this.stats.enabled;
  }

  /** One-time custom event registration (append-only, idempotent on Keewano's side). */
  async register(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const r = await this.transport(REGISTER_URL, { customEventsHash: this.hash, eventTypes: CATALOG }, this.apiKey, this.opts.timeoutMs);
      this.stats.registered = r.status >= 200 && r.status < 300;
      if (!this.stats.registered) this.fail(`register HTTP ${r.status}: ${r.text}`);
      else this.log.info({ events: CATALOG.length, hash: this.hash }, "keewano custom events registered");
      return this.stats.registered;
    } catch (e) {
      this.fail(`register: ${String((e as Error).message)}`);
      return false;
    }
  }

  /** Ledger bus listener. Synchronous, constant time, never throws. */
  onLedgerEvent = (ev: LedgerEvent) => {
    if (!this.enabled) return;
    try {
      const mapped = mapLedgerEvent(ev);
      const installId = caseUuid(ev.case_id);
      for (const k of mapped) {
        if (this.queue.length >= this.opts.maxQueue) {
          this.stats.dropped_events++;
          continue;
        }
        this.queue.push({ installId, ev: k });
      }
      this.stats.queued = this.queue.length;
      if (this.queue.length >= this.opts.maxBatch) void this.flush();
      else if (!this.timer && this.queue.length > 0) this.timer = setTimeout(() => void this.flush(), this.opts.flushMs);
    } catch (e) {
      this.fail(`map: ${String((e as Error).message)}`);
    }
  };

  /** Send everything queued, grouped per entity (one batch per case). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const items = this.queue.splice(0, this.queue.length);
    this.stats.queued = this.queue.length;
    try {
      if (!this.stats.registered) await this.register();
      const byEntity = new Map<string, KeewanoEvent[]>();
      for (const it of items) byEntity.set(it.installId, [...(byEntity.get(it.installId) ?? []), it.ev]);
      for (const [installId, events] of byEntity) {
        const body = { installId, dataSessionId: this.sessionId, batch: ++this.batchNo, customEventsHash: this.hash, events };
        try {
          const r = await this.transport(INGEST_URL, body, this.apiKey, this.opts.timeoutMs);
          if (r.status >= 200 && r.status < 300) {
            this.stats.sent_batches++;
            this.stats.sent_events += events.length;
          } else {
            this.stats.failed_batches++;
            this.fail(`ingest HTTP ${r.status}: ${r.text}`);
          }
        } catch (e) {
          this.stats.failed_batches++;
          this.fail(`ingest: ${String((e as Error).message)}`);
        }
      }
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) void this.flush();
    }
  }

  private fail(msg: string) {
    const clean = msg.replace(/k-token[^,]*/gi, "k-token [redacted]").slice(0, 200);
    // one warning per distinct error (bounded), so a dead Keewano never floods the log
    if (!this.warned.has(clean) && this.warned.size < 50) {
      this.warned.add(clean);
      this.log.warn({ error: clean }, "keewano sink error (ledger unaffected)");
    }
    this.stats.last_error = clean;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
