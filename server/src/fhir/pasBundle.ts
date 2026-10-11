// Minimal HL7 Da Vinci PAS (STU 2.1) request bundle, zod-validated.
// Profiles: profile-pas-request-bundle, profile-claim, profile-subscriber, profile-coverage,
// profile-insurer, profile-requestor, plus a DocumentReference carrying the letter.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CaseDetail } from "../domain/types.js";

const PAS = "http://hl7.org/fhir/us/davinci-pas/StructureDefinition";
const EX = "http://hl7.org/fhir/us/davinci-pas/StructureDefinition";

export const pasBundleSchema = z.object({
  resourceType: z.literal("Bundle"),
  id: z.string(),
  meta: z.object({ profile: z.array(z.string()).min(1) }),
  identifier: z.object({ system: z.string(), value: z.string() }),
  type: z.literal("collection"),
  timestamp: z.string(),
  entry: z
    .array(z.object({ fullUrl: z.string().url(), resource: z.object({ resourceType: z.string(), id: z.string() }).passthrough() }))
    .min(5)
    .refine((e) => e[0].resource.resourceType === "Claim", "Claim must be the first entry"),
});
export type PasBundle = z.infer<typeof pasBundleSchema>;

export interface BundleInput {
  c: CaseDetail;
  letterText: string;
  pdfBase64?: string | null;
  baseUrl?: string;
}

const cptSystem = (code: string) => (/^\d{5}$/.test(code) ? "http://www.ama-assn.org/go/cpt" : "http://hl7.org/fhir/sid/ndc");

export function buildPasBundle({ c, letterText, pdfBase64, baseUrl = "http://priorauth-pilot.local/fhir" }: BundleInput): PasBundle {
  const now = new Date().toISOString();
  const ids = {
    claim: `claim-${c.id}`,
    patient: `patient-${c.id}`,
    coverage: `coverage-${c.id}`,
    insurer: `insurer-${c.insurer.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    requestor: `requestor-${c.id}`,
    practitioner: `practitioner-${c.id}`,
    serviceRequest: `servicerequest-${c.id}`,
    docref: `docref-${c.id}`,
  };
  const url = (t: string, id: string) => `${baseUrl}/${t}/${id}`;
  // References are RELATIVE (ResourceType/id): the Da Vinci reference server resolves them against the bundle; absolute URLs are rejected with "Unknown resource type http:".
  const ref = (t: string, id: string) => `${t}/${id}`;
  const policyId = c.screening?.policy.id ?? "";
  const expedited = c.expedited;

  const claim = {
    resourceType: "Claim",
    id: ids.claim,
    meta: { profile: [`${PAS}/profile-claim`] },
    identifier: [{ system: "http://priorauth-pilot.local/PATIENT_EVENT_TRACE_NUMBER", value: c.id }],
    status: "active",
    type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/claim-type", code: "professional" }] },
    use: "preauthorization",
    patient: { reference: ref("Patient", ids.patient) },
    created: now,
    insurer: { reference: ref("Organization", ids.insurer) },
    provider: { reference: ref("Organization", ids.requestor) },
    priority: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/processpriority", code: expedited ? "stat" : "normal" }] },
    careTeam: [{ sequence: 1, provider: { reference: ref("Practitioner", ids.practitioner) }, role: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/claimcareteamrole", code: "primary" }] } }],
    supportingInfo: [
      {
        sequence: 1,
        category: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/claiminformationcategory", code: "attachment" }] },
        valueReference: { reference: ref("DocumentReference", ids.docref) },
      },
    ],
    insurance: [{ sequence: 1, focal: true, coverage: { reference: ref("Coverage", ids.coverage) } }],
    item: [
      {
        extension: [
          { url: `${EX}/extension-serviceItemRequestType`, valueCodeableConcept: { coding: [{ system: "https://codesystem.x12.org/005010/1525", code: "SC", display: "Specialty Care Review" }] } },
          { url: `${EX}/extension-certificationType`, valueCodeableConcept: { coding: [{ system: "https://codesystem.x12.org/005010/1322", code: "I", display: "Initial" }] } },
          { url: `${EX}/extension-requestedService`, valueReference: { reference: ref("ServiceRequest", ids.serviceRequest) } },
        ],
        sequence: 1,
        careTeamSequence: [1],
        category: { coding: [{ system: "https://codesystem.x12.org/005010/1365", code: "1", display: "Medical Care" }] },
        productOrService: { coding: [{ system: cptSystem(c.cpt), code: c.cpt, display: c.cpt_label }] },
        servicedDate: now.slice(0, 10),
        locationCodeableConcept: { coding: [{ system: "https://www.cms.gov/Medicare/Coding/place-of-service-codes/Place_of_Service_Code_Set", code: "11" }] },
      },
    ],
  };

  const entries = [
    { fullUrl: url("Claim", ids.claim), resource: claim },
    {
      fullUrl: url("Organization", ids.requestor),
      resource: {
        resourceType: "Organization",
        id: ids.requestor,
        meta: { profile: [`${PAS}/profile-requestor`] },
        identifier: [{ system: "http://hl7.org/fhir/sid/us-npi", value: c.physician.npi || "0000000000" }],
        active: true,
        name: "PriorAuth Pilot Demo Practice",
      },
    },
    {
      fullUrl: url("Organization", ids.insurer),
      resource: {
        resourceType: "Organization",
        id: ids.insurer,
        meta: { profile: [`${PAS}/profile-insurer`] },
        identifier: [{ system: "http://priorauth-pilot.local/payer-id", value: ids.insurer }],
        active: true,
        name: c.insurer,
      },
    },
    {
      fullUrl: url("Coverage", ids.coverage),
      resource: {
        resourceType: "Coverage",
        id: ids.coverage,
        meta: { profile: [`${PAS}/profile-coverage`] },
        status: "active",
        subscriberId: c.patient.member_id || "UNKNOWN",
        beneficiary: { reference: ref("Patient", ids.patient) },
        relationship: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/subscriber-relationship", code: "self" }] },
        payor: [{ reference: ref("Organization", ids.insurer) }],
      },
    },
    {
      fullUrl: url("Patient", ids.patient),
      resource: {
        resourceType: "Patient",
        id: ids.patient,
        meta: { profile: [`${PAS}/profile-subscriber`] },
        identifier: [{ system: "http://priorauth-pilot.local/member-id", value: c.patient.member_id || "UNKNOWN" }],
        name: [{ text: c.patient.name, family: c.patient.name.split(/\s+/).slice(-1)[0], given: c.patient.name.split(/\s+/).slice(0, -1) }],
        ...(c.patient.dob ? { birthDate: c.patient.dob } : {}),
        ...(c.patient.phone ? { telecom: [{ system: "phone", value: c.patient.phone }] } : {}),
      },
    },
    {
      fullUrl: url("Practitioner", ids.practitioner),
      resource: {
        resourceType: "Practitioner",
        id: ids.practitioner,
        meta: { profile: [`${PAS}/profile-practitioner`] },
        identifier: [{ system: "http://hl7.org/fhir/sid/us-npi", value: c.physician.npi || "0000000000" }],
        name: [{ text: c.physician.name }],
      },
    },
    {
      fullUrl: url("ServiceRequest", ids.serviceRequest),
      resource: {
        resourceType: "ServiceRequest",
        id: ids.serviceRequest,
        meta: { profile: [`${PAS}/profile-servicerequest`] },
        status: "active",
        intent: "order",
        priority: expedited ? "stat" : "routine",
        code: { coding: [{ system: cptSystem(c.cpt), code: c.cpt, display: c.cpt_label }] },
        subject: { reference: ref("Patient", ids.patient) },
        requester: { reference: ref("Practitioner", ids.practitioner) },
        reasonCode: [{ text: `Medical necessity per ${policyId}` }],
      },
    },
    {
      fullUrl: url("DocumentReference", ids.docref),
      resource: {
        resourceType: "DocumentReference",
        id: ids.docref,
        status: "current",
        type: { coding: [{ system: "http://loinc.org", code: "34109-9", display: "Note" }], text: "Letter of medical necessity" },
        subject: { reference: ref("Patient", ids.patient) },
        date: now,
        author: [{ reference: ref("Practitioner", ids.practitioner) }],
        description: `Letter of medical necessity for ${c.cpt_label}; criteria from ${policyId}`,
        content: [
          { attachment: { contentType: "text/plain", data: Buffer.from(letterText, "utf8").toString("base64"), title: "letter.txt" } },
          ...(pdfBase64 ? [{ attachment: { contentType: "application/pdf", data: pdfBase64, title: `${c.id}.pdf` } }] : []),
        ],
      },
    },
  ];

  const bundle = {
    resourceType: "Bundle" as const,
    id: `pas-request-${c.id}`,
    meta: { profile: [`${PAS}/profile-pas-request-bundle`] },
    identifier: { system: "http://priorauth-pilot.local/SUBMITTER_TRANSACTION_IDENTIFIER", value: randomUUID() },
    type: "collection" as const,
    timestamp: now,
    entry: entries,
  };
  return pasBundleSchema.parse(bundle);
}

/** Parse a ClaimResponse (or a Bundle containing one) into adjudication fields. */
export function parseClaimResponse(body: unknown): { adjudication: "A1" | "A2" | "A3" | "A4" | null; status: "approved" | "denied" | "pended" | "submitted"; reference: string | null; reason: string | null; raw_disposition: string | null } {
  const b = body as Record<string, any>;
  let cr: Record<string, any> | null = null;
  if (b?.resourceType === "ClaimResponse") cr = b;
  else if (b?.resourceType === "Bundle") cr = (b.entry ?? []).map((e: any) => e.resource).find((r: any) => r?.resourceType === "ClaimResponse") ?? null;
  if (!cr) return { adjudication: null, status: "submitted", reference: null, reason: null, raw_disposition: null };

  const findCode = (): string | null => {
    const exts: any[] = [];
    const walk = (o: any) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o.url && /reviewActionCode|reviewAction/.test(String(o.url))) exts.push(o);
      for (const v of Object.values(o)) walk(v);
    };
    walk(cr);
    for (const e of exts) {
      const code = e.valueCodeableConcept?.coding?.[0]?.code ?? e.extension?.find((x: any) => /code/i.test(x.url))?.valueCodeableConcept?.coding?.[0]?.code;
      if (code) return String(code);
    }
    return null;
  };
  const code = findCode();
  const disposition = cr.disposition ? String(cr.disposition) : null;
  const outcome = cr.outcome ? String(cr.outcome) : null;
  type Adj = "A1" | "A2" | "A3" | "A4";
  let adjudication: Adj | null = code && ["A1", "A2", "A3", "A4"].includes(code) ? (code as Adj) : null;
  if (!adjudication) {
    const d = (disposition ?? "").toLowerCase();
    if (/grant|approv|certified in total/.test(d) || outcome === "complete") adjudication = "A1";
    else if (/den|not certified|reject/.test(d) || outcome === "error") adjudication = "A3";
    else if (/pend|queued|partial/.test(d) || outcome === "queued" || outcome === "partial") adjudication = "A4";
  }
  const status = adjudication === "A1" || adjudication === "A2" ? "approved" : adjudication === "A3" ? "denied" : adjudication === "A4" ? "pended" : "submitted";
  const reference = cr.preAuthRef ? String(cr.preAuthRef) : cr.identifier?.[0]?.value ? String(cr.identifier[0].value) : cr.id ? String(cr.id) : null;
  const reason = cr.error?.[0]?.code?.text ?? cr.processNote?.[0]?.text ?? (status === "denied" || status === "pended" ? disposition : null);
  return { adjudication, status, reference, reason: reason ? String(reason) : null, raw_disposition: disposition };
}
