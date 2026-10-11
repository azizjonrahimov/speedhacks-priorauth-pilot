import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/layout/AppShell'
import { Dashboard } from '@/pages/Dashboard'
import { Cases } from '@/pages/Cases'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
})

function Placeholder({ name }: { name: string }) {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
      <p className="text-muted-foreground mt-1 text-sm">Coming up next.</p>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/cases" element={<Cases />} />
              <Route path="/new" element={<Placeholder name="New case" />} />
              <Route path="/cases/:id" element={<Placeholder name="Case view" />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="top-right" closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
