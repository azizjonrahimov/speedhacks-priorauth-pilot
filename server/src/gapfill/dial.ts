// Dial voice/SMS wrapper. Starts one event-stream listener with the server (reconnects on drop)
// and resolves per-call waiters from `call.ended` / `call.transcribed`, with a getCall() poll as
// the safety net (the stream is presence-based and only replays within 2 minutes).
import { EventEmitter } from "node:events";
import { config, hasDial } from "../config.js";
import { AppError } from "../domain/types.js";
import { maskPhone } from "../util/redact.js";

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };
type DialClientT = import("@getdial/sdk").DialClient;
type DialCall = import("@getdial/sdk").Call;
type DialEvent = import("@getdial/sdk").DialEvent;

export interface EndedCall {
  id: string;
  termination: "completed" | "busy" | "no-answer" | "failed" | "canceled" | "unknown";
  durationSeconds: number | null;
  failureReason: string | null;
  transcriptTurns: { speaker: "agent" | "physician"; text: string; start_ms: number }[];
  transcript: string | null;
}

/** The subset of DialClient we use; tests inject a fake. */
export type DialClientLike = Pick<DialClientT, "makeCall" | "getCall" | "sendMessage" | "newEventsConnection">;

/** Map Dial SDK failures to short, demo-safe messages (never raw payloads or keys). */
export function dialError(e: unknown, action: string): AppError {
  const err = e as { status?: number; statusCode?: number; code?: string; message?: string };
  const status = err.status ?? err.statusCode;
  const code = String(err.code ?? "");
  const msg = String(err.message ?? e)
    .replace(/sk_[A-Za-z0-9_]+/g, "[key]")
    .replace(/\{[\s\S]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (status === 401 || status === 403 || /unauthori|invalid api key|forbidden/i.test(msg)) return new AppError(503, "dial_unavailable", "Dial not configured: DIAL_API_KEY in server/.env was rejected. Use POST /cases/:id/gapfill/manual.");
  if (status === 429 || code === "call_limit_reached" || /call_limit|concurrent/i.test(msg)) return new AppError(503, "call_failed", "Dial: the from-number is already on a call or the concurrency limit was reached (429). Retry in a minute or use manual entry.");
  if (status === 409 || code === "calling_disabled" || /calling_disabled/i.test(msg)) return new AppError(503, "call_failed", "Dial: calling is disabled on the from-number (409). Enable calling or use manual entry.");
  if (status === 400) return new AppError(400, "call_failed", `Dial rejected the call request (400): ${msg || "check PHYSICIAN_PHONE is E.164"}`);
  if (status && status >= 500) return new AppError(502, "call_failed", `Dial provider error (${status}) while ${action}. Retry or use manual entry.`);
  return new AppError(502, "call_failed", `Dial error while ${action}: ${msg || "unknown"}`);
}

export class DialService {
  readonly events = new EventEmitter();
  private client: DialClientLike | null = null;
  private listening = false;
  private stopped = false;
  private log: Log;
  private injected: DialClientLike | null;

  constructor(log: Log, client: DialClientLike | null = null) {
    this.log = log;
    this.injected = client;
    this.events.setMaxListeners(50);
  }

  get available() {
    return this.injected != null || hasDial();
  }

  private async getClient(): Promise<DialClientLike> {
    if (this.injected) return this.injected;
    if (!hasDial()) throw new AppError(503, "dial_unavailable", "DIAL_API_KEY / DIAL_FROM_NUMBER_ID missing in server/.env; use POST /cases/:id/gapfill/manual");
    if (!this.client) {
      const { DialClient } = await import("@getdial/sdk");
      this.client = new DialClient({ apiKey: config.dialApiKey, userAgent: "priorauth-pilot/0.1" });
    }
    return this.client;
  }

  /** Start the account event stream (idempotent). Reconnects with backoff until stop(). */
  async listen() {
    if (this.listening || !hasDial()) return;
    this.listening = true;
    let backoff = 1000;
    void (async () => {
      while (!this.stopped) {
        try {
          const client = await this.getClient();
          const conn = await client.newEventsConnection();
          this.log.info({}, "dial event stream connected");
          backoff = 1000;
          try {
            for await (const ev of conn) {
              if (this.stopped) break;
              this.dispatch(ev);
            }
          } finally {
            await conn.close().catch(() => {});
          }
          if (!this.stopped) this.log.warn({}, "dial event stream ended; reconnecting");
        } catch (e) {
          this.log.warn({ error: String((e as Error).message).slice(0, 200), backoff }, "dial event stream error; reconnecting");
        }
        if (this.stopped) break;
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    })();
  }

  stop() {
    this.stopped = true;
  }

  private dispatch(ev: DialEvent) {
    // never log transcripts/bodies at info level
    this.log.info({ type: ev.type, related: ev.relatedObject?.id ?? null }, "dial event");
    this.events.emit(ev.type, ev);
    this.events.emit("any", ev);
  }

  async placeCall(params: { to: string; instruction: string; idempotencyKey: string; maxSeconds?: number }): Promise<DialCall> {
    const client = await this.getClient();
    try {
      return await client.makeCall({
        to: params.to,
        fromNumberId: config.dialFromNumberId,
        outboundInstruction: params.instruction,
        language: "en-US",
        idempotencyKey: params.idempotencyKey,
        maxCallDurationSeconds: Math.min(params.maxSeconds ?? 240, 300),
      });
    } catch (e) {
      throw dialError(e, `placing call to ${maskPhone(params.to)}`);
    }
  }

  async getCall(id: string): Promise<DialCall> {
    const client = await this.getClient();
    return client.getCall(id);
  }

  /**
   * Wait until the call terminates and its transcript (if any) is available.
   * Uses call.ended + call.transcribed events, plus a poll every `pollMs` as a safety net.
   */
  async waitForCallEnd(callId: string, opts: { timeoutMs?: number; pollMs?: number; onStatus?: (state: string) => void } = {}): Promise<EndedCall> {
    const timeoutMs = opts.timeoutMs ?? 6 * 60_000;
    const pollMs = opts.pollMs ?? 20_000;
    const started = Date.now();
    let ended = false;
    let transcribed = false;

    return new Promise<EndedCall>((resolve, reject) => {
      let done = false;
      const finish = async () => {
        if (done) return;
        try {
          const call = await this.getCall(callId);
          const state = call.status?.state;
          if (state !== "Terminated" && state !== "Unknown") return; // not over yet
          const term = (call.terminationType ?? call.status?.terminationType ?? "unknown") as EndedCall["termination"];
          const hasTurns = Array.isArray(call.transcriptTurns) && call.transcriptTurns.length > 0;
          // after a completed call, give the transcript a moment to land unless call.transcribed already fired
          if (term === "completed" && !hasTurns && !transcribed && Date.now() - started < timeoutMs && Date.now() - lastEndedAt < 45_000) return;
          done = true;
          cleanup();
          resolve({
            id: call.id,
            termination: term,
            durationSeconds: call.duration ?? null,
            failureReason: call.failureReason ?? null,
            transcript: call.transcript ?? null,
            transcriptTurns: (call.transcriptTurns ?? []).map((t) => ({ speaker: t.speaker === "agent" ? "agent" : "physician", text: t.text, start_ms: t.startMs })),
          });
        } catch (e) {
          this.log.warn({ error: String((e as Error).message).slice(0, 200) }, "getCall failed while waiting");
        }
      };
      let lastEndedAt = Number.POSITIVE_INFINITY;
      const onEnded = (ev: DialEvent) => {
        if ((ev.data as { callId?: string }).callId !== callId) return;
        ended = true;
        lastEndedAt = Date.now();
        void finish();
      };
      const onTranscribed = (ev: DialEvent) => {
        if ((ev.data as { callId?: string }).callId !== callId) return;
        transcribed = true;
        void finish();
      };
      const onStatus = (ev: DialEvent) => {
        const d = ev.data as { callId?: string; status?: { state?: string } };
        if (d.callId !== callId) return;
        opts.onStatus?.(d.status?.state ?? "unknown");
      };
      const poll = setInterval(() => {
        if (Date.now() - started > timeoutMs) {
          cleanup();
          if (!done) {
            done = true;
            reject(new AppError(504, "call_timeout", `call ${callId} did not terminate within ${timeoutMs / 1000}s`));
          }
          return;
        }
        void finish();
      }, pollMs);
      const cleanup = () => {
        clearInterval(poll);
        this.events.off("call.ended", onEnded);
        this.events.off("call.transcribed", onTranscribed);
        this.events.off("call.status_changed", onStatus);
      };
      this.events.on("call.ended", onEnded);
      this.events.on("call.transcribed", onTranscribed);
      this.events.on("call.status_changed", onStatus);
      void ended;
    });
  }

  async sendSms(to: string, body: string): Promise<{ id: string; state: string }> {
    const client = await this.getClient();
    let m: Awaited<ReturnType<DialClientLike["sendMessage"]>>;
    try {
      m = await client.sendMessage({ to, fromNumberId: config.dialFromNumberId, body });
    } catch (e) {
      throw dialError(e, `sending SMS to ${maskPhone(to)}`);
    }
    return { id: m.id, state: String((m as { deliveryState?: string }).deliveryState ?? (m as { status?: string }).status ?? "pending") };
  }
}
