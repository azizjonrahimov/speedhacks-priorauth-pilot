import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Calculator, ChevronDown, ExternalLink, Loader2, PenLine, PhoneCall, Quote, ShieldAlert, ShieldCheck, Siren, UserCheck } from 'lucide-react'
import { api, queryKeys } from '@/api/client'
import type { CaseDetail, Criterion, CriterionOverrideStatus } from '@/api/types'
import { CriterionChip, OverallPill } from '@/components/StatusBadges'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { compactFlags } from '@/pages/CaseView'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const BAR: Record<string, string> = { met: 'bg-met', unclear: 'bg-unclear', missing: 'bg-missing', not_applicable: 'bg-slate-400' }

interface OverrideInfo {
  from: string
  to: string
  reason: string
  at: string
}

const OVERRIDE_STATES = ['evidence_scored', 'needs_info', 'evidence_rescored', 'packet_ready']
const OVERRIDE_CHOICES: { v: CriterionOverrideStatus; label: string }[] = [
  { v: 'met', label: 'Met' },
  { v: 'missing', label: 'Missing' },
  { v: 'unclear', label: 'Unclear' },
  { v: 'not_applicable', label: 'N/A' },
]

/** Reviewer correction. Feeds the backend's lessons loop; the reason stays in the case ledger only. */
function OverrideForm({ caseId, k, onDone }: { caseId: string; k: Criterion; onDone: () => void }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<CriterionOverrideStatus | null>(null)
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: () => api.overrideCriterion(caseId, k.id, status!, reason.trim()),
    onSuccess: (r) => {
      toast.success('Override recorded', { description: `Overall is now ${String(r.overall).replace('_', ' ')}. The system will learn from this.` })
      for (const key of [queryKeys.case(caseId), queryKeys.events(caseId), queryKeys.cases, queryKeys.metrics, queryKeys.lessons, queryKeys.lessonsSummary])
        void qc.invalidateQueries({ queryKey: key })
      onDone()
    },
    onError: (e: Error) => toast.error('Override failed', { description: e.message }),
  })
  const valid = !!status && status !== k.status && reason.trim().length >= 3
  return (
    <motion.form
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) m.mutate()
      }}
    >
      <div className="bg-muted/50 mt-2 space-y-2 rounded-md p-3 ring-1 ring-slate-900/5 dark:ring-white/10">
        <div className="text-[11.5px] font-semibold">Reviewer override</div>
        <div className="flex flex-wrap gap-1">
          {OVERRIDE_CHOICES.map((o) => (
            <button
              key={o.v}
              type="button"
              disabled={o.v === k.status}
              onClick={() => setStatus(o.v)}
              className={cn(
                'h-7 rounded-md px-2.5 text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-40',
                status === o.v ? 'bg-primary text-primary-foreground ring-primary' : 'bg-background ring-border hover:bg-muted',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Reason (kept in the case audit log only)"
          className="bg-background border-input focus-visible:ring-ring/50 h-8 w-full rounded-md border px-2.5 text-[13px] outline-none focus-visible:ring-2"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={!valid || m.isPending}>
            {m.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            Save override
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <span className="text-muted-foreground ml-auto text-[11px]">Corrections become lessons for future cases under this policy.</span>
        </div>
      </div>
    </motion.form>
  )
}

function CriterionRow({
  k,
  selected,
  onSelect,
  anyOfSatisfied,
  caseId,
  canOverride = false,
  override,
}: {
  k: Criterion
  selected: boolean
  onSelect: () => void
  anyOfSatisfied: boolean
  caseId?: string
  canOverride?: boolean
  override?: OverrideInfo
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const src = k.evidence_source
  // A red-flag criterion that is not documented is good news, not a gap: show it neutrally.
  const redFlagAbsent = k.group === 'red_flag_any_of' && k.status !== 'met'
  // An unmet member of an any_of group that another member already satisfies is optional, not a gap.
  const optional = k.group === 'any_of' && anyOfSatisfied && k.status !== 'met' && k.status !== 'not_applicable'
  const chipStatus = redFlagAbsent || optional ? 'not_applicable' : k.status
  return (
    <motion.li
      layout
      key={k.id}
      initial={false}
      className={cn('group relative cursor-pointer px-5 py-3.5 transition-colors', selected ? 'bg-accent/60' : 'hover:bg-muted/50')}
      onClick={onSelect}
    >
      <motion.div
        key={k.status}
        initial={{ opacity: 0.6, backgroundColor: k.status === 'met' ? 'color-mix(in oklch, var(--met) 22%, transparent)' : 'transparent' }}
        animate={{ opacity: 0, backgroundColor: 'transparent' }}
        transition={{ duration: 1.8, ease: 'easeOut' }}
        className="pointer-events-none absolute inset-0"
      />
      <div className="relative flex items-start gap-3">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={chipStatus} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 28 }} className="w-[74px] shrink-0 pt-px">
            <CriterionChip status={chipStatus} label={redFlagAbsent ? 'Absent' : optional ? 'Optional' : undefined} />
          </motion.div>
        </AnimatePresence>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13.5px] leading-snug font-medium">{k.text}</p>
            {k.group === 'red_flag_any_of' && <Siren className="text-expedite size-4 shrink-0" />}
          </div>
          {k.evidence_quote ? (
            <blockquote
              className={cn(
                'mt-2 flex gap-2 rounded-md border-l-[3px] px-3 py-2 text-[13px] leading-snug',
                k.status === 'met' ? 'border-met bg-met-bg/60' : k.status === 'unclear' ? 'border-unclear bg-unclear-bg/60' : 'border-missing bg-missing-bg/60',
              )}
            >
              <Quote className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
              <span>
                “{k.evidence_quote}”
                {src && src !== 'note' && (
                  <span className="text-muted-foreground ml-2 inline-flex items-center gap-1 text-[11px] font-medium uppercase">
                    {src === 'phone_call' ? <PhoneCall className="size-3" /> : null}
                    {src === 'phone_call' ? 'physician by phone' : 'staff entry'}
                  </span>
                )}
              </span>
            </blockquote>
          ) : redFlagAbsent ? (
            <p className="text-muted-foreground mt-1.5 text-[12.5px]">Not documented in the note; standard review pathway.</p>
          ) : optional ? (
            <p className="text-muted-foreground mt-1.5 text-[12.5px]">Not documented; another finding in this group already satisfies the policy.</p>
          ) : (
            k.question_if_missing && <p className="text-muted-foreground mt-1.5 text-[12.5px] italic">Will ask: “{k.question_if_missing}”</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 [&>*]:whitespace-nowrap">
            <div className="bg-muted h-1.5 w-28 overflow-hidden rounded-full">
              <motion.div className={cn('h-full rounded-full', BAR[chipStatus] ?? BAR.not_applicable)} initial={{ width: 0 }} animate={{ width: `${Math.round(k.confidence * 100)}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
            </div>
            <span className="text-muted-foreground tabular text-[11px]">{Math.round(k.confidence * 100)}% confidence</span>
            {k.verifier?.quote_verified && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-met-fg inline-flex items-center gap-1 text-[11px]"><ShieldCheck className="size-3" /> quote verified</span>
                </TooltipTrigger>
                <TooltipContent>Quote found verbatim in the source (code check, not the model).</TooltipContent>
              </Tooltip>
            )}
            {k.verifier?.deterministic_check && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn('inline-flex items-center gap-1 text-[11px]', k.verifier.deterministic_check.passed ? 'text-met-fg' : 'text-missing-fg')}>
                    {k.verifier.deterministic_check.passed ? <Calculator className="size-3" /> : <ShieldAlert className="size-3" />}
                    rule check {k.verifier.deterministic_check.passed ? 'passed' : 'failed'}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{k.verifier.deterministic_check.detail}</TooltipContent>
              </Tooltip>
            )}
            {override && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-800 ring-1 ring-violet-200 ring-inset dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900">
                    <UserCheck className="size-3" /> overridden by reviewer
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {override.from.replace('_', ' ')} → {override.to.replace('_', ' ')}
                  {override.reason ? `: “${override.reason}”` : ''}
                </TooltipContent>
              </Tooltip>
            )}
            <span className="ml-auto flex items-center gap-3">
              {canOverride && caseId && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditing((v) => !v)
                  }}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11.5px]"
                >
                  <PenLine className="size-3" /> Override
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen((o) => !o)
                }}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11.5px]"
              >
                Reasoning <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
              </button>
            </span>
          </div>
          <AnimatePresence initial={false}>{editing && caseId && <OverrideForm caseId={caseId} k={k} onDone={() => setEditing(false)} />}</AnimatePresence>
          <AnimatePresence initial={false}>
            {open && (
              <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="text-muted-foreground mt-2 overflow-hidden text-[12.5px] leading-relaxed">
                {k.reasoning}
                {k.verifier?.deterministic_check && <span className="block">Check: {k.verifier.deterministic_check.detail}</span>}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.li>
  )
}

export function CriteriaTab({
  c,
  scoring,
  onScore,
  selectedId,
  onSelect,
  onGoToGaps,
  likelyGap = false,
  onCallNow,
  calling = false,
}: {
  likelyGap?: boolean
  onCallNow?: () => void
  calling?: boolean
  c: CaseDetail
  scoring: boolean
  onScore: () => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  onGoToGaps: () => void
}) {
  const policy = c.screening?.policy
  const groups = Array.from(new Set(c.criteria.map((k) => k.group)))
  const counts = {
    met: c.criteria.filter((k) => k.status === 'met' && k.group !== 'red_flag_any_of').length,
    total: c.criteria.filter((k) => k.group !== 'red_flag_any_of').length,
  }
  const openGaps = c.gaps.filter((g) => g.status === 'open').length
  const anyOfSatisfied = c.criteria.some((k) => k.group === 'any_of' && k.status === 'met')
  const canOverride = OVERRIDE_STATES.includes(String(c.state))
  // Latest reviewer override per criterion, read from the audit timeline.
  const overrides = useMemo(() => {
    const m = new Map<string, OverrideInfo>()
    for (const ev of c.timeline ?? []) {
      if (ev.type !== 'criterion.overridden') continue
      const p = ev.payload as Record<string, unknown>
      const id = String(p.criterion_id ?? '')
      if (id) m.set(id, { from: String(p.from_status ?? ''), to: String(p.to_status ?? ''), reason: String(p.reason ?? ''), at: ev.at })
    }
    return m
  }, [c.timeline])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold">
              {policy ? (policy.id.toLowerCase().startsWith(policy.insurer.toLowerCase()) ? policy.id : `${policy.insurer} · ${policy.id}`) : 'Policy'}{' '}
              {policy?.url && (
                <a href={policy.url} target="_blank" rel="noreferrer" className="text-primary ml-1 inline-flex items-center gap-1 text-xs font-medium hover:underline">
                  policy text <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <div className="text-muted-foreground text-xs">
              CPT {c.cpt} · {c.cpt_label}
              {groups.length > 0 && (
                <>
                  {' '}
                  · {groups.includes('all_of') ? 'all required criteria' : ''}
                  {groups.includes('any_of') ? (groups.includes('all_of') ? ' + at least one supporting finding' : 'at least one of') : ''}
                  {groups.includes('red_flag_any_of') ? ' · any red flag expedites' : ''}
                </>
              )}
            </div>
          </div>
          {c.criteria.length > 0 && (
            <div className="tabular text-right text-xs">
              <span className="text-foreground text-lg font-semibold">{counts.met}</span>
              <span className="text-muted-foreground">/{counts.total} met</span>
            </div>
          )}
        </div>
      </div>

      {likelyGap && c.overall !== 'ready' && c.overall !== 'expedite' && !c.call && (
        <div className="bg-unclear-bg/60 text-unclear-fg flex items-center gap-2 border-b px-5 py-2 text-[12.5px]">
          <PhoneCall className="size-3.5 shrink-0" />
          <span>
            <span className="font-semibold">Likely needs a physician call.</span> Most past cases under this policy did
            {c.criteria.length === 0 ? '; score first so the call asks only the open questions.' : '.'}
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {c.criteria.length === 0 ? (
          scoring ? (
            <div className="space-y-4 p-5">
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="text-primary size-4 animate-spin" /> Reading the note against {policy?.insurer ?? 'payer'} criteria, extracting verbatim quotes…
              </div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-6 w-[74px]" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-muted-foreground max-w-xs text-sm">Score the note against the payer's criteria to see which requirements are documented, with verbatim quotes.</p>
              <Button onClick={onScore} disabled={!c.screening}>
                Score evidence
              </Button>
            </div>
          )
        ) : (
          <ul className="divide-y">
            {c.criteria
              .filter((k) => k.group !== 'red_flag_any_of')
              .map((k) => (
                <CriterionRow key={k.id} k={k} caseId={c.id} canOverride={canOverride} override={overrides.get(k.id)} anyOfSatisfied={anyOfSatisfied} selected={selectedId === k.id} onSelect={() => onSelect(selectedId === k.id ? null : k.id)} />
              ))}
            {c.criteria.some((k) => k.group === 'red_flag_any_of') && (
              <li className="bg-muted/40 text-muted-foreground flex items-center gap-2 px-5 py-2 text-[11px] font-semibold tracking-wide uppercase">
                <Siren className="size-3.5" /> Red flags screened · any present expedites the request
              </li>
            )}
            {c.criteria
              .filter((k) => k.group === 'red_flag_any_of')
              .map((k) => (
                <CriterionRow key={k.id} k={k} caseId={c.id} canOverride={canOverride} override={overrides.get(k.id)} anyOfSatisfied={false} selected={selectedId === k.id} onSelect={() => onSelect(selectedId === k.id ? null : k.id)} />
              ))}
          </ul>
        )}
      </div>

      {c.criteria.length > 0 && (
        <div className="bg-card flex items-center justify-between gap-3 border-t px-5 py-3">
          <div className="flex items-center gap-3">
            <OverallPill overall={c.overall} size="lg" />
            {c.overall === 'expedite' && c.red_flags.length > 0 && (
              <ul className="text-expedite max-w-md text-xs font-medium" title={c.red_flags.join('\n')}>
                {compactFlags(c.red_flags, 3).map((f) => (
                  <li key={f} className="truncate">
                    {f.startsWith('+') ? f : `“${f}”`}
                  </li>
                ))}
              </ul>
            )}
            {c.overall === 'needs_info' && <span className="text-muted-foreground text-xs">{openGaps} open question{openGaps === 1 ? '' : 's'} for the physician</span>}
          </div>
          {c.overall === 'needs_info' && openGaps > 0 && likelyGap && onCallNow && !c.call ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={onGoToGaps}>
                Review questions
              </Button>
              <Button size="sm" onClick={onCallNow} disabled={calling}>
                {calling ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <PhoneCall data-icon="inline-start" />}
                Call {c.physician.name} now
              </Button>
            </div>
          ) : (
            c.overall === 'needs_info' &&
            openGaps > 0 && (
              <Button size="sm" onClick={onGoToGaps}>
                <PhoneCall data-icon="inline-start" /> Fill gaps
              </Button>
            )
          )}
        </div>
      )}
    </div>
  )
}
