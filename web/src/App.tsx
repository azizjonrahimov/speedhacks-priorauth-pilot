import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/layout/AppShell'
import { Dashboard } from '@/pages/Dashboard'
import { Cases } from '@/pages/Cases'
import { NewCase } from '@/pages/NewCase'
import { CaseView } from '@/pages/CaseView'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
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
