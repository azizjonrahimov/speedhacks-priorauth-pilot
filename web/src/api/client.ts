import type {
  ApiErrorBody,
  CallStarted,
  CaseDetail,
  CaseEvent,
  CaseSummary,
  CreateCaseBody,
  DemoNote,
  ManualGapfillResult,
  Metrics,
  Packet,
  Payer,
  PolicyListItem,
  ScoreResult,
  ScreenResult,
} from './types'

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000'
export const USE_MOCK: boolean = import.meta.env.VITE_USE_MOCK === '1'

export class HttpError extends Error {
  status: number
  code: string | undefined
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (USE_MOCK) {
    const { mockFetch } = await import('@/mock/server')
    return mockFetch<T>(path, init)
  }
  // Only declare a JSON body when there is one: Fastify rejects an empty body with a JSON content-type.
  const headers: Record<string, string> = { accept: 'application/json', ...((init?.headers as Record<string, string>) ?? {}) }
  if (init?.body != null) headers['content-type'] = 'application/json'
  const res = await fetch(API_URL + path, { ...init, headers })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    let code: string | undefined
    try {
      const body = (await res.json()) as ApiErrorBody
      if (body?.error?.message) message = body.error.message
      code = body?.error?.code
    } catch {
      // body was not JSON
    }
    throw new HttpError(res.status, message, code)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  listCases: () => request<{ cases: CaseSummary[] }>('/cases'),
  getCase: (id: string) => request<{ case: CaseDetail }>(`/cases/${id}`),
  getEvents: (id: string) => request<{ events: CaseEvent[] }>(`/cases/${id}/events`),
  createCase: (body: CreateCaseBody) => post<{ case: CaseDetail }>('/cases', body),
  screen: (id: string) => post<ScreenResult>(`/cases/${id}/screen`),
  score: (id: string) => post<ScoreResult>(`/cases/${id}/score`),
  gapfillCall: (id: string) => post<CallStarted>(`/cases/${id}/gapfill/call`),
  gapfillManual: (id: string, answers: { criterion_id: string; answer: string }[]) =>
    post<ManualGapfillResult>(`/cases/${id}/gapfill/manual`, { answers }),
  packet: (id: string) => post<Packet>(`/cases/${id}/packet`),
  submit: (id: string) => post<{ payer: Payer }>(`/cases/${id}/submit`),
  reviewComplete: (id: string) => post<{ review_seconds: number }>(`/cases/${id}/review/complete`),
  /** Backend extras beyond the plan's contract: poll a pended case for a decision, and close a decided case. */
  inquire: (id: string) => post<{ payer: Payer; changed: boolean }>(`/cases/${id}/inquire`),
  close: (id: string) => post<{ case: CaseDetail }>(`/cases/${id}/close`),
  metrics: () => request<Metrics>('/metrics'),
  /** Forces a live Keewano re-query; never fails, errors come back in insights.error. */
  keewanoRefresh: () => post<{ insights?: { status?: string; error?: string | null } }>('/keewano/refresh'),
  policies: () => request<{ policies: PolicyListItem[] }>('/policies'),
  demoNotes: () => request<{ notes: DemoNote[] }>('/demo/notes'),
}

export const queryKeys = {
  cases: ['cases'] as const,
  case: (id: string) => ['case', id] as const,
  events: (id: string) => ['events', id] as const,
  metrics: ['metrics'] as const,
  policies: ['policies'] as const,
  demoNotes: ['demoNotes'] as const,
}
