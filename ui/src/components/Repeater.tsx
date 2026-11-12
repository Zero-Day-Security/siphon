import { useState } from 'react'
import { Send, Plus, X, Camera } from 'lucide-react'
import type { Flow, RepeaterTab } from '../types'
import { sendRequest, captureEvidence } from '../api'
import HeadersTable from './HeadersTable'
import BodyViewer from './BodyViewer'
import MethodBadge from './MethodBadge'
import StatusBadge from './StatusBadge'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']

function newTab(name?: string, flow?: Flow): RepeaterTab {
  return {
    id: crypto.randomUUID(),
    name: name || 'New Request',
    request: {
      method: flow?.method || 'GET',
      url: flow?.url || '',
      headers: flow?.request_headers || {},
      body: flow?.request_body || '',
    },
    response: null,
    loading: false,
  }
}

function headersToText(headers: Record<string, string>): string {
  return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n')
}

function textToHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
  }
  return headers
}

interface Props {
  initialFlow?: Flow | null
}

export default function Repeater({ initialFlow }: Props) {
  const [tabs, setTabs] = useState<RepeaterTab[]>(() => [
    newTab(initialFlow ? new URL(initialFlow.url).pathname.slice(0, 30) : undefined, initialFlow || undefined),
  ])
  const [activeTab, setActiveTab] = useState(tabs[0].id)
  const [headersText, setHeadersText] = useState(() =>
    headersToText(tabs[0].request.headers),
  )
  const [resView, setResView] = useState<'headers' | 'body'>('body')
  const [captured, setCaptured] = useState(false)

  const tab = tabs.find((t) => t.id === activeTab) || tabs[0]

  const updateTab = (id: string, updates: Partial<RepeaterTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)))
  }

  const handleSend = async () => {
    updateTab(tab.id, { loading: true })
    try {
      const response = await sendRequest({
        ...tab.request,
        headers: textToHeaders(headersText),
      })
      updateTab(tab.id, { response, loading: false })
      setResView('body')
    } catch {
      updateTab(tab.id, { loading: false })
    }
  }

  const addTab = () => {
    const t = newTab()
    setTabs((prev) => [...prev, t])
    setActiveTab(t.id)
    setHeadersText('')
  }

  const closeTab = (id: string) => {
    if (tabs.length === 1) return
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs[idx === 0 ? 1 : idx - 1]
    setTabs((prev) => prev.filter((t) => t.id !== id))
    if (activeTab === id) {
      setActiveTab(next.id)
      setHeadersText(headersToText(next.request.headers))
    }
  }

  const switchTab = (id: string) => {
    setActiveTab(id)
    const t = tabs.find((x) => x.id === id)
    if (t) setHeadersText(headersToText(t.request.headers))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-px px-2 py-1 bg-[#161b22] border-b border-[#30363d] overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t transition-colors whitespace-nowrap ${
              activeTab === t.id
                ? 'bg-[#0d1117] text-[#e6edf3] border border-[#30363d] border-b-transparent'
                : 'text-[#484f58] hover:text-[#8b949e]'
            }`}
          >
            {t.name}
            {tabs.length > 1 && (
              <span
                onClick={(e) => { e.stopPropagation(); closeTab(t.id) }}
                className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
              >
                <X size={10} />
              </span>
            )}
          </button>
        ))}
        <button onClick={addTab} className="p-1 text-[#484f58] hover:text-[#8b949e] transition-colors">
          <Plus size={14} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col border-r border-[#30363d]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22]">
            <select
              value={tab.request.method}
              onChange={(e) => updateTab(tab.id, { request: { ...tab.request, method: e.target.value } })}
              className="px-2 py-1.5 bg-[#21262d] border border-[#30363d] rounded-md text-sm font-mono font-semibold text-[#e6edf3] focus:border-blue-500 focus:outline-none"
            >
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
            <input
              type="text"
              value={tab.request.url}
              onChange={(e) => updateTab(tab.id, { request: { ...tab.request, url: e.target.value } })}
              placeholder="https://example.com/api/endpoint"
              className="flex-1 px-3 py-1.5 bg-[#21262d] border border-[#30363d] rounded-md text-sm font-mono text-[#e6edf3] placeholder-[#484f58] focus:border-blue-500 focus:outline-none transition-colors"
            />
            <button
              onClick={handleSend}
              disabled={tab.loading || !tab.request.url}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-[#21262d] disabled:text-[#484f58] text-white text-sm font-medium rounded-md transition-colors"
            >
              <Send size={14} />
              {tab.loading ? 'Sending...' : 'Send'}
            </button>
          </div>

          <div className="flex flex-col flex-1 overflow-auto">
            <div className="px-3 py-2 border-b border-[#21262d]">
              <label className="text-xs font-medium text-[#8b949e] block mb-1">Headers</label>
              <textarea
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                placeholder="Content-Type: application/json&#10;Authorization: Bearer ..."
                rows={5}
                className="w-full px-2 py-1.5 bg-[#21262d] border border-[#30363d] rounded-md text-xs font-mono text-[#e6edf3] placeholder-[#484f58] resize-y focus:border-blue-500 focus:outline-none transition-colors"
              />
            </div>
            <div className="flex-1 px-3 py-2">
              <label className="text-xs font-medium text-[#8b949e] block mb-1">Body</label>
              <textarea
                value={tab.request.body}
                onChange={(e) => updateTab(tab.id, { request: { ...tab.request, body: e.target.value } })}
                placeholder='{"key": "value"}'
                className="w-full h-full min-h-[120px] px-2 py-1.5 bg-[#21262d] border border-[#30363d] rounded-md text-xs font-mono text-[#e6edf3] placeholder-[#484f58] resize-y focus:border-blue-500 focus:outline-none transition-colors"
              />
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          {tab.response ? (
            <>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22]">
                <MethodBadge method={tab.response.method} />
                <StatusBadge code={tab.response.status_code} />
                <span className="text-xs text-[#484f58]">
                  {tab.response.duration_ms !== null && `${Math.round(tab.response.duration_ms)}ms`}
                </span>
                <button
                  onClick={async () => {
                    if (tab.response) {
                      await captureEvidence(tab.response.id)
                      setCaptured(true)
                      setTimeout(() => setCaptured(false), 2000)
                    }
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                    captured ? 'text-emerald-400' : 'text-[#8b949e] hover:text-emerald-400 hover:bg-emerald-500/10'
                  }`}
                  title="Capture as evidence"
                >
                  <Camera size={12} /> {captured ? 'Captured!' : 'Evidence'}
                </button>
                <span className="flex-1" />
                <button
                  onClick={() => setResView('headers')}
                  className={`px-2 py-1 text-xs rounded transition-colors ${resView === 'headers' ? 'text-[#e6edf3] bg-[#21262d]' : 'text-[#484f58] hover:text-[#8b949e]'}`}
                >
                  Headers
                </button>
                <button
                  onClick={() => setResView('body')}
                  className={`px-2 py-1 text-xs rounded transition-colors ${resView === 'body' ? 'text-[#e6edf3] bg-[#21262d]' : 'text-[#484f58] hover:text-[#8b949e]'}`}
                >
                  Body
                </button>
              </div>
              <div className="flex-1 overflow-auto bg-[#0d1117]">
                {resView === 'headers' && tab.response.response_headers ? (
                  <HeadersTable headers={tab.response.response_headers} />
                ) : (
                  <BodyViewer body={tab.response.response_body} contentType={tab.response.response_content_type} />
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-[#484f58] text-sm">
              {tab.loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                  Sending request...
                </div>
              ) : (
                'Send a request to see the response'
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
