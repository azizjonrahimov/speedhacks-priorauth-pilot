import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { USE_MOCK } from '@/api/client'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
})

function Placeholder({ name }: { name: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">PriorAuth Pilot</h1>
      <p className="text-muted-foreground mt-1">
        {name} scaffold ok{USE_MOCK ? ' (mock mode)' : ''}
      </p>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Placeholder name="Dashboard" />} />
            <Route path="/new" element={<Placeholder name="New case" />} />
            <Route path="/cases/:id" element={<Placeholder name="Case view" />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
