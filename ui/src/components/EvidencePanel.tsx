import { useState, useEffect } from 'react'
import { Camera, ExternalLink, Download, Image, FileText, File } from 'lucide-react'
import type { Evidence } from '../types'
import { fetchEvidence, downloadReportMarkdown, downloadReportPdf, authedFetch } from '../api'
import MethodBadge from './MethodBadge'
import StatusBadge from './StatusBadge'
import HeadersTable from './HeadersTable'
import BodyViewer from './BodyViewer'

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString()
}

export default function EvidencePanel() {
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [selected, setSelected] = useState<Evidence | null>(null)
  const [detailTab, setDetailTab] = useState<'screenshot' | 'request' | 'response'>('screenshot')
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [screenshotLoading, setScreenshotLoading] = useState(false)

  useEffect(() => {
    fetchEvidence().then(setEvidence).catch(() => {})
  }, [])

  const refresh = async () => {
    const list = await fetchEvidence()
    setEvidence(list)
  }

  const loadScreenshot = async (ev: Evidence) => {
    setScreenshotLoading(true)
    setScreenshotUrl(null)
    try {
      const res = await authedFetch(`/evidence/${ev.id}/png`)
      if (res.ok) {
        const blob = await res.blob()
        setScreenshotUrl(URL.createObjectURL(blob))
      }
    } catch { /* ignore */ }
    setScreenshotLoading(false)
  }

  const downloadScreenshot = async (ev: Evidence) => {
    try {
      const res = await authedFetch(`/evidence/${ev.id}/png`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `evidence_${ev.method}_${new URL(ev.url).pathname.replace(/\//g, '_')}_${ev.id.slice(0, 8)}.png`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  const openHtml = (ev: Evidence) => {
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Evidence: ${ev.method} ${ev.url}</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; background: #0d1117; color: #e6edf3; padding: 24px; margin: 0; }
.card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; max-width: 900px; margin: 0 auto; }
.header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #30363d; }
.method { background: #1f6feb22; color: #58a6ff; padding: 2px 8px; border-radius: 4px; font-family: monospace; font-weight: 600; font-size: 13px; }
.url { font-family: monospace; font-size: 13px; word-break: break-all; }
.status { font-family: monospace; font-weight: 600; }
.meta { color: #8b949e; font-size: 12px; margin-bottom: 16px; }
h3 { font-size: 13px; color: #8b949e; margin: 16px 0 8px; }
pre { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 12px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; }
.notes { background: #1c2128; border: 1px solid #30363d; border-radius: 6px; padding: 12px; margin-top: 16px; font-size: 13px; }
</style></head><body>
<div class="card">
<div class="header">
  <span class="method">${ev.method}</span>
  <span class="url">${ev.url}</span>
  <span class="status">${ev.status_code || '---'}</span>
</div>
<div class="meta">Captured: ${formatTimestamp(ev.timestamp)}</div>
${ev.notes ? `<div class="notes"><strong>Notes:</strong> ${ev.notes}</div>` : ''}
<h3>Request Headers</h3>
<pre>${ev.request_headers ? Object.entries(ev.request_headers).map(([k, v]) => `${k}: ${v}`).join('\n') : 'None'}</pre>
${ev.request_body ? `<h3>Request Body</h3><pre>${ev.request_body.replace(/</g, '&lt;')}</pre>` : ''}
<h3>Response Headers</h3>
<pre>${ev.response_headers ? Object.entries(ev.response_headers).map(([k, v]) => `${k}: ${v}`).join('\n') : 'None'}</pre>
${ev.response_body ? `<h3>Response Body</h3><pre>${ev.response_body.replace(/</g, '&lt;')}</pre>` : ''}
</div></body></html>`
    const blob = new Blob([html], { type: 'text/html' })
    window.open(URL.createObjectURL(blob))
  }

  return (
    <div className="flex h-full">
      <div className="w-96 border-r border-[#30363d] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363d] bg-[#161b22]">
          <div className="flex items-center gap-2">
            <Camera size={14} className="text-[#8b949e]" />
            <span className="text-sm font-medium text-[#e6edf3]">Evidence</span>
            <span className="text-xs text-[#484f58]">{evidence.length}</span>
          </div>
          <button
            onClick={downloadReportMarkdown}
            className="flex items-center gap-1 text-xs text-[#484f58] hover:text-blue-400 transition-colors"
            title="Export report as Markdown"
          >
            <FileText size={12} /> Markdown
          </button>
          <button
            onClick={downloadReportPdf}
            className="flex items-center gap-1 text-xs text-[#484f58] hover:text-purple-400 transition-colors"
            title="Export report as PDF"
          >
            <File size={12} /> PDF
          </button>
          <button
            onClick={refresh}
            className="text-xs text-[#484f58] hover:text-[#8b949e] transition-colors"
          >
            Refresh
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {evidence.length === 0 ? (
            <p className="text-[#484f58] text-sm italic p-4 text-center">
              No evidence captured yet. Use the Evidence button on a flow to capture it.
            </p>
          ) : (
            evidence.map((ev) => (
              <div
                key={ev.id}
                onClick={() => { setSelected(ev); setDetailTab('screenshot'); loadScreenshot(ev) }}
                className={`px-3 py-2.5 border-b border-[#21262d] cursor-pointer transition-colors ${
                  selected?.id === ev.id ? 'bg-blue-500/10' : 'hover:bg-[#161b22]'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <MethodBadge method={ev.method} />
                  <StatusBadge code={ev.status_code} />
                  <span className="text-xs text-[#484f58] ml-auto">{formatTimestamp(ev.timestamp)}</span>
                </div>
                <p className="text-xs font-mono text-[#8b949e] truncate">{ev.url}</p>
                {ev.notes && (
                  <p className="text-xs text-[#484f58] mt-1 truncate">{ev.notes}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {selected ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22]">
              <MethodBadge method={selected.method} />
              <span className="font-mono text-sm text-[#e6edf3] truncate flex-1">{selected.url}</span>
              <button
                onClick={() => downloadScreenshot(selected)}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#8b949e] hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                title="Download PNG"
              >
                <Download size={12} /> Download PNG
              </button>
              <button
                onClick={() => openHtml(selected)}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#8b949e] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
              >
                <ExternalLink size={12} /> View HTML
              </button>
              <button
                onClick={() => { setDetailTab('screenshot'); loadScreenshot(selected) }}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${detailTab === 'screenshot' ? 'text-[#e6edf3] bg-[#21262d]' : 'text-[#484f58] hover:text-[#8b949e]'}`}
              >
                <Image size={12} /> Screenshot
              </button>
              <button
                onClick={() => setDetailTab('request')}
                className={`px-2 py-1 text-xs rounded transition-colors ${detailTab === 'request' ? 'text-[#e6edf3] bg-[#21262d]' : 'text-[#484f58] hover:text-[#8b949e]'}`}
              >
                Request
              </button>
              <button
                onClick={() => setDetailTab('response')}
                className={`px-2 py-1 text-xs rounded transition-colors ${detailTab === 'response' ? 'text-[#e6edf3] bg-[#21262d]' : 'text-[#484f58] hover:text-[#8b949e]'}`}
              >
                Response
              </button>
            </div>
            {selected.notes && (
              <div className="px-3 py-2 border-b border-[#21262d] bg-[#1c2128]">
                <span className="text-xs text-[#8b949e]">{selected.notes}</span>
              </div>
            )}
            <div className="flex-1 overflow-auto bg-[#0d1117]">
              {detailTab === 'screenshot' ? (
                <div className="p-4 flex flex-col items-center">
                  {screenshotLoading ? (
                    <div className="flex items-center gap-2 text-[#484f58] py-12">
                      <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                      Generating screenshot...
                    </div>
                  ) : screenshotUrl ? (
                    <div className="w-full">
                      <img
                        src={screenshotUrl}
                        alt="Evidence screenshot"
                        className="w-full max-w-[900px] mx-auto rounded-lg border border-[#30363d] shadow-lg"
                      />
                      <div className="flex justify-center mt-4">
                        <button
                          onClick={() => downloadScreenshot(selected)}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
                        >
                          <Download size={14} /> Download PNG for Report
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[#484f58] text-sm py-12">Failed to generate screenshot</p>
                  )}
                </div>
              ) : detailTab === 'request' ? (
                <div>
                  {selected.request_headers && <HeadersTable headers={selected.request_headers} />}
                  {selected.request_body && (
                    <div className="border-t border-[#21262d]">
                      <BodyViewer body={selected.request_body} />
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {selected.response_headers && <HeadersTable headers={selected.response_headers} />}
                  {selected.response_body && (
                    <div className="border-t border-[#21262d]">
                      <BodyViewer body={selected.response_body} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-[#484f58] text-sm">
            Select evidence to view details
          </div>
        )}
      </div>
    </div>
  )
}
