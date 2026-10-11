import { describe, expect, it } from "vitest";
import { evaluate, findPolicy, listPolicies, scanRedFlags } from "./engine.js";
import notes from "../seed/notes.json" with { type: "json" };

describe("rules engine", () => {
  it("has six policies with real policy ids and urls", () => {
    const ps = listPolicies();
    expect(ps).toHaveLength(6);
    for (const p of ps) {
      expect(p.url).toMatch(/^https:\/\//);
      expect(p.criteria.length).toBeGreaterThanOrEqual(3);
      const ids = new Set(p.criteria.map((c) => c.id));
      expect(ids.size).toBe(p.criteria.length);
    }
    expect(findPolicy("aetna", "72148")?.policy_id).toBe("Aetna CPB 0236");
    expect(findPolicy("BCBS SC", "74177")?.policy_id).toBe("BCBS SC CAM 717");
    expect(findPolicy("Aetna", "99999")).toBeNull();
  });

  it("every demo note maps to a policy", () => {
    for (const n of notes.notes) expect(findPolicy(n.insurer, n.cpt)).not.toBeNull();
  });

  it("scans red flags with negation handling", () => {
    const p = findPolicy("Aetna", "72148")!;
    expect(scanRedFlags(notes.notes[1].text, p)).toEqual(expect.arrayContaining(["saddle anesthesia", "urinary retention", "cauda equina"]));
    // note 1 explicitly DENIES saddle anesthesia / fever / cancer → no red flags
    expect(scanRedFlags(notes.notes[0].text, p)).toEqual([]);
  });

  it("evaluates group logic deterministically", () => {
    const mk = (id: string, group: "all_of" | "any_of" | "red_flag_any_of", status: "met" | "missing" | "unclear" | "not_applicable") => ({ id, group, status, text: id });
    expect(evaluate([mk("a", "all_of", "met"), mk("b", "all_of", "met")]).overall).toBe("ready");
    expect(evaluate([mk("a", "all_of", "met"), mk("b", "all_of", "missing")])).toMatchObject({ overall: "needs_info", unresolved: ["b"] });
    expect(evaluate([mk("a", "all_of", "met"), mk("b", "all_of", "not_applicable")]).overall).toBe("ready");
    expect(evaluate([mk("a", "all_of", "met"), mk("x", "any_of", "missing"), mk("y", "any_of", "met")]).overall).toBe("ready");
    expect(evaluate([mk("a", "all_of", "met"), mk("x", "any_of", "missing"), mk("y", "any_of", "unclear")])).toMatchObject({ overall: "needs_info", unresolved: ["x", "y"] });
    expect(evaluate([mk("a", "all_of", "missing"), mk("r", "red_flag_any_of", "met")])).toMatchObject({ overall: "expedite", satisfied: true });
    expect(evaluate([mk("a", "all_of", "missing")], false).overall).toBe("not_required");
  });
});
