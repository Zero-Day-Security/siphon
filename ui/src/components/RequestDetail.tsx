import { useState, useMemo } from 'react'
import { Repeat, Camera, Star, Clipboard, ChevronDown, ChevronRight } from 'lucide-react'
import type { Flow } from '../types'
import { toggleHighlight, setNotes, captureEvidence } from '../api'
import MethodBadge from './MethodBadge'
import StatusBadge from './StatusBadge'
import HeadersTable from './HeadersTable'
import BodyViewer from './BodyViewer'

type SubTab = 'headers' | 'body' | 'inspector'

function buildCurl(flow: Flow): string {
  let cmd = `curl -X ${flow.method} '${flow.url}'`
  for (const [k, v] of Object.entries(flow.request_headers)) {
    if (k.toLowerCase() === 'host') continue
    cmd += ` \\\n  -H '${k}: ${v}'`
  }
  if (flow.request_body) {
    cmd += ` \\\n  -d '${flow.request_body.replace(/'/g, "'\\''")}'`
  }
  return cmd
}

function parseQueryParams(url: string): [string, string][] {
  try {
    const u = new URL(url)
    return Array.from(u.searchParams.entries())
  } catch {
    return []
  }
}

function parseCookies(headers: Record<string, string>): [string, string][] {
  const raw = Object.entries(headers).find(([k]) => k.toLowerCase() === 'cookie')?.[1]
  if (!raw) return []
  return raw.split(';').map((c) => {
    const eq = c.indexOf('=')
    if (eq === -1) return [c.trim(), ''] as [string, string]
    return [c.slice(0, eq).trim(), c.slice(eq + 1).trim()] as [string, string]
  })
}

function parseFormParams(body: string | null, contentType: string | null): [string, string][] {
  if (!body || !contentType?.includes('form-urlencoded')) return []
  return body.split('&').map((p) => {
    const eq = p.indexOf('=')
    if (eq === -1) return [decodeURIComponent(p), ''] as [string, string]
    return [decodeURIComponent(p.slice(0, eq)), decodeURIComponent(p.slice(eq + 1))] as [string, string]
  })
}

function InspectorSection({ title, count, defaultOpen, children }: {
  title: string; count: number; defaultOpen: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-[#21262d]">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-[#161b22] transition-colors"
      >
        {open ? <ChevronDown size={12} className="text-[#484f58]" /> : <ChevronRight size={12} className="text-[#484f58]" />}
        <span className="text-xs text-[#8b949e]">{title}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${count > 0 ? 'bg-blue-500/20 text-blue-400' : 'bg-[#21262d] text-[#484f58]'}`}>
          {count}
        </span>
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  )
}

function KVTable({ entries }: { entries: [string, string][] }) {
  if (entries.length === 0) return <span className="text-xs text-[#484f58] italic">(none)</span>
  return (
    <table className="w-full text-xs">
      <tbody>
        {entries.map(([k, v], i) => (
          <tr key={i} className="border-b border-[#21262d]/50">
            <td className="py-1 pr-3 font-mono font-semibold text-[#e6edf3] whitespace-nowrap align-top">{k}</td>
            <td className="py-1 font-mono text-[#8b949e] break-all">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Inspector({ flow }: { flow: Flow }) {
  const queryParams = useMemo(() => parseQueryParams(flow.url), [flow.url])
  const cookies = useMemo(() => parseCookies(flow.request_headers), [flow.request_headers])
  const formParams = useMemo(() => parseFormParams(flow.request_body, flow.request_content_type), [flow.request_body, flow.request_content_type])
  const headerCount = Object.keys(flow.request_headers).length

  let parsedUrl: URL | null = null
  try { parsedUrl = new URL(flow.url) } catch { /* ignore */ }

  return (
    <div className="overflow-auto">
      <InspectorSection title="Request Attributes" count={4} defaultOpen={false}>
        <KVTable entries={[
          ['Method', flow.method],
          ['URL', flow.url],
          ['Protocol', flow.scheme.toUpperCase()],
          ['Host', `${flow.host}:${flow.port}`],
          ...(parsedUrl?.pathname ? [['Path', parsedUrl.pathname] as [string, string]] : []),
        ]} />
      </InspectorSection>
      <InspectorSection title="Query Parameters" count={queryParams.length} defaultOpen={queryParams.length > 0}>
        <KVTable entries={queryParams} />
      </InspectorSection>
      <InspectorSection title="Cookies" count={cookies.length} defaultOpen={cookies.length > 0}>
        <KVTable entries={cookies} />
      </InspectorSection>
      <InspectorSection title="Request Headers" count={headerCount} defaultOpen={false}>
        <KVTable entries={Object.entries(flow.request_headers)} />
      </InspectorSection>
      {formParams.length > 0 && (
        <InspectorSection title="Form Parameters" count={formParams.length} defaultOpen={true}>
          <KVTable entries={formParams} />
        </InspectorSection>
      )}
    </div>
  )
}

interface Props {
  flow: Flow
  onUpdate: (flow: Flow) => void
  onSendToRepeater: (flow: Flow) => void
}

export default function RequestDetail({ flow, onUpdate, onSendToRepeater }: Props) {
  const [reqTab, setReqTab] = useState<SubTab>('headers')
  const [resTab, setResTab] = useState<SubTab>('headers')
  const [notesValue, setNotesValue] = useState(flow.notes)
  const [captured, setCaptured] = useState(false)

  const handleHighlight = async () => {
    const updated = await toggleHighlight(flow.id)
    onUpdate(updated)
  }

  const handleSaveNotes = async () => {
    const updated = await setNotes(flow.id, notesValue)
    onUpdate(updated)
  }

  const handleCapture = async () => {
    await captureEvidence(flow.id)
    setCaptured(true)
    setTimeout(() => setCaptured(false), 2000)
  }

  const handleCopyCurl = async () => {
    await navigator.clipboard.writeText(buildCurl(flow))
  }

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-xs font-medium transition-colors rounded-t ${
      active
        ? 'text-[#e6edf3] bg-[#0d1117] border border-[#30363d] border-b-transparent'
        : 'text-[#484f58] hover:text-[#8b949e]'
    }`

  return (
    <div className="flex flex-col h-full bg-[#161b22]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d]">
        <MethodBadge method={flow.method} />
        <span className="font-mono text-sm text-[#e6edf3] truncate flex-1">{flow.url}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSendToRepeater(flow)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#8b949e] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
            title="Send to Repeater"
          >
            <Repeat size={12} /> Repeater
          </button>
          <button
            onClick={handleCapture}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              captured ? 'text-emerald-400' : 'text-[#8b949e] hover:text-emerald-400 hover:bg-emerald-500/10'
            }`}
            title="Capture Evidence"
          >
            <Camera size={12} /> {captured ? 'Captured!' : 'Evidence'}
          </button>
          <button
            onClick={handleHighlight}
            className={`p-1 rounded transition-colors ${
              flow.highlighted ? 'text-amber-400' : 'text-[#484f58] hover:text-amber-400'
            }`}
            title="Toggle highlight"
          >
            <Star size={14} fill={flow.highlighted ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={handleCopyCurl}
            className="p-1 rounded text-[#484f58] hover:text-[#8b949e] transition-colors"
            title="Copy as cURL"
          >
            <Clipboard size={14} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col border-r border-[#30363d] min-w-0">
          <div className="flex items-center gap-px px-3 pt-2 bg-[#161b22]">
            <span className="text-xs font-semibold text-[#8b949e] mr-3">Request</span>
            <button className={tabClass(reqTab === 'headers')} onClick={() => setReqTab('headers')}>Headers</button>
            <button className={tabClass(reqTab === 'body')} onClick={() => setReqTab('body')}>Body</button>
            <button className={tabClass(reqTab === 'inspector')} onClick={() => setReqTab('inspector')}>Inspector</button>
          </div>
          <div className="flex-1 overflow-auto bg-[#0d1117]">
            {reqTab === 'headers' && <HeadersTable headers={flow.request_headers} />}
            {reqTab === 'body' && <BodyViewer body={flow.request_body} contentType={flow.request_content_type} />}
            {reqTab === 'inspector' && <Inspector flow={flow} />}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-px px-3 pt-2 bg-[#161b22]">
            <span className="text-xs font-semibold text-[#8b949e] mr-2">Response</span>
            {flow.status_code !== null && (
              <StatusBadge code={flow.status_code} />
            )}
            <span className="flex-1" />
            <button className={tabClass(resTab === 'headers')} onClick={() => setResTab('headers')}>Headers</button>
            <button className={tabClass(resTab === 'body')} onClick={() => setResTab('body')}>Body</button>
          </div>
          <div className="flex-1 overflow-auto bg-[#0d1117]">
            {flow.response_headers ? (
              resTab === 'headers' ? (
                <HeadersTable headers={flow.response_headers} />
              ) : (
                <BodyViewer body={flow.response_body} contentType={flow.response_content_type} />
              )
            ) : (
              <p className="text-[#484f58] text-sm italic p-3">Waiting for response...</p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-[#30363d] px-3 py-2">
        <textarea
          value={notesValue}
          onChange={(e) => setNotesValue(e.target.value)}
          onBlur={handleSaveNotes}
          placeholder="Add notes..."
          rows={2}
          className="w-full px-2 py-1.5 bg-[#21262d] border border-[#30363d] rounded-md text-xs text-[#e6edf3] placeholder-[#484f58] resize-none focus:border-blue-500 focus:outline-none transition-colors"
        />
      </div>
    </div>
  )
}
