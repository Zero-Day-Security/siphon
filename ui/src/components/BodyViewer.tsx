import { useState, useMemo } from 'react'
import { Copy, WrapText } from 'lucide-react'

function tryFormatJson(text: string): { formatted: string; isJson: boolean } {
  try {
    const parsed = JSON.parse(text)
    return { formatted: JSON.stringify(parsed, null, 2), isJson: true }
  } catch {
    return { formatted: text, isJson: false }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function SyntaxHighlight({ json }: { json: string }) {
  const escaped = escapeHtml(json)
  const highlighted = escaped.replace(
    /(&quot;(?:\\.|[^&])*?&quot;)\s*:/g,
    '<span class="text-purple-400">$1</span>:',
  ).replace(
    /:\s*(&quot;(?:\\.|[^&])*?&quot;)/g,
    ': <span class="text-emerald-400">$1</span>',
  ).replace(
    /:\s*(\d+\.?\d*)/g,
    ': <span class="text-amber-400">$1</span>',
  ).replace(
    /:\s*(true|false|null)/g,
    ': <span class="text-sky-400">$1</span>',
  )
  return <pre dangerouslySetInnerHTML={{ __html: highlighted }} />
}

export default function BodyViewer({ body, contentType }: { body: string | null; contentType?: string | null }) {
  const [wrap, setWrap] = useState(true)
  const [copied, setCopied] = useState(false)

  const { formatted, isJson } = useMemo(() => {
    if (!body) return { formatted: '', isJson: false }
    const isJsonType = contentType?.includes('json')
    if (isJsonType || body.trimStart().startsWith('{') || body.trimStart().startsWith('[')) {
      return tryFormatJson(body)
    }
    return { formatted: body, isJson: false }
  }, [body, contentType])

  if (!body) {
    return <p className="text-[#484f58] text-sm italic p-3">No body content</p>
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(body)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#21262d]">
        <button
          onClick={() => setWrap(!wrap)}
          className={`p-1 rounded transition-colors ${wrap ? 'text-blue-400 bg-blue-500/10' : 'text-[#484f58] hover:text-[#8b949e]'}`}
          title="Toggle word wrap"
        >
          <WrapText size={14} />
        </button>
        <button
          onClick={handleCopy}
          className="p-1 rounded text-[#484f58] hover:text-[#8b949e] transition-colors"
          title="Copy body"
        >
          <Copy size={14} />
        </button>
        {copied && <span className="text-xs text-emerald-400">Copied</span>}
        <span className="text-xs text-[#484f58] ml-auto">{body.length.toLocaleString()} bytes</span>
      </div>
      <div className="overflow-auto flex-1 p-3">
        <div className={`text-sm font-mono text-[#e6edf3] ${wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}>
          {isJson ? <SyntaxHighlight json={formatted} /> : <pre>{formatted}</pre>}
        </div>
      </div>
    </div>
  )
}
