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

const SENSITIVE_KEYS = new Set(["note", "transcript", "transcriptTurns", "letter_text", "outboundInstruction"]);

function isPlain(o: object) {
  const p = Object.getPrototypeOf(o);
  return p === null || p === Object.prototype;
}

/** Deep-redact a log object. Cycle-safe, depth-limited, and skips non-plain objects (sockets, streams, errors). */
export function redactValue<T>(v: T, depth = 0, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof v === "string") return redactText(v) as T;
  if (!v || typeof v !== "object") return v;
  if (seen.has(v as object)) return "[circular]" as T;
  if (depth > 6) return "[deep]" as T;
  if (v instanceof Error) return { message: redactText(v.message), name: v.name } as T;
  if (Array.isArray(v)) {
    seen.add(v);
    return v.slice(0, 200).map((x) => redactValue(x, depth + 1, seen)) as T;
  }
  if (!isPlain(v as object)) return `[${(v as object).constructor?.name ?? "object"}]` as T;
  seen.add(v as object);
  const o: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    o[k] = SENSITIVE_KEYS.has(k) ? "[redacted]" : redactValue(val, depth + 1, seen);
  }
  return o as T;
}
