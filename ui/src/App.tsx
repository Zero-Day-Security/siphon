import { useState, useCallback, useEffect, useRef } from 'react'
import { Shield, History, Crosshair, Repeat, Code, Camera, Radio, Globe, Wifi, WifiOff, Save, FolderOpen } from 'lucide-react'
import type { Flow } from './types'
import { fetchFlows, useFlowStream, authedFetch } from './api'
import type { FlowEvent } from './api'
import ProxyHistory from './components/ProxyHistory'
import RequestDetail from './components/RequestDetail'
import Repeater from './components/Repeater'
import Decoder from './components/Decoder'
import TargetScope from './components/TargetScope'
import EvidencePanel from './components/EvidencePanel'
import BeaconPanel from './components/BeaconPanel'
import BrowserPanel from './components/BrowserPanel'

type Tab = 'history' | 'target' | 'repeater' | 'decoder' | 'evidence' | 'beacon' | 'browser'

const TABS: { id: Tab; label: string; icon: typeof History }[] = [
  { id: 'history', label: 'History', icon: History },
  { id: 'target', label: 'Target', icon: Crosshair },
  { id: 'repeater', label: 'Repeater', icon: Repeat },
  { id: 'decoder', label: 'Decoder', icon: Code },
  { id: 'evidence', label: 'Evidence', icon: Camera },
  { id: 'beacon', label: 'Beacon', icon: Radio },
  { id: 'browser', label: 'Browser', icon: Globe },
]

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('history')
  const [flows, setFlows] = useState<Flow[]>([])
  const [selectedFlow, setSelectedFlow] = useState<Flow | null>(null)
  const [repeaterFlow, setRepeaterFlow] = useState<Flow | null>(null)
  const repeaterKeyRef = useRef(0)

  useEffect(() => {
    fetchFlows().then((data) => {
      setFlows(data.reverse())
    }).catch(() => {})
  }, [])

  const handleFlowEvent = useCallback((event: FlowEvent) => {
    setFlows((prev) => {
      if (event.type === 'new') {
        return [event.flow, ...prev]
      }
      return prev.map((f) => (f.id === event.flow.id ? event.flow : f))
    })
    setSelectedFlow((prev) => {
      if (prev && prev.id === event.flow.id) return event.flow
      return prev
    })
  }, [])

  const connected = useFlowStream(handleFlowEvent)

  const handleFlowUpdate = (updated: Flow) => {
    setFlows((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
    setSelectedFlow((prev) => (prev?.id === updated.id ? updated : prev))
  }

  const handleSendToRepeater = (flow: Flow) => {
    setRepeaterFlow(flow)
    repeaterKeyRef.current += 1
    setActiveTab('repeater')
  }

  const handleClear = () => {
    setFlows([])
    setSelectedFlow(null)
  }

  const projectInputRef = useRef<HTMLInputElement>(null)

  const handleSaveProject = async () => {
    try {
      const res = await authedFetch('/project/save')
      if (!res.ok) throw new Error('Failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `siphon_project_${new Date().toISOString().slice(0, 10)}.siphon`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  const handleLoadProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      const res = await authedFetch('/project/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      })
      const stats = await res.json()
      alert(`Project loaded: ${stats.flows} flows, ${stats.evidence} evidence, ${stats.beacon_tokens} beacon tokens`)
      const data = await fetchFlows()
      setFlows(data.reverse())
      setSelectedFlow(null)
    } catch {
      alert('Failed to load project file')
    }
    if (projectInputRef.current) projectInputRef.current.value = ''
  }

  return (
    <div className="h-screen flex flex-col bg-[#0d1117]">
      <header className="flex items-center justify-between px-4 py-2 border-b border-[#30363d] bg-[#161b22]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Shield size={20} className="text-blue-500" />
            <h1 className="text-base font-bold text-[#e6edf3] tracking-tight">Siphon</h1>
          </div>
          <nav className="flex items-center gap-1 ml-6">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === id
                    ? 'bg-[#21262d] text-[#e6edf3]'
                    : 'text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d]/50'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveProject}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#8b949e] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
            title="Save Project"
          >
            <Save size={13} /> Save
          </button>
          <button
            onClick={() => projectInputRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#8b949e] hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            title="Load Project"
          >
            <FolderOpen size={13} /> Load
          </button>
          <input ref={projectInputRef} type="file" accept=".siphon,.json" onChange={handleLoadProject} className="hidden" />
          <div className="w-px h-4 bg-[#30363d]" />
          {connected ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Wifi size={12} />
              <span>Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-[#484f58]">
              <WifiOff size={12} />
              <span>Disconnected</span>
            </div>
          )}
          <span className="text-xs text-[#484f58] px-2 py-1 bg-[#21262d] rounded">
            Proxy :8080
          </span>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        {activeTab === 'history' && (
          <div className="flex flex-col h-full">
            <div className={`${selectedFlow ? 'h-1/2' : 'h-full'} border-b border-[#30363d]`}>
              <ProxyHistory
                flows={flows}
                selectedId={selectedFlow?.id || null}
                onSelect={setSelectedFlow}
                onClear={handleClear}
              />
            </div>
            {selectedFlow && (
              <div className="h-1/2">
                <RequestDetail
                  key={selectedFlow.id}
                  flow={selectedFlow}
                  onUpdate={handleFlowUpdate}
                  onSendToRepeater={handleSendToRepeater}
                />
              </div>
            )}
          </div>
        )}
        {activeTab === 'target' && (
          <TargetScope />
        )}
        {activeTab === 'repeater' && (
          <Repeater key={repeaterKeyRef.current} initialFlow={repeaterFlow} />
        )}
        {activeTab === 'decoder' && (
          <Decoder />
        )}
        {activeTab === 'evidence' && (
          <EvidencePanel />
        )}
        {activeTab === 'beacon' && (
          <BeaconPanel />
        )}
        {activeTab === 'browser' && (
          <BrowserPanel />
        )}
      </main>
    </div>
  )
}
