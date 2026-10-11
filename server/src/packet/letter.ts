// Medical-necessity letter. Claude drafts it ONLY from verified facts + criteria; a code
// post-check rejects any quoted sentence that is not in the note/facts.
import type { CaseDetail } from "../domain/types.js";
import { completeText } from "../llm/client.js";
import { locateQuote } from "../evidence/verify.js";

const SYSTEM = `You write letters of medical necessity for prior authorization on behalf of an ordering physician. You must be scrupulously accurate:
- Use ONLY the facts provided (each has a verbatim quote). Never add symptoms, dates, durations, test results or history that are not in the facts.
- Quote the note verbatim (in quotation marks) when citing evidence; never alter a quote.
- Cite the policy by id and URL, and walk through each criterion: state whether it is met and the supporting quote. For criteria answered by phone or by staff, say so ("per telephone confirmation with the ordering physician on <date>").
- If a criterion is not met or unclear, say so plainly; do not argue around it.
- Plain professional prose, no markdown, no bullet symbols, ~350-500 words. Structure: date line, RE line (patient, DOB, member ID, requested service with code), salutation, clinical summary, criteria review, conclusion, signature block for the physician (NPI).`;

export function letterPrompt(c: CaseDetail): string {
  const today = new Date().toISOString().slice(0, 10);
  const facts = c.facts.map((f) => ({ id: f.id, kind: f.kind, label: f.label, quote: f.quote, source: f.source }));
  const criteria = c.criteria.map((k) => ({ id: k.id, text: k.text, status: k.status, evidence_quote: k.evidence_quote, evidence_source: k.evidence_source, code_check: k.verifier.deterministic_check?.detail ?? null }));
  return `TODAY: ${today}
PATIENT: ${c.patient.name}, DOB ${c.patient.dob || "unknown"}, member ID ${c.patient.member_id || "unknown"}
INSURER: ${c.insurer}
REQUESTED SERVICE: ${c.cpt_label} (${c.cpt})
ORDERING PHYSICIAN: ${c.physician.name}, NPI ${c.physician.npi || "unknown"}
POLICY: ${c.screening?.policy.id ?? ""} — ${c.screening?.policy.url ?? ""}
OVERALL (from the rules engine): ${c.overall}${c.expedited ? " (EXPEDITED: red flags documented; a decision is requested within 72 hours per CMS-0057-F)" : ""}
RED FLAGS: ${c.red_flags.length ? c.red_flags.join("; ") : "none"}

VERIFIED FACTS (JSON):
${JSON.stringify(facts, null, 1)}

CRITERIA REVIEW (JSON):
${JSON.stringify(criteria, null, 1)}

Write the letter now.`;
}

/** Template fallback when the LLM is unavailable: deterministic, facts-only. */
export function templateLetter(c: CaseDetail): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`Date: ${today}`);
  lines.push(`RE: ${c.patient.name} (DOB ${c.patient.dob || "unknown"}, Member ID ${c.patient.member_id || "unknown"})`);
  lines.push(`Requested service: ${c.cpt_label} (${c.cpt})`);
  lines.push(`Policy: ${c.screening?.policy.id ?? ""} ${c.screening?.policy.url ?? ""}`);
  lines.push("");
  lines.push(`To ${c.insurer} Utilization Management:`);
  lines.push("");
  lines.push(`I am requesting prior authorization for ${c.cpt_label} for my patient ${c.patient.name}. The clinical documentation supports medical necessity under ${c.screening?.policy.id ?? "the applicable policy"} as follows.`);
  lines.push("");
  for (const k of c.criteria) {
    const status = k.status === "met" ? "MET" : k.status === "not_applicable" ? "NOT APPLICABLE" : k.status.toUpperCase();
    lines.push(`Criterion ${k.id} — ${k.text}`);
    lines.push(`Status: ${status}.${k.evidence_quote ? ` Evidence: "${k.evidence_quote}"${k.evidence_source && k.evidence_source !== "note" ? ` (${k.evidence_source === "phone_call" ? "per telephone confirmation with the ordering physician" : "per staff-entered confirmation"})` : ""}` : ""}`);
    lines.push("");
  }
  if (c.expedited) lines.push("Red-flag findings are documented; expedited review (decision within 72 hours) is requested.");
  lines.push("Please contact my office with any questions.");
  lines.push("");
  lines.push(`Sincerely,`);
  lines.push(`${c.physician.name}`);
  lines.push(`NPI ${c.physician.npi || "unknown"}`);
  return lines.join("\n");
}

/** Every quoted passage in the letter must appear verbatim in the note or in a non-note fact. */
export function checkLetterQuotes(letter: string, c: CaseDetail): { ok: boolean; bad: string[] } {
  const bad: string[] = [];
  const re = /[“"]([^”"]{12,})[”"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(letter))) {
    const q = m[1];
    const inNote = locateQuote(c.note, q).ok;
    const inFacts = c.facts.some((f) => f.source !== "note" && (locateQuote(f.quote, q).ok || locateQuote(q, f.quote).ok));
    const inCriteria = c.criteria.some((k) => locateQuote(k.text, q).ok);
    if (!inNote && !inFacts && !inCriteria) bad.push(q);
  }
  return { ok: bad.length === 0, bad };
}

export async function generateLetter(c: CaseDetail, log?: { warn: (o: object, m: string) => void }): Promise<{ text: string; generator: "llm" | "template"; rejected_quotes: string[] }> {
  try {
    let text = await completeText(SYSTEM, letterPrompt(c), 3500);
    let check = checkLetterQuotes(text, c);
    if (!check.ok) {
      log?.warn({ bad: check.bad.length }, "letter contained unverifiable quotes; regenerating");
      text = await completeText(SYSTEM, letterPrompt(c) + `\n\nYour previous draft contained quotations that are NOT verbatim from the facts: ${JSON.stringify(check.bad.slice(0, 5))}. Rewrite the letter using only exact quotes from the facts' "quote" fields.`, 3500);
      check = checkLetterQuotes(text, c);
    }
    if (!check.ok) {
      // Last resort: strip the offending quotes rather than ship invented text.
      for (const b of check.bad) text = text.split(b).join("[quote removed by verifier]");
    }
    return { text, generator: "llm", rejected_quotes: check.bad };
  } catch (e) {
    if ((e as { code?: string }).code === "llm_unavailable") return { text: templateLetter(c), generator: "template", rejected_quotes: [] };
    throw e;
  }
}
