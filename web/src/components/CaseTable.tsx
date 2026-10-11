import { useNavigate } from 'react-router-dom'
import { Siren } from 'lucide-react'
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
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[22%]">Patient</TableHead>
          <TableHead>Procedure</TableHead>
          <TableHead className="w-[14%]">Insurer</TableHead>
          <TableHead className="w-[13%]">State</TableHead>
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
          <TableRow>
            <TableCell colSpan={6} className="text-muted-foreground h-24 text-center">
              {emptyHint ?? 'No cases yet. Press N to start one.'}
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
            <TableCell>
              <span className="text-muted-foreground tabular mr-2 font-mono text-xs">{c.cpt}</span>
              {c.cpt_label}
            </TableCell>
            <TableCell>{c.insurer}</TableCell>
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
