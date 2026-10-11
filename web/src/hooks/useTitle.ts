import { useEffect } from 'react'

export function useTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · PriorAuth Pilot` : 'PriorAuth Pilot · Prior authorization on autopilot'
  }, [title])
}
