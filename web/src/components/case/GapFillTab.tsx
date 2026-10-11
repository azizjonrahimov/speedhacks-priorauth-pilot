import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Bot, CheckCircle2, Loader2, PenLine, PhoneCall, PhoneOff, Stethoscope, Voicemail } from 'lucide-react'
import { api, queryKeys } from '@/api/client'
import type { Call, CaseDetail } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { fmtClock } from '@/lib/format'
import { cn } from '@/lib/utils'

function useElapsed(call: Call | null) {
  const live = !!call && (call.status === 'queued' || call.status === 'in_progress')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [live])
  if (!call) return 0
  if (call.duration_seconds != null) return call.duration_seconds
  const end = call.ended_at ? Date.parse(call.ended_at) : now
  return Math.max(0, (end - Date.parse(call.placed_at)) / 1000)
}

const STATUS: Record<string, { label: string; cls: string; Icon: typeof PhoneCall; pulse?: boolean }> = {
  queued: { label: 'Dialing', cls: 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900', Icon: PhoneCall, pulse: true },
  in_progress: { label: 'In call', cls: 'bg-met-bg text-met-fg ring-emerald-200 dark:ring-emerald-900', Icon: PhoneCall, pulse: true },
  ended: { label: 'Call ended', cls: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700', Icon: PhoneOff },
  no_answer: { label: 'No answer', cls: 'bg-unclear-bg text-unclear-fg ring-amber-200', Icon: Voicemail },
  failed: { label: 'Call failed', cls: 'bg-missing-bg text-missing-fg ring-rose-200', Icon: PhoneOff },
  unresolved: { label: 'Unresolved', cls: 'bg-missing-bg text-missing-fg ring-rose-200', Icon: PhoneOff },
}

export function CallCard({ c }: { c: CaseDetail }) {
  const call = c.call!
  const elapsed = useElapsed(call)
  const st = STATUS[call.status] ?? STATUS.ended
  const answeredIds = new Set(call.answers.map((a) => a.criterion_id))
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ring-1 ring-inset', st.cls)}>
            {st.pulse && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-current" /></span>}
            <st.Icon className="size-3.5" />
            {st.label}
          </span>
          <span className="text-sm">
            {c.physician.name} <span className="text-muted-foreground tabular font-mono text-xs">{call.to_masked}</span>
          </span>
          {call.attempt > 1 && <span className="text-muted-foreground text-xs">attempt {call.attempt}</span>}
        </div>
        <span className="tabular text-2xl font-semibold tracking-tight">{fmtClock(elapsed)}</span>
      </div>

      <div className="flex flex-col gap-2.5 px-4 py-3">
        {call.transcript.length === 0 && (call.status === 'queued' || call.status === 'in_progress') && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-3.5 animate-spin" /> {call.status === 'queued' ? 'Placing the call…' : 'Connected, waiting for the physician…'}
          </p>
        )}
        <AnimatePresence initial={false}>
          {call.transcript.map((t, i) => {
            const agent = t.speaker === 'agent'
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn('flex items-end gap-2', agent ? 'justify-start' : 'justify-end')}>
                {agent && <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full"><Bot className="size-3.5" /></span>}
                <div className={cn('max-w-[80%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-snug', agent ? 'bg-muted rounded-bl-sm' : 'bg-primary text-primary-foreground rounded-br-sm')}>
                  {t.text}
                  <span className={cn('tabular mt-0.5 block text-[10px]', agent ? 'text-muted-foreground' : 'text-primary-foreground/70')}>{fmtClock(t.start_ms / 1000)}</span>
                </div>
                {!agent && <span className="bg-foreground/10 flex size-6 shrink-0 items-center justify-center rounded-full"><Stethoscope className="size-3.5" /></span>}
              </motion.div>
            )
          })}
        </AnimatePresence>
        {call.status === 'ended' && call.answers.length === 0 && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm"><Loader2 className="size-3.5 animate-spin" /> Extracting answers from the transcript…</p>
        )}
      </div>

      {call.answers.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-t px-4 py-3">
          <div className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wide uppercase">Answers extracted</div>
          <ul className="space-y-2">
            {call.answers.map((a) => {
              const k = c.criteria.find((x) => x.id === a.criterion_id)
              return (
                <li key={a.criterion_id} className="flex items-start gap-2 text-[13px]">
                  <CheckCircle2 className="text-met mt-0.5 size-4 shrink-0" />
                  <div>
                    <div className="font-medium">{k?.text ?? a.criterion_id}</div>
                    <div className="text-muted-foreground">“{a.answer}”</div>
                  </div>
                </li>
              )
            })}
          </ul>
          {c.gaps.filter((g) => g.status === 'open' && !answeredIds.has(g.criterion_id)).length > 0 && (
            <p className="text-unclear-fg mt-2 text-xs">Some questions were not answered; enter them manually below.</p>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}

export function GapFillTab({ c }: { c: CaseDetail }) {
  const qc = useQueryClient()
  const openGaps = c.gaps.filter((g) => g.status === 'open')
  const answered = c.gaps.filter((g) => g.status !== 'open')
  const [manual, setManual] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const calling = c.call && (c.call.status === 'queued' || c.call.status === 'in_progress')
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.case(c.id) })
    void qc.invalidateQueries({ queryKey: queryKeys.cases })
  }

  const call = useMutation({
    mutationFn: () => api.gapfillCall(c.id),
    onSuccess: () => {
      toast.info(`Calling ${c.physician.name}…`)
      invalidate()
    },
    onError: (e: Error) => toast.error('Could not place call', { description: e.message }),
  })
  const submitManual = useMutation({
    mutationFn: () =>
      api.gapfillManual(
        c.id,
        Object.entries(answers)
          .filter(([, v]) => v.trim())
          .map(([criterion_id, answer]) => ({ criterion_id, answer: answer.trim() })),
      ),
    onSuccess: () => {
      toast.success('Answers recorded, criteria re-scored')
      setManual(false)
      setAnswers({})
      invalidate()
    },
    onError: (e: Error) => toast.error('Could not save answers', { description: e.message }),
  })

  if (c.criteria.length === 0) return <Empty text="Score the evidence first; open questions appear here." />

  return (
    <div className="flex flex-col gap-4 overflow-auto p-5">
      {openGaps.length === 0 && !c.call ? (
        <Empty text="No open questions. Every criterion is documented." />
      ) : (
        <>
          {openGaps.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  Open questions <span className="text-muted-foreground font-normal">({openGaps.length})</span>
                </h3>
              </div>
              <ol className="space-y-2">
                {openGaps.map((g, i) => {
                  const k = c.criteria.find((x) => x.id === g.criterion_id)
                  return (
                    <li key={g.criterion_id} className="bg-card flex gap-3 rounded-lg px-4 py-3 ring-1 ring-foreground/10">
                      <span className="bg-unclear-bg text-unclear-fg tabular flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-medium">{g.question}</p>
                        {k && <p className="text-muted-foreground mt-0.5 text-xs">For: {k.text}</p>}
                      </div>
                    </li>
                  )
                })}
              </ol>
              {!calling && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button onClick={() => call.mutate()} disabled={call.isPending} size="lg">
                    {call.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <PhoneCall data-icon="inline-start" />}
                    Call {c.physician.name} now
                  </Button>
                  <Button variant="outline" size="lg" onClick={() => setManual((m) => !m)}>
                    <PenLine data-icon="inline-start" /> Enter answers manually
                  </Button>
                  <span className="text-muted-foreground text-xs">AI voice agent asks only these questions, then re-scores.</span>
                </div>
              )}
              <AnimatePresence>
                {manual && (
                  <motion.form
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 space-y-3 overflow-hidden"
                    onSubmit={(e) => {
                      e.preventDefault()
                      submitManual.mutate()
                    }}
                  >
                    {openGaps.map((g) => (
                      <div key={g.criterion_id} className="grid gap-1.5">
                        <Label className="text-xs">{g.question}</Label>
                        <Textarea rows={2} value={answers[g.criterion_id] ?? ''} onChange={(e) => setAnswers({ ...answers, [g.criterion_id]: e.target.value })} placeholder="Physician's answer, verbatim" />
                      </div>
                    ))}
                    <Button type="submit" disabled={submitManual.isPending || !Object.values(answers).some((v) => v.trim())}>
                      {submitManual.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
                      Save answers & re-score
                    </Button>
                  </motion.form>
                )}
              </AnimatePresence>
            </section>
          )}
          {c.call && <CallCard c={c} />}
          {answered.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Resolved</h3>
              <ul className="space-y-2">
                {answered.map((g) => (
                  <li key={g.criterion_id} className="bg-card flex items-start gap-3 rounded-lg px-4 py-3 text-[13px] ring-1 ring-foreground/10">
                    <CheckCircle2 className="text-met mt-0.5 size-4 shrink-0" />
                    <div>
                      <div className="font-medium">{g.question}</div>
                      <div className="text-muted-foreground">
                        “{g.answer}” <span className="text-[11px] uppercase">· {g.answered_via === 'phone_call' ? 'by phone' : 'manual'}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
      <p className="max-w-xs">{text}</p>
    </div>
  )
}
