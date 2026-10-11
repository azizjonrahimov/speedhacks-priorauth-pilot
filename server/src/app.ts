import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { Ledger } from "./db/ledger.js";
import { AppError } from "./domain/types.js";
import { redactLogObject } from "./util/redact.js";
import { registerCaseRoutes } from "./routes/cases.js";
import { registerMiscRoutes } from "./routes/misc.js";
import { registerEvidenceRoutes } from "./routes/evidence.js";
import { registerGapfillRoutes } from "./routes/gapfill.js";
import { registerPacketRoutes } from "./routes/packet.js";
import { DialService, type DialClientLike } from "./gapfill/dial.js";
import { registerSubmitRoutes } from "./routes/submit.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { wireInboundMessages } from "./notify/patient.js";
import { KeewanoSink } from "./keewano/sink.js";
import { KeewanoInsights } from "./keewano/insights.js";
import { KeewanoQueryClient } from "./keewano/query.js";
import { LessonsStore } from "./learning/lessons.js";

export interface AppContext {
  ledger: Ledger;
  dial: DialService;
  keewano: { sink: KeewanoSink; insights: KeewanoInsights };
  lessons: LessonsStore;
}

export async function buildApp(
  opts: { dbPath?: string; logger?: boolean; dialClient?: DialClientLike | null; keewanoSink?: KeewanoSink; keewanoInsights?: KeewanoInsights } = {},
): Promise<FastifyInstance & { ctx: AppContext }> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.logLevel,
            // PHI hygiene: every log object passes through the redaction wrapper.
            formatters: { log: (o) => redactLogObject(o) },
            redact: { paths: ["req.headers.authorization", "*.apiKey", "*.api_key"], censor: "[redacted]" },
            serializers: {
              req: (r) => ({ method: r.method, url: r.url }),
              res: (r) => ({ statusCode: r.statusCode }),
            },
          },
  });

  const ledger = new Ledger(opts.dbPath ?? config.dbPath);
  const dial = new DialService(app.log, opts.dialClient ?? null);
  // Keewano: inert unless keys are set. Tests (logger:false) get disabled defaults unless they inject instances.
  const sink = opts.keewanoSink ?? new KeewanoSink(opts.logger === false ? "" : config.keewanoApiKey, app.log);
  const insights =
    opts.keewanoInsights ?? new KeewanoInsights(new KeewanoQueryClient(opts.logger === false ? "" : config.keewanoPat, config.keewanoProjectId || null), app.log);
  ledger.bus.on("event", sink.onLedgerEvent);
  // Lessons are derived data: rebuilt from the full ledger at boot, then updated on every appended event.
  const lessons = new LessonsStore(ledger);
  lessons.rebuild();
  lessons.attach();
  const ctx: AppContext = { ledger, dial, keewano: { sink, insights }, lessons };
  (app as unknown as { ctx: AppContext }).ctx = ctx;

  await app.register(cors, { origin: config.corsOrigins, methods: ["GET", "POST", "OPTIONS"] });

  // Lenient JSON: body-less POSTs (screen, score, packet, submit, ...) may carry a JSON content-type with an empty body.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = String(body ?? "").trim();
    if (text === "") return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new AppError(400, "bad_request", "invalid JSON body"), undefined);
    }
  });

  const packetsDir = resolve(config.packetsDir);
  mkdirSync(packetsDir, { recursive: true });
  await app.register(fastifyStatic, { root: packetsDir, prefix: "/packets/", decorateReply: false });

  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as Partial<AppError> & { validation?: unknown; message?: string };
    const status = typeof e.statusCode === "number" ? e.statusCode : 500;
    const code = e.code ?? (e.validation ? "bad_request" : status === 500 ? "internal" : "error");
    if (status >= 500) app.log.error({ err: e.message }, "request failed");
    reply.status(status).send({ error: { code, message: e.message ?? "error" } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "not_found", message: "route not found" } }));

  registerMiscRoutes(app, ctx);
  registerCaseRoutes(app, ctx);
  registerEvidenceRoutes(app, ctx);
  registerGapfillRoutes(app, ctx);
  registerPacketRoutes(app, ctx);
  registerSubmitRoutes(app, ctx);
  registerMetricsRoutes(app, ctx);

  if (opts.logger !== false) {
    void dial.listen();
    wireInboundMessages(ctx, app.log);
    insights.start();
    if (sink.enabled) void sink.register();
  }
  app.addHook("onClose", async () => {
    dial.stop();
    insights.stop();
    sink.stop();
    await sink.flush().catch(() => {});
    ledger.close();
  });
  return app as unknown as FastifyInstance & { ctx: AppContext };
}
