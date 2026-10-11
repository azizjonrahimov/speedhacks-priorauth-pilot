import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ArrowRight, CheckCircle2, Clock, FilePlus2, RefreshCw, Timer, TrendingUp } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, queryKeys } from '@/api/client'
import type { Metrics } from '@/api/types'
import { useCases, useMetrics } from '@/hooks/useApi'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { NumberTicker } from '@/components/NumberTicker'
import { CaseTable } from '@/components/CaseTable'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BASELINE_SECONDS, fmtAgo, fmtClock, fmtTime, pct } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PageHeader, greeting } from '@/components/PageHeader'
import { useDemoUser } from '@/lib/auth'

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  loading,
  accent,
  badge,
}: {
  label: string
  value: React.ReactNode
  sub: React.ReactNode
  icon: typeof Clock
  loading?: boolean
  accent?: boolean
  badge?: React.ReactNode
}) {
  return (
    <Card size="sm" className={cn(accent && 'ring-primary/30 bg-gradient-to-br from-teal-50/70 to-transparent dark:from-teal-950/40')}>
      <CardContent className="flex flex-col gap-1">
        <div className="text-muted-foreground flex items-center justify-between gap-2 text-[12.5px] font-medium">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap sm:whitespace-nowrap">
            {label}
            {badge}
          </span>
          <Icon className={cn('size-4 shrink-0', accent ? 'text-primary' : 'text-muted-foreground/70')} />
        </div>
        {loading ? <Skeleton className="mt-1 h-9 w-24" /> : <div className="tabular text-[2rem] leading-none font-semibold tracking-tight">{value}</div>}
        <div className="text-muted-foreground mt-1 text-xs">{sub}</div>
      </CardContent>
    </Card>
  )
}

function KeewanoBadge({ m }: { m: Metrics }) {
  const qc = useQueryClient()
  const k = m.keewano ?? {}
  const asOf = m.as_of ?? k.as_of ?? null
  const refresh = useMutation({
    mutationFn: api.keewanoRefresh,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: queryKeys.metrics })
      if (r?.insights?.error) toast.warning('Keewano refresh returned an error', { description: r.insights.error })
      else toast.success('Refreshed from Keewano')
    },
    onError: (e: Error) => toast.error('Keewano refresh failed', { description: e.message }),
  })
  return (
    <span className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="bg-primary/10 text-primary inline-flex h-5 cursor-default items-center gap-1 rounded-full pr-0.5 pl-2 text-[10.5px] font-semibold whitespace-nowrap">
            <span className="relative flex size-1.5">
              <span className="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-60" />
              <span className="bg-primary relative inline-flex size-1.5 rounded-full" />
            </span>
            live from Keewano
            <button
              type="button"
              aria-label="Refresh from Keewano"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              className="hover:bg-primary/15 ml-0.5 inline-flex size-4 items-center justify-center rounded-full disabled:opacity-60"
            >
              <RefreshCw className={cn('size-2.5', refresh.isPending && 'animate-spin')} />
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-0.5">
          <div>Minutes saved use Keewano's median staff review time{k.median_review_s != null ? ` (${fmtClock(k.median_review_s)})` : ''}.</div>
          {k.call_share != null && <div>{Math.round(k.call_share * 100)}% of cases needed a physician call.</div>}
          {k.note && <div className="opacity-80">{k.note}</div>}
          <div className="opacity-80">{asOf ? `As of ${fmtTime(asOf)} · ${fmtAgo(asOf)} · data lags about 5 min` : 'Refresh time unknown'}</div>
        </TooltipContent>
      </Tooltip>
    </span>
  )
}

/** "41 cases · 40 synthetic history"; tolerant of missing fields. */
function keewanoBasis(m: Metrics | undefined): string | null {
  if (m?.source !== 'keewano') return null
  const scored = m.keewano?.cases_scored
  const synthetic = m.keewano?.synthetic_cases
  if (scored == null) return null
  return `${scored} case${scored === 1 ? '' : 's'}${synthetic != null && synthetic > 0 ? ` · ${synthetic} synthetic history` : ''}`
}

const chartConfig = {
  baseline: { label: 'Manual baseline', color: 'var(--chart-2)' },
  ours: { label: 'With PriorAuth Pilot', color: 'var(--chart-1)' },
  saved: { label: 'Cumulative min saved', color: 'var(--chart-3)' },
} satisfies ChartConfig

export function Dashboard() {
  const metrics = useMetrics()
  const cases = useCases()
  const user = useDemoUser()

  const todayCount = useMemo(() => {
    const today = new Date().toDateString()
    return (cases.data ?? []).filter((c) => new Date(c.created_at).toDateString() === today).length
  }, [cases.data])

  // Per-case staff time comes from CaseSummary.review_seconds (null until review.completed).
  const chart = useMemo(() => {
    const reviewed = (cases.data ?? [])
      .filter((c) => c.review_seconds != null)
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    const rows: { name: string; baseline: number; ours: number; saved: number }[] = []
    let cum = 0
    for (const c of reviewed) {
      const ours = Math.round((c.review_seconds! / 60) * 10) / 10
      cum += Math.max(0, 24 - ours)
      rows.push({ name: c.patient_name.split(' ')[0] + ' · ' + c.cpt, baseline: 24, ours, saved: Math.round(cum * 10) / 10 })
    }
    return rows
  }, [cases.data])

  const m = metrics.data
  const decided = (m?.approved ?? 0) + (m?.denied ?? 0) + (m?.pended ?? 0)
  const active = (cases.data ?? []).filter((c) => c.state !== 'closed')

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-4 md:p-6">
      <PageHeader
        title={greeting(user?.name)}
        description="Prior authorizations across the practice, updated live."
        actions={
          <Button asChild>
            <Link to="/new">
              <FilePlus2 data-icon="inline-start" /> New case
            </Link>
          </Button>
        }
      />

      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          accent
          label="Staff minutes saved"
          icon={TrendingUp}
          loading={metrics.isLoading}
          badge={m?.source === 'keewano' ? <KeewanoBadge m={m} /> : null}
          value={<NumberTicker value={m?.minutes_saved_total ?? 0} />}
          sub={
            keewanoBasis(m) ? (
              <>
                vs <span className="font-medium">24 min</span> baseline · Keewano basis: <span className="tabular">{keewanoBasis(m)}</span>
              </>
            ) : (
              <>
                vs <span className="font-medium">24 min</span> manual baseline · {m?.completed ?? 0} completed
              </>
            )
          }
        />
        <Kpi label="Cases today" icon={FilePlus2} loading={cases.isLoading} value={<NumberTicker value={todayCount} />} sub={`${active.length} active · ${m?.cases ?? 0} total`} />
        <Kpi
          label="Approval rate"
          icon={CheckCircle2}
          loading={metrics.isLoading}
          value={decided ? <NumberTicker value={Math.round(((m?.approved ?? 0) / decided) * 100)} suffix="%" /> : '—'}
          sub={`${m?.approved ?? 0} approved · ${m?.pended ?? 0} pended · ${m?.denied ?? 0} denied`}
        />
        <Kpi
          label="Avg staff review time"
          icon={Timer}
          loading={metrics.isLoading}
          value={<NumberTicker value={m?.avg_review_seconds ?? 0} format={fmtClock} />}
          sub={m?.avg_review_seconds ? `${pct(BASELINE_SECONDS - m.avg_review_seconds, BASELINE_SECONDS)} faster than manual` : 'No completed reviews yet'}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card size="sm" className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Minutes per prior auth</CardTitle>
            <CardDescription>Manual baseline (24 min, CAQH) vs staff review time with the copilot, per completed case.</CardDescription>
          </CardHeader>
          <CardContent>
            {chart.length === 0 ? (
              <div className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">Complete a case to see the comparison.</div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[200px] w-full">
                <BarChart data={chart} barGap={4}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
                  <YAxis width={28} tickLine={false} axisLine={false} fontSize={12} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="baseline" fill="var(--color-baseline)" radius={4} />
                  <Bar dataKey="ours" fill="var(--color-ours)" radius={4} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
        <Card size="sm" className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Cumulative minutes saved</CardTitle>
            <CardDescription>Running total across completed cases.</CardDescription>
          </CardHeader>
          <CardContent>
            {chart.length === 0 ? (
              <div className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">—</div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[200px] w-full">
                <LineChart data={chart}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} hide />
                  <YAxis width={28} tickLine={false} axisLine={false} fontSize={12} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="saved" stroke="var(--color-saved)" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </section>

      <Card size="sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Case queue</CardTitle>
            <CardDescription>Click a row or press Enter to open the case.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/cases">
              All cases <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          <CaseTable cases={cases.data?.slice(0, 8)} loading={cases.isLoading} />
        </CardContent>
      </Card>
    </div>
  )
}
