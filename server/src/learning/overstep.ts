// Detect the voice agent asserting it will document things (the 14:27 live-call failure mode).
// Deterministic, so it does not depend on the LLM parser noticing.
import type { TranscriptTurn } from "../domain/types.js";

const COMMIT_RE = /\b(i'?ll|i will|i'm going to|let me|we'?ll)\s+(document|note|record|put down|mark|add)\b/i;

export interface Overstep {
  detected: boolean;
  turns: number[]; // indexes of offending agent turns (the text itself stays in the ledger, never in lessons)
}

export function detectOverstep(turns: TranscriptTurn[], parserAnswers: { answer: string }[] = []): Overstep {
  const idx = turns.map((t, i) => (t.speaker === "agent" && COMMIT_RE.test(t.text) ? i : -1)).filter((i) => i >= 0);
  const parserFlag = parserAnswers.some((a) => /agent (assumed|stated|added)|did not confirm|not confirmed by the physician/i.test(a.answer));
  return { detected: idx.length > 0 || parserFlag, turns: idx };
}
