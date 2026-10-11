// Patient notification on approval. Real SMS only works Dial-number → Dial-number
// (US 10DLC blocks SMS to arbitrary phones), so PATIENT_PHONE must be a second Dial number;
// otherwise we log a simulated notification and say so in the demo.
import type { AppContext } from "../app.js";
import { config } from "../config.js";
import type { CaseDetail } from "../domain/types.js";
import { maskPhone } from "../util/redact.js";

export function notificationBody(c: CaseDetail): string {
  const first = c.patient.name.split(/\s+/)[0];
  const ref = c.payer?.reference ? ` Reference ${c.payer.reference}.` : "";
  return `Hi ${first}, good news from ${c.physician.name}'s office: ${c.insurer} has approved your ${c.cpt_label}.${ref} Scheduling will call you within 1 business day. Reply STOP to opt out.`;
}

export async function notifyPatientApproved(ctx: AppContext, c: CaseDetail, log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
  const { ledger, dial } = ctx;
  const to = config.patientPhone;
  const body = notificationBody(c);
  if (to && dial.available) {
    try {
      const m = await dial.sendSms(to, body);
      ledger.appendEvent(c.id, "patient.notified", { channel: "sms", to_masked: maskPhone(to), message_id: m.id, delivery_state: m.state, body }, "dial");
      log.info({ case_id: c.id, to: maskPhone(to), message_id: m.id }, "patient SMS sent");
      return;
    } catch (e) {
      log.warn({ case_id: c.id, error: String((e as Error).message).slice(0, 200) }, "patient SMS failed; falling back to simulated");
    }
  }
  ledger.appendEvent(c.id, "patient.notified", { channel: "simulated", to_masked: maskPhone(c.patient.phone), message_id: null, body, note: to ? "Dial SMS failed" : "PATIENT_PHONE not set (needs a second Dial number; US 10DLC blocks SMS to real phones)" }, "system");
}

/** Wire inbound SMS (patient replies) from the Dial stream to patient.replied events. */
export function wireInboundMessages(ctx: AppContext, log: { info: (o: object, m: string) => void }) {
  ctx.dial.events.on("message.received", (ev: { data: { from?: string; body?: string } }) => {
    const from = ev.data?.from ?? "";
    const body = ev.data?.body ?? "";
    // Attribute the reply to the most recent case that was notified by SMS.
    const target = ctx.ledger.allCases().find((c) => c.notification?.channel === "sms" && (!config.patientPhone || from === config.patientPhone));
    if (!target) return;
    ctx.ledger.appendEvent(target.id, "patient.replied", { body, from_masked: maskPhone(from) }, "dial");
    log.info({ case_id: target.id, from: maskPhone(from) }, "patient replied");
  });
}
