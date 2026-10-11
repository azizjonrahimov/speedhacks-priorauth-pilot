import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GraduationCap, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { api, queryKeys } from '@/api/client'
import type { Lesson } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { fmtAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

const KIND: Record<string, { label: string; cls: string }> = {
  override: { label: 'Reviewer override', cls: 'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900' },
  quote_rejected: { label: 'Quote rejected', cls: 'bg-missing-bg text-missing-fg ring-rose-200 dark:ring-rose-900' },
  verifier_mismatch: { label: 'Verifier mismatch', cls: 'bg-unclear-bg text-unclear-fg ring-amber-200 dark:ring-amber-900' },
  call_overstep: { label: 'Call overstep', cls: 'bg-unclear-bg text-unclear-fg ring-amber-200 dark:ring-amber-900' },
}

function KindBadge({ kind, direction }: { kind: Lesson['kind']; direction: Lesson['direction'] }) {
  const k = KIND[kind] ?? { label: String(kind).replace(/_/g, ' '), cls: 'bg-muted text-muted-foreground ring-border' }
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset', k.cls)}>
      {k.label}
      {direction === 'under' && <span className="opacity-70">· under-called</span>}
      {direction === 'over' && <span className="opacity-70">· over-called</span>}
    </span>
  )
}

export function Lessons() {
  const qc = useQueryClient()
  const lessons = useQuery({ queryKey: queryKeys.lessons, queryFn: api.lessons })
  const summary = useQuery({ queryKey: queryKeys.lessonsSummary, queryFn: () => api.lessonsSummary(false), staleTime: 60_000 })
  const [regenerating, setRegenerating] = useState(false)
  const rows = useMemo(() => [...(lessons.data?.lessons ?? [])].sort((a, b) => b.last_seen.localeCompare(a.last_seen)), [lessons.data])

  const regenerate = async () => {
    setRegenerating(true)
    try {
      const r = await api.lessonsSummary(true)
      qc.setQueryData(queryKeys.lessonsSummary, r)
    } finally {
      setRegenerating(false)
    }
  }

  const s = summary.data?.summary
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-4 md:p-6">
      <PageHeader
        title="Lessons learned"
        description="Corrections from reviewers, the quote verifier and physician calls, turned into rules the system applies to future cases under the same policy. No patient data is stored here."
      />

      <Card size="sm" className="ring-primary/25 bg-gradient-to-br from-teal-50/60 to-transparent dark:from-teal-950/30">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="text-primary size-4" /> What I learned
            </CardTitle>
            <CardDescription>
              {s
                ? `${s.generator === 'llm' ? 'Written by Claude' : 'Generated from template'} from ${s.lessons_count} lesson${s.lessons_count === 1 ? '' : 's'} · ${fmtAgo(s.generated_at)}${s.stale ? ' · out of date' : ''}`
                : 'Summary of everything the system has learned so far.'}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={regenerate} disabled={regenerating}>
            {regenerating ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
            {regenerating ? 'Writing…' : 'Regenerate'}
          </Button>
        </CardHeader>
        <CardContent>
          {summary.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : s?.text ? (
            <div className="max-w-3xl space-y-2 text-[14px] leading-relaxed whitespace-pre-line">{s.text}</div>
          ) : (
            <p className="text-muted-foreground text-sm">Nothing learned yet. Overrides and verifier corrections will appear here.</p>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>All lessons</CardTitle>
          <CardDescription>
            {lessons.data ? `${lessons.data.total} lesson${lessons.data.total === 1 ? '' : 's'} from ${lessons.data.total_occurrences} correction${lessons.data.total_occurrences === 1 ? '' : 's'}` : 'Loading…'}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table className="min-w-[820px] table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[17%]">Kind</TableHead>
                <TableHead className="w-[17%]">Policy</TableHead>
                <TableHead className="w-[14%]">Criterion</TableHead>
                <TableHead>Lesson</TableHead>
                <TableHead className="w-[7%] text-right">Count</TableHead>
                <TableHead className="w-[11%] text-right">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lessons.isLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!lessons.isLoading && rows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-12">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <span className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full">
                        <GraduationCap className="size-5" />
                      </span>
                      <div className="text-sm font-medium">No lessons yet</div>
                      <div className="text-muted-foreground text-xs">Override a criterion on any case to teach the system.</div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((l) => (
                <TableRow key={l.id} className="align-top">
                  <TableCell>
                    <KindBadge kind={l.kind} direction={l.direction} />
                  </TableCell>
                  <TableCell className="truncate text-[13px]" title={l.policy_id}>
                    {l.policy_id}
                  </TableCell>
                  <TableCell className="text-muted-foreground truncate font-mono text-xs" title={l.criterion_id ?? ''}>
                    {l.criterion_id ?? '—'}
                  </TableCell>
                  <TableCell className="text-[13px] leading-snug whitespace-normal">{l.summary}</TableCell>
                  <TableCell className="tabular text-right font-semibold">{l.count}</TableCell>
                  <TableCell className="text-muted-foreground tabular text-right text-xs">{fmtAgo(l.last_seen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
