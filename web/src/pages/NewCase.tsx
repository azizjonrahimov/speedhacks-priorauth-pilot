import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, FileText, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { api, queryKeys } from '@/api/client'
import type { CaseDetail, DemoNote, ScreenResult } from '@/api/types'
import { useDemoNotes, usePolicies } from '@/hooks/useApi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const EXPECT_LABEL: Record<string, { label: string; cls: string }> = {
  meets: { label: 'meets criteria', cls: 'bg-met-bg text-met-fg' },
  gap: { label: 'has a gap', cls: 'bg-unclear-bg text-unclear-fg' },
  red_flag: { label: 'red flag', cls: 'bg-missing-bg text-missing-fg' },
}

const empty = { name: '', dob: '', member_id: '', phone: '' }
const emptyMd = { name: '', npi: '', phone: '' }

export function NewCase() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const notes = useDemoNotes()
  const policies = usePolicies()

  const [note, setNote] = useState('')
  const [policyKey, setPolicyKey] = useState<string>('')
  const [insurer, setInsurer] = useState('')
  const [patient, setPatient] = useState(empty)
  const [physician, setPhysician] = useState(emptyMd)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [result, setResult] = useState<{ c: CaseDetail; screen: ScreenResult } | null>(null)

  const cpt = policyKey.split('|')[0] ?? ''
  const insurers = useMemo(() => Array.from(new Set((policies.data ?? []).map((p) => p.insurer))).sort(), [policies.data])

  const loadDemo = (n: DemoNote) => {
    setNote(n.text)
    setPolicyKey(`${n.cpt}|${n.insurer}`)
    setInsurer(n.insurer)
    setPatient(n.patient)
    setPhysician(n.physician)
    setLoadedId(n.id)
    setResult(null)
  }

  const check = useMutation({
    mutationFn: async () => {
      const { case: c } = await api.createCase({ note, cpt, insurer, patient, physician })
      const screen = await api.screen(c.id)
      return { c, screen }
    },
    onSuccess: (r) => {
      setResult(r)
      void qc.invalidateQueries({ queryKey: queryKeys.cases })
      void qc.invalidateQueries({ queryKey: queryKeys.metrics })
    },
    onError: (e: Error) => toast.error('Could not check requirements', { description: e.message }),
  })

  const lines = note ? note.split('\n').length : 0
  const canCheck = note.trim().length > 40 && cpt && insurer && patient.name && physician.name && !check.isPending

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5 p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">New case</h1>
        <p className="text-muted-foreground text-sm">Paste the visit note, pick the procedure and payer, and check whether prior authorization is required.</p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
        {/* Left: demo notes */}
        <Card size="sm" className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="text-primary size-4" /> Load demo note
            </CardTitle>
            <CardDescription>Synthetic notes from the backend. No real patient data.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {notes.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            {notes.data?.map((n) => {
              const ex = EXPECT_LABEL[n.expect] ?? { label: n.expect, cls: 'bg-muted text-muted-foreground' }
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => loadDemo(n)}
                  className={cn(
                    'hover:bg-muted flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    loadedId === n.id && 'border-primary bg-accent',
                  )}
                >
                  <span className="font-medium leading-tight">{n.label}</span>
                  <span className="text-muted-foreground flex items-center gap-2 text-[11px]">
                    <span className="tabular font-mono">{n.cpt}</span> · {n.insurer}
                    <span className={cn('rounded px-1.5 py-px text-[10px] font-semibold', ex.cls)}>{ex.label}</span>
                  </span>
                </button>
              )
            })}
          </CardContent>
        </Card>

        {/* Center: note */}
        <Card size="sm" className="min-h-[560px]">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="text-muted-foreground size-4" /> Visit note
              </CardTitle>
              <CardDescription>Raw text, exactly as charted. Quotes are matched against this text.</CardDescription>
            </div>
            <div className="text-muted-foreground tabular text-xs">
              {lines} lines · {note.length.toLocaleString()} chars
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <Textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                setResult(null)
              }}
              placeholder="CHIEF COMPLAINT: …&#10;HPI: …&#10;EXAM: …&#10;ASSESSMENT / PLAN: …"
              spellCheck={false}
              className="min-h-[480px] flex-1 resize-y font-mono text-[13.5px] leading-relaxed"
            />
          </CardContent>
        </Card>

        {/* Right: structured fields */}
        <div className="flex flex-col gap-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Procedure & payer</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-1.5">
                <Label>Procedure (CPT)</Label>
                <Select
                  value={policyKey}
                  onValueChange={(v) => {
                    setPolicyKey(v)
                    const ins = v.split('|')[1]
                    if (ins) setInsurer(ins)
                    setResult(null)
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={policies.isLoading ? 'Loading policies…' : 'Select procedure'} />
                  </SelectTrigger>
                  <SelectContent>
                    {policies.data?.map((p) => (
                      <SelectItem key={`${p.cpt}|${p.insurer}`} value={`${p.cpt}|${p.insurer}`}>
                        <span className="tabular font-mono text-xs">{p.cpt}</span> · {p.label} — {p.insurer} {p.policy_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Insurer</Label>
                <Select value={insurer} onValueChange={(v) => { setInsurer(v); setResult(null) }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select insurer" />
                  </SelectTrigger>
                  <SelectContent>
                    {insurers.map((i) => (
                      <SelectItem key={i} value={i}>
                        {i}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Patient</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Field label="Name" className="col-span-2" value={patient.name} onChange={(v) => setPatient({ ...patient, name: v })} />
              <Field label="Date of birth" type="date" value={patient.dob} onChange={(v) => setPatient({ ...patient, dob: v })} />
              <Field label="Member ID" value={patient.member_id} onChange={(v) => setPatient({ ...patient, member_id: v })} mono />
              <Field label="Mobile (for SMS updates)" className="col-span-2" value={patient.phone} onChange={(v) => setPatient({ ...patient, phone: v })} mono />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Ordering physician</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Field label="Name" className="col-span-2" value={physician.name} onChange={(v) => setPhysician({ ...physician, name: v })} />
              <Field label="NPI" value={physician.npi} onChange={(v) => setPhysician({ ...physician, npi: v })} mono />
              <Field label="Phone (for gap-fill call)" value={physician.phone} onChange={(v) => setPhysician({ ...physician, phone: v })} mono />
            </CardContent>
          </Card>

          <Button size="lg" disabled={!canCheck} onClick={() => check.mutate()} className="w-full">
            {check.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <ShieldCheck data-icon="inline-start" />}
            {check.isPending ? 'Checking payer rules…' : 'Check requirements'}
          </Button>

          {result && (
            <Card size="sm" className={cn('ring-2', result.screen.pa_required ? 'ring-primary/40' : 'ring-met/40')}>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  {result.screen.pa_required ? <ShieldCheck className="text-primary mt-0.5 size-5" /> : <CheckCircle2 className="text-met mt-0.5 size-5" />}
                  <div className="min-w-0">
                    <div className="text-base font-semibold">{result.screen.pa_required ? 'PA REQUIRED' : 'No PA required'}</div>
                    <div className="text-muted-foreground text-sm">
                      {result.screen.policy.id.toLowerCase().startsWith(result.screen.policy.insurer.toLowerCase()) ? result.screen.policy.id : `${result.screen.policy.insurer} ${result.screen.policy.id}`} · {result.screen.policy.label}
                    </div>
                    <a href={result.screen.policy.url} target="_blank" rel="noreferrer" className="text-primary mt-1 inline-flex items-center gap-1 text-xs hover:underline">
                      View policy <ExternalLink className="size-3" />
                    </a>
                  </div>
                </div>
                {result.screen.expedited && (
                  <div className="bg-missing-bg text-missing-fg flex items-start gap-2 rounded-md px-3 py-2 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <div>
                      <div className="font-semibold">Red flags detected — expedited (72h decision window)</div>
                      <ul className="mt-0.5 list-disc pl-4">
                        {result.screen.red_flags.map((f) => (
                          <li key={f}>“{f}”</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                {result.screen.pa_required ? (
                  <Button onClick={() => navigate(`/cases/${result.c.id}?score=1`)} className="w-full">
                    Score evidence against {result.screen.policy.insurer} criteria <ArrowRight data-icon="inline-end" />
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => navigate(`/cases/${result.c.id}`)} className="w-full">
                    Open case <ArrowRight data-icon="inline-end" />
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', className, mono }: { label: string; value: string; onChange: (v: string) => void; type?: string; className?: string; mono?: boolean }) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={cn(mono && 'tabular font-mono text-[13px]')} />
    </div>
  )
}
