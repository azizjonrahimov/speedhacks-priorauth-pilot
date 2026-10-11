import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ArrowRight, CheckCircle2, Clock, FilePlus2, Timer, TrendingUp } from 'lucide-react'
import { useCases, useCompletedCaseDetails, useMetrics } from '@/hooks/useApi'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { NumberTicker } from '@/components/NumberTicker'
import { CaseTable } from '@/components/CaseTable'
import { BASELINE_SECONDS, fmtClock, pct } from '@/lib/format'
import { cn } from '@/lib/utils'

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  loading,
  accent,
}: {
  label: string
  value: React.ReactNode
  sub: React.ReactNode
  icon: typeof Clock
  loading?: boolean
  accent?: boolean
}) {
  return (
    <Card size="sm" className={cn(accent && 'ring-primary/30 bg-gradient-to-br from-teal-50/70 to-transparent dark:from-teal-950/40')}>
      <CardContent className="flex flex-col gap-1">
        <div className="text-muted-foreground flex items-center justify-between text-[12.5px] font-medium">
          {label}
          <Icon className={cn('size-4', accent ? 'text-primary' : 'text-muted-foreground/70')} />
        </div>
        {loading ? <Skeleton className="mt-1 h-9 w-24" /> : <div className="tabular text-[2rem] leading-none font-semibold tracking-tight">{value}</div>}
        <div className="text-muted-foreground mt-1 text-xs">{sub}</div>
      </CardContent>
    </Card>
  )
}

const chartConfig = {
  baseline: { label: 'Manual baseline', color: 'var(--chart-2)' },
  ours: { label: 'With PriorAuth Pilot', color: 'var(--chart-1)' },
  saved: { label: 'Cumulative min saved', color: 'var(--chart-3)' },
} satisfies ChartConfig

export function Dashboard() {
  const metrics = useMetrics()
  const cases = useCases()
  const details = useCompletedCaseDetails(cases.data)

  const todayCount = useMemo(() => {
    const today = new Date().toDateString()
    return (cases.data ?? []).filter((c) => new Date(c.created_at).toDateString() === today).length
  }, [cases.data])

  const chart = useMemo(() => {
    const reviewed = details
      .map((q) => q.data)
      .filter((c): c is NonNullable<typeof c> => !!c && !!c.review)
      .sort((a, b) => a.review!.completed_at.localeCompare(b.review!.completed_at))
    let cum = 0
    return reviewed.map((c) => {
      const ours = Math.round((c.review!.review_seconds / 60) * 10) / 10
      cum += Math.max(0, 24 - ours)
      return { name: c.patient_name.split(' ')[0] + ' · ' + c.cpt, baseline: 24, ours, saved: Math.round(cum * 10) / 10 }
    })
  }, [details])

  const m = metrics.data
  const decided = (m?.approved ?? 0) + (m?.denied ?? 0) + (m?.pended ?? 0)
  const active = (cases.data ?? []).filter((c) => c.state !== 'closed')

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Prior authorizations across the practice, updated live.</p>
        </div>
        <Button asChild>
          <Link to="/new">
            <FilePlus2 data-icon="inline-start" /> New case
          </Link>
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          accent
          label="Staff minutes saved"
          icon={TrendingUp}
          loading={metrics.isLoading}
          value={<NumberTicker value={m?.minutes_saved_total ?? 0} />}
          sub={
            <>
              vs <span className="font-medium">24 min</span> manual baseline · {m?.completed ?? 0} completed
            </>
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
