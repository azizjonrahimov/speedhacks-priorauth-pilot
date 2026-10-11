// DEMO AUTH ONLY. No auth provider, no network calls, no password storage.
// A "session" is a small JSON blob in localStorage so the demo can show sign-in, gating and sign-out.
// Anything here must be replaced with a real identity provider before handling real users or PHI.
import { useSyncExternalStore } from 'react'

export interface DemoUser {
  name: string
  email: string
  org: string
}

export const DEMO_ACCOUNT = { email: 'demo@bayviewclinic.test', password: 'demo1234', name: 'Jordan Lee', org: 'Bayview Family Medicine' }

const KEY = 'pap.demo-session'
const listeners = new Set<() => void>()

function read(): DemoUser | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as DemoUser) : null
  } catch {
    return null
  }
}

let current: DemoUser | null = read()

function write(u: DemoUser | null) {
  current = u
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u))
    else localStorage.removeItem(KEY)
  } catch {
    // storage unavailable: session lives in memory for this tab only
  }
  listeners.forEach((l) => l())
}

/** Demo sign-in: accepts any well-formed email with a password of 8+ characters. */
export function demoSignIn(email: string, password: string, name?: string, org?: string): string | null {
  const e = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return 'Enter a valid email address.'
  if (password.length < 8) return 'Password must be at least 8 characters.'
  const isDemo = e === DEMO_ACCOUNT.email
  write({
    email: e,
    name: name?.trim() || (isDemo ? DEMO_ACCOUNT.name : e.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())),
    org: org?.trim() || (isDemo ? DEMO_ACCOUNT.org : 'Your practice'),
  })
  return null
}

export function continueAsDemo() {
  write({ email: DEMO_ACCOUNT.email, name: DEMO_ACCOUNT.name, org: DEMO_ACCOUNT.org })
}

export function signOut() {
  write(null)
}

export function useDemoUser(): DemoUser | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      const onStorage = (ev: StorageEvent) => {
        if (ev.key === KEY) {
          current = read()
          cb()
        }
      }
      window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(cb)
        window.removeEventListener('storage', onStorage)
      }
    },
    () => current,
  )
}
