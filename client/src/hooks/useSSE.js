import { useEffect, useRef } from 'react'
import { subscribeSSE } from '../lib/api'
import { useAuth } from '../lib/auth'

export function useSSE(channel, handlers, deps = []) {
  const { auth } = useAuth()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!auth?.token || !channel) return

    const stableHandlers = {}
    for (const [event, handler] of Object.entries(handlersRef.current)) {
      stableHandlers[event] = handler
    }

    const close = subscribeSSE(channel, auth.token, stableHandlers)
    return close
  }, [auth?.token, channel, ...deps])
}
