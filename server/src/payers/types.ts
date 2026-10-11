import type { Adjudication } from "../domain/types.js";
import type { PasBundle } from "../fhir/pasBundle.js";

export interface PayerResponse {
  status: "approved" | "denied" | "pended" | "submitted";
  adjudication: Adjudication | null;
  reference: string | null;
  reason: string | null; // CMS-0057-F: a specific reason for every denial
  raw?: unknown;
}

export interface SubmitContext {
  caseId: string;
  satisfied: boolean; // rules engine: policy logic satisfied
  unresolved: string[]; // criterion ids still missing/unclear
  unresolvedTexts: string[];
  expedited: boolean;
  policyId: string;
}

export interface PayerAdapter {
  readonly name: "mock" | "davinci";
  submit(bundle: PasBundle, ctx: SubmitContext): Promise<PayerResponse>;
  inquire(reference: string, ctx: SubmitContext): Promise<PayerResponse>;
}

/** Error shape the submission layer understands. */
export class PayerError extends Error {
  kind: "http_500" | "timeout" | "error";
  status_code?: number;
  constructor(kind: PayerError["kind"], message: string, status_code?: number) {
    super(message);
    this.kind = kind;
    this.status_code = status_code;
  }
}
