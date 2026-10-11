import type { CaseDetail } from '@/api/types'

// POST /screen may return likely_gap without persisting it on the case, so remember it per case for the case view.
const key = (id: string) => `pap.likely_gap.${id}`

export function rememberLikelyGap(caseId: string, value: boolean | undefined) {
  if (value === undefined) return
  try {
    sessionStorage.setItem(key(caseId), value ? '1' : '0')
  } catch {
    // storage unavailable; the hint just won't show
  }
}

export function likelyGap(c: CaseDetail): boolean {
  if (typeof c.screening?.likely_gap === 'boolean') return c.screening.likely_gap
  try {
    return sessionStorage.getItem(key(c.id)) === '1'
  } catch {
    return false
  }
}
