// Anthropic structured-output wrapper: forced tool-use with a zod-derived JSON schema,
// temperature 0, one retry on schema failure. Never logs prompt contents (PHI).
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config, hasAnthropic } from "../config.js";
import { AppError } from "../domain/types.js";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!hasAnthropic()) throw new AppError(503, "llm_unavailable", "ANTHROPIC_API_KEY missing in server/.env");
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2, timeout: 120_000 });
  return client;
}

export interface StructuredCall<T> {
  toolName: string;
  description: string;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  maxTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  usage: { input_tokens: number; output_tokens: number };
  attempts: number;
  model: string;
}

export async function structured<T>(call: StructuredCall<T>, log?: { warn: (o: object, m: string) => void }): Promise<StructuredResult<T>> {
  const anthropic = getClient();
  const input_schema = sanitizeSchema(z.toJSONSchema(call.schema, { target: "draft-7" })) as Anthropic.Tool["input_schema"];

  let lastErr: unknown = null;
  let strict = true;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Claude 5.x: `temperature` is deprecated and forced tool_choice (tool/any) is rejected, so we use
      // tool_choice=auto + a hard instruction, strict schemas, and retry with a nudge if no tool call comes back.
      const res = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: call.maxTokens ?? 8000,
        system: `${call.system}\n\nOUTPUT RULE: You MUST respond by calling the tool "${call.toolName}" exactly once with input matching its schema. Do not answer in prose.`,
        tools: [{ name: call.toolName, description: call.description, input_schema, ...(strict ? { strict: true } : {}) } as Anthropic.Tool],
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        messages: [
          { role: "user", content: call.user },
          ...(attempt > 1 && lastErr
            ? [
                { role: "assistant" as const, content: `I will call the tool "${call.toolName}" now with input that matches the schema exactly.` },
                { role: "user" as const, content: `Your previous response was not acceptable: ${String((lastErr as Error).message).slice(0, 800)}. Call the tool "${call.toolName}" exactly once with corrected input.` },
              ]
            : []),
        ],
      });
      const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!block) throw new Error(`you did not call the tool (stop_reason=${res.stop_reason}); the tool call is mandatory`);
      const parsed = call.schema.safeParse(block.input);
      if (!parsed.success) throw new Error(`schema validation failed: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return { data: parsed.data, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens }, attempts: attempt, model: config.anthropicModel };
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error).message ?? err);
      // Strict mode may be rejected for exotic schema features: retry non-strict once.
      if (strict && /strict|schema|not supported|tools\.\d/i.test(msg) && (err as { status?: number }).status === 400) {
        strict = false;
        log?.warn({ tool: call.toolName }, "strict tool schema rejected; retrying without strict");
        continue;
      }
      const status = (err as { status?: number }).status;
      if (status && status !== 400 && status < 500) throw upstreamError(status, msg);
      if (status === 400) throw upstreamError(status, msg); // request-shape errors never fix themselves by retrying
      log?.warn({ tool: call.toolName, attempt, error: msg.slice(0, 300) }, "structured call failed");
      if (attempt === 3) break;
    }
  }
  const st = (lastErr as { status?: number })?.status;
  if (st && st >= 500) throw upstreamError(st, String((lastErr as Error).message));
  throw new AppError(502, "llm_failed", `LLM returned output that failed schema validation after 3 attempts (${summarize(String((lastErr as Error)?.message ?? lastErr))})`);
}

// Strict tool schemas reject validation keywords (minimum/maximum/pattern/...). zod re-validates the
// parsed input anyway, so we drop them from the schema sent to the API.
const UNSUPPORTED_KEYWORDS = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "uniqueItems", "default", "$schema", "$id"]);
export function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(k)) continue;
    out[k] = k === "properties" || k === "definitions" || k === "$defs" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, sanitizeSchema(pv)])) : sanitizeSchema(v);
  }
  return out;
}

function summarize(msg: string) {
  // keep the API's own one-line reason when present; otherwise strip JSON payloads and request ids
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(msg);
  const text = m ? m[1].replace(/\\"/g, '"') : msg.replace(/\{[\s\S]*\}/g, "").replace(/request_id[^\s]*/g, "");
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Map upstream Anthropic failures to short, demo-safe messages (never the raw JSON). */
export function upstreamError(status: number, msg: string): AppError {
  if (status === 401 || status === 403) return new AppError(503, "llm_unavailable", "LLM not configured: the ANTHROPIC_API_KEY in server/.env was rejected (401). Set a valid key and restart.");
  if (status === 404) return new AppError(503, "llm_unavailable", `LLM model "${config.anthropicModel}" not found for this key (404). Set ANTHROPIC_MODEL in server/.env.`);
  if (status === 429) return new AppError(503, "llm_failed", "LLM rate limited (429). Retry in a few seconds.");
  if (status === 529 || status >= 500) return new AppError(502, "llm_failed", `LLM provider error (${status}). Retry.`);
  return new AppError(502, "llm_failed", `LLM request failed (${status}): ${summarize(msg)}`);
}

/** Plain-text completion (used for the medical-necessity letter). */
export async function completeText(system: string, user: string, maxTokens = 3000): Promise<string> {
  const anthropic = getClient();
  let res: Anthropic.Message;
  try {
    res = await anthropic.messages.create({
      model: config.anthropicModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) throw upstreamError(status, String((err as Error).message));
    throw new AppError(502, "llm_failed", `LLM request failed: ${summarize(String((err as Error).message))}`);
  }
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
