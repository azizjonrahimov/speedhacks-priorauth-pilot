import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import notes from "../seed/notes.json" with { type: "json" };

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp({ dbPath: ":memory:", logger: false });
});
afterAll(async () => {
  await app.close();
});

describe("routes: policies, notes, cases, screen", () => {
  it("serves policies and demo notes", async () => {
    const p = await app.inject({ method: "GET", url: "/policies" });
    expect(p.statusCode).toBe(200);
    expect(p.json().policies).toHaveLength(6);
    const n = await app.inject({ method: "GET", url: "/demo/notes" });
    expect(n.json().notes).toHaveLength(6);
    expect(n.json().notes[2].expect).toBe("gap");
  });

  it("creates, lists, fetches and screens a case; masks phones", async () => {
    const note = notes.notes[1]; // red-flag lumbar note
    const r = await app.inject({
      method: "POST",
      url: "/cases",
      payload: { note: note.text, cpt: note.cpt, insurer: note.insurer, patient: note.patient, physician: note.physician },
    });
    expect(r.statusCode).toBe(201);
    const c = r.json().case;
    expect(c.state).toBe("intake");
    expect(c.cpt_label).toMatch(/lumbar/i);
    expect(c.patient.phone).toBe("+1415***0112");
    expect(c.note).toBe(note.text);

    const list = await app.inject({ method: "GET", url: "/cases" });
    expect(list.json().cases[0].id).toBe(c.id);

    const s = await app.inject({ method: "POST", url: `/cases/${c.id}/screen` });
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({ pa_required: true, expedited: true, policy: { id: "Aetna CPB 0236" } });
    expect(s.json().red_flags).toContain("saddle anesthesia");

    const d = await app.inject({ method: "GET", url: `/cases/${c.id}` });
    expect(d.json().case).toMatchObject({ state: "screened", expedited: true });
    expect(d.json().case.timeline.map((e: { type: string }) => e.type)).toEqual(["case.created", "screening.completed"]);

    const ev = await app.inject({ method: "GET", url: `/cases/${c.id}/events` });
    expect(ev.json().events).toHaveLength(2);
    expect(ev.json().events[1]).toMatchObject({ seq: 2, type: "screening.completed", state: "screened", case_id: c.id });
  });

  it("returns contract-shaped errors", async () => {
    const r = await app.inject({ method: "POST", url: "/cases", payload: { note: "short" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("bad_request");
    const nf = await app.inject({ method: "GET", url: "/cases/pa_nope" });
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error.code).toBe("not_found");
  });

  it("screens unknown insurer/cpt as not required", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/cases",
      payload: { note: "A long enough note for a procedure nobody has a policy for.", cpt: "99213", insurer: "Humana", patient: { name: "X Y" }, physician: { name: "Dr Z" } },
    });
    const s = await app.inject({ method: "POST", url: `/cases/${r.json().case.id}/screen` });
    expect(s.json()).toMatchObject({ pa_required: false, policy: { id: "NONE" } });
    const d = await app.inject({ method: "GET", url: `/cases/${r.json().case.id}` });
    expect(d.json().case.overall).toBe("not_required");
  });
});
