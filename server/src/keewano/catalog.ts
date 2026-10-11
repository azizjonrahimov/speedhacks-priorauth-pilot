// Ledger event → Keewano custom event. Only categories and numbers; never PHI (names, phones,
// note text, quotes, transcripts, letters). IDs 2000+ per Keewano's custom-event rules.
import { createHash } from "node:crypto";
import type { LedgerEvent } from "../domain/types.js";

export type KeewanoType = "none" | "string" | "uint" | "bool" | "price_usd_cent" | "timestamp";
export interface CustomEventType {
  eventTypeId: number;
  name: string;
  dataType: KeewanoType;
}
export interface KeewanoEvent {
  eventTypeId: number;
  dataType: KeewanoType;
  timestamp: number; // unix seconds
  data: string | number | boolean | null;
}

// Names become SQL columns (quoted). Prefixed "PA " so they never collide with built-ins.
export const CATALOG: CustomEventType[] = [
  { eventTypeId: 2000, name: "PA Case Policy", dataType: "string" },
  { eventTypeId: 2001, name: "PA Case Expedited", dataType: "bool" },
  { eventTypeId: 2002, name: "PA Score Overall", dataType: "string" },
  { eventTypeId: 2003, name: "PA Quote Rejected", dataType: "string" },
  { eventTypeId: 2004, name: "PA Gap Opened", dataType: "string" },
  { eventTypeId: 2005, name: "PA Call Placed", dataType: "uint" },
  { eventTypeId: 2006, name: "PA Call Duration Seconds", dataType: "uint" },
  { eventTypeId: 2007, name: "PA Call Failed", dataType: "string" },
  { eventTypeId: 2008, name: "PA Call Answers", dataType: "uint" },
  { eventTypeId: 2009, name: "PA Gap Unresolved", dataType: "uint" },
  { eventTypeId: 2010, name: "PA Gap Manual", dataType: "uint" },
  { eventTypeId: 2011, name: "PA Rescore Overall", dataType: "string" },
  { eventTypeId: 2012, name: "PA Packet Generated", dataType: "string" },
  { eventTypeId: 2013, name: "PA Payer Attempt Failed", dataType: "string" },
  { eventTypeId: 2014, name: "PA Payer Decision", dataType: "string" },
  { eventTypeId: 2015, name: "PA Patient Notified", dataType: "string" },
  { eventTypeId: 2016, name: "PA Review Seconds", dataType: "uint" },
  // "live" for real cases, "synthetic" for backfilled history; lets every query separate the two.
  { eventTypeId: 2017, name: "PA Data Origin", dataType: "string" },
];

const byId = new Map(CATALOG.map((c) => [c.eventTypeId, c]));

// CRC32 (IEEE) of the JSON of the list sorted by id; must be nonzero.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(s: string): number {
  let c = 0xffffffff;
  for (const b of Buffer.from(s, "utf8")) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function catalogHash(list: CustomEventType[] = CATALOG): number {
  const sorted = [...list].sort((a, b) => a.eventTypeId - b.eventTypeId);
  return crc32(JSON.stringify(sorted)) || 1;
}

/** Deterministic UUIDv5 (DNS-style namespace of our own) from a case id: same case → same entity. */
const NS = Buffer.from("6f1c2a9e4b7d4e21a3c58d0f9b2e7a41", "hex");
export function caseUuid(caseId: string): string {
  const h = createHash("sha1").update(NS).update(caseId).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const s = (v: unknown, max = 64) => String(v ?? "").slice(0, max);
const u = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 4294967295) : null;
};

/** Map one ledger event to zero or more Keewano events. Pure; PHI never leaves. */
export function mapLedgerEvent(ev: LedgerEvent): KeewanoEvent[] {
  const p = ev.payload as Record<string, unknown>;
  const ts = Math.floor(Date.parse(ev.at) / 1000);
  const mk = (id: number, data: KeewanoEvent["data"]): KeewanoEvent | null => {
    const t = byId.get(id)!;
    if (data === null && t.dataType !== "none") return null;
    return { eventTypeId: id, dataType: t.dataType, timestamp: ts, data };
  };
  const out: (KeewanoEvent | null)[] = [];
  switch (ev.type) {
    case "case.created":
      out.push(mk(2017, "live"));
      out.push(mk(2000, s(`${p.insurer ?? ""} ${p.cpt ?? ""}`.trim())));
      break;
    case "screening.completed":
      out.push(mk(2001, Boolean(p.expedited)));
      break;
    case "evidence.scored":
      out.push(mk(2002, s(p.overall)));
      break;
    case "evidence.quote_rejected":
      out.push(mk(2003, s(p.criterion_id)));
      break;
    case "gap.question_generated":
      out.push(mk(2004, s(p.criterion_id)));
      break;
    case "call.placed":
      out.push(mk(2005, u(p.attempt)));
      break;
    case "call.ended":
      out.push(mk(2006, u(p.duration_seconds)));
      break;
    case "call.failed":
      out.push(mk(2007, s(p.reason)));
      break;
    case "call.parsed":
      out.push(mk(2008, u(p.answers_count)));
      break;
    case "gap.unresolved":
      out.push(mk(2009, u((p.criterion_ids as unknown[] | undefined)?.length ?? 0)));
      break;
    case "gap.manual_answered":
      out.push(mk(2010, u((p.criterion_ids as unknown[] | undefined)?.length ?? 0)));
      break;
    case "evidence.rescored":
      out.push(mk(2011, s(p.overall)));
      break;
    case "packet.generated":
      out.push(mk(2012, s(p.generator ?? "llm")));
      break;
    case "payer.attempt_failed":
      out.push(mk(2013, s(p.outcome)));
      break;
    case "payer.responded":
      out.push(mk(2014, s(p.adjudication ?? p.status)));
      break;
    case "patient.notified":
      out.push(mk(2015, s(p.channel)));
      break;
    case "review.completed":
      out.push(mk(2016, u(p.review_seconds)));
      break;
    default:
      break;
  }
  return out.filter((e): e is KeewanoEvent => e !== null);
}
