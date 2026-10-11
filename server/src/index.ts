import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";

const PORT = Number(process.env.PORT ?? 4000);

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: ["http://localhost:5173"], methods: ["GET", "POST", "OPTIONS"] });

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send({ error: { code: (err as { code?: string }).code ?? "internal", message: err.message } });
  });

  app.get("/health", async () => ({ ok: true, service: "priorauth-pilot", time: new Date().toISOString() }));
  return app;
}

if (process.argv[1] && process.argv[1].endsWith("index.ts")) {
  buildApp().then((app) => app.listen({ port: PORT, host: "0.0.0.0" })).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
