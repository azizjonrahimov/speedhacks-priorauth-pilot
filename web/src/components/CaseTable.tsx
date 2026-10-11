import { Link, useNavigate } from 'react-router-dom'
import { FilePlus2, Inbox, Siren } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CaseSummary } from '@/api/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { OverallPill, StateBadge } from '@/components/StatusBadges'
import { fmtAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

export function CaseTable({ cases, loading, emptyHint }: { cases: CaseSummary[] | undefined; loading?: boolean; emptyHint?: string }) {
  const navigate = useNavigate()
  const open = (id: string) => navigate(`/cases/${id}`)
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[20%]">Patient</TableHead>
          <TableHead>Procedure</TableHead>
          <TableHead className="w-[15%]">Insurer</TableHead>
          <TableHead className="w-[12%]">State</TableHead>
          <TableHead className="w-[12%]">Overall</TableHead>
          <TableHead className="w-[11%] text-right">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: 6 }).map((__, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        {!loading && cases?.length === 0 && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={6} className="py-12">
              <div className="flex flex-col items-center gap-3 text-center">
                <span className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full">
                  <Inbox className="size-5" />
                </span>
                <div>
                  <div className="text-foreground text-sm font-medium">{emptyHint ?? 'No prior authorizations yet'}</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">Paste a visit note to start one. Shortcut: N.</div>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/new">
                    <FilePlus2 data-icon="inline-start" /> New case
                  </Link>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        )}
        {cases?.map((c) => (
          <TableRow
            key={c.id}
            tabIndex={0}
            role="link"
            onClick={() => open(c.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                open(c.id)
              }
            }}
            className={cn('focus-visible:ring-ring/50 h-12 cursor-pointer outline-none focus-visible:ring-2', c.expedited && 'border-l-expedite border-l-4')}
          >
            <TableCell className="font-medium">
              <div className="flex items-center gap-2">
                {c.patient_name}
                {c.expedited && (
                  <span className="text-expedite inline-flex items-center gap-1 text-[11px] font-semibold uppercase">
                    <Siren className="size-3.5" /> 72h
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="truncate" title={`${c.cpt} · ${c.cpt_label}`}>
              <span className="text-muted-foreground tabular mr-2 font-mono text-xs">{c.cpt}</span>
              {c.cpt_label}
            </TableCell>
            <TableCell className="truncate" title={c.insurer}>
              {c.insurer}
            </TableCell>
            <TableCell>
              <StateBadge state={c.state} />
            </TableCell>
            <TableCell>
              <OverallPill overall={c.overall} />
            </TableCell>
            <TableCell className="text-muted-foreground tabular text-right text-xs whitespace-nowrap">{fmtAgo(c.updated_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
