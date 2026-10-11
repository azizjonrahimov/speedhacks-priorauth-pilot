import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppContext } from "../app.js";
import { config } from "../config.js";
import { canTransition } from "../domain/stateMachine.js";
import { AppError } from "../domain/types.js";
import { buildPasBundle } from "../fhir/pasBundle.js";
import { generateLetter } from "../packet/letter.js";
import { renderPacketPdf } from "../packet/pdf.js";

export function registerPacketRoutes(app: FastifyInstance, ctx: AppContext) {
  const { ledger } = ctx;

  app.post<{ Params: { id: string } }>("/cases/:id/packet", async (req) => {
    const c = ledger.requireCase(req.params.id);
    if (!canTransition(c.state, "packet.generated")) throw new AppError(409, "illegal_transition", `cannot generate a packet in state ${c.state} (score first)`);
    if (c.criteria.length === 0) throw new AppError(409, "illegal_transition", "score the case before generating a packet");

    const letter = await generateLetter(c, req.log);
    const pdfPath = resolve(config.packetsDir, `${c.id}.pdf`);
    let pdf_url = "";
    let pdfBase64: string | null = null;
    try {
      await renderPacketPdf(c, letter.text, pdfPath);
      const host = req.headers.host ?? `localhost:${config.port}`;
      pdf_url = `${req.protocol}://${host}/packets/${c.id}.pdf`;
      pdfBase64 = (await readFile(pdfPath)).toString("base64");
    } catch (e) {
      req.log.warn({ error: String((e as Error).message).slice(0, 200) }, "pdf render failed; packet continues without PDF");
    }
    // Keep the base64 PDF out of the stored bundle (size); the submit path re-attaches it.
    const fhir_bundle = buildPasBundle({ c, letterText: letter.text, pdfBase64: null });
    void pdfBase64;
    ledger.appendEvent(c.id, "packet.generated", { pdf_url, letter_chars: letter.text.length, bundle_entries: fhir_bundle.entry.length, generator: letter.generator, rejected_quotes: letter.rejected_quotes, letter_text: letter.text, fhir_bundle }, "llm");
    return { letter_text: letter.text, pdf_url, fhir_bundle, generator: letter.generator };
  });
}
