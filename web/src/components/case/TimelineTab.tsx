import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import { api, queryKeys } from '@/api/client'
import {
  ChevronDown,
  GraduationCap,
  TriangleAlert,
  Bot,
  CheckCircle2,
  FileCheck,
  FilePlus2,
  Flag,
  HelpCircle,
  MessageSquareReply,
  MessageSquareText,
  PhoneCall,
  PhoneOff,
  RotateCcw,
  ScanSearch,
  Send,
  ShieldCheck,
  ShieldX,
  Sparkles,
  UserCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type { CaseEvent } from '@/api/types'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtAgo, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const ICON: Record<string, { Icon: LucideIcon; cls: string }> = {
  'case.created': { Icon: FilePlus2, cls: 'bg-slate-100 text-slate-700' },
  'screening.completed': { Icon: ShieldCheck, cls: 'bg-teal-50 text-teal-700' },
  'evidence.extracted': { Icon: ScanSearch, cls: 'bg-sky-50 text-sky-700' },
  'evidence.scored': { Icon: Sparkles, cls: 'bg-sky-50 text-sky-700' },
  'evidence.quote_rejected': { Icon: ShieldX, cls: 'bg-unclear-bg text-unclear-fg' },
  'gap.question_generated': { Icon: HelpCircle, cls: 'bg-unclear-bg text-unclear-fg' },
  'call.placed': { Icon: PhoneCall, cls: 'bg-violet-50 text-violet-700' },
  'call.status': { Icon: PhoneCall, cls: 'bg-violet-50 text-violet-700' },
  'call.ended': { Icon: PhoneOff, cls: 'bg-violet-50 text-violet-700' },
  'call.failed': { Icon: PhoneOff, cls: 'bg-missing-bg text-missing-fg' },
  'call.retry_scheduled': { Icon: RotateCcw, cls: 'bg-unclear-bg text-unclear-fg' },
  'call.parsed': { Icon: Bot, cls: 'bg-violet-50 text-violet-700' },
  'gap.unresolved': { Icon: XCircle, cls: 'bg-missing-bg text-missing-fg' },
  'gap.manual_answered': { Icon: UserCheck, cls: 'bg-met-bg text-met-fg' },
  'evidence.rescored': { Icon: Sparkles, cls: 'bg-met-bg text-met-fg' },
  'packet.generated': { Icon: FileCheck, cls: 'bg-teal-50 text-teal-700' },
  'payer.attempt_failed': { Icon: RotateCcw, cls: 'bg-missing-bg text-missing-fg' },
  'payer.submitted': { Icon: Send, cls: 'bg-indigo-50 text-indigo-700' },
  'payer.responded': { Icon: Flag, cls: 'bg-met-bg text-met-fg' },
  'patient.notified': { Icon: MessageSquareText, cls: 'bg-primary text-primary-foreground' },
  'patient.replied': { Icon: MessageSquareReply, cls: 'bg-primary text-primary-foreground' },
  'review.completed': { Icon: CheckCircle2, cls: 'bg-met-bg text-met-fg' },
  'case.closed': { Icon: CheckCircle2, cls: 'bg-slate-100 text-slate-700' },
  'criterion.overridden': { Icon: UserCheck, cls: 'bg-violet-50 text-violet-700' },
  'lessons.applied': { Icon: GraduationCap, cls: 'bg-violet-100 text-violet-800' },
}

const TITLE: Record<string, string> = {
  'case.created': 'Case created',
  'screening.completed': 'Screening completed',
  'evidence.extracted': 'Facts extracted from note',
  'evidence.scored': 'Evidence scored',
  'evidence.quote_rejected': 'Quote rejected by verifier',
  'gap.question_generated': 'Question prepared for physician',
  'call.placed': 'Call placed to physician',
  'call.status': 'Call status',
  'call.ended': 'Call ended',
  'call.failed': 'Call failed',
  'call.retry_scheduled': 'Call retry scheduled',
  'call.parsed': 'Answers extracted from call',
  'gap.unresolved': 'Gaps unresolved',
  'gap.manual_answered': 'Answers entered by staff',
  'evidence.rescored': 'Evidence re-scored',
  'packet.generated': 'Packet generated',
  'payer.attempt_failed': 'Submission attempt failed',
  'payer.submitted': 'Submitted to payer',
  'payer.responded': 'Payer responded',
  'patient.notified': 'Patient texted',
  'patient.replied': 'Patient replied',
  'review.completed': 'Staff review complete',
  'case.closed': 'Case closed',
  'criterion.overridden': 'Reviewer overrode a criterion',
  'lessons.applied': 'Lessons applied',
}

function summarize(e: CaseEvent): string {
  const p = e.payload as Record<string, unknown>
  const s = (k: string) => (p[k] == null ? '' : String(p[k]))
  switch (e.type) {
    case 'case.created':
      return `${s('patient_name')} · CPT ${s('cpt')} · ${s('insurer')}`
    case 'screening.completed': {
      const pol = p.policy as { id?: string; insurer?: string } | undefined
      return `${p.pa_required ? 'PA required' : 'No PA required'}${pol ? ` · ${pol.insurer ?? ''} ${pol.id ?? ''}` : ''}${p.expedited ? ' · EXPEDITED' : ''}`
    }
    case 'evidence.extracted':
      return `${s('facts_count')} facts`
    case 'evidence.scored':
    case 'evidence.rescored':
      return `${s('met')} met · ${s('missing')} missing · ${s('unclear')} unclear → ${s('overall').replace('_', ' ')}`
    case 'evidence.quote_rejected':
      return `“${s('rejected_quote')}” not found verbatim in note`
    case 'gap.question_generated':
      return `“${s('question')}”`
    case 'call.placed':
      return `to ${s('to_masked')} · attempt ${s('attempt')}`
    case 'call.status':
      return s('status').replace('_', ' ')
    case 'call.ended':
      return `${s('duration_seconds')}s · ${s('end_reason')}`
    case 'call.failed':
      return `${s('reason')} · attempt ${s('attempt')}`
    case 'call.retry_scheduled':
      return `attempt ${s('attempt')} in ${s('in_seconds')}s`
    case 'call.parsed':
      return `${s('answers_count')} answer(s)${overstep(e) ? ' · agent overstepped its script (flagged, becomes a lesson)' : ''}`
    case 'criterion.overridden':
      return `${s('criterion_id')}: ${s('from_status').replace('_', ' ')} → ${s('to_status').replace('_', ' ')}${p.overall && p.overall_before && p.overall !== p.overall_before ? ` · overall ${s('overall_before').replace('_', ' ')} → ${s('overall').replace('_', ' ')}` : ''}${p.reason ? ` · “${s('reason')}”` : ''}`
    case 'lessons.applied': {
      const n = Number(p.count ?? (p.ids as unknown[] | undefined)?.length ?? 0)
      const where = p.pass === 'call_script' ? 'to the physician call script' : 'to scoring'
      return `System applied ${n} lesson${n === 1 ? '' : 's'} learned from earlier cases ${where}`
    }
    case 'gap.unresolved':
      return `${(p.criterion_ids as string[] | undefined)?.length ?? ''} criteria still open`
    case 'gap.manual_answered':
      return `${(p.criterion_ids as string[] | undefined)?.length ?? ''} answer(s)`
    case 'packet.generated':
      return `${s('bundle_entries')} FHIR entries · ${s('letter_chars')} chars`
    case 'payer.attempt_failed':
      return `attempt ${s('n')}: ${s('outcome').replace('_', ' ')}${p.status_code ? ` (${s('status_code')})` : ''} · retry in ${(Number(p.backoff_ms ?? 0) / 1000).toFixed(1)}s`
    case 'payer.submitted':
      return `${s('adapter') === 'davinci' ? 'Da Vinci PAS' : 'mock payer'} · ref ${s('reference')} · ${s('n_attempts')} attempt(s)`
    case 'payer.responded':
      return `${s('adjudication')} ${s('status')}${p.reason ? ` · ${s('reason')}` : ''}`
    case 'patient.notified':
      return `${s('channel')} to ${s('to_masked')}`
    case 'patient.replied':
      return `“${s('body')}”`
    case 'review.completed':
      return `${s('review_seconds')}s staff time`
    default: {
      const keys = Object.keys(p)
      return keys.length ? keys.map((k) => `${k}: ${typeof p[k] === 'object' ? JSON.stringify(p[k]) : String(p[k])}`).join(' · ') : ''
    }
  }
}

function overstep(e: CaseEvent): boolean {
  if (e.type !== 'call.parsed') return false
  const o = (e.payload as { overstep?: { detected?: boolean } | boolean }).overstep
  return typeof o === 'boolean' ? o : !!o?.detected
}

function LessonsApplied({ e }: { e: CaseEvent }) {
  const [open, setOpen] = useState(false)
  const lessons = useQuery({ queryKey: queryKeys.lessons, queryFn: api.lessons, enabled: open, staleTime: 30_000 })
  const ids = ((e.payload as { ids?: unknown }).ids as string[] | undefined) ?? []
  if (!ids.length) return null
  const byId = new Map((lessons.data?.lessons ?? []).map((l) => [l.id, l]))
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-primary inline-flex items-center gap-1 text-[12px] font-medium">
        {open ? 'Hide' : 'Show'} lessons <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1.5">
          {ids.map((id) => {
            const l = byId.get(id)
            return (
              <li key={id} className="bg-muted/60 rounded-md px-2.5 py-1.5 text-[12px] leading-snug">
                {l ? l.summary : lessons.isLoading ? 'Loading…' : id}
                {l && <span className="text-muted-foreground ml-1.5 text-[10.5px]">seen {l.count}×</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function TimelineTab({ events, loading }: { events: CaseEvent[] | undefined; loading: boolean }) {
  const list = [...(events ?? [])].sort((a, b) => b.seq - a.seq)
  return (
    <div className="overflow-auto p-5">
      {loading && (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {!loading && list.length === 0 && <p className="text-muted-foreground text-sm">No events yet.</p>}
      <ol className="relative ml-3.5 border-l">
        <AnimatePresence initial={false}>
          {list.map((e) => {
            const flagged = overstep(e)
            const ic = flagged ? { Icon: TriangleAlert, cls: 'bg-unclear-bg text-unclear-fg' } : (ICON[e.type] ?? { Icon: Flag, cls: 'bg-slate-100 text-slate-700' })
            const learning = e.type === 'lessons.applied' || e.type === 'criterion.overridden'
            const highlight = e.type === 'patient.notified' || e.type === 'patient.replied' || e.type === 'payer.responded'
            return (
              <motion.li key={e.seq} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="relative mb-4 pl-7">
                <span className={cn('absolute -left-[13px] top-0.5 flex size-6 items-center justify-center rounded-full ring-4 ring-background', ic.cls)}>
                  <ic.Icon className="size-3.5" />
                </span>
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 ring-1 ring-foreground/10',
                    flagged ? 'bg-unclear-bg/60 ring-amber-300 dark:ring-amber-800' : learning ? 'bg-violet-50/70 ring-violet-200 dark:bg-violet-950/40 dark:ring-violet-900' : highlight ? 'bg-accent/70 ring-primary/30' : 'bg-card',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-semibold">{TITLE[e.type] ?? e.type}</span>
                    <span className="text-muted-foreground tabular shrink-0 text-[11px]" title={e.at}>
                      {fmtTime(e.at)} · {fmtAgo(e.at)}
                    </span>
                  </div>
                  {summarize(e) && <p className="text-muted-foreground mt-0.5 text-[12.5px]">{summarize(e)}</p>}
                  {e.type === 'lessons.applied' && <LessonsApplied e={e} />}
                  <div className="text-muted-foreground/70 mt-1 flex gap-2 text-[10.5px] uppercase">
                    <span>{e.actor}</span>
                    <span>·</span>
                    <span>{String(e.state).replace(/_/g, ' ')}</span>
                    <span>·</span>
                    <span className="font-mono normal-case">{e.type}</span>
                  </div>
                </div>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ol>
    </div>
  )
}
