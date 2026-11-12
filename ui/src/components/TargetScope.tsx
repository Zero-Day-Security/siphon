import { useState, useEffect, useMemo } from 'react'
import { Check, X, Plus, Save, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import type { Flow } from '../types'
import { fetchFlows, getScope, setScope, toggleScopeFilter, getSitemap } from '../api'
import MethodBadge from './MethodBadge'
import StatusBadge from './StatusBadge'

interface ScopeData {
  patterns: string[]
  enabled: boolean
}

interface SitemapEntry {
  host: string
  flow_count: number
  paths?: string[]
  methods: string[]
  in_scope: boolean
}

export default function TargetScope() {
  const [scopeData, setScopeData] = useState<ScopeData>({ patterns: [], enabled: false })
  const [patternsText, setPatternsText] = useState('')
  const [sitemap, setSitemap] = useState<SitemapEntry[]>([])
  const [saved, setSaved] = useState(false)
  const [flows, setFlows] = useState<Flow[]>([])
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set())

  const loadScope = async () => {
    try {
      const data = await getScope()
      setScopeData(data)
      setPatternsText(data.patterns.join('\n'))
    } catch {
      // scope endpoint may not exist yet
    }
  }

  const loadSitemap = async () => {
    try {
      const data = await getSitemap()
      setSitemap(data)
    } catch { /* ignore */ }
    try {
      const flowData = await fetchFlows()
      setFlows(flowData)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadScope()
    loadSitemap()
  }, [])

  const toggleHost = (host: string) => {
    setExpandedHosts((prev) => {
      const next = new Set(prev)
      if (next.has(host)) next.delete(host)
      else next.add(host)
      return next
    })
  }

  const flowsByHost = useMemo(() => {
    const map = new Map<string, Flow[]>()
    for (const f of flows) {
      const list = map.get(f.host) || []
      list.push(f)
      map.set(f.host, list)
    }
    return map
  }, [flows])

  const derivedSitemap = useMemo(() => {
    if (sitemap.length > 0) return sitemap
    const hostMap = new Map<string, { count: number; methods: Set<string>; paths: Set<string> }>()
    for (const f of flows) {
      const entry = hostMap.get(f.host) || { count: 0, methods: new Set<string>(), paths: new Set<string>() }
      entry.count++
      entry.methods.add(f.method)
      entry.paths.add(f.path)
      hostMap.set(f.host, entry)
    }
    return Array.from(hostMap.entries())
      .map(([host, { count, methods, paths }]) => ({
        host,
        flow_count: count,
        paths: Array.from(paths),
        methods: Array.from(methods),
        in_scope: scopeData.patterns.some((p) => matchPattern(p, host)),
      }))
      .sort((a, b) => b.flow_count - a.flow_count)
  }, [sitemap, flows, scopeData.patterns])

  const handleToggleScope = async () => {
    try {
      const data = await toggleScopeFilter()
      setScopeData((prev) => ({ ...prev, enabled: data.enabled }))
    } catch { /* ignore */ }
  }

  const handleSave = async () => {
    const patterns = patternsText.split('\n').map((l) => l.trim()).filter(Boolean)
    try {
      const data = await setScope(patterns)
      setScopeData(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      loadSitemap()
    } catch { /* ignore */ }
  }

  const handleAddHost = (host: string) => {
    const current = patternsText.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!current.includes(host)) {
      const updated = [...current, host]
      setPatternsText(updated.join('\n'))
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#30363d] bg-[#161b22]">
        <span className="text-sm font-semibold text-[#e6edf3]">Target Scope</span>
        <div className="flex items-center gap-2 ml-4">
          <button
            onClick={handleToggleScope}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              scopeData.enabled ? 'bg-blue-600' : 'bg-[#30363d]'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                scopeData.enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span className={`text-xs ${scopeData.enabled ? 'text-blue-400' : 'text-[#484f58]'}`}>
            {scopeData.enabled ? 'Scope filtering active' : 'Scope filtering disabled'}
          </span>
        </div>
        {scopeData.enabled && (
          <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
            Out-of-scope traffic will not be captured
          </span>
        )}
        <span className="flex-1" />
        <button
          onClick={() => { loadScope(); loadSitemap() }}
          className="p-1 rounded text-[#484f58] hover:text-[#8b949e] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-2/5 flex flex-col border-r border-[#30363d]">
          <div className="flex items-center justify-between px-3 py-2 bg-[#161b22] border-b border-[#30363d]">
            <span className="text-xs font-medium text-[#8b949e] uppercase tracking-wider">Scope Patterns</span>
            <button
              onClick={handleSave}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                saved ? 'text-emerald-400' : 'text-blue-400 hover:bg-blue-500/10'
              }`}
            >
              <Save size={12} /> {saved ? 'Saved!' : 'Save'}
            </button>
          </div>
          <textarea
            value={patternsText}
            onChange={(e) => setPatternsText(e.target.value)}
            placeholder={"example.com\n*.api.example.com\n192.168.1.*"}
            className="flex-1 w-full p-3 bg-[#0d1117] text-[#e6edf3] font-mono text-sm resize-none focus:outline-none placeholder-[#484f58]"
            spellCheck={false}
          />
          <div className="px-3 py-2 border-t border-[#30363d] bg-[#161b22]">
            <p className="text-[10px] text-[#484f58] leading-relaxed">
              One pattern per line. Use <code className="text-[#8b949e]">*</code> for wildcards.
              When scope filtering is enabled, only matching traffic is captured by the proxy.
            </p>
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          <div className="flex items-center px-3 py-2 bg-[#161b22] border-b border-[#30363d]">
            <span className="text-xs font-medium text-[#8b949e] uppercase tracking-wider">Site Map</span>
            <span className="text-xs text-[#484f58] ml-2">{derivedSitemap.length} host(s)</span>
          </div>
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#161b22] z-10">
                <tr className="border-b border-[#30363d] text-[#8b949e] text-left">
                  <th className="px-3 py-2 font-medium w-8"></th>
                  <th className="px-3 py-2 font-medium">Host / Path</th>
                  <th className="px-3 py-2 font-medium w-20">Flows</th>
                  <th className="px-3 py-2 font-medium w-16">Method</th>
                  <th className="px-3 py-2 font-medium w-16">Status</th>
                  <th className="px-3 py-2 font-medium w-20 text-center">In Scope</th>
                  <th className="px-3 py-2 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {derivedSitemap.map((entry) => {
                  const expanded = expandedHosts.has(entry.host)
                  const hostFlows = flowsByHost.get(entry.host) || []
                  return (
                    <>
                      <tr
                        key={entry.host}
                        onClick={() => toggleHost(entry.host)}
                        className="border-b border-[#21262d] hover:bg-[#161b22] transition-colors cursor-pointer"
                      >
                        <td className="px-3 py-2 text-[#484f58]">
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="px-3 py-2 font-mono text-[#e6edf3] font-semibold">{entry.host}</td>
                        <td className="px-3 py-2 text-[#8b949e] tabular-nums">{entry.flow_count}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1 flex-wrap">
                            {entry.methods.map((m) => (
                              <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e]">{m}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2"></td>
                        <td className="px-3 py-2 text-center">
                          {entry.in_scope ? (
                            <Check size={14} className="inline text-emerald-400" />
                          ) : (
                            <X size={14} className="inline text-[#484f58]" />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {!entry.in_scope && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAddHost(entry.host) }}
                              className="p-1 rounded text-[#484f58] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                              title="Add to scope"
                            >
                              <Plus size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded && hostFlows.map((f) => (
                        <tr key={f.id} className="border-b border-[#21262d]/50 bg-[#0d1117] hover:bg-[#161b22]/50 transition-colors">
                          <td className="px-3 py-1.5"></td>
                          <td className="px-3 py-1.5 font-mono text-xs text-[#8b949e] pl-8 truncate max-w-[300px]">{f.path}</td>
                          <td className="px-3 py-1.5"></td>
                          <td className="px-3 py-1.5"><MethodBadge method={f.method} /></td>
                          <td className="px-3 py-1.5"><StatusBadge code={f.status_code} /></td>
                          <td className="px-3 py-1.5"></td>
                          <td className="px-3 py-1.5"></td>
                        </tr>
                      ))}
                    </>
                  )
                })}
                {derivedSitemap.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[#484f58] text-sm">
                      No hosts discovered yet. Proxy some traffic first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function matchPattern(pattern: string, host: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
    'i'
  )
  return regex.test(host)
}
