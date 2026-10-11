import { formatDistanceToNowStrict, format, parseISO } from 'date-fns'
import type { Overall, State } from '@/api/types'

export function fmtDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || Number.isNaN(totalSeconds)) return '—'
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r}s`
  return `${m}m ${r.toString().padStart(2, '0')}s`
}

export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true })
  } catch {
    return '—'
  }
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'h:mm:ss a')
  } catch {
    return '—'
  }
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'MMM d, yyyy')
  } catch {
    return iso
  }
}

export function fmtDob(dob: string): string {
  try {
    const d = parseISO(dob)
    const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600_000))
    return `${format(d, 'MM/dd/yyyy')} (${age}y)`
  } catch {
    return dob
  }
}

export const STATE_LABEL: Record<string, string> = {
  intake: 'Intake',
  screened: 'Screened',
  evidence_scored: 'Scored',
  needs_info: 'Needs info',
  calling: 'Calling MD',
  evidence_rescored: 'Re-scored',
  packet_ready: 'Packet ready',
  submitted: 'Submitted',
  pended: 'Pended',
  approved: 'Approved',
  denied: 'Denied',
  closed: 'Closed',
}

export function stateLabel(s: State): string {
  return STATE_LABEL[s] ?? s.replace(/_/g, ' ')
}

export const OVERALL_LABEL: Record<string, string> = {
  ready: 'Ready',
  needs_info: 'Needs info',
  expedite: 'Expedite',
  not_required: 'No PA needed',
}

export function overallLabel(o: Overall | null | undefined): string {
  if (!o) return '—'
  return OVERALL_LABEL[o] ?? o.replace(/_/g, ' ')
}

export function pct(n: number, d: number): string {
  if (!d) return '—'
  return `${Math.round((n / d) * 100)}%`
}

export const BASELINE_SECONDS = 24 * 60
