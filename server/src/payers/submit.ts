// Submission layer: bounded retry + exponential backoff with jitter + circuit breaker.
// Every attempt is recorded by the caller through `onAttempt` (→ payer.attempt_failed events).
import type { PayerAttempt } from "../domain/types.js";
import type { PasBundle } from "../fhir/pasBundle.js";
import { PayerError, type PayerAdapter, type PayerResponse, type SubmitContext } from "./types.js";

export interface RetryPolicy {
  maxAttempts: number; // total attempts including the first
  baseMs: number; // first backoff
  maxMs: number;
  jitter: number; // 0..1 fraction of the delay
}
export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 5, baseMs: 300, maxMs: 4000, jitter: 0.3 };

/** Simple per-adapter circuit breaker: opens after N consecutive failures, half-opens after cooldown. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  constructor(
    private threshold = 4,
    private cooldownMs = 30_000,
    private now: () => number = Date.now,
  ) {}
  get state(): "closed" | "open" | "half_open" {
    if (this.openedAt == null) return "closed";
    return this.now() - this.openedAt >= this.cooldownMs ? "half_open" : "open";
  }
  canAttempt() {
    return this.state !== "open";
  }
  onSuccess() {
    this.failures = 0;
    this.openedAt = null;
  }
  onFailure() {
    this.failures++;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }
  snapshot() {
    return { state: this.state, consecutive_failures: this.failures };
  }
}

export interface SubmitOutcome {
  response: PayerResponse | null; // null when every attempt failed
  attempts: PayerAttempt[];
  gave_up_reason: string | null;
}

export async function submitWithRetry(
  adapter: PayerAdapter,
  bundle: PasBundle,
  ctx: SubmitContext,
  opts: {
    policy?: Partial<RetryPolicy>;
    breaker?: CircuitBreaker;
    onAttempt?: (a: PayerAttempt, final: boolean) => void;
    sleep?: (ms: number) => Promise<void>;
    rng?: () => number;
  } = {},
): Promise<SubmitOutcome> {
  const policy = { ...DEFAULT_RETRY, ...(opts.policy ?? {}) };
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rng = opts.rng ?? Math.random;
  const breaker = opts.breaker;
  const attempts: PayerAttempt[] = [];

  for (let n = 1; n <= policy.maxAttempts; n++) {
    const at = new Date().toISOString();
    if (breaker && !breaker.canAttempt()) {
      const a: PayerAttempt = { n, at, outcome: "circuit_open", ms: 0, error: `circuit breaker open for ${adapter.name}` };
      attempts.push(a);
      opts.onAttempt?.(a, true);
      return { response: null, attempts, gave_up_reason: "circuit_open" };
    }
    const t0 = Date.now();
    try {
      const response = await adapter.submit(bundle, ctx);
      const a: PayerAttempt = { n, at, outcome: "ok", ms: Date.now() - t0 };
      attempts.push(a);
      breaker?.onSuccess();
      opts.onAttempt?.(a, true);
      return { response, attempts, gave_up_reason: null };
    } catch (e) {
      const err = e instanceof PayerError ? e : new PayerError("error", String((e as Error).message ?? e));
      breaker?.onFailure();
      const retryable = err.kind === "http_500" || err.kind === "timeout";
      const last = n === policy.maxAttempts || !retryable;
      const backoff = last ? undefined : Math.min(policy.maxMs, policy.baseMs * 2 ** (n - 1)) * (1 + (rng() * 2 - 1) * policy.jitter);
      const a: PayerAttempt = { n, at, outcome: err.kind, ms: Date.now() - t0, status_code: err.status_code, error: err.message.slice(0, 300), ...(backoff != null ? { backoff_ms: Math.round(backoff) } : {}) };
      attempts.push(a);
      opts.onAttempt?.(a, last);
      if (last) return { response: null, attempts, gave_up_reason: retryable ? "max_attempts" : "non_retryable" };
      await sleep(Math.round(backoff!));
    }
  }
  return { response: null, attempts, gave_up_reason: "max_attempts" };
}
