import { HttpError } from '@/api/client'
import type { CreateCaseBody } from '@/api/types'
import { DEMO_NOTES, POLICIES } from './policies'
import * as store from './store'

const latency = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 220))

function parse(init?: RequestInit): unknown {
  if (!init?.body) return undefined
  try {
    return JSON.parse(String(init.body))
  } catch {
    return undefined
  }
}

export async function mockFetch<T>(path: string, init?: RequestInit): Promise<T> {
  await store.ready
  await latency()
  const method = (init?.method ?? 'GET').toUpperCase()
  const url = new URL(path, 'http://mock.local')
  const parts = url.pathname.split('/').filter(Boolean)
  try {
    // Clone like a real JSON round-trip would, so react-query sees new references after in-place store mutations.
    return structuredClone(await route(method, parts, parse(init))) as T
  } catch (e) {
    if (e instanceof store.MockHttpError) throw new HttpError(e.status, e.message, e.code)
    throw e
  }
}

async function route(method: string, parts: string[], body: unknown): Promise<unknown> {
  const [root, id, action, sub] = parts
  if (method === 'GET') {
    if (root === 'health') return { ok: true }
    if (root === 'metrics') return store.metrics()
    if (root === 'policies')
      return { policies: POLICIES.map(({ criteria: _c, ...p }) => p) }
    if (root === 'demo' && id === 'notes') return { notes: DEMO_NOTES }
    if (root === 'cases' && !id) return { cases: store.listCases() }
    if (root === 'cases' && id && !action) return { case: store.getCase(id) }
    if (root === 'cases' && id && action === 'events') return { events: store.getCase(id).timeline }
  }
  if (method === 'POST' && root === 'cases') {
    if (!id) return { case: store.createCase(body as CreateCaseBody) }
    switch (action) {
      case 'screen':
        return store.screen(id)
      case 'score':
        return store.score(id)
      case 'gapfill':
        if (sub === 'call') return store.startCall(id)
        if (sub === 'manual') return store.manualAnswers(id, (body as { answers: { criterion_id: string; answer: string }[] }).answers)
        break
      case 'packet':
        return store.generatePacket(id)
      case 'submit': {
        // respond immediately like the real server (202-ish) and let the script run; the UI follows SSE
        const c = store.getCase(id)
        if (!c.packet) throw new store.MockHttpError(409, 'illegal_transition', 'Generate the packet before submitting')
        void store.submit(id)
        await new Promise((r) => setTimeout(r, 50))
        return { payer: c.payer }
      }
      case 'review':
        if (sub === 'complete') return store.reviewComplete(id)
        break
      case 'inquire':
        return store.inquire(id)
      case 'close':
        return store.closeCase(id)
    }
  }
  throw new store.MockHttpError(404, 'not_found', `mock: no handler for ${method} /${parts.join('/')}`)
}
