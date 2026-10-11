// PHI hygiene for logs: masks phone numbers and any registered person names.
// Transcripts and notes are never passed to info-level logs; this is defense in depth.

const knownNames = new Set<string>();

export function registerName(name: string | undefined | null) {
  if (name && name.trim().length >= 3) knownNames.add(name.trim());
}

export function maskPhone(phone: string | undefined | null): string {
  if (!phone) return "";
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 5)}***${digits.slice(-4)}`;
}

const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g;

export function redactText(s: string): string {
  let out = s.replace(PHONE_RE, (m) => maskPhone(m));
  for (const n of knownNames) {
    if (n.length === 0) continue;
    out = out.split(n).join("[name]");
  }
  return out;
}

export function redactValue<T>(v: T): T {
  if (typeof v === "string") return redactText(v) as T;
  if (Array.isArray(v)) return v.map(redactValue) as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "note" || k === "transcript" || k === "transcriptTurns" || k === "letter_text") o[k] = "[redacted]";
      else o[k] = redactValue(val);
    }
    return o as T;
  }
  return v;
}
