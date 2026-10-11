// Fetch sections of the Keewano SQL guide over MCP (read-only). Usage: npx tsx scripts/keewano-guide.ts <section,...>
import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../backend/server/.env", quiet: true });
const PAT = process.env.KEEWANO_PAT ?? "";
let sid: string | null = null;
let id = 0;
async function rpc(method: string, params: unknown = {}, notify = false) {
  const r = await fetch("https://api.keewano.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "k-token": PAT, ...(sid ? { "mcp-session-id": sid } : {}), "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params }),
  });
  sid = r.headers.get("mcp-session-id") ?? sid;
  const t = await r.text();
  if (!t) return null;
  if ((r.headers.get("content-type") ?? "").includes("event-stream")) return JSON.parse(t.split("\n").filter((l) => l.startsWith("data: ")).pop()!.slice(6));
  return JSON.parse(t);
}
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pa", version: "0" } });
await rpc("notifications/initialized", {}, true);
const sections = (process.argv[2] ?? "the-mental-model").split(",");
const g = await rpc("tools/call", { name: "get_tool_guide", arguments: { tool: process.argv[3] ?? "run_sql_query", sections } });
console.log((g?.result?.content ?? []).map((c: any) => c.text).join("\n"));
