// Deterministic synthetic PA history for Keewano, so live medians aren't based on one or two cases.
// Every synthetic case carries "PA Data Origin" = "synthetic" as its FIRST event, and its id starts with "synthetic_".
import { listPolicies } from "../rules/engine.js";
import { caseUuid, type KeewanoEvent } from "./catalog.js";

export interface SyntheticCase {
  case_id: string;
  installId: string;
  events: KeewanoEvent[];
  summary: { policy: string; overall: string; called: boolean; review_seconds: number; decision: string };
}

// mulberry32: tiny seeded PRNG so the same seed always yields the same history
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build n synthetic cases spread over the `days` before `anchor` (business hours, PT-ish).
 * Shape: ~55% ready, ~35% needs_info (70% of those resolved by a call, the rest manually), ~10% expedite.
 * Review time with the copilot: lognormal-ish around 5 min (3–11 min).
 */
export function buildSyntheticCases(n = 40, seed = 20261011, anchor = Date.parse("2026-10-11T00:00:00Z"), days = 21): SyntheticCase[] {
  const r = rng(seed);
  const policies = listPolicies();
  const out: SyntheticCase[] = [];
  for (let i = 0; i < n; i++) {
    const pol = policies[Math.floor(r() * policies.length)];
    const dayOffset = Math.floor(r() * days) + 1;
    const start = Math.floor((anchor - dayOffset * 86400_000 + (16 + r() * 8) * 3600_000) / 1000); // 16:00–24:00 UTC ≈ 9am–5pm PT
    let t = start;
    const ev: KeewanoEvent[] = [];
    const push = (eventTypeId: number, dataType: KeewanoEvent["dataType"], data: KeewanoEvent["data"], dt = 1) => {
      t += dt;
      ev.push({ eventTypeId, dataType, timestamp: t, data });
    };
    const roll = r();
    const overall = roll < 0.55 ? "ready" : roll < 0.9 ? "needs_info" : "expedite";
    push(2017, "string", "synthetic", 0);
    push(2000, "string", `${pol.insurer} ${pol.cpt}`);
    push(2001, "bool", overall === "expedite");
    push(2002, "string", overall, 15 + Math.floor(r() * 10));
    let called = false;
    if (overall === "needs_info") {
      const crit = pol.criteria.find((c) => c.group !== "red_flag_any_of")?.id ?? "unknown";
      push(2004, "string", crit);
      if (r() < 0.7) {
        called = true;
        push(2005, "uint", 1, 10);
        const noAnswer = r() < 0.2;
        if (noAnswer) {
          push(2007, "string", "no-answer", 30);
          push(2005, "uint", 2, 60);
        }
        push(2006, "uint", 45 + Math.floor(r() * 110), 60);
        push(2008, "uint", 1, 6);
      } else {
        push(2010, "uint", 1, 120 + Math.floor(r() * 120));
      }
      push(2011, "string", "ready", 8);
    }
    push(2012, "string", "llm", 20);
    // chaos: ~30% of submissions see one payer 500 before succeeding
    if (r() < 0.3) push(2013, "string", "http_500", 2);
    const d = r();
    const decision = overall === "expedite" || d < 0.82 ? "A1" : d < 0.95 ? "A4" : "A3";
    push(2014, "string", decision, 2);
    if (decision === "A1") push(2015, "string", "simulated", 1);
    const review_seconds = Math.round(Math.min(660, Math.max(180, 300 * Math.exp((r() - 0.5) * 0.9))));
    push(2016, "uint", review_seconds, review_seconds);
    const case_id = `synthetic_${String(i + 1).padStart(3, "0")}`;
    out.push({ case_id, installId: caseUuid(case_id), events: ev, summary: { policy: `${pol.insurer} ${pol.cpt}`, overall, called, review_seconds, decision } });
  }
  return out;
}

export function summarize(cases: SyntheticCase[]) {
  const reviews = cases.map((c) => c.summary.review_seconds).sort((a, b) => a - b);
  const median = reviews.length ? (reviews[Math.floor((reviews.length - 1) / 2)] + reviews[Math.ceil((reviews.length - 1) / 2)]) / 2 : null;
  const scored = cases.length;
  const withCall = cases.filter((c) => c.summary.called).length;
  return { cases: scored, events: cases.reduce((s, c) => s + c.events.length, 0), median_review_seconds: median, cases_with_call: withCall, call_share: scored ? Math.round((withCall / scored) * 1000) / 1000 : null };
}
