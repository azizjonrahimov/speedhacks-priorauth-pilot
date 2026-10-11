// Placeholder mock router; fleshed out in the next step with a scripted fake case
// that walks every state (met/missing/unclear, call in progress, retries, approved).
export async function mockFetch<T>(path: string, init?: RequestInit): Promise<T> {
  await new Promise((r) => setTimeout(r, 150))
  const method = init?.method ?? 'GET'
  throw new Error(`mock: no handler for ${method} ${path}`)
}
