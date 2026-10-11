import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/layout/AppShell'
import { Dashboard } from '@/pages/Dashboard'
import { Cases } from '@/pages/Cases'
import { NewCase } from '@/pages/NewCase'
import { CaseView } from '@/pages/CaseView'
import { API_URL, USE_MOCK } from '@/api/client'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({
    onError: (err, query) => {
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
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/cases" element={<Cases />} />
              <Route path="/new" element={<NewCase />} />
              <Route path="/cases/:id" element={<CaseView />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="bottom-right" closeButton duration={3500} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
