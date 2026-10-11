import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/marketing/MarketingLayout'
import { continueAsDemo, DEMO_ACCOUNT, demoSignIn } from '@/lib/auth'
import { useTitle } from '@/hooks/useTitle'

/** Sign in / sign up. DEMO AUTH ONLY: see src/lib/auth.ts. Nothing leaves the browser. */
export function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  useTitle(mode === 'signin' ? 'Sign in' : 'Create account')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') || '/app'
  const [email, setEmail] = useState(mode === 'signin' ? DEMO_ACCOUNT.email : '')
  const [password, setPassword] = useState(mode === 'signin' ? DEMO_ACCOUNT.password : '')
  const [name, setName] = useState('')
  const [org, setOrg] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const err = demoSignIn(email, password, mode === 'signup' ? name : undefined, mode === 'signup' ? org : undefined)
    if (err) return setError(err)
    navigate(next, { replace: true })
  }

  return (
    <div className="bg-muted/40 grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col p-6 md:p-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-tight">{mode === 'signin' ? 'Welcome back' : 'Start your free pilot'}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {mode === 'signin' ? 'Sign in to your practice workspace.' : '30 days, no credit card. Synthetic data until you connect your EHR.'}
            </p>
            <form onSubmit={submit} className="mt-6 grid gap-4">
              {mode === 'signup' && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="name">Full name</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="org">Practice name</Label>
                    <Input id="org" value={org} onChange={(e) => setOrg(e.target.value)} autoComplete="organization" />
                  </div>
                </>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="email">Work email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" size="lg" className="h-10">
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </Button>
              <div className="text-muted-foreground relative my-1 text-center text-xs">
                <span className="bg-muted/40 relative z-10 px-2">or</span>
                <span className="absolute inset-x-0 top-1/2 -z-0 border-t" />
              </div>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-10"
                onClick={() => {
                  continueAsDemo()
                  navigate(next, { replace: true })
                }}
              >
                Continue with demo account <ArrowRight data-icon="inline-end" />
              </Button>
            </form>
            <p className="text-muted-foreground mt-6 text-center text-sm">
              {mode === 'signin' ? (
                <>
                  New here?{' '}
                  <Link to={`/signup${params.toString() ? `?${params}` : ''}`} className="text-primary font-medium hover:underline">
                    Create an account
                  </Link>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <Link to={`/signin${params.toString() ? `?${params}` : ''}`} className="text-primary font-medium hover:underline">
                    Sign in
                  </Link>
                </>
              )}
            </p>
            <p className="text-muted-foreground mt-8 rounded-md border border-dashed px-3 py-2 text-center text-[11px]">
              Demo authentication. Accounts are stored only in this browser.
            </p>
          </div>
        </div>
      </div>
      <div className="bg-primary text-primary-foreground relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-center lg:p-16">
        <svg className="absolute -right-24 -bottom-24 size-[520px] opacity-15" viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r="98" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <circle cx="100" cy="100" r="42" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <path d="M60 104l26 26 54-60" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <blockquote className="relative max-w-md">
          <p className="text-2xl leading-snug font-medium tracking-tight">“We stopped chasing faxes. The copilot finds the quote, calls the doctor, and we just sign off.”</p>
          <footer className="text-primary-foreground/75 mt-4 text-sm">Practice manager, pilot clinic (illustrative)</footer>
        </blockquote>
        <ul className="relative mt-10 space-y-3 text-sm">
          {['Verified quotes for every criterion', 'Physician gap-fill by phone', 'FHIR Da Vinci PAS submission'].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <CheckCircle2 className="size-4" /> {t}
            </li>
          ))}
          <li className="text-primary-foreground/75 flex items-center gap-2">
            <ShieldCheck className="size-4" /> Synthetic data only in this demo
          </li>
        </ul>
      </div>
    </div>
  )
}
