// Run read-only SQL against the Keewano project via MCP. Usage: npx tsx scripts/keewano-sql.ts "<sql>" ["<sql>" ...]
import { config as loadEnv } from "dotenv";
import { KeewanoQueryClient } from "../src/keewano/query.js";
loadEnv({ path: process.env.ENV_PATH ?? "../../backend/server/.env", quiet: true });
const q = new KeewanoQueryClient(process.env.KEEWANO_PAT ?? "", process.env.KEEWANO_PROJECT_ID || null);
for (const sql of process.argv.slice(2)) {
  try {
    const r = await q.sql(sql, 20);
    console.log("OK  ", sql.replace(/\s+/g, " ").slice(0, 160), "\n     ", JSON.stringify(r));
  } catch (e) {
    console.log("FAIL", sql.replace(/\s+/g, " ").slice(0, 160), "\n     ", String((e as Error).message).slice(0, 240));
  }
}
