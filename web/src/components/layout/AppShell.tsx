import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Clock, FilePlus2, LayoutDashboard, ListChecks, Moon, Presentation, Stethoscope, Sun, Wifi, WifiOff } from 'lucide-react'
import { onStreamEvent, useStream } from '@/hooks/useStream'
import { queryKeys, USE_MOCK } from '@/api/client'
import type { CaseSummary } from '@/api/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/cases', label: 'Cases', icon: ListChecks, end: false },
  { to: '/new', label: 'New case', icon: FilePlus2, end: false },
]

function useHtmlClass(cls: string, key: string, initial = false) {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) === '1' || initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    document.documentElement.classList.toggle(cls, on)
    try {
      localStorage.setItem(key, on ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [on, cls, key])
  return [on, setOn] as const
}

export function AppShell() {
  const status = useStream()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [dark, setDark] = useHtmlClass('dark', 'pap.dark')
  const [demo, setDemo] = useHtmlClass('demo-mode', 'pap.demo')

  // Global toasts for the events that matter to staff.
  useEffect(
    () =>
      onStreamEvent((ev) => {
        const cases = qc.getQueryData<{ cases: CaseSummary[] }>(queryKeys.cases)?.cases
        const c = cases?.find((x) => x.id === ev.case_id)
        const who = c ? `${c.patient_name} · ${c.cpt_label}` : `Case ${ev.case_id.slice(-6)}`
        const open = { label: 'Open', onClick: () => navigate(`/cases/${ev.case_id}`) }
        switch (ev.type) {
          case 'payer.responded': {
            const st = String(ev.payload.status ?? '')
            const ref = ev.payload.reference ? ` · ref ${String(ev.payload.reference)}` : ''
            if (st === 'approved') toast.success(`Approved: ${who}${ref}`, { action: open })
            else if (st === 'denied') toast.error(`Denied: ${who}`, { description: String(ev.payload.reason ?? ''), action: open })
            else toast.warning(`Pended: ${who}`, { description: String(ev.payload.reason ?? ''), action: open })
            break
          }
          case 'call.ended':
            toast.info(`Physician call ended · ${who}`, { description: `${String(ev.payload.duration_seconds ?? '?')}s, ${String(ev.payload.end_reason ?? '')}`, action: open })
            break
          case 'call.failed':
            toast.error(`Call failed · ${who}`, { description: String(ev.payload.reason ?? ''), action: open })
            break
          case 'patient.replied':
            toast.message(`Patient replied · ${who}`, { description: `"${String(ev.payload.body ?? '')}"` })
            break
          case 'gap.unresolved':
            toast.warning(`Gaps unresolved after 2 calls · ${who}`, { description: 'Enter answers manually.', action: open })
            break
        }
      }),
    [qc, navigate],
  )

  // Keyboard: N = new case
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        navigate('/new')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="bg-background flex min-h-svh">
      <aside className="no-print bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-0 flex h-svh w-60 shrink-0 flex-col border-r">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Stethoscope className="size-4.5" />
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">PriorAuth Pilot</div>
            <div className="text-muted-foreground text-[11px]">Prior-auth copilot</div>
          </div>
        </div>
        <nav className="mt-2 flex flex-col gap-0.5 px-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/80 hover:bg-muted hover:text-foreground',
                )
              }
            >
              <n.icon className="size-4" />
              {n.label}
              {n.to === '/new' && <kbd className="text-muted-foreground ml-auto rounded border px-1.5 font-mono text-[10px]">N</kbd>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-4 pb-4">
          <div className="flex items-center gap-2 text-xs">
            {status === 'live' ? <Wifi className="text-met size-3.5" /> : <WifiOff className="text-muted-foreground size-3.5" />}
            <span className="text-muted-foreground">
              {status === 'live' ? (USE_MOCK ? 'Live · mock server' : 'Live · connected') : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
            </span>
          </div>
          <div className="text-muted-foreground flex items-start gap-2 rounded-md border p-2.5 text-[11.5px] leading-snug">
            <Clock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Baseline: <span className="text-foreground font-semibold">24 min</span> per manual PA (CAQH Index 2024). 40 PAs / physician / week (AMA).
            </span>
          </div>
          <div className="flex gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">
                  {dark ? <Sun /> : <Moon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle dark mode</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant={demo ? 'default' : 'outline'} size="sm" onClick={() => setDemo(!demo)} className="flex-1">
                  <Presentation data-icon="inline-start" />
                  Demo mode {demo ? 'on' : 'off'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Larger type for the recording</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
