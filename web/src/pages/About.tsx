import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTitle } from '@/hooks/useTitle'

export function About() {
  useTitle('About')
  return (
    <main className="mx-auto max-w-3xl px-4 py-20 md:px-6 md:py-28">
      <div className="text-primary text-sm font-semibold">About</div>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">Give the front desk its afternoons back.</h1>
      <div className="text-muted-foreground mt-8 space-y-5 text-lg leading-relaxed">
        <p>
          Small practices carry the same prior-authorization burden as hospital systems, without the revenue-cycle team. Staff copy findings from the note into payer portals, wait on hold, and chase physicians between patients.
        </p>
        <p>
          PriorAuth Pilot does the reading, the matching and the chasing. It cites the note for every criterion, asks the physician only what the note doesn't say, and assembles a standards-based submission. A person reviews every case before it goes out.
        </p>
        <p>
          We built it in one day at SpeedHacks in San Francisco with Claude for reasoning, Dial for the physician call, Keewano for live analytics, and the HL7 Da Vinci Prior Authorization Support guide for submission.
        </p>
      </div>
      <dl className="mt-12 grid grid-cols-2 gap-6 border-t pt-8 sm:grid-cols-4">
        {[
          ['6', 'payer policies'],
          ['1 day', 'to build'],
          ['0', 'unverified quotes'],
          ['100%', 'synthetic data'],
        ].map(([k, l]) => (
          <div key={l}>
            <dt className="tabular text-3xl font-semibold tracking-tight">{k}</dt>
            <dd className="text-muted-foreground mt-1 text-sm">{l}</dd>
          </div>
        ))}
      </dl>
      <Button size="lg" asChild className="mt-12 h-11 px-5">
        <Link to="/app">
          Open the live demo <ArrowRight data-icon="inline-end" />
        </Link>
      </Button>
    </main>
  )
}
