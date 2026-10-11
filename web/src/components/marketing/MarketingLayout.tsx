import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Menu, Moon, Stethoscope, Sun, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDemoUser } from '@/lib/auth'
import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2', className)}>
      <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
        <Stethoscope className="size-4.5" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">PriorAuth Pilot</span>
    </Link>
  )
}

export function useDarkToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('pap.dark', dark ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [dark])
  return [dark, setDark] as const
}

const LINKS = [
  { href: '/#how', label: 'How it works' },
  { href: '/#trust', label: 'Trust' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' },
]

export function MarketingLayout() {
  const user = useDemoUser()
  const [open, setOpen] = useState(false)
  const [dark, setDark] = useDarkToggle()
  return (
    <div className="bg-background text-foreground min-h-svh">
      <header className="bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 md:px-6">
          <Logo />
          <nav className="text-muted-foreground hidden items-center gap-6 text-sm md:flex">
            {LINKS.map((l) =>
              l.to ? (
                <NavLink key={l.label} to={l.to} className={({ isActive }) => cn('hover:text-foreground transition-colors', isActive && 'text-foreground font-medium')}>
                  {l.label}
                </NavLink>
              ) : (
                <a key={l.label} href={l.href} className="hover:text-foreground transition-colors">
                  {l.label}
                </a>
              ),
            )}
          </nav>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <Button variant="ghost" size="icon-sm" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">
              {dark ? <Sun /> : <Moon />}
            </Button>
            {user ? (
              <Button asChild>
                <Link to="/app">Open app</Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link to="/signin">Sign in</Link>
                </Button>
                <Button asChild>
                  <Link to="/signup">Start free pilot</Link>
                </Button>
              </>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" className="ml-auto md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <X /> : <Menu />}
          </Button>
        </div>
        {open && (
          <div className="border-t px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1 text-sm">
              {LINKS.map((l) =>
                l.to ? (
                  <Link key={l.label} to={l.to} onClick={() => setOpen(false)} className="hover:bg-muted rounded-md px-2 py-2">
                    {l.label}
                  </Link>
                ) : (
                  <a key={l.label} href={l.href} onClick={() => setOpen(false)} className="hover:bg-muted rounded-md px-2 py-2">
                    {l.label}
                  </a>
                ),
              )}
              <div className="mt-2 flex gap-2">
                <Button variant="outline" className="flex-1" asChild>
                  <Link to={user ? '/app' : '/signin'}>{user ? 'Open app' : 'Sign in'}</Link>
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">
                  {dark ? <Sun /> : <Moon />}
                </Button>
              </div>
            </nav>
          </div>
        )}
      </header>
      <Outlet />
      <footer className="border-t">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-4 md:px-6">
          <div className="space-y-3 md:col-span-2">
            <Logo />
            <p className="text-muted-foreground max-w-sm text-sm">
              Prior authorization copilot for small practices. Built at SpeedHacks, San Francisco, October 2026.
            </p>
            <p className="text-muted-foreground text-xs">Demo product. Synthetic patient data only. Not for clinical use.</p>
          </div>
          <div className="space-y-2 text-sm">
            <div className="font-medium">Product</div>
            <a href="/#how" className="text-muted-foreground hover:text-foreground block">How it works</a>
            <Link to="/pricing" className="text-muted-foreground hover:text-foreground block">Pricing</Link>
            <Link to="/app" className="text-muted-foreground hover:text-foreground block">Live demo</Link>
          </div>
          <div className="space-y-2 text-sm">
            <div className="font-medium">Company</div>
            <Link to="/about" className="text-muted-foreground hover:text-foreground block">About</Link>
            <a href="/#trust" className="text-muted-foreground hover:text-foreground block">Trust & safety</a>
            <Link to="/signin" className="text-muted-foreground hover:text-foreground block">Sign in</Link>
          </div>
        </div>
        <div className="text-muted-foreground mx-auto max-w-6xl border-t px-4 py-5 text-xs md:px-6">© 2026 PriorAuth Pilot</div>
      </footer>
    </div>
  )
}
