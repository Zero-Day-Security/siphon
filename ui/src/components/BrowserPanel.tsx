import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, ArrowLeft, ArrowRight, RotateCw, AlertTriangle, Globe, Monitor, Eye } from 'lucide-react'
import { authedFetch } from '../api'

interface BrowserStatus {
  running: boolean
  available: boolean
  url: string | null
}

interface XssEvent {
  type: string
  args: string
  url: string
  timestamp: number
}

export default function BrowserPanel() {
  const [status, setStatus] = useState<BrowserStatus>({ running: false, available: false, url: null })
  const [urlInput, setUrlInput] = useState('')
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pageTitle, setPageTitle] = useState('')
  const [xssEvents, setXssEvents] = useState<XssEvent[]>([])
  const [xssHooks, setXssHooks] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = async () => {
    try {
      const res = await authedFetch('/browser/status')
      const data = await res.json()
      setStatus(data)
      if (data.url) setUrlInput(data.url)
    } catch { /* ignore */ }
  }

  const fetchXss = async () => {
    try {
      const res = await authedFetch('/browser/xss')
      const data = await res.json()
      setXssEvents(data)
    } catch { /* ignore */ }
  }

  const refreshScreenshot = useCallback(async () => {
    try {
      const res = await authedFetch('/browser/screenshot')
      if (res.ok) {
        const blob = await res.blob()
        setScreenshotUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return URL.createObjectURL(blob)
        })
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchStatus()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (status.running) {
      refreshScreenshot()
      fetchXss()
      intervalRef.current = setInterval(() => {
        refreshScreenshot()
        fetchXss()
      }, 1500)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setScreenshotUrl(null)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [status.running, refreshScreenshot])

  const handleStart = async (useHeadless?: boolean) => {
    setLoading(true)
    try {
      const res = await authedFetch('/browser/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: useHeadless ?? true, xss_hooks: xssHooks }),
      })
      await res.json()
      await fetchStatus()
    } catch { /* ignore */ }
    setLoading(false)
  }

  const handleStop = async () => {
    try {
      await authedFetch('/browser/stop', { method: 'POST' })
      setStatus({ running: false, available: true, url: null })
      setScreenshotUrl(null)
      setPageTitle('')
      setXssEvents([])
    } catch { /* ignore */ }
  }

  const handleNavigate = async (url?: string) => {
    const target = url || urlInput
    if (!target) return
    setLoading(true)
    try {
      const res = await authedFetch('/browser/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      })
      const data = await res.json()
      if (data.url) setUrlInput(data.url)
      if (data.title) setPageTitle(data.title)
      setTimeout(refreshScreenshot, 500)
    } catch { /* ignore */ }
    setLoading(false)
  }

  const handleBack = async () => {
    const res = await authedFetch('/browser/back', { method: 'POST' })
    const data = await res.json()
    if (data.url) setUrlInput(data.url)
    setTimeout(refreshScreenshot, 500)
  }

  const handleForward = async () => {
    const res = await authedFetch('/browser/forward', { method: 'POST' })
    const data = await res.json()
    if (data.url) setUrlInput(data.url)
    setTimeout(refreshScreenshot, 500)
  }

  const handleReload = async () => {
    const res = await authedFetch('/browser/reload', { method: 'POST' })
    const data = await res.json()
    if (data.url) setUrlInput(data.url)
    setTimeout(refreshScreenshot, 500)
  }

  const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current || !status.running) return
    const rect = imgRef.current.getBoundingClientRect()
    const scaleX = 1280 / rect.width
    const scaleY = 800 / rect.height
    const x = Math.round((e.clientX - rect.left) * scaleX)
    const y = Math.round((e.clientY - rect.top) * scaleY)
    try {
      const res = await authedFetch('/browser/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      })
      const data = await res.json()
      if (data.url) setUrlInput(data.url)
      if (data.title) setPageTitle(data.title)
      setTimeout(refreshScreenshot, 500)
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22]">
        {status.running ? (
          <button onClick={handleStop} className="p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors" title="Stop browser">
            <Square size={14} />
          </button>
        ) : (
          <button onClick={() => handleStart()} disabled={loading} className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/10 transition-colors" title="Start browser">
            <Play size={14} />
          </button>
        )}
        <button onClick={handleBack} disabled={!status.running} className="p-1.5 rounded text-[#8b949e] hover:text-[#e6edf3] disabled:text-[#30363d] transition-colors">
          <ArrowLeft size={14} />
        </button>
        <button onClick={handleForward} disabled={!status.running} className="p-1.5 rounded text-[#8b949e] hover:text-[#e6edf3] disabled:text-[#30363d] transition-colors">
          <ArrowRight size={14} />
        </button>
        <button onClick={handleReload} disabled={!status.running} className="p-1.5 rounded text-[#8b949e] hover:text-[#e6edf3] disabled:text-[#30363d] transition-colors">
          <RotateCw size={14} />
        </button>
        <div className="flex-1 flex items-center gap-1.5">
          <Globe size={13} className="text-[#484f58]" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNavigate() }}
            placeholder="https://target.example.com"
            disabled={!status.running}
            className="flex-1 px-3 py-1.5 bg-[#21262d] border border-[#30363d] rounded-md text-sm font-mono text-[#e6edf3] placeholder-[#484f58] focus:border-blue-500 focus:outline-none disabled:opacity-50 transition-colors"
          />
        </div>
        {xssEvents.length > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-red-500/15 border border-red-500/30 rounded text-xs text-red-400 font-semibold animate-pulse">
            <AlertTriangle size={12} />
            XSS: {xssEvents.length}
          </div>
        )}
        <span className={`text-xs px-2 py-1 rounded ${status.running ? 'text-emerald-400 bg-emerald-500/10' : 'text-[#484f58] bg-[#21262d]'}`}>
          {status.running ? 'Running' : 'Stopped'}
        </span>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-auto bg-[#0d1117] flex items-start justify-center p-2">
          {status.running ? (
            screenshotUrl ? (
              <img
                ref={imgRef}
                src={screenshotUrl}
                alt="Browser view"
                onClick={handleImageClick}
                className="max-w-full max-h-full rounded border border-[#30363d] cursor-crosshair shadow-lg"
                style={{ imageRendering: 'auto' }}
              />
            ) : (
              <div className="flex items-center gap-2 text-[#484f58] py-12">
                <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                Loading browser...
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Globe size={48} className="text-[#21262d] mb-4" />
              <p className="text-[#8b949e] text-sm mb-1">Built-in Browser</p>
              <p className="text-[#484f58] text-xs mb-4 max-w-md">
                Launch a Chromium browser auto-proxied through Siphon. All traffic is captured.
              </p>
              <div className="flex flex-col gap-3 mb-4">
                <label className="flex items-center gap-2 text-xs text-[#8b949e] cursor-pointer">
                  <input type="checkbox" checked={xssHooks} onChange={(e) => setXssHooks(e.target.checked)}
                    className="rounded border-[#30363d] bg-[#21262d]" />
                  Enable XSS detection hooks
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleStart(true)}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
                >
                  <Monitor size={14} /> {loading ? 'Starting...' : 'Headless'}
                </button>
                <button
                  onClick={() => handleStart(false)}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
                >
                  <Eye size={14} /> {loading ? 'Starting...' : 'Visible Window'}
                </button>
              </div>
              <p className="text-[#484f58] text-[10px] mt-2 max-w-sm">
                Headless: AI-controlled via screenshots. Visible: opens a real Chromium window for manual auth flows.
              </p>
            </div>
          )}
        </div>

        {xssEvents.length > 0 && (
          <div className="w-72 border-l border-[#30363d] flex flex-col bg-[#161b22]">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d]">
              <AlertTriangle size={13} className="text-red-400" />
              <span className="text-xs font-semibold text-red-400">XSS Events</span>
              <span className="text-[10px] text-[#484f58]">{xssEvents.length}</span>
            </div>
            <div className="overflow-auto flex-1">
              {xssEvents.map((evt, i) => (
                <div key={i} className="px-3 py-2 border-b border-[#21262d] text-xs">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="font-semibold text-red-400">{evt.type}()</span>
                  </div>
                  <p className="font-mono text-[#e6edf3] break-all">{evt.args}</p>
                  <p className="text-[#484f58] truncate mt-0.5">{evt.url}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {status.running && pageTitle && (
        <div className="px-3 py-1 border-t border-[#30363d] bg-[#161b22]">
          <span className="text-xs text-[#484f58]">{pageTitle}</span>
        </div>
      )}
    </div>
  )
}
