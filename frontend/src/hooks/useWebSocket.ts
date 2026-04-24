import { useEffect, useRef, useState, useCallback } from 'react'

export type WsEventType =
  | 'position_update'
  | 'order_fill'
  | 'kill_switch'
  | 'governor_event'
  | 'pong'

export interface WsEvent {
  type: WsEventType
  data: Record<string, unknown>
  ts?: string
}

export interface UseWebSocketResult {
  lastEvent: WsEvent | null
  isConnected: boolean
  isStale: boolean
}

const RECONNECT_DELAY_MS = 3_000
const STALE_THRESHOLD_MS = 15_000

function getWebSocketUrl(): string {
  if (typeof window === 'undefined') {
    return 'ws://127.0.0.1:8001/ws'
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

export function useWebSocket(): UseWebSocketResult {
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isStale, setIsStale] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const resetStaleTimer = useCallback(() => {
    if (staleTimer.current) clearTimeout(staleTimer.current)
    setIsStale(false)
    staleTimer.current = setTimeout(() => {
      if (mountedRef.current) setIsStale(true)
    }, STALE_THRESHOLD_MS)
  }, [])

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return

    try {
      const ws = new WebSocket(getWebSocketUrl())
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        setIsConnected(true)
        setIsStale(false)
        resetStaleTimer()
        // Send ping to confirm live
        ws.send('ping')
      }

      ws.onmessage = (evt) => {
        if (!mountedRef.current) return
        resetStaleTimer()
        try {
          const parsed: WsEvent = JSON.parse(evt.data)
          setLastEvent(parsed)
        } catch {
          // ignore malformed frames
        }
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setIsConnected(false)
        setIsStale(true)
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch {
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
    }
  }, [resetStaleTimer])

  useEffect(() => {
    mountedRef.current = true
    connect()

    // Expose a test helper so E2E tests can inject WS events directly.
    // Tests can call `window.__ut_set_last_event({ type, data, ts })` to simulate an incoming frame.
    if (typeof window !== 'undefined') {
      ;(window as any).__ut_set_last_event = (evt: WsEvent) => {
        if (mountedRef.current) setLastEvent(evt)
      }
    }

    return () => {
      mountedRef.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (staleTimer.current) clearTimeout(staleTimer.current)
      wsRef.current?.close()
      if (typeof window !== 'undefined' && (window as any).__ut_set_last_event) {
        try { delete (window as any).__ut_set_last_event } catch {}
      }
    }
  }, [connect])

  return { lastEvent, isConnected, isStale }
}
