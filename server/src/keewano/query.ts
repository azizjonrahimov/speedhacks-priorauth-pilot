// Live Keewano queries over its MCP server (Streamable HTTP, JSON-RPC, header k-token = personal access token).
// There is no REST query endpoint; run_sql_query returns structuredContent {columns, rows}.
export const MCP_URL = "https://api.keewano.com/mcp";

export interface SqlResult {
  columns: string[];
  rows: unknown[][];
}

export type McpFetch = (body: unknown, pat: string, timeoutMs: number) => Promise<{ status: number; json: any }>;

export const fetchMcp: McpFetch = async (body, pat, timeoutMs) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "k-token": pat, "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json: any = null;
    if ((r.headers.get("content-type") ?? "").includes("event-stream")) {
      const line = text.split("\n").filter((l) => l.startsWith("data: ")).pop();
      json = line ? JSON.parse(line.slice(6)) : null;
    } else if (text) json = JSON.parse(text);
    return { status: r.status, json };
  } finally {
    clearTimeout(t);
  }
};

export class KeewanoQueryClient {
  private projectId: string | null;
  private initialized = false;
  private id = 0;

  constructor(
    private pat: string,
    projectId: string | null = null,
    private mcp: McpFetch = fetchMcp,
    private timeoutMs = 15_000,
  ) {
    this.projectId = projectId;
  }

  get enabled() {
    return this.pat.length > 0;
  }

  private async rpc(method: string, params: unknown, notify = false) {
    const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++this.id, method, params };
    const r = await this.mcp(body, this.pat, this.timeoutMs);
    if (r.status === 401 || r.status === 403) throw new Error(`Keewano MCP rejected the access token (${r.status})`);
    if (r.status >= 400) throw new Error(`Keewano MCP HTTP ${r.status}`);
    if (r.json?.error) throw new Error(`Keewano MCP error: ${String(r.json.error.message ?? "").slice(0, 160)}`);
    return r.json?.result;
  }

  private async ensureInit() {
    if (this.initialized) return;
    await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "priorauth-pilot", version: "0.1" } });
    await this.rpc("notifications/initialized", {}, true);
    this.initialized = true;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    await this.ensureInit();
    const res = await this.rpc("tools/call", { name, arguments: args });
    if (res?.isError) {
      const msg = (res.content ?? []).map((c: { text?: string }) => c.text ?? "").join(" ");
      throw new Error(msg.slice(0, 200) || `${name} failed`);
    }
    return res;
  }

  async resolveProjectId(): Promise<string> {
    if (this.projectId) return this.projectId;
    const res = await this.callTool("list_projects", {});
    const text = (res.content ?? []).map((c: { text?: string }) => c.text ?? "").join("\n");
    const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(text);
    if (!m) throw new Error("no Keewano project visible to this token");
    this.projectId = m[0];
    return this.projectId;
  }

  async sql(sqlQuery: string, maxRows = 100): Promise<SqlResult> {
    const projectId = await this.resolveProjectId();
    const res = await this.callTool("run_sql_query", { projectId, sqlQuery, maxRows });
    const sc = res.structuredContent;
    if (!sc || !Array.isArray(sc.rows)) throw new Error("run_sql_query returned no structured rows");
    return { columns: (sc.columns ?? []).map((c: { name: string }) => c.name), rows: sc.rows };
  }
}

export function rowObject(r: SqlResult, i = 0): Record<string, unknown> {
  const row = r.rows[i] ?? [];
  return Object.fromEntries(r.columns.map((c, j) => [c, row[j] ?? null]));
}
