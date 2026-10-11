import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { listPolicies } from "../rules/engine.js";
import notesJson from "../seed/notes.json" with { type: "json" };
import type { LedgerEvent } from "../domain/types.js";

export function registerMiscRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/health", async () => ({ ok: true, service: "priorauth-pilot", time: new Date().toISOString() }));

  app.get("/policies", async () => ({
    policies: listPolicies().map((p) => ({
      insurer: p.insurer,
      cpt: p.cpt,
      label: p.label,
      policy_id: p.policy_id,
      url: p.url,
      criteria_count: p.criteria.length,
      pa_required: p.pa_required,
    })),
  }));

  app.get("/demo/notes", async () => ({ notes: notesJson.notes }));

  // Server-Sent Events: every appended ledger event, as it happens. No replay.
  app.get("/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": (req.headers.origin as string) ?? "*",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ server_time: new Date().toISOString() })}\n\n`);
    const onEvent = (ev: LedgerEvent) => {
      reply.raw.write(`event: ${ev.type}\nid: ${ev.case_id}:${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
    };
    ctx.ledger.bus.on("event", onEvent);
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 15000);
    req.raw.on("close", () => {
      clearInterval(ping);
      ctx.ledger.bus.off("event", onEvent);
    });
    // Keep the request open; fastify must not auto-send.
    reply.hijack();
  });
}
