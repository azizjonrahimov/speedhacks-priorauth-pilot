import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTitle } from '@/hooks/useTitle'
import { cn } from '@/lib/utils'

const PLANS = [
  {
    name: 'Pilot',
    price: '$0',
    per: 'for 30 days',
    blurb: 'Try it on your own payer mix with synthetic or de-identified notes.',
    features: ['Up to 50 prior auths', 'All payer policies in the library', 'Verified quotes and rule checks', 'Email support'],
    cta: 'Start free pilot',
    to: '/signup',
  },
  {
    name: 'Practice',
    price: '$12',
    per: 'per prior auth',
    blurb: 'For independent practices. Pay only for submitted authorizations.',
    features: ['Physician gap-fill calls included', 'FHIR Da Vinci PAS submission', 'Patient SMS updates', 'Audit timeline export', 'BAA available'],
    cta: 'Talk to us',
    to: '/signup',
    featured: true,
  },
  {
    name: 'Group',
    price: 'Custom',
    per: 'volume pricing',
    blurb: 'Multi-site groups and MSOs with EHR integration needs.',
    features: ['EHR integration (FHIR / HL7v2)', 'Custom payer policies', 'SSO and role-based access', 'Dedicated success manager'],
    cta: 'Contact sales',
    to: '/signup',
  },
]

export function Pricing() {
  useTitle('Pricing')
  return (
    <main className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <div className="text-primary text-sm font-semibold">Pricing</div>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">Pay for authorizations, not seats.</h1>
        <p className="text-muted-foreground mt-4 text-lg">At 24 minutes of staff time per manual PA, one saved hour covers several requests.</p>
      </div>
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => (
          <div
            key={p.name}
            className={cn(
              'bg-card flex flex-col rounded-2xl p-7 ring-1 ring-slate-900/5 dark:ring-white/10',
              p.featured && 'ring-primary relative shadow-xl shadow-teal-900/10 ring-2',
            )}
          >
            {p.featured && <span className="bg-primary text-primary-foreground absolute -top-3 left-7 rounded-full px-2.5 py-0.5 text-xs font-semibold">Most practices</span>}
            <h2 className="font-semibold">{p.name}</h2>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="tabular text-4xl font-semibold tracking-tight">{p.price}</span>
              <span className="text-muted-foreground text-sm">{p.per}</span>
            </div>
            <p className="text-muted-foreground mt-3 text-sm">{p.blurb}</p>
            <ul className="mt-6 flex-1 space-y-2.5 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="text-primary mt-0.5 size-4 shrink-0" /> {f}
                </li>
              ))}
            </ul>
            <Button asChild variant={p.featured ? 'default' : 'outline'} className="mt-8 h-10">
              <Link to={p.to}>{p.cta}</Link>
            </Button>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-10 text-center text-xs">Illustrative pricing for the hackathon demo.</p>
    </main>
  )
}
