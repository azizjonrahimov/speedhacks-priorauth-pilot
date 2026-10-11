import { describe, expect, it } from "vitest";
import { buildCallScript } from "./script.js";
import type { CaseDetail } from "../domain/types.js";

const c = {
  patient: { name: "Marcus Lindqvist", dob: "", member_id: "", phone: "" },
  physician: { name: "Dr. Priya Raman", npi: "", phone: "" },
  cpt_label: "MRI knee without contrast",
  insurer: "Aetna",
  screening: { policy: { id: "Aetna CPB 0171" } },
} as unknown as CaseDetail;

describe("buildCallScript", () => {
  it("includes greeting, patient, procedure, every open question, confirmation and goodbye", () => {
    const s = buildCallScript(c, [
      { criterion_id: "a", question: "How many weeks of therapy?", status: "open", answer: null, answered_via: null },
      { criterion_id: "b", question: "Were x-rays done?", status: "answered", answer: "yes", answered_via: "manual" },
      { criterion_id: "d", question: "Any locking?", status: "unresolved", answer: null, answered_via: null },
    ]);
    expect(s.questions.map((q) => q.criterion_id)).toEqual(["a", "d"]);
    expect(s.instruction).toContain("Dr. Priya Raman");
    expect(s.instruction).toContain("Marcus Lindqvist");
    expect(s.instruction).toContain("MRI knee without contrast");
    expect(s.instruction).toContain("1. How many weeks of therapy?");
    expect(s.instruction).toContain("2. Any locking?");
    expect(s.instruction).not.toContain("Were x-rays done");
    expect(s.instruction).toMatch(/confirm what you heard/);
    expect(s.instruction).toMatch(/Thank you, that's everything/);
    expect(s.instruction).toMatch(/voicemail/);
  });
});
