// The one live Keewano query surfaced in the product: median review time and share of cases
// that needed a physician call. Cached; refreshed in the background; /metrics never waits on it.
import type { KeewanoQueryClient } from "./query.js";
import { rowObject } from "./query.js";

// Keewano SQL facts (verified live 2026-10-11): FILTER only works on count/sum/avg/min/max/variance/stddev,
// and IS NULL is unsupported. Columns are step functions held forward, so the median is pinned to the moment
// each review happened (first occurrence per case). Hence two statements.
export const MEDIAN_SQL = `SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY "PA Review Seconds") AS median_review_s,
  count(DISTINCT user_id) AS cases_reviewed
FROM events
WHERE occurrence("PA Review Seconds") = 1`;

export const COUNTS_SQL = `SELECT
  count(DISTINCT user_id) FILTER (WHERE "PA Call Placed" IS NOT NULL) AS cases_with_call,
  count(DISTINCT user_id) FILTER (WHERE "PA Score Overall" IS NOT NULL) AS cases_scored,
  count(DISTINCT user_id) FILTER (WHERE "PA Data Origin" = 'synthetic') AS synthetic_cases
FROM events`;

export interface KeewanoInsight {
  median_review_seconds: number | null;
  cases_reviewed: number;
  cases_scored: number;
  cases_with_call: number;
  call_share: number | null; // cases_with_call / cases_scored
  synthetic_cases: number; // how many of the cases are backfilled synthetic history
  as_of: string;
  query: string;
}

export interface InsightsState {
  enabled: boolean;
  status: "disabled" | "pending" | "ok" | "error";
  data: KeewanoInsight | null;
  error: string | null;
  last_attempt: string | null;
}

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

export class KeewanoInsights {
  readonly state: InsightsState;
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;

  constructor(
    private client: KeewanoQueryClient,
    private log: Log,
    private refreshMs = 60_000,
  ) {
    this.state = { enabled: client.enabled, status: client.enabled ? "pending" : "disabled", data: null, error: null, last_attempt: null };
  }

  start() {
    if (!this.client.enabled || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.refreshMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): Promise<void> {
    if (!this.client.enabled) return Promise.resolve();
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      this.state.last_attempt = new Date().toISOString();
      const query = `${MEDIAN_SQL};\n${COUNTS_SQL}`;
      try {
        let med: Record<string, unknown>;
        let cnt: Record<string, unknown>;
        try {
          [med, cnt] = await Promise.all([this.client.sql(MEDIAN_SQL, 1).then((r) => rowObject(r)), this.client.sql(COUNTS_SQL, 1).then((r) => rowObject(r))]);
        } catch (e) {
          // unknown column = our custom events were never registered/ingested yet: report zeros, not an error
          if (/unknown column/i.test(String((e as Error).message))) {
            this.state.data = { median_review_seconds: null, cases_reviewed: 0, cases_scored: 0, cases_with_call: 0, call_share: null, synthetic_cases: 0, as_of: new Date().toISOString(), query };
            this.state.status = "ok";
            this.state.error = "no PriorAuth events in Keewano yet";
            return;
          }
          throw e;
        }
        const scored = num(cnt.cases_scored) ?? 0;
        const withCall = num(cnt.cases_with_call) ?? 0;
        this.state.data = {
          median_review_seconds: num(med.median_review_s),
          cases_reviewed: num(med.cases_reviewed) ?? 0,
          cases_scored: scored,
          cases_with_call: withCall,
          call_share: scored > 0 ? Math.round((withCall / scored) * 1000) / 1000 : null,
          synthetic_cases: num(cnt.synthetic_cases) ?? 0,
          as_of: new Date().toISOString(),
          query,
        };
        this.state.status = "ok";
        this.state.error = scored === 0 ? "no PriorAuth events in Keewano yet" : null;
      } catch (e) {
        this.state.status = this.state.data ? "ok" : "error"; // keep serving the last good answer
        this.state.error = String((e as Error).message).slice(0, 200);
        this.log.warn({ error: this.state.error }, "keewano insights refresh failed (serving cached/local)");
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}
