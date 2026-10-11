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
  const input_schema = z.toJSONSchema(call.schema, { target: "draft-7" }) as Anthropic.Tool["input_schema"];
  delete (input_schema as Record<string, unknown>).$schema;

  let lastErr: unknown = null;
  let strict = true;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model: config.anthropicModel,
        max_tokens: call.maxTokens ?? 8000,
        temperature: 0,
        system: call.system,
        tools: [{ name: call.toolName, description: call.description, input_schema, ...(strict ? { strict: true } : {}) } as Anthropic.Tool],
        tool_choice: { type: "tool", name: call.toolName, disable_parallel_tool_use: true },
        messages: [
          { role: "user", content: call.user },
          ...(attempt > 1 && lastErr
            ? [
                { role: "assistant" as const, content: "I will call the tool again with input that matches the schema exactly." },
                { role: "user" as const, content: `Your previous tool input failed validation: ${String((lastErr as Error).message).slice(0, 800)}. Call the tool again with corrected input.` },
              ]
            : []),
        ],
      });
      const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!block) throw new Error(`no tool_use block (stop_reason=${res.stop_reason})`);
      const parsed = call.schema.safeParse(block.input);
      if (!parsed.success) throw new Error(`schema validation failed: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return { data: parsed.data, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens }, attempts: attempt, model: config.anthropicModel };
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error).message ?? err);
      // Strict mode may be rejected for exotic schema features: retry non-strict once.
      if (strict && /strict|schema/i.test(msg) && (err as { status?: number }).status === 400) {
        strict = false;
        log?.warn({ tool: call.toolName }, "strict tool schema rejected; retrying without strict");
        continue;
      }
      if ((err as { status?: number }).status && (err as { status: number }).status !== 400 && (err as { status: number }).status < 500) {
        throw new AppError(502, "llm_failed", `Anthropic error ${(err as { status: number }).status}: ${msg}`);
      }
      log?.warn({ tool: call.toolName, attempt, error: msg.slice(0, 300) }, "structured call failed");
      if (attempt === 3) break;
    }
  }
  throw new AppError(502, "llm_failed", `LLM structured output failed after retries: ${String((lastErr as Error)?.message ?? lastErr).slice(0, 300)}`);
}

/** Plain-text completion (used for the medical-necessity letter). */
export async function completeText(system: string, user: string, maxTokens = 3000): Promise<string> {
  const anthropic = getClient();
  const res = await anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens: maxTokens,
    temperature: 0,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
