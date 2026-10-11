import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, MinusCircle, Siren, XCircle } from 'lucide-react'
import type { CriterionStatus, Overall, State } from '@/api/types'
import { cn } from '@/lib/utils'
import { overallLabel, stateLabel } from '@/lib/format'

const STATE_CLASS: Record<string, string> = {
  intake: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
  screened: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
  evidence_scored: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-900',
  needs_info: 'bg-unclear-bg text-unclear-fg ring-amber-200 dark:ring-amber-900',
  calling: 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900',
  evidence_rescored: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-900',
  packet_ready: 'bg-teal-50 text-teal-800 ring-teal-200 dark:bg-teal-950 dark:text-teal-200 dark:ring-teal-900',
  submitted: 'bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:ring-indigo-900',
  pended: 'bg-unclear-bg text-unclear-fg ring-amber-200 dark:ring-amber-900',
  approved: 'bg-met-bg text-met-fg ring-emerald-200 dark:ring-emerald-900',
  denied: 'bg-missing-bg text-missing-fg ring-rose-200 dark:ring-rose-900',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
}

export function StateBadge({ state, className }: { state: State; className?: string }) {
  const live = state === 'calling' || state === 'submitted'
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        STATE_CLASS[state] ?? STATE_CLASS.intake,
        className,
      )}
    >
      {live && <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" /><span className="relative inline-flex size-1.5 rounded-full bg-current" /></span>}
      {stateLabel(state)}
    </span>
  )
}

const OVERALL_CLASS: Record<string, string> = {
  ready: 'bg-met-bg text-met-fg ring-emerald-200 dark:ring-emerald-900',
  needs_info: 'bg-unclear-bg text-unclear-fg ring-amber-200 dark:ring-amber-900',
  expedite: 'bg-red-600 text-white ring-red-700',
  not_required: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
}

export function OverallPill({ overall, size = 'sm', className }: { overall: Overall | null | undefined; size?: 'sm' | 'lg'; className?: string }) {
  if (!overall) return <span className="text-muted-foreground text-xs">—</span>
  const Icon = overall === 'ready' ? CheckCircle2 : overall === 'needs_info' ? HelpCircle : overall === 'expedite' ? Siren : MinusCircle
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ring-1 ring-inset',
        size === 'sm' ? 'h-6 px-2 text-xs' : 'h-9 px-3.5 text-sm tracking-wide uppercase',
        OVERALL_CLASS[overall] ?? OVERALL_CLASS.not_required,
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} />
      {overallLabel(overall)}
    </span>
  )
}

const CRIT: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  met: { label: 'Met', cls: 'bg-met-bg text-met-fg ring-emerald-200 dark:ring-emerald-900', Icon: CheckCircle2 },
  missing: { label: 'Missing', cls: 'bg-missing-bg text-missing-fg ring-rose-200 dark:ring-rose-900', Icon: XCircle },
  unclear: { label: 'Unclear', cls: 'bg-unclear-bg text-unclear-fg ring-amber-200 dark:ring-amber-900', Icon: AlertTriangle },
  not_applicable: { label: 'N/A', cls: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700', Icon: CircleDashed },
}

export function CriterionChip({ status, className }: { status: CriterionStatus; className?: string }) {
  const c = CRIT[status] ?? { label: status, cls: CRIT.not_applicable.cls, Icon: CircleDashed }
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-semibold ring-1 ring-inset', c.cls, className)}>
      <c.Icon className="size-3.5" />
      {c.label}
    </span>
  )
}
