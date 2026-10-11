import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ClipboardPaste, FileCheck2, History, PhoneCall, ScanSearch, ShieldCheck, Sigma, Timer } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { NumberTicker } from '@/components/NumberTicker'
import { ProductPreview } from '@/components/marketing/ProductPreview'
import { useTitle } from '@/hooks/useTitle'

const STEPS = [
  { icon: ClipboardPaste, title: 'Paste the visit note', body: 'Pick the procedure and payer. We check whether prior authorization is required and flag red-flag cases for a 72-hour decision.' },
  { icon: ScanSearch, title: 'AI scores it with verified quotes', body: "Every payer criterion is matched to a verbatim quote from the note. Quotes are checked character-for-character before you see them." },
  { icon: PhoneCall, title: 'AI calls the physician', body: 'Only the questions the note leaves open. A voice agent asks, records the answer, and re-scores the case while staff keep working.' },
  { icon: FileCheck2, title: 'Packet submitted', body: 'Letter of medical necessity plus an HL7 Da Vinci PAS FHIR bundle, submitted with retries. The patient gets a text when it is approved.' },
]

const TRUST = [
  { icon: ShieldCheck, title: 'Every quote verified', body: 'The model must cite the note. Code confirms each quote is an exact substring at the stated offsets, or the criterion is downgraded to unclear.' },
  { icon: Sigma, title: 'Deterministic rule checks', body: 'Weeks of therapy, BMI, age and scores are re-checked in code against the policy thresholds, independent of the model.' },
  { icon: History, title: 'Full audit timeline', body: 'Every step, from screening to the payer response, is an append-only event with actor and timestamp. Staff stay in control and sign off.' },
]

const PARTNERS = ['Claude', 'Dial', 'Keewano', 'HL7 FHIR · Da Vinci PAS']

function useLiveNumbers() {
  const q = useQuery({ queryKey: ['metrics'], queryFn: api.metrics, retry: 0, staleTime: 30_000 })
  const m = q.data
  const reviewS = m?.keewano?.median_review_s ?? (m?.avg_review_seconds || null)
  return {
    baseline: m?.baseline_minutes ?? 24,
    ours: reviewS ? Math.round((reviewS / 60) * 10) / 10 : 5,
    live: !!reviewS,
    source: m?.source === 'keewano' ? 'Keewano' : 'our pilot',
    cases: m?.keewano?.cases_scored ?? m?.cases ?? null,
  }
}

export function Landing() {
  useTitle(undefined)
  const n = useLiveNumbers()
  const saved = Math.max(0, n.baseline - n.ours)
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 md:px-6 md:pt-24 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <div className="text-primary bg-primary/10 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold">
              Prior authorization copilot for small practices
            </div>
            <h1 className="mt-5 text-4xl leading-[1.05] font-semibold tracking-tight text-balance md:text-6xl">
              Prior auths in minutes, <span className="text-primary">not half an hour.</span>
            </h1>
            <p className="text-muted-foreground mt-5 max-w-xl text-lg text-pretty">
              PriorAuth Pilot reads the visit note, proves each payer criterion with a verified quote, calls the physician for what is missing, and submits the packet. Your staff review and sign off.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild className="h-11 px-5 text-[15px]">
                <Link to="/app">
                  See the live demo <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="h-11 px-5 text-[15px]">
                <a href="#how">How it works</a>
              </Button>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t pt-6">
              <div>
                <dt className="text-muted-foreground text-xs">Manual PA (CAQH)</dt>
                <dd className="tabular mt-1 text-3xl font-semibold tracking-tight">
                  {n.baseline}
                  <span className="text-muted-foreground text-base font-normal"> min</span>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">With PriorAuth Pilot</dt>
                <dd className="text-primary tabular mt-1 text-3xl font-semibold tracking-tight">
                  <NumberTicker value={n.ours} decimals={1} />
                  <span className="text-muted-foreground text-base font-normal"> min</span>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Saved per PA</dt>
                <dd className="tabular mt-1 text-3xl font-semibold tracking-tight">
                  <NumberTicker value={saved} decimals={1} />
                  <span className="text-muted-foreground text-base font-normal"> min</span>
                </dd>
              </div>
            </dl>
            <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
              <Timer className="size-3.5" />
              {n.live ? `Median staff review time, live from ${n.source}${n.cases ? ` (${n.cases} cases, including synthetic history)` : ''}.` : 'Target staff review time; live figures load from the pilot.'} Baseline: CAQH Index.
            </p>
          </div>
          <div className="relative">
            <ProductPreview />
          </div>
        </div>
      </section>

      {/* Partners */}
      <section className="border-y">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-8 md:flex-row md:gap-10 md:px-6">
          <span className="text-muted-foreground shrink-0 text-xs font-medium tracking-wide uppercase">Built on</span>
          <ul className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-lg font-semibold tracking-tight md:justify-between md:flex-1">
            {PARTNERS.map((p) => (
              <li key={p} className="opacity-80 transition-opacity hover:opacity-100">
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Problem numbers */}
      <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Prior auth eats the front desk.</h2>
          <p className="text-muted-foreground mt-4 text-lg">
            A physician's office handles about 40 prior authorizations a week. Each one takes around 24 minutes of staff time, most of it chasing documentation the note already has or the physician could answer in one sentence.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {[
            { k: '40', l: 'PAs per physician per week', s: 'AMA physician survey' },
            { k: '24 min', l: 'staff time per manual PA', s: 'CAQH Index' },
            { k: '~13 h', l: 'per physician per week', s: 'AMA physician survey' },
          ].map((x) => (
            <div key={x.l} className="bg-card rounded-xl p-6 ring-1 ring-slate-900/5 dark:ring-white/10">
              <div className="tabular text-4xl font-semibold tracking-tight">{x.k}</div>
              <div className="mt-2 text-sm">{x.l}</div>
              <div className="text-muted-foreground mt-1 text-xs">{x.s}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-muted/40 scroll-mt-16 border-y">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <div className="max-w-2xl">
            <div className="text-primary text-sm font-semibold">How it works</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">From visit note to submitted packet.</h2>
          </div>
          <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="bg-card relative rounded-xl p-6 ring-1 ring-slate-900/5 dark:ring-white/10">
                <div className="flex items-center gap-3">
                  <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                    <s.icon className="size-4.5" />
                  </span>
                  <span className="text-muted-foreground tabular font-mono text-xs">0{i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Trust */}
      <section id="trust" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 md:px-6 md:py-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <div className="text-primary text-sm font-semibold">Trust</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">AI that shows its work.</h2>
            <p className="text-muted-foreground mt-4 text-lg">
              Payers reject vague letters. Clinicians distrust black boxes. Every claim PriorAuth Pilot makes points back to the source, and the checks that matter run in code.
            </p>
          </div>
          <ul className="grid gap-4">
            {TRUST.map((t) => (
              <li key={t.title} className="bg-card flex gap-4 rounded-xl p-5 ring-1 ring-slate-900/5 dark:ring-white/10">
                <span className="bg-met-bg text-met-fg flex size-10 shrink-0 items-center justify-center rounded-lg">
                  <t.icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{t.title}</h3>
                  <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{t.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-24 md:px-6">
        <div className="bg-primary text-primary-foreground mx-auto flex max-w-6xl flex-col items-start gap-6 rounded-2xl px-8 py-12 md:flex-row md:items-center md:justify-between md:px-12">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">See a prior auth go end to end.</h2>
            <p className="text-primary-foreground/80 mt-2 max-w-xl">Six synthetic cases, real payer criteria, a real phone call to the physician. About three minutes.</p>
          </div>
          <Button size="lg" variant="secondary" asChild className="h-11 px-5 text-[15px]">
            <Link to="/app">
              Open the live demo <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
