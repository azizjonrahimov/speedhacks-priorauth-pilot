import { Bot, CheckCircle2, PhoneCall, Quote, ShieldCheck, Stethoscope, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Browser chrome around a preview. Pure CSS, zero image weight. */
export function BrowserFrame({ url, children, className }: { url: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-card overflow-hidden rounded-xl shadow-2xl shadow-slate-900/10 ring-1 ring-slate-900/10 dark:shadow-black/40 dark:ring-white/10', className)}>
      <div className="bg-muted/70 flex h-9 items-center gap-2 border-b px-3">
        <span className="size-2.5 rounded-full bg-rose-400/80" />
        <span className="size-2.5 rounded-full bg-amber-400/80" />
        <span className="size-2.5 rounded-full bg-emerald-400/80" />
        <span className="bg-background text-muted-foreground mx-auto w-1/2 truncate rounded-md px-3 py-0.5 text-center font-mono text-[10.5px]">{url}</span>
      </div>
      {children}
    </div>
  )
}

function Row({ status, text, quote }: { status: 'met' | 'missing'; text: string; quote?: string }) {
  return (
    <div className="flex gap-2.5 border-b px-3 py-2.5 last:border-0">
      <span
        className={cn(
          'inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-semibold ring-1 ring-inset',
          status === 'met' ? 'bg-met-bg text-met-fg ring-emerald-200 dark:ring-emerald-900' : 'bg-missing-bg text-missing-fg ring-rose-200 dark:ring-rose-900',
        )}
      >
        {status === 'met' ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
        {status === 'met' ? 'Met' : 'Missing'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] leading-snug font-medium">{text}</div>
        {quote ? (
          <div className="border-met bg-met-bg/60 mt-1 flex gap-1.5 rounded border-l-2 px-2 py-1 text-[10.5px]">
            <Quote className="text-muted-foreground mt-px size-2.5 shrink-0" />“{quote}”
          </div>
        ) : (
          <div className="text-muted-foreground mt-1 text-[10.5px] italic">Will ask the physician by phone</div>
        )}
        {quote && (
          <div className="text-met-fg mt-1 flex items-center gap-1 text-[9.5px]">
            <ShieldCheck className="size-2.5" /> quote verified
          </div>
        )}
      </div>
    </div>
  )
}

/** A faithful, static miniature of the case view (note highlights, criteria, live call). */
export function ProductPreview() {
  return (
    <BrowserFrame url="app.priorauthpilot.com/cases/pa_db2e223b">
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <span className="text-[13px] font-semibold">Daniel Okafor</span>
        <span className="text-muted-foreground hidden text-[11px] sm:inline">72148 MRI lumbar spine · Aetna</span>
        <span className="bg-met-bg text-met-fg ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold">Approved · A1</span>
      </div>
      <div className="grid md:grid-cols-[1fr_1.15fr]">
        <div className="bg-card hidden border-r p-4 font-mono text-[10.5px] leading-[1.75] md:block">
          <div className="text-muted-foreground mb-1 font-sans text-[9.5px] font-semibold tracking-wide uppercase">Visit note</div>
          HPI: 47-year-old male with low back pain.{' '}
          <mark className="bg-met-bg text-met-fg decoration-met rounded-sm px-0.5 underline decoration-2 underline-offset-2">
            Sharp pain radiating down the posterior thigh into the lateral foot, S1 distribution.
          </mark>{' '}
          <mark className="bg-met-bg text-met-fg decoration-met rounded-sm px-0.5 underline decoration-2 underline-offset-2">
            Completed 8 weeks of conservative therapy
          </mark>{' '}
          including PT and naproxen. EXAM:{' '}
          <mark className="bg-met-bg text-met-fg decoration-met rounded-sm px-0.5 underline decoration-2 underline-offset-2">
            Diminished right ankle reflex (1+).
          </mark>{' '}
          No saddle anesthesia.
        </div>
        <div>
          <Row status="met" text="Radicular pain in a dermatomal distribution" quote="radiating … consistent with an S1 distribution" />
          <Row status="met" text="6+ weeks of conservative therapy without improvement" quote="Completed 8 weeks of conservative therapy" />
          <Row status="missing" text="Imaging result expected to change management" />
          <div className="bg-muted/40 m-3 rounded-lg p-2.5 ring-1 ring-slate-900/5 dark:ring-white/10">
            <div className="mb-2 flex items-center gap-2 text-[10.5px]">
              <span className="bg-met-bg text-met-fg inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold">
                <PhoneCall className="size-2.5" /> In call
              </span>
              <span className="text-muted-foreground">Dr. Priya Raman</span>
              <span className="tabular ml-auto font-semibold">0:41</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-end gap-1.5">
                <span className="bg-primary/10 text-primary flex size-4 items-center justify-center rounded-full"><Bot className="size-2.5" /></span>
                <div className="bg-card rounded-xl rounded-bl-sm px-2 py-1 text-[10px]">Will the MRI change management, e.g. a surgical referral?</div>
              </div>
              <div className="flex items-end justify-end gap-1.5">
                <div className="bg-primary text-primary-foreground rounded-xl rounded-br-sm px-2 py-1 text-[10px]">Yes, it decides between surgery and an epidural.</div>
                <span className="bg-foreground/10 flex size-4 items-center justify-center rounded-full"><Stethoscope className="size-2.5" /></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  )
}
