import { describe, expect, it } from "vitest";
import { buildPasBundle, parseClaimResponse, pasBundleSchema } from "./pasBundle.js";
import type { CaseDetail } from "../domain/types.js";

const c = {
  id: "pa_abc12345",
  cpt: "72148",
  cpt_label: "MRI lumbar spine without contrast",
  insurer: "Aetna",
  expedited: false,
  patient: { name: "Daniel Okafor", dob: "1979-03-14", member_id: "AET-1", phone: "+14155550111" },
  physician: { name: "Dr. Priya Raman", npi: "1891234567", phone: "+14155550100" },
  screening: { policy: { id: "Aetna CPB 0236", url: "https://x", insurer: "Aetna", cpt: "72148", label: "x" } },
  criteria: [],
  facts: [],
} as unknown as CaseDetail;

describe("PAS bundle", () => {
  it("builds a schema-valid collection bundle with Claim first and resolvable references", () => {
    const b = buildPasBundle({ c, letterText: "Dear payer, ..." });
    expect(pasBundleSchema.safeParse(b).success).toBe(true);
    expect(b.entry[0].resource.resourceType).toBe("Claim");
    const claim = b.entry[0].resource as Record<string, any>;
    expect(claim.use).toBe("preauthorization");
    expect(claim.item[0].productOrService.coding[0]).toMatchObject({ code: "72148", system: "http://www.ama-assn.org/go/cpt" });
    const urls = new Set(b.entry.map((e) => `${e.resource.resourceType}/${e.resource.id}`));
    const refs: string[] = [];
    const walk = (o: unknown) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(walk);
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k === "reference" && typeof v === "string") refs.push(v);
        else walk(v);
      }
    };
    walk(b);
    expect(refs.length).toBeGreaterThan(5);
    for (const r of refs) expect(urls.has(r)).toBe(true);
    const doc = b.entry.find((e) => e.resource.resourceType === "DocumentReference")!.resource as Record<string, any>;
    expect(Buffer.from(doc.content[0].attachment.data, "base64").toString()).toBe("Dear payer, ...");
  });

  it("uses NDC system and stat priority for pharmacy + expedited cases", () => {
    const b = buildPasBundle({ c: { ...c, cpt: "WEGOVY", expedited: true } as CaseDetail, letterText: "x" });
    const claim = b.entry[0].resource as Record<string, any>;
    expect(claim.item[0].productOrService.coding[0].system).toContain("ndc");
    expect(claim.priority.coding[0].code).toBe("stat");
  });

  it("parses ClaimResponse adjudication from extension codes and dispositions", () => {
    expect(parseClaimResponse({ resourceType: "ClaimResponse", id: "r1", preAuthRef: "AUTH-1", disposition: "Granted", outcome: "complete" })).toMatchObject({ adjudication: "A1", status: "approved", reference: "AUTH-1" });
    expect(parseClaimResponse({ resourceType: "ClaimResponse", id: "r2", disposition: "Pended", outcome: "queued" })).toMatchObject({ adjudication: "A4", status: "pended" });
    expect(
      parseClaimResponse({
        resourceType: "Bundle",
        entry: [{ resource: { resourceType: "ClaimResponse", id: "r3", item: [{ extension: [{ url: "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewAction", extension: [{ url: "code", valueCodeableConcept: { coding: [{ code: "A3" }] } }] }] }] } }],
      }),
    ).toMatchObject({ adjudication: "A3", status: "denied" });
    expect(parseClaimResponse({ resourceType: "OperationOutcome" }).status).toBe("submitted");
  });
});
