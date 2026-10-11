import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FilePlus2 } from 'lucide-react'
import { useCases } from '@/hooks/useApi'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CaseTable } from '@/components/CaseTable'
import { PageHeader } from '@/components/PageHeader'

const FILTERS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'open', label: 'In progress', match: (s) => !['approved', 'denied', 'pended', 'closed'].includes(s) },
  { key: 'submitted', label: 'Awaiting payer', match: (s) => s === 'submitted' || s === 'pended' },
  { key: 'done', label: 'Decided', match: (s) => ['approved', 'denied', 'closed'].includes(s) },
]

export function Cases() {
  const cases = useCases()
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0]
    const needle = q.trim().toLowerCase()
    return (cases.data ?? []).filter((c) => f.match(c.state) && (!needle || `${c.patient_name} ${c.cpt} ${c.cpt_label} ${c.insurer}`.toLowerCase().includes(needle)))
  }, [cases.data, filter, q])

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-4 md:p-6">
      <PageHeader
        title="Cases"
        description={`${cases.data?.length ?? 0} prior authorizations`}
        actions={
          <Button asChild>
            <Link to="/new">
              <FilePlus2 data-icon="inline-start" /> New case
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.key} value={f.key}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input placeholder="Search patient, CPT, insurer…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
      </div>
      <Card size="sm">
        <CardContent className="px-0">
          <CaseTable cases={rows} loading={cases.isLoading} emptyHint="No cases match." />
        </CardContent>
      </Card>
    </div>
  )
}
