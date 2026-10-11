import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Check, CheckCircle2, ChevronDown, Clock, Copy, ExternalLink, FileCheck, FileJson, Loader2, Printer, RotateCcw, Send, Timer, XCircle } from 'lucide-react'
import { api, queryKeys } from '@/api/client'
import type { CaseDetail, SubmitAttempt } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { fmtDuration, fmtTime, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'

function highlightJson(json: string) {
  const esc = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (m) => {
    let cls = 'text-sky-700 dark:text-sky-300'
    if (m.startsWith('"')) cls = m.endsWith(':') ? 'text-slate-700 dark:text-slate-300 font-medium' : 'text-emerald-700 dark:text-emerald-300'
    else if (/true|false/.test(m)) cls = 'text-violet-700 dark:text-violet-300'
    else if (/null/.test(m)) cls = 'text-rose-600'
    return `<span class="${cls}">${m}</span>`
  })
}

const OUTCOME: Record<string, { label: string; cls: string; Icon: typeof Check }> = {
  ok: { label: 'OK', cls: 'text-met-fg bg-met-bg', Icon: CheckCircle2 },
  http_500: { label: 'HTTP 500', cls: 'text-missing-fg bg-missing-bg', Icon: XCircle },
  timeout: { label: 'Timeout', cls: 'text-missing-fg bg-missing-bg', Icon: Clock },
  circuit_open: { label: 'Circuit open', cls: 'text-unclear-fg bg-unclear-bg', Icon: RotateCcw },
  error: { label: 'Error', cls: 'text-missing-fg bg-missing-bg', Icon: XCircle },
}

function Attempt({ a, last }: { a: SubmitAttempt; last: boolean }) {
  const o = OUTCOME[a.outcome] ?? OUTCOME.error
  return (
    <motion.li initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 text-[13px]">
      <span className={cn('inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-semibold', o.cls)}>
        <o.Icon className="size-3.5" /> Attempt {a.n}: {o.label}
      </span>
      <span className="text-muted-foreground tabular">{a.ms} ms</span>
      {a.error && <span className="text-muted-foreground truncate">{a.error}</span>}
      {a.outcome !== 'ok' && a.backoff_ms != null && (
        <span className="text-foreground inline-flex items-center gap-1 text-xs font-medium">
          <RotateCcw className="size-3" /> retry in {(a.backoff_ms / 1000).toFixed(1)} s
        </span>
      )}
      {a.outcome !== 'ok' && last && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
    </motion.li>
  )
}

const ADJ: Record<string, { label: string; cls: string }> = {
  A1: { label: 'A1 · Approved', cls: 'bg-met-bg text-met-fg ring-emerald-200' },
  A2: { label: 'A2 · Partially approved', cls: 'bg-unclear-bg text-unclear-fg ring-amber-200' },
  A3: { label: 'A3 · Denied', cls: 'bg-missing-bg text-missing-fg ring-rose-200' },
  A4: { label: 'A4 · Pended', cls: 'bg-unclear-bg text-unclear-fg ring-amber-200' },
}

export function PacketTab({ c }: { c: CaseDetail }) {
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.case(c.id) })
    void qc.invalidateQueries({ queryKey: queryKeys.cases })
    void qc.invalidateQueries({ queryKey: queryKeys.metrics })
  }
  const gen = useMutation({ mutationFn: () => api.packet(c.id), onSuccess: invalidate, onError: (e: Error) => toast.error('Packet generation failed', { description: e.message }) })
  const submit = useMutation({ mutationFn: () => api.submit(c.id), onSuccess: invalidate, onError: (e: Error) => toast.error('Submission failed', { description: e.message }) })
  const review = useMutation({
    mutationFn: () => api.reviewComplete(c.id),
    onSuccess: (r) => {
      toast.success(`Review complete in ${fmtDuration(r.review_seconds)}`, { description: `${Math.round((24 * 60 - r.review_seconds) / 60)} minutes saved vs the 24-minute manual baseline.` })
      invalidate()
    },
    onError: (e: Error) => toast.error('Could not complete review', { description: e.message }),
  })

  const inquire = useMutation({
    mutationFn: () => api.inquire(c.id),
    onSuccess: (r) => {
      if (r.changed) toast.success(`Payer decided: ${r.payer.adjudication ?? ''} ${r.payer.status}`)
      else toast.info('Still pended at the payer', { description: 'No decision yet; try again later.' })
      invalidate()
    },
    onError: (e: Error) => toast.error('Inquiry failed', { description: e.message }),
  })
  const close = useMutation({
    mutationFn: () => api.close(c.id),
    onSuccess: () => {
      toast.success('Case closed')
      invalidate()
    },
    onError: (e: Error) => toast.error('Could not close case', { description: e.message }),
  })

  const bundleJson = useMemo(() => (c.packet ? JSON.stringify(c.packet.fhir_bundle, null, 2) : ''), [c.packet])
  const bundleEntries = (c.packet?.fhir_bundle as { entry?: unknown[] } | null)?.entry?.length ?? 0
  const payer = c.payer
  const decided = payer && payer.adjudication
  // No payer yet, or the last submission failed (e.g. circuit breaker tripped): staff can submit again.
  const failed = payer?.status === 'failed'
  const canSubmit = !!c.packet && (!payer || failed)
  const saved = c.review ? Math.max(0, 24 * 60 - c.review.review_seconds) : 0

  if (c.criteria.length === 0) {
    return <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">Score the evidence first; the packet is built from the met criteria.</div>
  }

  return (
    <div className="flex flex-col gap-4 overflow-auto p-5">
      {/* Packet */}
      {!c.packet ? (
        <div className="bg-card flex flex-col items-start gap-3 rounded-xl p-5 ring-1 ring-foreground/10">
          <div>
            <h3 className="text-sm font-semibold">Authorization packet</h3>
            <p className="text-muted-foreground text-[13px]">Letter of medical necessity citing each met criterion verbatim, plus an HL7 Da Vinci PAS FHIR bundle.</p>
          </div>
          {c.overall === 'needs_info' && <p className="text-unclear-fg text-xs">There are still open questions. You can generate now, but the letter will omit undocumented criteria.</p>}
          <Button onClick={() => gen.mutate()} disabled={gen.isPending} size="lg">
            {gen.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <FileCheck data-icon="inline-start" />}
            {gen.isPending ? 'Drafting letter & bundle…' : 'Generate packet'}
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <FileCheck className="text-primary size-4" /> Letter of medical necessity
                <span className="text-muted-foreground text-xs font-normal">generated {fmtTime(c.packet.generated_at)}</span>
              </div>
              <div className="no-print flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer data-icon="inline-start" /> Print
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={c.packet.pdf_url} target="_blank" rel="noreferrer">
                    <ExternalLink data-icon="inline-start" /> Open PDF
                  </a>
                </Button>
                {!payer && (
                  <Button variant="ghost" size="sm" onClick={() => gen.mutate()} disabled={gen.isPending}>
                    <RotateCcw data-icon="inline-start" /> Regenerate
                  </Button>
                )}
              </div>
            </div>
            <div className="print-area bg-white px-8 py-7 text-[13.5px] leading-relaxed text-slate-900 dark:bg-slate-50">
              <pre className="font-sans whitespace-pre-wrap">{c.packet.letter_text}</pre>
            </div>
          </div>

          <Collapsible className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <div className="flex items-center justify-between px-4 py-2.5">
              <CollapsibleTrigger className="group flex items-center gap-2 text-sm font-semibold">
                <FileJson className="text-primary size-4" /> FHIR bundle
                <span className="text-muted-foreground text-xs font-normal">Da Vinci PAS · {bundleEntries} entries</span>
                <ChevronDown className="text-muted-foreground size-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(bundleJson).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                }}
              >
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                {copied ? 'Copied' : 'Copy JSON'}
              </Button>
            </div>
            <CollapsibleContent>
              <pre className="bg-muted/40 max-h-[360px] overflow-auto border-t px-4 py-3 font-mono text-[12px] leading-relaxed" dangerouslySetInnerHTML={{ __html: highlightJson(bundleJson) }} />
            </CollapsibleContent>
          </Collapsible>
        </>
      )}

      {/* Submission */}
      {c.packet && (
        <div className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Send className="text-primary size-4" /> Payer submission
              {payer && <span className="text-muted-foreground text-xs font-normal">via {payer.adapter === 'davinci' ? 'HL7 Da Vinci PAS reference server' : 'Mock payer'}</span>}
            </div>
            {canSubmit && (
              <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
                {submit.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                Submit to {c.insurer}
              </Button>
            )}
          </div>
          {!payer ? (
            <p className="text-muted-foreground px-4 py-3 text-[13px]">Submits the FHIR bundle as an X12 278-equivalent request. Failed attempts are retried with backoff; you will see every attempt here.</p>
          ) : (
            <div className="flex flex-col gap-3 px-4 py-3">
              <ul className="space-y-1.5">
                {payer.attempts.map((a, i) => (
                  <Attempt key={a.n} a={a} last={i === payer.attempts.length - 1 && !payer.reference} />
                ))}
                {payer.attempts.length === 0 && !failed && (
                  <li className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="size-3.5 animate-spin" /> Connecting to payer…
                  </li>
                )}
              </ul>
              {payer.reference && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <span>
                    Reference <span className="tabular font-mono font-semibold">{payer.reference}</span>
                  </span>
                  {payer.sla && (
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <Timer className="size-3.5" /> {payer.sla.kind === 'expedited' ? '72-hour' : '7-day'} decision window · due {fmtDate(payer.sla.decision_due_at)}
                    </span>
                  )}
                </div>
              )}
              {failed && (
                <div className="bg-missing-bg text-missing-fg flex items-start gap-3 rounded-lg px-4 py-3 ring-1 ring-rose-200 ring-inset">
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                  <div className="text-[13px]">
                    <div className="font-semibold">Submission failed after {payer.attempts.length} attempt{payer.attempts.length === 1 ? '' : 's'}</div>
                    {payer.reason && <div>{payer.reason}</div>}
                    <div className="mt-0.5 text-xs opacity-80">The packet is intact. Submit again when the payer endpoint recovers.</div>
                  </div>
                </div>
              )}
              <AnimatePresence>
                {decided ? (
                  <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className={cn('flex items-start gap-3 rounded-lg px-4 py-3 ring-1 ring-inset', (ADJ[payer.adjudication!] ?? { cls: 'bg-muted text-foreground ring-border' }).cls)}>
                    <div className="text-base font-bold">{(ADJ[payer.adjudication!] ?? { label: `${payer.adjudication} · ${payer.status}` }).label}</div>
                    <div className="text-[13px]">
                      {payer.reason ?? (payer.status === 'approved' ? 'Medical necessity criteria met.' : '')}
                      {payer.responded_at && <span className="block text-xs opacity-70">responded {fmtTime(payer.responded_at)}</span>}
                    </div>
                  </motion.div>
                ) : payer.reference && !failed ? (
                  <p className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="size-3.5 animate-spin" /> Awaiting payer decision…
                  </p>
                ) : null}
              </AnimatePresence>
              {payer.status === 'pended' && (
                <div>
                  <Button variant="outline" size="sm" onClick={() => inquire.mutate()} disabled={inquire.isPending}>
                    {inquire.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
                    Check for decision (X12 278 inquiry)
                  </Button>
                </div>
              )}
              {c.notification && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[13px]">
                  <span className="text-muted-foreground">Patient texted ({c.notification.to_masked}):</span> “{c.notification.body}”
                  {c.notification.reply && <span className="text-met-fg ml-2 font-medium">Reply: “{c.notification.reply.body}”</span>}
                </motion.div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Review complete */}
      {(decided || c.review) && (
        <div className={cn('rounded-xl p-4 ring-1', c.review ? 'bg-met-bg/50 ring-met/40' : 'bg-card ring-foreground/10')}>
          {c.review ? (
            <div className="flex items-center gap-4">
              <CheckCircle2 className="text-met size-6" />
              <div>
                <div className="text-sm font-semibold">Review complete</div>
                <div className="text-[13.5px]">
                  Staff time <span className="tabular font-semibold">{fmtDuration(c.review.review_seconds)}</span> vs <span className="tabular">24m</span> baseline →{' '}
                  <span className="text-met-fg tabular text-lg font-bold">{Math.round(saved / 60)}m saved</span>
                </div>
              </div>
              {c.state !== 'closed' && (
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => close.mutate()} disabled={close.isPending}>
                  Close case
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Done reviewing?</div>
                <p className="text-muted-foreground text-[13px]">Stops the staff-time clock for this case and records minutes saved against the CAQH baseline.</p>
              </div>
              <Button onClick={() => review.mutate()} disabled={review.isPending} size="lg">
                {review.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <CheckCircle2 data-icon="inline-start" />}
                Mark review complete
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
