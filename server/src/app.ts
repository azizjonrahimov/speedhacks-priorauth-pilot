import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { Ledger } from "./db/ledger.js";
import { AppError } from "./domain/types.js";
import { redactValue } from "./util/redact.js";
import { registerCaseRoutes } from "./routes/cases.js";
import { registerMiscRoutes } from "./routes/misc.js";
import { registerEvidenceRoutes } from "./routes/evidence.js";
import { registerGapfillRoutes } from "./routes/gapfill.js";
import { registerPacketRoutes } from "./routes/packet.js";
import { DialService } from "./gapfill/dial.js";

export interface AppContext {
  ledger: Ledger;
  dial: DialService;
}

export async function buildApp(opts: { dbPath?: string; logger?: boolean } = {}): Promise<FastifyInstance & { ctx: AppContext }> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.logLevel,
            // PHI hygiene: every log object passes through the redaction wrapper.
            formatters: { log: (o) => redactValue(o) as Record<string, unknown> },
            redact: { paths: ["req.headers.authorization", "*.apiKey", "*.api_key"], censor: "[redacted]" },
            serializers: {
              req: (r) => ({ method: r.method, url: r.url }),
              res: (r) => ({ statusCode: r.statusCode }),
            },
          },
  });

  const ledger = new Ledger(opts.dbPath ?? config.dbPath);
  const dial = new DialService(app.log);
  const ctx: AppContext = { ledger, dial };
  (app as unknown as { ctx: AppContext }).ctx = ctx;

  await app.register(cors, { origin: config.corsOrigins, methods: ["GET", "POST", "OPTIONS"] });

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

  if (opts.logger !== false) void dial.listen();
  app.addHook("onClose", async () => {
    dial.stop();
    ledger.close();
  });
  return app as unknown as FastifyInstance & { ctx: AppContext };
}
