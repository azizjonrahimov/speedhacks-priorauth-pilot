import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/marketing/MarketingLayout'
import { useTitle } from '@/hooks/useTitle'

export function NotFound() {
  useTitle('Page not found')
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo />
      <div>
        <div className="text-primary tabular font-mono text-sm font-semibold">404</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page isn't on file.</h1>
        <p className="text-muted-foreground mt-2 text-sm">The link may be old, or the case may have been closed.</p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link to="/app">Go to dashboard</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/">Home</Link>
        </Button>
      </div>
    </div>
  )
}
