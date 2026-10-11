// The one live Keewano query surfaced in the product: median review time and share of cases
// that needed a physician call. Cached; refreshed in the background; /metrics never waits on it.
import type { KeewanoQueryClient } from "./query.js";
import { rowObject } from "./query.js";

// Columns are step functions held forward in time, so pin the median to the moment each review
// happened (first occurrence per case); count cases with/without a call via FILTER.
export const INSIGHTS_SQL = `SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY "PA Review Seconds") FILTER (WHERE occurrence("PA Review Seconds") = 1) AS median_review_s,
  count(DISTINCT user_id) FILTER (WHERE "PA Review Seconds" IS NOT NULL) AS cases_reviewed,
  count(DISTINCT user_id) FILTER (WHERE "PA Call Placed" IS NOT NULL) AS cases_with_call,
  count(DISTINCT user_id) FILTER (WHERE "PA Score Overall" IS NOT NULL) AS cases_scored
FROM events`;

// Fallback without FILTER on the percentile, in case the engine rejects that combination.
export const INSIGHTS_SQL_SIMPLE = `SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY "PA Review Seconds") AS median_review_s,
  count(DISTINCT user_id) FILTER (WHERE "PA Review Seconds" IS NOT NULL) AS cases_reviewed,
  count(DISTINCT user_id) FILTER (WHERE "PA Call Placed" IS NOT NULL) AS cases_with_call,
  count(DISTINCT user_id) FILTER (WHERE "PA Score Overall" IS NOT NULL) AS cases_scored
FROM events
WHERE occurrence("PA Review Seconds") = 1 OR "PA Review Seconds" IS NULL`;

export interface KeewanoInsight {
  median_review_seconds: number | null;
  cases_reviewed: number;
  cases_scored: number;
  cases_with_call: number;
  call_share: number | null; // cases_with_call / cases_scored
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
  private useSimple = false;

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
      try {
        let r;
        try {
          try {
            r = await this.client.sql(this.useSimple ? INSIGHTS_SQL_SIMPLE : INSIGHTS_SQL, 1);
          } catch (e) {
            if (this.useSimple || /unknown column/i.test(String((e as Error).message))) throw e;
            // engine rejected FILTER on the percentile: switch to the simpler form for good
            this.useSimple = true;
            r = await this.client.sql(INSIGHTS_SQL_SIMPLE, 1);
          }
        } catch (e) {
          // unknown column = our events were never ingested yet: report zeros, not an error
          if (/unknown column/i.test(String((e as Error).message))) {
            this.state.data = { median_review_seconds: null, cases_reviewed: 0, cases_scored: 0, cases_with_call: 0, call_share: null, as_of: new Date().toISOString(), query: this.useSimple ? INSIGHTS_SQL_SIMPLE : INSIGHTS_SQL };
            this.state.status = "ok";
            this.state.error = "no PriorAuth events in Keewano yet";
            return;
          }
          throw e;
        }
        const o = rowObject(r);
        const scored = num(o.cases_scored) ?? 0;
        const withCall = num(o.cases_with_call) ?? 0;
        this.state.data = {
          median_review_seconds: num(o.median_review_s),
          cases_reviewed: num(o.cases_reviewed) ?? 0,
          cases_scored: scored,
          cases_with_call: withCall,
          call_share: scored > 0 ? Math.round((withCall / scored) * 1000) / 1000 : null,
          as_of: new Date().toISOString(),
          query: this.useSimple ? INSIGHTS_SQL_SIMPLE : INSIGHTS_SQL,
        };
        this.state.status = "ok";
        this.state.error = null;
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
