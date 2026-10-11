// Turn a call transcript into structured answers → new facts (source: phone_call).
import type { Fact, TranscriptTurn } from "../domain/types.js";
import { structured } from "../llm/client.js";
import { parseTranscriptOutput } from "../evidence/schemas.js";
import { locateQuote } from "../evidence/verify.js";

const SYSTEM = `You are extracting the ordering physician's answers from a phone-call transcript between an AI prior-authorization assistant ("agent") and the physician ("physician").
Rules:
- For each question, decide whether the physician gave a usable answer. Only the physician's words count; the agent's confirmations do not.
- "answer": a short clinical statement of what the physician said (e.g. "Completed 8 weeks of formal physical therapy from early July to late August plus daily NSAIDs").
- "quote": a VERBATIM substring of the transcript (physician's words) supporting the answer. Never paraphrase.
- Fill value_number/unit when the answer is quantitative (weeks of therapy, BMI, age). Convert "two months" to value_number=2 unit="months". If the physician gives dates, fill date_start/date_end as ISO dates when the year is clear (assume the current year if not stated).
- If the physician says they don't know or the question was not asked, answered=false.`;

export function transcriptText(turns: TranscriptTurn[]): string {
  return turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
}

export async function parseTranscriptAnswers(
  turns: TranscriptTurn[],
  questions: { criterion_id: string; question: string }[],
  callId: string,
  nextFactIndex: number,
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
): Promise<{ answers: { criterion_id: string; answer: string; confidence: number }[]; facts: Fact[] }> {
  const text = transcriptText(turns);
  const r = await structured(
    {
      toolName: "record_answers",
      description: "Record the physician's answers to each prior-authorization question.",
      schema: parseTranscriptOutput,
      system: SYSTEM,
      user: `QUESTIONS (JSON):\n${JSON.stringify(questions, null, 1)}\n\nTRANSCRIPT:\n<transcript>\n${text}\n</transcript>\n\nToday's date: ${new Date().toISOString().slice(0, 10)}.`,
      maxTokens: 3000,
    },
    log,
  );
  const answers: { criterion_id: string; answer: string; confidence: number }[] = [];
  const facts: Fact[] = [];
  let n = nextFactIndex;
  for (const a of r.data.answers) {
    if (!a.answered || !a.answer.trim()) continue;
    answers.push({ criterion_id: a.criterion_id, answer: a.answer.trim(), confidence: a.confidence });
    // the fact's quote must be verbatim from the transcript; fall back to the physician's full answer text if not
    const m = locateQuote(text, a.quote);
    const quote = m.ok ? m.quote : a.answer.trim();
    facts.push({
      id: `f${n++}`,
      kind: a.value_number != null && (a.unit === "weeks" || a.unit === "days" || a.unit === "months" || a.unit === "years" || a.unit === "sessions") ? "therapy" : a.unit === "kg/m2" ? "bmi" : a.unit === "years_old" ? "age" : "other",
      label: `Physician answer: ${a.answer.trim().slice(0, 80)}`,
      value: a.value_number ?? null,
      quote,
      char_start: -1,
      char_end: -1,
      source: "phone_call",
      call_id: callId,
      ...(a.unit !== "none" ? { unit: a.unit } : {}),
      ...(a.date_start ? { date_start: a.date_start } : {}),
      ...(a.date_end ? { date_end: a.date_end } : {}),
      criterion_id: a.criterion_id,
    } as Fact);
  }
  return { answers, facts };
}

/** Manual (typed) answers become facts the same way, without an LLM pass. */
export function manualAnswersToFacts(answers: { criterion_id: string; answer: string }[], nextFactIndex: number): Fact[] {
  let n = nextFactIndex;
  return answers
    .filter((a) => a.answer.trim().length > 0)
    .map((a) => {
      const text = a.answer.trim();
      const weeks = /(\d+(?:\.\d+)?)\s*(week|wk)s?/i.exec(text);
      const months = /(\d+(?:\.\d+)?)\s*months?/i.exec(text);
      const bmi = /bmi\s*(?:of|is|was|=|:)?\s*(\d+(?:\.\d+)?)/i.exec(text);
      const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
      const wordWeeks = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+weeks?\b/i.exec(text);
      const wordMonths = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+months?\b/i.exec(text);
      let value: number | null = null;
      let unit: string | undefined;
      let kind: Fact["kind"] = "other";
      if (bmi) {
        value = Number(bmi[1]);
        unit = "kg/m2";
        kind = "bmi";
      } else if (weeks) {
        value = Number(weeks[1]);
        unit = "weeks";
        kind = "therapy";
      } else if (wordWeeks) {
        value = words[wordWeeks[1].toLowerCase()];
        unit = "weeks";
        kind = "therapy";
      } else if (months) {
        value = Number(months[1]);
        unit = "months";
        kind = "therapy";
      } else if (wordMonths) {
        value = words[wordMonths[1].toLowerCase()];
        unit = "months";
        kind = "therapy";
      }
      return {
        id: `f${n++}`,
        kind,
        label: `Staff-entered answer: ${text.slice(0, 80)}`,
        value,
        quote: text,
        char_start: -1,
        char_end: -1,
        source: "manual",
        ...(unit ? { unit } : {}),
        criterion_id: a.criterion_id,
      } as Fact;
    });
}
