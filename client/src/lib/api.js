const BASE = ''

export async function api(method, path, body, token) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (token) opts.headers['Authorization'] = `Bearer ${token}`
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(`${BASE}${path}`, opts)
  const data = await res.json()

  if (!res.ok) throw new Error(data.error || `${res.status} error`)
  return data
}

export function subscribeSSE(channel, token, handlers) {
  const es = new EventSource(`${BASE}/events/${channel}?token=${token}`)

  for (const [event, handler] of Object.entries(handlers)) {
    es.addEventListener(event, (e) => {
      try { handler(JSON.parse(e.data)) } catch {}
    })
  }

  es.onerror = () => {
    console.warn(`[SSE] ${channel} reconnecting...`)
  }

  return () => es.close()
}
