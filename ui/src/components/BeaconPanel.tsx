import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Copy, Trash2, ChevronDown, ChevronRight, Radio, Globe } from 'lucide-react'
import type { BeaconToken, BeaconInteraction } from '../types'
import {
  generateBeaconToken,
  listBeaconTokens,
  getBeaconToken,
  deleteBeaconToken,
  getBeaconStatus,
  useBeaconStream,
} from '../api'
import type { BeaconEvent } from '../api'
import HeadersTable from './HeadersTable'
import BodyViewer from './BodyViewer'

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString()
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-[#484f58] hover:text-[#8b949e] hover:bg-[#21262d] transition-colors"
      title="Copy"
    >
      <Copy size={11} />
      {copied ? <span className="text-emerald-400">Copied!</span> : label && <span>{label}</span>}
    </button>
  )
}

function InteractionRow({ interaction }: { interaction: BeaconInteraction }) {
  const [expanded, setExpanded] = useState(false)
  const [isNew, setIsNew] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setIsNew(false), 2000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className={`border-b border-[#21262d] transition-colors duration-1000 ${isNew ? 'bg-emerald-500/10' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#21262d]/50 transition-colors"
      >
        {expanded ? <ChevronDown size={12} className="text-[#484f58]" /> : <ChevronRight size={12} className="text-[#484f58]" />}
        <span className="text-xs font-mono text-amber-400 font-semibold w-14">{interaction.method}</span>
        <span className="text-xs font-mono text-[#8b949e] truncate flex-1">
          {interaction.path}{interaction.query_string ? `?${interaction.query_string}` : ''}
        </span>
        <span className="text-xs text-[#484f58] font-mono">{interaction.source_ip}</span>
        <span className="text-xs text-[#484f58] tabular-nums">{formatTime(interaction.timestamp)}</span>
      </button>
      {expanded && (
        <div className="border-t border-[#21262d] bg-[#0d1117]">
          <div className="px-3 py-2 space-y-2">
            <div className="flex items-center gap-4 text-xs">
              <span className="text-[#8b949e]">Source IP: <span className="text-[#e6edf3] font-mono">{interaction.source_ip}</span></span>
              <span className="text-[#8b949e]">Protocol: <span className="text-[#e6edf3] font-mono">{interaction.protocol}</span></span>
              <span className="text-[#8b949e]">Time: <span className="text-[#e6edf3]">{formatDate(interaction.timestamp)}</span></span>
            </div>
            <div>
              <p className="text-xs font-semibold text-[#8b949e] mb-1">Headers</p>
              <HeadersTable headers={interaction.headers} />
            </div>
            {interaction.body && (
              <div>
                <p className="text-xs font-semibold text-[#8b949e] mb-1">Body</p>
                <BodyViewer body={interaction.body} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ExamplePayloads({ url }: { url: string }) {
  const payloads = [
    { label: 'SSRF', value: url },
    { label: 'Blind XSS', value: `<img src="${url}">` },
    { label: 'XXE', value: `<!ENTITY xxe SYSTEM "${url}">` },
    { label: 'cURL', value: `curl ${url}` },
    { label: 'Fetch', value: `fetch("${url}")` },
    { label: 'Redirect', value: url },
  ]
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-[#8b949e] uppercase tracking-wide">Example Payloads</p>
      {payloads.map(({ label, value }) => (
        <div key={label} className="flex items-center gap-2 bg-[#0d1117] rounded px-2.5 py-1.5 border border-[#21262d]">
          <span className="text-xs text-[#484f58] w-16 shrink-0">{label}</span>
          <code className="text-xs font-mono text-[#8b949e] truncate flex-1">{value}</code>
          <CopyButton text={value} />
        </div>
      ))}
    </div>
  )
}

export default function BeaconPanel() {
  const [tokens, setTokens] = useState<BeaconToken[]>([])
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<(BeaconToken & { interactions: BeaconInteraction[] }) | null>(null)
  const [status, setStatus] = useState<{ enabled: boolean; url: string; token_count: number; interaction_count: number } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadTokens = useCallback(async () => {
    try {
      const data = await listBeaconTokens()
      setTokens(data)
    } catch {
      // beacon not running
    }
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const s = await getBeaconStatus()
      setStatus(s)
    } catch {
      setStatus(null)
    }
  }, [])

  const loadDetail = useCallback(async (token: string) => {
    try {
      const detail = await getBeaconToken(token)
      setSelectedDetail(detail)
    } catch {
      // token may have been deleted
    }
  }, [])

  useEffect(() => {
    loadTokens()
    loadStatus()
  }, [loadTokens, loadStatus])

  useEffect(() => {
    if (selectedToken) {
      loadDetail(selectedToken)
    } else {
      setSelectedDetail(null)
    }
  }, [selectedToken, loadDetail])

  const handleBeaconEvent = useCallback((event: BeaconEvent) => {
    if (event.type === 'interaction') {
      const interaction = event.data
      setTokens((prev) =>
        prev.map((t) =>
          t.token === interaction.token
            ? { ...t, interaction_count: t.interaction_count + 1 }
            : t
        )
      )
      setSelectedDetail((prev) => {
        if (prev && prev.token === interaction.token) {
          return { ...prev, interactions: [interaction, ...prev.interactions], interaction_count: prev.interaction_count + 1 }
        }
        return prev
      })
      loadStatus()
    }
  }, [loadStatus])

  useBeaconStream(handleBeaconEvent)

  const handleGenerate = async () => {
    setCreating(true)
    try {
      const token = await generateBeaconToken(description)
      setTokens((prev) => [token, ...prev])
      setSelectedToken(token.token)
      setDescription('')
      setShowForm(false)
      loadStatus()
    } catch {
      // error
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (token: string) => {
    await deleteBeaconToken(token)
    setTokens((prev) => prev.filter((t) => t.token !== token))
    if (selectedToken === token) {
      setSelectedToken(null)
    }
    loadStatus()
  }

  useEffect(() => {
    if (showForm) inputRef.current?.focus()
  }, [showForm])

  const totalInteractions = tokens.reduce((sum, t) => sum + t.interaction_count, 0)

  if (tokens.length === 0 && !showForm) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-[#161b22] border border-[#30363d] flex items-center justify-center">
          <Radio size={28} className="text-[#484f58]" />
        </div>
        <div>
          <p className="text-[#e6edf3] font-medium mb-1">No beacon payloads yet</p>
          <p className="text-sm text-[#484f58] max-w-md">
            Generate a beacon payload to detect blind vulnerabilities like SSRF, blind XSS, XXE, and out-of-band data exfiltration.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
        >
          <Plus size={14} /> Generate Payload
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22]">
        {showForm ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              ref={inputRef}
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              placeholder="Description (optional, e.g. 'SSRF test on /api/webhook')"
              className="flex-1 px-2.5 py-1.5 bg-[#21262d] border border-[#30363d] rounded-md text-sm text-[#e6edf3] placeholder-[#484f58] focus:border-blue-500 focus:outline-none transition-colors"
            />
            <button
              onClick={handleGenerate}
              disabled={creating}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
            >
              {creating ? 'Creating...' : 'Generate'}
            </button>
            <button
              onClick={() => { setShowForm(false); setDescription('') }}
              className="px-2 py-1.5 text-sm text-[#8b949e] hover:text-[#e6edf3] transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
            >
              <Plus size={14} /> Generate Payload
            </button>
            <div className="flex-1" />
            {status && (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-[#484f58]">
                  <Globe size={11} className="inline mr-1" />
                  {status.url}
                </span>
                {status.url.includes('127.0.0.1') || status.url.includes('localhost') ? (
                  <span className="text-amber-400/70 text-[10px]" title="Use --beacon-url to set a public URL for external targets">
                    (local only — use --beacon-url for external targets)
                  </span>
                ) : null}
                <span className="text-[#484f58]">{tokens.length} token{tokens.length !== 1 ? 's' : ''}</span>
                {totalInteractions > 0 && (
                  <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-medium">
                    {totalInteractions} interaction{totalInteractions !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-2/5 border-r border-[#30363d] overflow-auto">
          {tokens.map((t) => (
            <div
              key={t.id}
              onClick={() => setSelectedToken(t.token)}
              className={`flex items-center gap-2 px-3 py-2.5 border-b border-[#21262d] cursor-pointer transition-colors ${
                selectedToken === t.token ? 'bg-blue-500/10' : 'hover:bg-[#161b22]'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-[#e6edf3] truncate">{t.token}</code>
                  <CopyButton text={t.payload_url} label="URL" />
                </div>
                {t.description && (
                  <p className="text-xs text-[#8b949e] mt-0.5 truncate">{t.description}</p>
                )}
                <p className="text-xs text-[#484f58] mt-0.5 tabular-nums">{formatDate(t.created_at)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                  t.interaction_count > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-[#21262d] text-[#484f58]'
                }`}>
                  {t.interaction_count}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(t.token) }}
                  className="p-1 rounded text-[#484f58] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Delete token"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="w-3/5 overflow-auto">
          {selectedDetail ? (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3 border-b border-[#30363d] bg-[#161b22] space-y-3">
                <div>
                  <p className="text-xs font-semibold text-[#8b949e] uppercase tracking-wide mb-1">Payload URL</p>
                  <div className="flex items-center gap-2 bg-[#0d1117] rounded px-3 py-2 border border-[#30363d]">
                    <code className="text-sm font-mono text-blue-400 break-all flex-1">{selectedDetail.payload_url}</code>
                    <CopyButton text={selectedDetail.payload_url} />
                  </div>
                </div>
                <ExamplePayloads url={selectedDetail.payload_url} />
              </div>

              <div className="flex-1 overflow-auto">
                <div className="px-4 py-2 border-b border-[#30363d] bg-[#161b22]">
                  <p className="text-xs font-semibold text-[#8b949e] uppercase tracking-wide">
                    Interactions ({selectedDetail.interactions.length})
                  </p>
                </div>
                {selectedDetail.interactions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500/50 animate-pulse" />
                    <p className="text-sm text-[#484f58]">Waiting for callbacks...</p>
                    <p className="text-xs text-[#484f58]">Inject the payload URL into a target and interactions will appear here</p>
                  </div>
                ) : (
                  selectedDetail.interactions.map((interaction) => (
                    <InteractionRow key={interaction.id} interaction={interaction} />
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-[#484f58]">Select a token to view details and interactions</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
