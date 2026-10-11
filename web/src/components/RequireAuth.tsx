import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useDemoUser } from '@/lib/auth'

/** Demo-auth gate for the app routes. Redirects to /signin and returns to the requested URL afterwards. */
export function RequireAuth() {
  const user = useDemoUser()
  const loc = useLocation()
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return <Outlet />
}
