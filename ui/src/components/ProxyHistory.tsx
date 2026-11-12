import { useState, useMemo, useRef } from 'react'
import { Search, Trash2, Download, Upload, ChevronDown } from 'lucide-react'
import type { Flow } from '../types'
import { clearFlows, downloadExport, importBurpXml } from '../api'
import MethodBadge from './MethodBadge'
import StatusBadge from './StatusBadge'

const METHODS = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString()
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '---'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatSize(body: string | null): string {
  if (!body) return '---'
  const bytes = new Blob([body]).size
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

interface Props {
  flows: Flow[]
  selectedId: string | null
  onSelect: (flow: Flow) => void
  onClear: () => void
}

export default function ProxyHistory({ flows, selectedId, onSelect, onClear }: Props) {
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('')
  const [showExport, setShowExport] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      const result = await importBurpXml(text)
      alert(`Imported ${result.imported} flow(s) from Burp XML`)
    } catch {
      alert('Failed to import Burp XML')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const filtered = useMemo(() => {
    return flows.filter((f) => {
      if (methodFilter !== 'ALL' && f.method.toUpperCase() !== methodFilter) return false
      if (statusFilter) {
        const code = f.status_code?.toString() || ''
        if (!code.startsWith(statusFilter)) return false
      }
      if (search) {
        const q = search.toLowerCase()
        return (
          f.url.toLowerCase().includes(q) ||
          f.host.toLowerCase().includes(q) ||
          f.path.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [flows, search, methodFilter, statusFilter])

  const handleClear = async () => {
    await clearFlows()
    onClear()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22]">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#484f58]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by URL, host, path..."
            className="w-full pl-8 pr-3 py-1.5 bg-[#21262d] border border-[#30363d] rounded-md text-sm text-[#e6edf3] placeholder-[#484f58] focus:border-blue-500 focus:outline-none transition-colors"
          />
        </div>
        <select
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value)}
          className="px-2 py-1.5 bg-[#21262d] border border-[#30363d] rounded-md text-sm text-[#e6edf3] focus:border-blue-500 focus:outline-none transition-colors"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2 py-1.5 bg-[#21262d] border border-[#30363d] rounded-md text-sm text-[#e6edf3] focus:border-blue-500 focus:outline-none transition-colors"
        >
          <option value="">All Status</option>
          <option value="2">2xx</option>
          <option value="3">3xx</option>
          <option value="4">4xx</option>
          <option value="5">5xx</option>
        </select>
        <span className="text-xs text-[#484f58] tabular-nums">{filtered.length} flows</span>
        <div className="relative">
          <button
            onClick={() => setShowExport(!showExport)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#8b949e] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
            title="Export / Import"
          >
            <Download size={13} /> Export <ChevronDown size={10} />
          </button>
          {showExport && (
            <div className="absolute right-0 top-full mt-1 bg-[#161b22] border border-[#30363d] rounded-md shadow-xl z-50 min-w-[180px] py-1">
              <button onClick={() => { downloadExport('har'); setShowExport(false) }} className="w-full text-left px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-[#21262d] transition-colors">
                Export as HAR
              </button>
              <button onClick={() => { downloadExport('burp-xml'); setShowExport(false) }} className="w-full text-left px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-[#21262d] transition-colors">
                Export as Burp XML
              </button>
              <button onClick={() => { downloadExport('json'); setShowExport(false) }} className="w-full text-left px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-[#21262d] transition-colors">
                Export as JSON
              </button>
              <div className="border-t border-[#30363d] my-1" />
              <button onClick={() => { fileInputRef.current?.click(); setShowExport(false) }} className="w-full text-left px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-[#21262d] transition-colors flex items-center gap-1.5">
                <Upload size={11} /> Import Burp XML
              </button>
            </div>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept=".xml" onChange={handleImport} className="hidden" />
        <button
          onClick={handleClear}
          className="p-1.5 rounded text-[#484f58] hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Clear history"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#161b22] z-10">
            <tr className="border-b border-[#30363d] text-[#8b949e] text-left">
              <th className="px-3 py-2 font-medium w-10">#</th>
              <th className="px-3 py-2 font-medium w-20">Method</th>
              <th className="px-3 py-2 font-medium">Host</th>
              <th className="px-3 py-2 font-medium">Path</th>
              <th className="px-3 py-2 font-medium w-16">Status</th>
              <th className="px-3 py-2 font-medium w-24">Type</th>
              <th className="px-3 py-2 font-medium w-20">Size</th>
              <th className="px-3 py-2 font-medium w-20">Time</th>
              <th className="px-3 py-2 font-medium w-24">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((flow, i) => (
              <tr
                key={flow.id}
                onClick={() => onSelect(flow)}
                className={`border-b border-[#21262d] cursor-pointer transition-colors ${
                  selectedId === flow.id
                    ? 'bg-blue-500/10'
                    : 'hover:bg-[#161b22]'
                } ${flow.highlighted ? 'border-l-2 border-l-amber-500' : ''}`}
              >
                <td className="px-3 py-1.5 text-[#484f58] font-mono tabular-nums">{i + 1}</td>
                <td className="px-3 py-1.5"><MethodBadge method={flow.method} /></td>
                <td className="px-3 py-1.5 font-mono text-[#e6edf3] truncate max-w-[200px]">{flow.host}</td>
                <td className="px-3 py-1.5 font-mono text-[#8b949e] truncate max-w-[300px]">{flow.path}</td>
                <td className="px-3 py-1.5"><StatusBadge code={flow.status_code} /></td>
                <td className="px-3 py-1.5 text-[#484f58] text-xs truncate max-w-[120px]">
                  {flow.response_content_type?.split(';')[0] || '---'}
                </td>
                <td className="px-3 py-1.5 text-[#484f58] font-mono text-xs tabular-nums">
                  {formatSize(flow.response_body)}
                </td>
                <td className="px-3 py-1.5 text-[#484f58] font-mono text-xs tabular-nums">
                  {formatDuration(flow.duration_ms)}
                </td>
                <td className="px-3 py-1.5 text-[#484f58] text-xs tabular-nums">
                  {formatTime(flow.timestamp)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[#484f58] text-sm">
                  {flows.length === 0 ? 'No flows captured yet. Configure your browser to use the proxy.' : 'No flows match the current filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
