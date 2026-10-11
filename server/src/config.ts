import "dotenv/config";

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : d;
};

export const config = {
  port: num(process.env.PORT, 4000),
  logLevel: process.env.LOG_LEVEL ?? "info",
  dbPath: process.env.DB_PATH ?? "./data/priorauth.db",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
  dialApiKey: process.env.DIAL_API_KEY ?? "",
  dialFromNumberId: process.env.DIAL_FROM_NUMBER_ID ?? "",
  physicianPhone: process.env.PHYSICIAN_PHONE ?? "",
  patientPhone: process.env.PATIENT_PHONE ?? "",
  payerAdapter: (process.env.PAYER_ADAPTER ?? "mock") as "mock" | "davinci",
  chaos: {
    p500: num(process.env.CHAOS_P500, 0.3),
    pTimeout: num(process.env.CHAOS_PTIMEOUT, 0.1),
    pPend: num(process.env.CHAOS_PPEND, 0.3),
  },
  davinciUrl: process.env.DAVINCI_URL ?? "https://prior-auth.davinci.hl7.org/fhir",
  packetsDir: process.env.PACKETS_DIR ?? "./data/packets",
  keewanoApiKey: process.env.KEEWANO_API_KEY ?? "", // project ingest key (k-token for REST ingest)
  keewanoPat: process.env.KEEWANO_PAT ?? "", // personal access token kwpat-… (k-token for MCP queries)
  keewanoProjectId: process.env.KEEWANO_PROJECT_ID ?? "",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim()),
};

export function hasAnthropic() {
  return config.anthropicApiKey.length > 0;
}
export function hasDial() {
  return config.dialApiKey.length > 0 && config.dialFromNumberId.length > 0;
}
