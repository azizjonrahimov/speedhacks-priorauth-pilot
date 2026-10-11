import { buildApp } from "./app.js";
import { config, hasAnthropic, hasDial } from "./config.js";

buildApp()
  .then(async (app) => {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info({ anthropic: hasAnthropic(), dial: hasDial(), payer: config.payerAdapter, model: config.anthropicModel }, "priorauth-pilot up");
    if (!hasAnthropic()) app.log.warn("ANTHROPIC_API_KEY missing: /score, /packet and call parsing will return 503 llm_unavailable");
    if (!hasDial()) app.log.warn("DIAL_API_KEY / DIAL_FROM_NUMBER_ID missing: /gapfill/call will return 503 dial_unavailable; use /gapfill/manual");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
