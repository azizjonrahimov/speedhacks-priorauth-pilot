// Diagnoses what the configured ANTHROPIC_API_KEY / model support. Prints statuses and error text only.
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
const clean = (e: unknown) => String((e as Error).message).replace(/sk-ant-[A-Za-z0-9_-]+/g, "[key]").replace(/request_id[^}]*/g, "").slice(0, 220);
const tool = { name: "t", description: "record", input_schema: { type: "object", properties: { x: { type: "string" } }, required: ["x"], additionalProperties: false } } as const;

async function tryCase(label: string, fn: () => Promise<unknown>) {
  try {
    const r = (await fn()) as Anthropic.Message;
    console.log(`OK   ${label}: stop=${r.stop_reason} blocks=${r.content.map((b) => b.type).join(",")}`);
  } catch (e) {
    console.log(`FAIL ${label}: ${(e as { status?: number }).status ?? "?"} ${clean(e)}`);
  }
}

try {
  const models = await client.models.list({ limit: 50 });
  console.log("models:", models.data.map((m) => m.id).join(", "));
} catch (e) {
  console.log("models list FAIL:", (e as { status?: number }).status, clean(e));
}
console.log("model under test:", model);
await tryCase("plain + temperature 0", () => client.messages.create({ model, max_tokens: 20, temperature: 0, system: "Reply with one word.", messages: [{ role: "user", content: "hi" }] }));
await tryCase("plain, no temperature", () => client.messages.create({ model, max_tokens: 20, system: "Reply with one word.", messages: [{ role: "user", content: "hi" }] }));
await tryCase("tools + tool_choice auto", () => client.messages.create({ model, max_tokens: 100, tools: [tool], tool_choice: { type: "auto" }, messages: [{ role: "user", content: "Call tool t with x='a'." }] }));
await tryCase("tools + tool_choice tool", () => client.messages.create({ model, max_tokens: 100, tools: [tool], tool_choice: { type: "tool", name: "t" }, messages: [{ role: "user", content: "x is a" }] }));
await tryCase("tools + tool_choice any", () => client.messages.create({ model, max_tokens: 100, tools: [tool], tool_choice: { type: "any" }, messages: [{ role: "user", content: "x is a" }] }));
await tryCase("tools strict + auto", () => client.messages.create({ model, max_tokens: 100, tools: [{ ...tool, strict: true } as never], tool_choice: { type: "auto" }, messages: [{ role: "user", content: "Call tool t with x='a'." }] }));
for (const m of ["claude-opus-5-5", "claude-haiku-5-5", "claude-sonnet-5"]) {
  await tryCase(`${m} tool_choice tool`, () => client.messages.create({ model: m, max_tokens: 50, tools: [tool], tool_choice: { type: "tool", name: "t" }, messages: [{ role: "user", content: "x is a" }] }));
}
