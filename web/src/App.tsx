import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/components/RequireAuth'
import { MarketingLayout } from '@/components/marketing/MarketingLayout'
import { Dashboard } from '@/pages/Dashboard'
import { Cases } from '@/pages/Cases'
import { NewCase } from '@/pages/NewCase'
import { CaseView } from '@/pages/CaseView'
import { Landing } from '@/pages/Landing'
import { AuthPage } from '@/pages/Auth'
import { Pricing } from '@/pages/Pricing'
import { About } from '@/pages/About'
import { NotFound } from '@/pages/NotFound'
import { API_URL, USE_MOCK } from '@/api/client'

const isAppPath = () => {
  const p = window.location.pathname
  return p === '/app' || p === '/new' || p === '/cases' || p.startsWith('/cases/')
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({
    onError: (err, query) => {
      // Marketing pages read /metrics opportunistically and fall back silently.
      if (!isAppPath()) return
      // Surface API failures once per query key so a dead backend is obvious, not a blank screen.
      toast.error(`Could not load ${String(query.queryKey[0])}`, {
        id: `qerr-${String(query.queryKey[0])}`,
        description: err instanceof Error ? err.message : String(err),
        action: USE_MOCK ? undefined : { label: 'API', onClick: () => window.open(API_URL + '/health', '_blank') },
      })
    },
  }),
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <BrowserRouter>
          <Routes>
            <Route element={<MarketingLayout />}>
              <Route path="/" element={<Landing />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/about" element={<About />} />
            </Route>
            <Route path="/signin" element={<AuthPage mode="signin" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            {/* Demo-auth gate: unauthenticated visits redirect to /signin?next=… */}
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route path="/app" element={<Dashboard />} />
                <Route path="/cases" element={<Cases />} />
                <Route path="/new" element={<NewCase />} />
                <Route path="/cases/:id" element={<CaseView />} />
              </Route>
            </Route>
            <Route path="/dashboard" element={<Navigate to="/app" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="bottom-right" closeButton duration={3500} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
