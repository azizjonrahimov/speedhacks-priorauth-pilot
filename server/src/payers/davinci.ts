// HL7 Da Vinci PAS reference server adapter: POST Bundle to Claim/$submit, parse ClaimResponse.
import { config } from "../config.js";
import { parseClaimResponse, type PasBundle } from "../fhir/pasBundle.js";
import { PayerError, type PayerAdapter, type PayerResponse, type SubmitContext } from "./types.js";

export class DaVinciPasAdapter implements PayerAdapter {
  readonly name = "davinci" as const;
  constructor(
    private baseUrl = config.davinciUrl,
    private timeoutMs = 15_000,
  ) {}

  private async post(path: string, body: unknown): Promise<{ status: number; json: unknown; text: string }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const r = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/fhir+json", accept: "application/fhir+json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await r.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
      return { status: r.status, json, text };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new PayerError("timeout", `davinci: timeout after ${this.timeoutMs} ms`);
      throw new PayerError("error", `davinci: ${String((e as Error).message).slice(0, 200)}`);
    } finally {
      clearTimeout(t);
    }
  }

  async submit(bundle: PasBundle, _ctx: SubmitContext): Promise<PayerResponse> {
    const r = await this.post("/Claim/$submit", bundle);
    if (r.status >= 500) throw new PayerError("http_500", `davinci: HTTP ${r.status} ${r.text.slice(0, 200)}`, r.status);
    if (r.status >= 400) {
      // 4xx is not retryable: surface the OperationOutcome as a denial-style response so the UI shows the real error
      const oo = r.json as { issue?: { diagnostics?: string; details?: { text?: string } }[] } | null;
      const diag = oo?.issue?.map((i) => i.diagnostics ?? i.details?.text).filter(Boolean).join("; ") ?? r.text.slice(0, 300);
      throw new PayerError("error", `davinci rejected the bundle (HTTP ${r.status}): ${diag}`, r.status);
    }
    const parsed = parseClaimResponse(r.json);
    return { ...parsed, raw: r.json };
  }

  async inquire(reference: string, _ctx: SubmitContext): Promise<PayerResponse> {
    const r = await this.post("/Claim/$inquire", {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Claim", id: `inq-${reference}`, status: "active", use: "preauthorization", identifier: [{ value: reference }] } }],
    });
    if (r.status >= 500) throw new PayerError("http_500", `davinci inquire: HTTP ${r.status}`, r.status);
    if (r.status >= 400) return { status: "submitted", adjudication: null, reference, reason: `inquire not supported (HTTP ${r.status})` };
    return { ...parseClaimResponse(r.json), raw: r.json };
  }
}
