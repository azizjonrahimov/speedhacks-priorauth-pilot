import { describe, expect, it } from "vitest";
import { maskPhone, redactValue, registerName } from "./redact.js";

describe("redact", () => {
  it("masks phones and registered names, drops notes/transcripts", () => {
    registerName("Maria Delgado");
    expect(maskPhone("+14155550100")).toBe("+1415***0100");
    const out = redactValue({
      msg: "calling Maria Delgado at +1 (415) 555-0100 now",
      note: "secret",
      transcript: "secret",
      nested: { phone: "+14155550199" },
    });
    expect(out.msg).not.toContain("Delgado");
    expect(out.msg).not.toContain("555-0100");
    expect(out.note).toBe("[redacted]");
    expect(out.transcript).toBe("[redacted]");
    expect(out.nested.phone).toBe("+1415***0199");
  });
});
