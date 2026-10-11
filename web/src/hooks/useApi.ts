import { useQuery } from '@tanstack/react-query'
import { api, queryKeys } from '@/api/client'

export const useCases = () => useQuery({ queryKey: queryKeys.cases, queryFn: api.listCases, select: (d) => d.cases })
export const useMetrics = () => useQuery({ queryKey: queryKeys.metrics, queryFn: api.metrics })
export const useCase = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.case(id ?? ''), queryFn: () => api.getCase(id!), enabled: !!id, select: (d) => d.case })
export const useEvents = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.events(id ?? ''), queryFn: () => api.getEvents(id!), enabled: !!id, select: (d) => d.events })
export const usePolicies = () => useQuery({ queryKey: queryKeys.policies, queryFn: api.policies, select: (d) => d.policies, staleTime: 5 * 60_000 })
export const useDemoNotes = () => useQuery({ queryKey: queryKeys.demoNotes, queryFn: api.demoNotes, select: (d) => d.notes, staleTime: 5 * 60_000 })
