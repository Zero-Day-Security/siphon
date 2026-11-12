import { useEffect, useRef, useCallback, useState } from 'react'
import type { Flow, Evidence, BeaconToken, BeaconInteraction } from './types'

const BASE = '/api'

export function getApiToken(): string {
  return localStorage.getItem('siphon_api_token') || ''
}

export function setApiToken(token: string) {
  localStorage.setItem('siphon_api_token', token)
}

function authHeaders(): Record<string, string> {
  const token = getApiToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

export function authedFetch(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts?.headers || {}) },
  }).then(async (res) => {
    if (res.status === 401) {
      const newToken = prompt('Siphon API Token required.\nCopy from the terminal where Siphon is running:')
      if (newToken) {
        setApiToken(newToken.trim())
        return authedFetch(path, opts)
      }
    }
    return res
  })
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await authedFetch(path, opts)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function fetchFlows(params?: {
  search?: string
  method?: string
  status?: string
}): Promise<Flow[]> {
  const qs = new URLSearchParams()
  if (params?.search) qs.set('search', params.search)
  if (params?.method) qs.set('method', params.method)
  if (params?.status) qs.set('status', params.status)
  const query = qs.toString()
  const data = await request<{ total: number; flows: Flow[] }>(`/flows${query ? `?${query}` : ''}`)
  return data.flows
}

export async function fetchFlow(id: string): Promise<Flow> {
  return request<Flow>(`/flows/${id}`)
}

export async function replayFlow(id: string): Promise<Flow> {
  return request<Flow>(`/flows/${id}/replay`, { method: 'POST' })
}

export async function sendRequest(req: {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}): Promise<Flow> {
  return request<Flow>('/send', { method: 'POST', body: JSON.stringify(req) })
}

export async function toggleHighlight(id: string): Promise<Flow> {
  return request<Flow>(`/flows/${id}/highlight`, { method: 'POST' })
}

export async function setNotes(id: string, notes: string): Promise<Flow> {
  return request<Flow>(`/flows/${id}/notes`, {
    method: 'PUT',
    body: JSON.stringify({ notes }),
  })
}

export async function captureEvidence(
  id: string,
  notes?: string,
): Promise<Evidence> {
  return request<Evidence>(`/flows/${id}/evidence`, {
    method: 'POST',
    body: JSON.stringify({ notes: notes || '' }),
  })
}

export async function fetchEvidence(): Promise<Evidence[]> {
  return request<Evidence[]>('/evidence')
}

export async function clearFlows(): Promise<void> {
  await authedFetch('/flows', { method: 'DELETE' })
}

export async function getScope(): Promise<{ patterns: string[]; enabled: boolean }> {
  return request('/scope')
}

export async function setScope(patterns: string[]): Promise<{ patterns: string[]; enabled: boolean }> {
  return request('/scope', { method: 'PUT', body: JSON.stringify({ patterns }) })
}

export async function toggleScopeFilter(): Promise<{ enabled: boolean }> {
  return request('/scope/toggle', { method: 'POST' })
}

export async function getSitemap(): Promise<{ host: string; flow_count: number; methods: string[]; in_scope: boolean }[]> {
  return request('/sitemap')
}

export async function generateBeaconToken(description?: string): Promise<BeaconToken> {
  return request<BeaconToken>('/beacon/tokens', {
    method: 'POST',
    body: JSON.stringify({ description: description || '' }),
  })
}

export async function listBeaconTokens(): Promise<BeaconToken[]> {
  return request<BeaconToken[]>('/beacon/tokens')
}

export async function getBeaconToken(token: string): Promise<BeaconToken & { interactions: BeaconInteraction[] }> {
  return request<BeaconToken & { interactions: BeaconInteraction[] }>('/beacon/tokens/' + token)
}

export async function deleteBeaconToken(token: string): Promise<void> {
  await authedFetch(`/beacon/tokens/${token}`, { method: 'DELETE' })
}

export async function listBeaconInteractions(): Promise<BeaconInteraction[]> {
  return request<BeaconInteraction[]>('/beacon/interactions')
}

export async function getBeaconStatus(): Promise<{
  enabled: boolean
  url: string
  token_count: number
  interaction_count: number
}> {
  return request('/beacon/status')
}

export interface BeaconEvent {
  type: 'interaction'
  data: BeaconInteraction
}

export function useBeaconStream(onEvent: (event: BeaconEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const callbackRef = useRef(onEvent)
  const [connected, setConnected] = useState(false)
  callbackRef.current = onEvent

  const connect = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const token = getApiToken()
    const qs = token ? `?token=${encodeURIComponent(token)}` : ''
    const ws = new WebSocket(`${proto}//${window.location.host}/api/beacon/ws${qs}`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as BeaconEvent
        callbackRef.current(event)
      } catch {
        // ignore
      }
    }

    ws.onclose = () => {
      setConnected(false)
      setTimeout(connect, 2000)
    }

    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])

  return connected
}

// --- Export helpers ---

async function downloadWithAuth(path: string, filename: string) {
  const res = await authedFetch(path)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadExport(format: 'har' | 'burp-xml' | 'json') {
  const ext = format === 'har' ? 'har' : format === 'burp-xml' ? 'xml' : 'json'
  downloadWithAuth(`/export/${format}`, `siphon_export.${ext}`)
}

export function downloadReportMarkdown() {
  downloadWithAuth('/export/report/markdown', 'siphon_report.md')
}

export function downloadReportPdf() {
  downloadWithAuth('/export/report/pdf', 'siphon_report.pdf')
}

export async function importBurpXml(xmlContent: string): Promise<{ imported: number }> {
  const token = getApiToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/xml' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}/import/burp-xml`, {
    method: 'POST',
    headers,
    body: xmlContent,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export interface FlowEvent {
  type: 'new' | 'update'
  flow: Flow
}

export function useFlowStream(onEvent: (event: FlowEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const callbackRef = useRef(onEvent)
  const [connected, setConnected] = useState(false)
  callbackRef.current = onEvent

  const connect = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const token = getApiToken()
    const qs = token ? `?token=${encodeURIComponent(token)}` : ''
    const ws = new WebSocket(`${proto}//${window.location.host}/api/ws${qs}`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)

    ws.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data)
        const mapped: FlowEvent = {
          type: raw.type === 'new_flow' ? 'new' : 'update',
          flow: raw.data,
        }
        callbackRef.current(mapped)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      setConnected(false)
      setTimeout(connect, 2000)
    }

    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])

  return connected
}
