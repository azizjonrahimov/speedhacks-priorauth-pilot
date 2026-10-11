import { describe, expect, it } from "vitest";
import { CATALOG, caseUuid, catalogHash, crc32, mapLedgerEvent } from "./catalog.js";
import { KeewanoSink, INGEST_URL, REGISTER_URL, type Transport } from "./sink.js";
import { KeewanoQueryClient, type McpFetch } from "./query.js";
import { KeewanoInsights } from "./insights.js";
import { Ledger } from "../db/ledger.js";
import { EVENT_TYPES, type LedgerEvent } from "../domain/types.js";
import { buildApp } from "../app.js";

const quiet = { info: () => {}, warn: () => {} };
const ev = (type: LedgerEvent["type"], payload: Record<string, unknown>, case_id = "pa_abc"): LedgerEvent => ({ seq: 1, case_id, type, payload, at: "2026-10-11T20:00:00.000Z", actor: "system", state: "intake" });

describe("keewano catalog", () => {
  it("has unique ids >= 2000, a stable nonzero hash, and a deterministic UUID per case", () => {
    const ids = CATALOG.map((c) => c.eventTypeId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.min(...ids)).toBe(2000);
    expect(catalogHash()).toBe(catalogHash());
    expect(catalogHash()).not.toBe(0);
    expect(crc32("123456789")).toBe(0xcbf43926); // standard CRC32 check value
    expect(caseUuid("pa_abc")).toBe(caseUuid("pa_abc"));
    expect(caseUuid("pa_abc")).not.toBe(caseUuid("pa_abd"));
    expect(caseUuid("pa_abc")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("maps ledger events to typed, PHI-free values", () => {
    const created = mapLedgerEvent(ev("case.created", { insurer: "Aetna", cpt: "73721", patient_name: "Marcus Lindqvist", input: { note: "secret note", patient: { phone: "+14155550113" } } }));
    expect(created).toEqual([{ eventTypeId: 2017, dataType: "string", timestamp: 1791748800, data: "live" }, { eventTypeId: 2000, dataType: "string", timestamp: 1791748800, data: "Aetna 73721" }]);
    expect(JSON.stringify(created)).not.toMatch(/Lindqvist|secret|4155550113/);
    expect(mapLedgerEvent(ev("call.ended", { duration_seconds: 63, transcript: [{ text: "PHI" }] }))[0]).toMatchObject({ eventTypeId: 2006, dataType: "uint", data: 63 });
    expect(mapLedgerEvent(ev("review.completed", { review_seconds: 31 }))[0]).toMatchObject({ eventTypeId: 2016, data: 31 });
    expect(mapLedgerEvent(ev("payer.responded", { status: "approved", adjudication: "A1", reason: null }))[0]).toMatchObject({ eventTypeId: 2014, data: "A1" });
    expect(mapLedgerEvent(ev("screening.completed", { expedited: true }))[0]).toMatchObject({ eventTypeId: 2001, dataType: "bool", data: true });
    expect(mapLedgerEvent(ev("call.status", { status: "in_progress" }))).toEqual([]);
    // every mapped event type exists in the catalog with a matching dataType
    for (const t of EVENT_TYPES) {
      for (const k of mapLedgerEvent(ev(t, { insurer: "A", cpt: "1", overall: "ready", criterion_id: "c", attempt: 1, duration_seconds: 1, reason: "x", answers_count: 1, criterion_ids: ["a"], outcome: "http_500", adjudication: "A1", channel: "sms", review_seconds: 5, expedited: false, generator: "llm" }))) {
        expect(CATALOG.find((c) => c.eventTypeId === k.eventTypeId)?.dataType).toBe(k.dataType);
      }
    }
  });
});

describe("synthetic backfill", () => {
  it("is deterministic, clearly tagged synthetic, uses only catalog types, and stays in the past", async () => {
    const { buildSyntheticCases, summarize } = await import("./backfill.js");
    const a = buildSyntheticCases(40);
    const b = buildSyntheticCases(40);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const anchor = Date.parse("2026-10-11T00:00:00Z") / 1000;
    for (const c of a) {
      expect(c.case_id).toMatch(/^synthetic_\d{3}$/);
      expect(c.installId).toBe(caseUuid(c.case_id));
      expect(c.events[0]).toMatchObject({ eventTypeId: 2017, data: "synthetic" });
      for (const e of c.events) {
        expect(CATALOG.find((k) => k.eventTypeId === e.eventTypeId)?.dataType).toBe(e.dataType);
        expect(e.timestamp).toBeLessThan(anchor + 86400);
      }
      expect(c.events.at(-1)).toMatchObject({ eventTypeId: 2016, dataType: "uint" });
    }
    const s = summarize(a);
    expect(s.cases).toBe(40);
    expect(s.median_review_seconds).toBeGreaterThan(180);
    expect(s.median_review_seconds).toBeLessThan(660);
    expect(s.call_share).toBeGreaterThan(0.1);
    expect(s.call_share).toBeLessThan(0.5);
  });

  it("live case.created is tagged origin=live", () => {
    expect(mapLedgerEvent(ev("case.created", { insurer: "Aetna", cpt: "72148" }))[0]).toMatchObject({ eventTypeId: 2017, data: "live" });
  });
});

describe("keewano sink", () => {
  it("registers once, batches per case, and carries the catalog hash", async () => {
    const calls: { url: string; body: any }[] = [];
    const transport: Transport = async (url, body) => {
      calls.push({ url, body });
      return { status: 200, text: "" };
    };
    const sink = new KeewanoSink("key", quiet, transport, { flushMs: 10_000, maxBatch: 100, maxQueue: 500, timeoutMs: 100 });
    sink.onLedgerEvent(ev("case.created", { insurer: "Aetna", cpt: "72148" }, "pa_1"));
    sink.onLedgerEvent(ev("evidence.scored", { overall: "ready" }, "pa_1"));
    sink.onLedgerEvent(ev("case.created", { insurer: "Cigna", cpt: "WEGOVY" }, "pa_2"));
    await sink.flush();
    sink.stop();
    expect(calls[0].url).toBe(REGISTER_URL);
    expect(calls[0].body.eventTypes).toHaveLength(CATALOG.length);
    const ingests = calls.filter((c) => c.url === INGEST_URL);
    expect(ingests).toHaveLength(2);
    expect(ingests[0].body).toMatchObject({ installId: caseUuid("pa_1"), customEventsHash: catalogHash(), batch: 1 });
    expect(ingests[0].body.events).toHaveLength(3);
    expect(ingests[1].body.batch).toBe(2);
    expect(sink.stats).toMatchObject({ registered: true, sent_batches: 2, sent_events: 5, failed_batches: 0 });
  });

  it("is inert without a key", async () => {
    let called = 0;
    const sink = new KeewanoSink("", quiet, async () => {
      called++;
      return { status: 200, text: "" };
    });
    sink.onLedgerEvent(ev("case.created", { insurer: "A", cpt: "1" }));
    await sink.flush();
    expect(called).toBe(0);
    expect(sink.enabled).toBe(false);
  });

  it("a dead or hanging Keewano never blocks or breaks the ledger", async () => {
    const hanging: Transport = () => new Promise((_r, rej) => setTimeout(() => rej(new Error("socket hang up")), 30));
    const warns: string[] = [];
    const sink = new KeewanoSink("key", { info: () => {}, warn: (o: any) => warns.push(o.error) }, hanging, { flushMs: 5, maxBatch: 2, maxQueue: 3, timeoutMs: 20 });
    const ledger = new Ledger(":memory:");
    ledger.bus.on("event", sink.onLedgerEvent);
    const t0 = Date.now();
    const input = { note: "x".repeat(30), cpt: "72148", insurer: "Aetna", patient: { name: "A B", phone: "", dob: "", member_id: "" }, physician: { name: "Dr C", phone: "", npi: "" } };
    for (let i = 0; i < 10; i++) ledger.appendEvent(`pa_${i}`, "case.created", { input, cpt: "72148", insurer: "Aetna" });
    expect(Date.now() - t0).toBeLessThan(500); // appends are not slowed down by the sink
    expect(ledger.listCases()).toHaveLength(10);
    await new Promise((r) => setTimeout(r, 200));
    await sink.flush();
    sink.stop();
    expect(sink.stats.failed_batches + sink.stats.dropped_events).toBeGreaterThan(0);
    expect(new Set(warns).size).toBe(warns.length); // one warning per distinct error, no flood
  });
});

describe("keewano insights", () => {
  const fakeMcp = (rows: unknown[][], columns = ["median_review_s", "cases_reviewed", "cases_with_call", "cases_scored"], fail?: string): McpFetch => async (body: any) => {
    if (body.method === "initialize") return { status: 200, json: { result: { serverInfo: { name: "keewano-mcp" } } } };
    if (body.method === "notifications/initialized") return { status: 202, json: null };
    if (body.params?.name === "list_projects") return { status: 200, json: { result: { content: [{ type: "text", text: "- SpeedHack (84af1714-b5e0-4b78-bc57-9e0c6b9b2587)" }] } } };
    if (fail) return { status: 200, json: { result: { content: [{ type: "text", text: fail }], isError: true } } };
    return { status: 200, json: { result: { content: [], structuredContent: { columns: columns.map((name) => ({ name })), rows } } } };
  };

  it("computes median and call share from Keewano and feeds /metrics minutes_saved", async () => {
    const insights = new KeewanoInsights(new KeewanoQueryClient("kwpat-x", null, fakeMcp([[60, 4, 3, 6]])), quiet);
    await insights.refresh();
    expect(insights.state).toMatchObject({ status: "ok", data: { median_review_seconds: 60, cases_with_call: 3, cases_scored: 6, call_share: 0.5 } });

    const app = await buildApp({ dbPath: ":memory:", logger: false, keewanoInsights: insights });
    const id = "pa_m1";
    const input = { note: "x".repeat(30), cpt: "72148", insurer: "Aetna", patient: { name: "A B", phone: "", dob: "", member_id: "" }, physician: { name: "Dr C", phone: "", npi: "" } };
    app.ctx.ledger.appendEvent(id, "case.created", { input, cpt_label: "x" });
    app.ctx.ledger.appendEvent(id, "screening.completed", { pa_required: true, policy: { id: "p", url: "", insurer: "Aetna", cpt: "72148", label: "x" }, red_flags: [] });
    app.ctx.ledger.appendEvent(id, "evidence.scored", { criteria: [], facts: [], overall: "ready", red_flags: [] });
    app.ctx.ledger.appendEvent(id, "packet.generated", { letter_text: "x", pdf_url: "", fhir_bundle: {} });
    app.ctx.ledger.appendEvent(id, "review.completed", { review_seconds: 600 }, "staff");
    const m = (await app.inject({ method: "GET", url: "/metrics" })).json();
    expect(m.minutes_saved_source).toBe("keewano");
    expect(m.source).toBe("keewano"); // frontend alias
    expect(m.as_of).toBe(m.keewano.as_of);
    expect(m.keewano.median_review_s).toBe(60);
    expect(m.minutes_saved_total).toBe(23); // 1 case × (24 − 60 s/60), not (24 − 600 s/60)
    expect(m.keewano).toMatchObject({ status: "ok", label: "live from Keewano", call_share: 0.5, median_review_seconds: 60 });
    await app.close();
  });

  it("treats 'unknown column' (nothing ingested yet) as zeros, keeps last good answer on errors, and is disabled without a token", async () => {
    const empty = new KeewanoInsights(new KeewanoQueryClient("kwpat-x", null, fakeMcp([], undefined, "Failed to execute SQL query: SQL error at 1:52: unknown column 'PA Review Seconds'")), quiet);
    await empty.refresh();
    expect(empty.state).toMatchObject({ status: "ok", data: { cases_scored: 0, median_review_seconds: null }, error: "no PriorAuth events in Keewano yet" });

    let fail = false;
    const flaky: McpFetch = async (body: any) => (fail && body.params?.name === "run_sql_query" ? { status: 503, json: null } : fakeMcp([[45, 1, 1, 2]])(body, "", 0));
    const ins = new KeewanoInsights(new KeewanoQueryClient("kwpat-x", "84af1714-b5e0-4b78-bc57-9e0c6b9b2587", flaky), quiet);
    await ins.refresh();
    fail = true;
    await ins.refresh();
    expect(ins.state.status).toBe("ok");
    expect(ins.state.data?.median_review_seconds).toBe(45);
    expect(ins.state.error).toMatch(/503/);

    const off = new KeewanoInsights(new KeewanoQueryClient(""), quiet);
    expect(off.state.status).toBe("disabled");
  });

  it("/metrics stays local when Keewano is disabled", async () => {
    const app = await buildApp({ dbPath: ":memory:", logger: false });
    const m = (await app.inject({ method: "GET", url: "/metrics" })).json();
    expect(m.minutes_saved_source).toBe("local");
    expect(m.source).toBe("local");
    expect(m.as_of).toBeNull();
    expect(m.keewano.median_review_s).toBeNull();
    expect(m.keewano).toMatchObject({ enabled: false, status: "disabled" });
    await app.close();
  });
});
