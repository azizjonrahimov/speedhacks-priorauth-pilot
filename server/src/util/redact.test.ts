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

  it("survives circular and non-plain objects (pino passes raw req/res)", () => {
    const a: Record<string, unknown> = { msg: "hi" };
    a.self = a;
    a.sock = new (class Socket {
      remote = "+14155550100";
    })();
    a.err = new Error("call to +14155550100 failed");
    const out = redactValue(a) as Record<string, unknown>;
    expect(out.self).toBe("[circular]");
    expect(out.sock).toBe("[Socket]");
    expect((out.err as { message: string }).message).toBe("call to +1415***0100 failed");
  });
});
