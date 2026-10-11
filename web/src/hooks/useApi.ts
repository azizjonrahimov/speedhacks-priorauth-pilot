import { useQueries, useQuery } from '@tanstack/react-query'
import { api, queryKeys } from '@/api/client'
import type { CaseSummary } from '@/api/types'

export const useCases = () => useQuery({ queryKey: queryKeys.cases, queryFn: api.listCases, select: (d) => d.cases })
export const useMetrics = () => useQuery({ queryKey: queryKeys.metrics, queryFn: api.metrics })
export const useCase = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.case(id ?? ''), queryFn: () => api.getCase(id!), enabled: !!id, select: (d) => d.case })
export const useEvents = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.events(id ?? ''), queryFn: () => api.getEvents(id!), enabled: !!id, select: (d) => d.events })
export const usePolicies = () => useQuery({ queryKey: queryKeys.policies, queryFn: api.policies, select: (d) => d.policies, staleTime: 5 * 60_000 })
export const useDemoNotes = () => useQuery({ queryKey: queryKeys.demoNotes, queryFn: api.demoNotes, select: (d) => d.notes, staleTime: 5 * 60_000 })

/** Details for every case that has reached a terminal payer state (small N; used by the dashboard chart). */
export function useCompletedCaseDetails(cases: CaseSummary[] | undefined) {
  const ids = (cases ?? []).filter((c) => ['approved', 'denied', 'pended', 'closed'].includes(c.state)).map((c) => c.id)
  return useQueries({
    queries: ids.map((id) => ({ queryKey: queryKeys.case(id), queryFn: () => api.getCase(id), select: (d: { case: import('@/api/types').CaseDetail }) => d.case })),
  })
}
