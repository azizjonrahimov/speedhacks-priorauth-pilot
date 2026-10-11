import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CaseDetail } from "../domain/types.js";

export function renderPacketPdf(c: CaseDetail, letter: string, outPath: string): Promise<void> {
  mkdirSync(dirname(outPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 64, bottom: 64, left: 64, right: 64 }, info: { Title: `Prior authorization packet ${c.id}`, Author: "PriorAuth Pilot" } });
    const out = createWriteStream(outPath);
    out.on("finish", () => resolve());
    out.on("error", reject);
    doc.on("error", reject);
    doc.pipe(out);

    doc.font("Helvetica-Bold").fontSize(16).text("Prior Authorization Request Packet");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).fillColor("#444")
      .text(`Case ${c.id} · ${c.insurer} · ${c.cpt_label} (${c.cpt}) · Policy ${c.screening?.policy.id ?? ""}`)
      .text(`Generated ${new Date().toISOString()}${c.expedited ? " · EXPEDITED REVIEW REQUESTED (red flags documented)" : ""}`);
    doc.fillColor("#000").moveDown();

    doc.font("Helvetica-Bold").fontSize(13).text("1. Letter of medical necessity");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11).text(letter, { lineGap: 2 });

    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(13).text("2. Criteria checklist with verified evidence");
    doc.moveDown(0.5);
    for (const k of c.criteria) {
      const color = k.status === "met" ? "#1a7f37" : k.status === "not_applicable" ? "#666" : "#b35900";
      doc.font("Helvetica-Bold").fontSize(10).fillColor(color).text(`${k.status.toUpperCase()}  `, { continued: true }).fillColor("#000").font("Helvetica").text(`${k.id}: ${k.text}`);
      if (k.evidence_quote) doc.font("Helvetica-Oblique").fontSize(9.5).fillColor("#222").text(`“${k.evidence_quote}”${k.evidence_source && k.evidence_source !== "note" ? `  [${k.evidence_source}]` : ""}`, { indent: 16 });
      if (k.verifier.deterministic_check) doc.font("Helvetica").fontSize(9).fillColor("#555").text(`code check: ${k.verifier.deterministic_check.detail}`, { indent: 16 });
      doc.fillColor("#000").moveDown(0.5);
    }

    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(13).text("3. Source visit note");
    doc.moveDown(0.5);
    doc.font("Courier").fontSize(8.5).text(c.note, { lineGap: 1 });

    if (c.call && c.call.transcript.length) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(13).text("4. Telephone confirmation with ordering physician");
      doc.font("Helvetica").fontSize(9).fillColor("#555").text(`Call ${c.call.call_id} · ${c.call.placed_at} · ${c.call.duration_seconds ?? "?"} s`).fillColor("#000").moveDown(0.5);
      for (const t of c.call.transcript) doc.font(t.speaker === "physician" ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).text(`${t.speaker}: ${t.text}`);
    }

    doc.end();
  });
}
