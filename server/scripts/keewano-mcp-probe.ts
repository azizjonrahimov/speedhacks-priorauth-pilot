// Read-only probe of the Keewano MCP server: initialize + tools/list. Never prints the token.
// Usage (from ../backend-keewano/server): npx tsx scripts/keewano-mcp-probe.ts [path-to-.env]
import { config as loadEnv } from "dotenv";

loadEnv({ path: process.argv[2] ?? "../../backend/server/.env" });
const PAT = process.env.KEEWANO_PAT ?? "";
const URL = "https://api.keewano.com/mcp";
if (!PAT) {
  console.log("KEEWANO_PAT missing");
  process.exit(1);
}
console.log("PAT shape:", { prefix: PAT.slice(0, 6), length: PAT.length });

let sessionId: string | null = null;
let id = 0;
async function rpc(method: string, params: unknown = {}, notify = false) {
  const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params };
  const r = await fetch(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "k-token": PAT,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });
  sessionId = r.headers.get("mcp-session-id") ?? sessionId;
  const text = await r.text();
  const ct = r.headers.get("content-type") ?? "";
  let json: any = null;
  if (ct.includes("text/event-stream")) {
    const line = text.split("\n").filter((l) => l.startsWith("data: ")).pop();
    json = line ? JSON.parse(line.slice(6)) : null;
  } else if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 300) };
    }
  }
  return { status: r.status, ct, json };
}

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "priorauth-pilot", version: "0.1" } });
console.log("initialize:", init.status, init.ct, JSON.stringify(init.json?.result?.serverInfo ?? init.json?.error ?? init.json).slice(0, 300));
if (init.status >= 400) process.exit(1);
await rpc("notifications/initialized", {}, true);
const tools = await rpc("tools/list");
console.log("tools/list:", tools.status);
for (const t of tools.json?.result?.tools ?? []) {
  console.log(`\n- ${t.name}: ${String(t.description ?? "").replace(/\s+/g, " ").slice(0, 220)}`);
  console.log(`  input: ${JSON.stringify(t.inputSchema?.properties ?? {}).slice(0, 600)}  required=${JSON.stringify(t.inputSchema?.required ?? [])}`);
}
if (!tools.json?.result) console.log(JSON.stringify(tools.json).slice(0, 500));

const text = (r: any) => (r.json?.result?.content ?? []).map((c: any) => c.text ?? "").join("\n");
const projects = await rpc("tools/call", { name: "list_projects", arguments: {} });
console.log("\n=== list_projects:", projects.status, text(projects).slice(0, 800));
const pid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(text(projects))?.[0];
if (pid) {
  const et = await rpc("tools/call", { name: "list_event_types", arguments: { projectId: pid } });
  console.log("\n=== list_event_types:", et.status, text(et).slice(0, 1500));
  const g = await rpc("tools/call", { name: "get_tool_guide", arguments: { tool: "run_sql_query" } });
  console.log("\n=== sql guide (toc):", text(g).slice(0, 3000));
  const q = await rpc("tools/call", { name: "run_sql_query", arguments: { projectId: pid, sqlQuery: "SELECT count(DISTINCT user_id) AS users FROM events", maxRows: 5 } });
  console.log("\n=== sample sql:", q.status, text(q).slice(0, 500));
}
