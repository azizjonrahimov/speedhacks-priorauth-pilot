import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { API_URL, USE_MOCK, queryKeys } from '@/api/client'
import type { StreamEvent } from '@/api/types'

type Handler = (e: StreamEvent) => void
const handlers = new Set<Handler>()

/** Subscribe to every stream event (any component). Returns an unsubscribe. */
export function onStreamEvent(fn: Handler): () => void {
  handlers.add(fn)
  return () => handlers.delete(fn)
}

export type StreamStatus = 'connecting' | 'live' | 'offline'

/**
 * Minimal SSE reader over fetch so that ANY `event:` name is delivered (EventSource only fires
 * listeners for names registered up front, which would silently drop new backend event types).
 */
async function readSse(url: string, signal: AbortSignal, onEvent: (type: string, data: string) => void, onOpen: () => void) {
  const res = await fetch(url, { headers: { accept: 'text/event-stream' }, signal })
  if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
  onOpen()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let type = 'message'
  let data: string[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '')
      buf = buf.slice(nl + 1)
      if (line === '') {
        if (data.length) onEvent(type, data.join('\n'))
        type = 'message'
        data = []
      } else if (line.startsWith(':')) {
        // comment / ping
      } else if (line.startsWith('event:')) {
        type = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''))
      }
    }
  }
}

/**
 * Single app-wide connection to GET /stream (or the mock bus). Invalidates react-query caches
 * (debounced 300 ms) on every event and fans events out to `onStreamEvent` subscribers.
 */
export function useStream(): StreamStatus {
  const qc = useQueryClient()
  const [status, setStatus] = useState<StreamStatus>('connecting')
  const pending = useRef<{ caseIds: Set<string>; timer: ReturnType<typeof setTimeout> | null }>({
    caseIds: new Set(),
    timer: null,
  })

  useEffect(() => {
    const dispatch = (ev: StreamEvent) => {
      for (const h of handlers) {
        try {
          h(ev)
        } catch (err) {
          console.error('stream handler failed', err)
        }
      }
      const p = pending.current
      if (ev.case_id) p.caseIds.add(ev.case_id)
      if (p.timer) clearTimeout(p.timer)
      p.timer = setTimeout(() => {
        p.timer = null
        void qc.invalidateQueries({ queryKey: queryKeys.cases })
        void qc.invalidateQueries({ queryKey: queryKeys.metrics })
        for (const id of p.caseIds) {
          void qc.invalidateQueries({ queryKey: queryKeys.case(id) })
          void qc.invalidateQueries({ queryKey: queryKeys.events(id) })
        }
        p.caseIds.clear()
      }, 300)
    }

    if (USE_MOCK) {
      let unsub: (() => void) | undefined
      let cancelled = false
      void import('@/mock/store').then((m) => {
        if (cancelled) return
        unsub = m.subscribe(dispatch)
        setStatus('live')
      })
      return () => {
        cancelled = true
        unsub?.()
      }
    }

    const ctrl = new AbortController()
    let backoff = 1000
    const loop = async () => {
      while (!ctrl.signal.aborted) {
        try {
          await readSse(
            API_URL + '/stream',
            ctrl.signal,
            (type, raw) => {
              if (type === 'hello') return
              try {
                const data = JSON.parse(raw) as Partial<StreamEvent>
                dispatch({
                  seq: data.seq ?? 0,
                  case_id: data.case_id ?? '',
                  type: data.type ?? type,
                  payload: data.payload ?? {},
                  at: data.at ?? new Date().toISOString(),
                  actor: data.actor ?? 'system',
                  state: data.state ?? '',
                })
              } catch (err) {
                console.warn('bad stream payload', type, err)
              }
            },
            () => {
              backoff = 1000
              setStatus('live')
            },
          )
        } catch {
          /* fallthrough to reconnect */
        }
        if (ctrl.signal.aborted) break
        setStatus('offline')
        await new Promise((r) => setTimeout(r, backoff))
        backoff = Math.min(backoff * 2, 15_000)
      }
    }
    void loop()
    return () => ctrl.abort()
  }, [qc])

  return status
}
