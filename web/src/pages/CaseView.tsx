import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Siren } from 'lucide-react'
import { api, queryKeys } from '@/api/client'
import { useCase, useEvents } from '@/hooks/useApi'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { StateBadge } from '@/components/StatusBadges'
import { NotePane } from '@/components/case/NotePane'
import { CriteriaTab } from '@/components/case/CriteriaTab'
import { GapFillTab } from '@/components/case/GapFillTab'
import { PacketTab } from '@/components/case/PacketTab'
import { TimelineTab } from '@/components/case/TimelineTab'
import { fmtDob } from '@/lib/format'
import { likelyGap } from '@/lib/likelyGap'

/** red_flags mixes short note quotes with full criterion sentences; prefer the short ones and cap the list. */
export function compactFlags(flags: string[], max = 4): string[] {
  const short = flags.filter((f) => f.length <= 60)
  const list = (short.length ? short : flags).slice(0, max).map((f) => (f.length > 60 ? f.slice(0, 57).trimEnd() + '…' : f))
  const rest = flags.length - list.length
  return rest > 0 ? [...list, `+${rest} more`] : list
}

export function CaseView() {
  const { id } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const q = useCase(id)
  const events = useEvents(id)
  const [tab, setTab] = useState('criteria')
  const [selected, setSelected] = useState<string | null>(null)
  const c = q.data

  const score = useMutation({
    mutationFn: () => api.score(id!),
    onSuccess: (r) => {
      toast.success(`Scored: ${r.criteria.filter((k) => k.status === 'met').length} of ${r.criteria.length} criteria documented`)
      void qc.invalidateQueries({ queryKey: queryKeys.case(id!) })
      void qc.invalidateQueries({ queryKey: queryKeys.cases })
      void qc.invalidateQueries({ queryKey: queryKeys.events(id!) })
    },
    onError: (e: Error) => toast.error('Scoring failed', { description: e.message }),
  })

  // Surfaced early when Keewano says this policy usually needs a physician call.
  const callNow = useMutation({
    mutationFn: () => api.gapfillCall(id!),
    onSuccess: () => {
      toast.info(`Calling ${c?.physician.name ?? 'physician'}…`)
      setTab('gaps')
      void qc.invalidateQueries({ queryKey: queryKeys.case(id!) })
      void qc.invalidateQueries({ queryKey: queryKeys.cases })
    },
    onError: (e: Error) => toast.error('Could not place call', { description: e.message }),
  })

  // Auto-trigger scoring once when arriving from intake with ?score=1
  const fired = useRef(false)
  useEffect(() => {
    if (!c || fired.current) return
    if (params.get('score') === '1') {
      fired.current = true
      setParams({}, { replace: true })
      // Survive StrictMode double-effects and dev remounts: score each case at most once per session.
      const key = `pap.autoscore.${c.id}`
      let already = false
      try {
        already = sessionStorage.getItem(key) === '1'
        sessionStorage.setItem(key, '1')
      } catch {
        /* ignore */
      }
      if (c.criteria.length === 0 && !already) score.mutate()
    }
  }, [c, params, setParams, score])

  // Jump tabs when the backend progresses (e.g. call ends -> criteria re-scored)
  const prevState = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!c) return
    if (prevState.current && prevState.current !== c.state) {
      if (c.state === 'evidence_rescored') setTab('criteria')
    }
    prevState.current = c.state
  }, [c])

  if (q.isError) {
    return (
      <div className="p-8">
        <p className="text-destructive text-sm">Could not load case: {(q.error as Error).message}</p>
        <Button variant="outline" asChild className="mt-3">
          <Link to="/">
            <ArrowLeft data-icon="inline-start" /> Back to dashboard
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-svh flex-col">
      {/* Sticky header */}
      <header className="no-print bg-card/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-5">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to="/" aria-label="Back">
              <ArrowLeft />
            </Link>
          </Button>
          {c ? (
            <>
              <div className="flex min-w-0 items-baseline gap-3">
                <h1 className="truncate text-lg font-semibold tracking-tight">{c.patient_name}</h1>
                <span className="text-muted-foreground tabular text-sm">DOB {fmtDob(c.patient.dob)}</span>
                <span className="text-muted-foreground text-sm">·</span>
                <span className="text-sm">
                  <span className="tabular font-mono text-xs">{c.cpt}</span> {c.cpt_label}
                </span>
                <span className="text-muted-foreground text-sm">·</span>
                <span className="text-sm font-medium">{c.insurer}</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-muted-foreground tabular font-mono text-xs">{c.id}</span>
                <StateBadge state={c.state} />
              </div>
            </>
          ) : (
            <Skeleton className="h-6 w-96" />
          )}
        </div>
        {c?.expedited && (
          <div className="bg-expedite flex items-center gap-2 px-5 py-1.5 text-[13px] font-medium text-white" title={c.red_flags.join('\n')}>
            <Siren className="size-4 shrink-0" />
            <span className="truncate">
              Expedited — 72-hour decision window (CMS-0057-F). Red flags: {compactFlags(c.red_flags).join(' · ')}
            </span>
          </div>
        )}
      </header>

      {/* Two panes */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section className="no-print bg-card min-h-0 border-r">
          {c ? <NotePane note={c.note} criteria={c.criteria} selectedId={selected} onSelect={setSelected} /> : <div className="space-y-3 p-6">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>}
        </section>
        <section className="min-h-0">
          {c ? (
            <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col gap-0">
              <TabsList variant="line" className="no-print h-11 w-full justify-start gap-4 rounded-none border-b px-5">
                <TabsTrigger value="criteria">
                  Criteria
                  {c.criteria.length > 0 && (
                    <span className="text-muted-foreground tabular ml-1 text-xs">
                      {c.criteria.filter((k) => k.status === 'met' && k.group !== 'red_flag_any_of').length}/{c.criteria.filter((k) => k.group !== 'red_flag_any_of').length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="gaps">
                  Gap fill
                  {c.overall === 'needs_info' && c.gaps.filter((g) => g.status === 'open').length > 0 && (
                    <span className="bg-unclear text-white tabular ml-1 rounded-full px-1.5 text-[10px] font-bold">{c.gaps.filter((g) => g.status === 'open').length}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="packet">Packet</TabsTrigger>
                <TabsTrigger value="timeline">
                  Timeline <span className="text-muted-foreground tabular ml-1 text-xs">{events.data?.length ?? c.timeline?.length ?? 0}</span>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="criteria" className="min-h-0 flex-1">
                <CriteriaTab
                  c={c}
                  scoring={score.isPending}
                  onScore={() => score.mutate()}
                  selectedId={selected}
                  onSelect={setSelected}
                  onGoToGaps={() => setTab('gaps')}
                  likelyGap={likelyGap(c)}
                  onCallNow={() => callNow.mutate()}
                  calling={callNow.isPending}
                />
              </TabsContent>
              <TabsContent value="gaps" className="min-h-0 flex-1 overflow-auto">
                <GapFillTab c={c} />
              </TabsContent>
              <TabsContent value="packet" className="min-h-0 flex-1 overflow-auto">
                <PacketTab c={c} />
              </TabsContent>
              <TabsContent value="timeline" className="min-h-0 flex-1 overflow-auto">
                <TimelineTab events={events.data ?? c.timeline} loading={events.isLoading && !c.timeline} />
              </TabsContent>
            </Tabs>
          ) : null}
        </section>
      </div>
    </div>
  )
}
