import { useState, useCallback } from 'react'
import { Copy, ArrowDownUp, ArrowRight, Zap, Trash2, CornerDownLeft } from 'lucide-react'

type OpCategory = 'encode' | 'decode' | 'hash' | 'parse'

interface Op {
  label: string
  category: OpCategory
  fn: (input: string) => string | Promise<string>
}

function b64Encode(s: string): string {
  return btoa(
    encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    )
  )
}

function b64Decode(s: string): string {
  const cleaned = s.replace(/\s/g, '')
  const bin = atob(cleaned)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function hexEncode(s: string): string {
  return Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ')
}

function hexDecode(s: string): string {
  const hex = s.replace(/[^0-9a-fA-F]/g, '')
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || [])
  return new TextDecoder().decode(bytes)
}

function htmlEncode(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function htmlDecode(s: string): string {
  const el = document.createElement('textarea')
  el.innerHTML = s
  return el.value
}

function unicodeEscape(s: string): string {
  return Array.from(s)
    .map((c) => {
      const code = c.codePointAt(0) || 0
      return code > 127 ? `\\u${code.toString(16).padStart(4, '0')}` : c
    })
    .join('')
}

function unicodeUnescape(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16))
  )
}

function jwtDecode(s: string): string {
  const token = s.trim()
  const parts = token.split('.')
  if (parts.length < 2) throw new Error('Not a valid JWT (expected at least 2 parts)')
  const decodeSegment = (seg: string) => {
    const padded = seg.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (seg.length % 4)) % 4)
    return JSON.parse(b64Decode(padded))
  }
  const header = decodeSegment(parts[0])
  const payload = decodeSegment(parts[1])
  return JSON.stringify({ header, payload }, null, 2)
}

function jsonBeautify(s: string): string {
  return JSON.stringify(JSON.parse(s), null, 2)
}

function jsonMinify(s: string): string {
  return JSON.stringify(JSON.parse(s))
}

async function hashWith(algo: string, input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest(algo, data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function smartDecode(s: string): string {
  const trimmed = s.trim()

  // JWT
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(trimmed)) {
    try { return '(JWT Decoded)\n' + jwtDecode(trimmed) } catch { /* fall through */ }
  }

  // URL encoded
  if (/%[0-9A-Fa-f]{2}/.test(trimmed)) {
    try { return '(URL Decoded)\n' + decodeURIComponent(trimmed) } catch { /* fall through */ }
  }

  // HTML entities
  if (/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(trimmed)) {
    return '(HTML Decoded)\n' + htmlDecode(trimmed)
  }

  // Hex
  if (/^([0-9a-fA-F]{2}\s*)+$/.test(trimmed) && trimmed.replace(/\s/g, '').length >= 4) {
    try { return '(Hex Decoded)\n' + hexDecode(trimmed) } catch { /* fall through */ }
  }

  // Base64
  if (/^[A-Za-z0-9+/=\s]{4,}$/.test(trimmed)) {
    try {
      const decoded = b64Decode(trimmed)
      if (/[\x00-\x08\x0E-\x1F]/.test(decoded)) throw new Error('binary')
      return '(Base64 Decoded)\n' + decoded
    } catch { /* fall through */ }
  }

  return '(No encoding detected)'
}

const OPS: Op[] = [
  { label: 'Base64', category: 'encode', fn: b64Encode },
  { label: 'URL', category: 'encode', fn: (s) => encodeURIComponent(s) },
  { label: 'HTML', category: 'encode', fn: htmlEncode },
  { label: 'Hex', category: 'encode', fn: hexEncode },
  { label: 'Unicode', category: 'encode', fn: unicodeEscape },
  { label: 'Base64', category: 'decode', fn: b64Decode },
  { label: 'URL', category: 'decode', fn: (s) => decodeURIComponent(s) },
  { label: 'HTML', category: 'decode', fn: htmlDecode },
  { label: 'Hex', category: 'decode', fn: hexDecode },
  { label: 'Unicode', category: 'decode', fn: unicodeUnescape },
  { label: 'SHA-256', category: 'hash', fn: (s) => hashWith('SHA-256', s) },
  { label: 'SHA-1', category: 'hash', fn: (s) => hashWith('SHA-1', s) },
  { label: 'MD5', category: 'hash', fn: async (s) => {
    const data = new TextEncoder().encode(s)
    const buf = await crypto.subtle.digest('SHA-1', data)
    return '(MD5 not in SubtleCrypto — showing SHA-1)\n' +
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }},
  { label: 'JWT', category: 'parse', fn: jwtDecode },
  { label: 'Beautify', category: 'parse', fn: jsonBeautify },
  { label: 'Minify', category: 'parse', fn: jsonMinify },
]

const CATEGORY_LABELS: Record<OpCategory, string> = {
  encode: 'Encode',
  decode: 'Decode',
  hash: 'Hash',
  parse: 'Parse',
}

const CATEGORIES: OpCategory[] = ['encode', 'decode', 'hash', 'parse']

export default function Decoder() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [chain, setChain] = useState<string[]>([])
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const applyOp = useCallback(async (op: Op) => {
    const src = output || input
    if (!src) return
    setError('')
    try {
      const result = await op.fn(src)
      setOutput(result)
      setChain((prev) => [...prev, `${CATEGORY_LABELS[op.category]}: ${op.label}`])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Operation failed')
    }
  }, [input, output])

  const handleSmartDecode = () => {
    const src = output || input
    if (!src) return
    setError('')
    try {
      const result = smartDecode(src)
      setOutput(result)
      setChain((prev) => [...prev, 'Smart Decode'])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Smart decode failed')
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleSwap = () => {
    setInput(output)
    setOutput(input)
    setChain([])
    setError('')
  }

  const handleUseAsInput = () => {
    setInput(output)
    setOutput('')
    setChain([])
    setError('')
  }

  const handleClear = () => {
    setInput('')
    setOutput('')
    setChain([])
    setError('')
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#30363d] bg-[#161b22]">
        <span className="text-sm font-semibold text-[#e6edf3]">Decoder</span>
        <span className="text-xs text-[#484f58]">Encode, decode, hash, and parse data</span>
        <span className="flex-1" />
        <button
          onClick={handleClear}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#484f58] hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={12} /> Clear
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col border-r border-[#30363d]">
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-[#30363d]">
            <span className="text-xs font-medium text-[#8b949e]">Input</span>
            <button
              onClick={handleSmartDecode}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-blue-400 hover:bg-blue-500/10 transition-colors"
            >
              <Zap size={12} /> Smart Decode
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => { setInput(e.target.value); setOutput(''); setChain([]); setError('') }}
            placeholder="Paste text to encode, decode, or transform..."
            className="flex-1 w-full p-3 bg-[#0d1117] text-[#e6edf3] font-mono text-sm resize-none focus:outline-none placeholder-[#484f58]"
            spellCheck={false}
          />
        </div>

        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-[#30363d]">
            <span className="text-xs font-medium text-[#8b949e]">Output</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleUseAsInput}
                disabled={!output}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors disabled:opacity-30"
                title="Use as Input"
              >
                <CornerDownLeft size={12} /> Use as Input
              </button>
              <button
                onClick={handleSwap}
                disabled={!output}
                className="p-1 rounded text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors disabled:opacity-30"
                title="Swap"
              >
                <ArrowDownUp size={14} />
              </button>
              <button
                onClick={handleCopy}
                disabled={!output}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors disabled:opacity-30 ${
                  copied ? 'text-emerald-400' : 'text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d]'
                }`}
              >
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <textarea
            value={error ? `Error: ${error}` : output}
            readOnly
            className={`flex-1 w-full p-3 bg-[#0d1117] font-mono text-sm resize-none focus:outline-none ${
              error ? 'text-red-400' : 'text-[#e6edf3]'
            }`}
            spellCheck={false}
          />
        </div>
      </div>

      {chain.length > 0 && (
        <div className="px-4 py-1.5 border-t border-[#30363d] bg-[#161b22] flex items-center gap-1.5 text-xs text-[#484f58]">
          <span className="text-[#8b949e]">Chain:</span>
          <span>Input</span>
          {chain.map((step, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <ArrowRight size={10} className="text-[#30363d]" />
              <span className="text-blue-400">{step}</span>
            </span>
          ))}
          <ArrowRight size={10} className="text-[#30363d]" />
          <span>Output</span>
        </div>
      )}

      <div className="border-t border-[#30363d] bg-[#161b22] px-4 py-2">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {CATEGORIES.map((cat) => (
            <div key={cat} className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[#484f58] font-semibold w-12">
                {CATEGORY_LABELS[cat]}
              </span>
              <div className="flex items-center gap-1">
                {OPS.filter((op) => op.category === cat).map((op, i) => (
                  <button
                    key={`${cat}-${i}`}
                    onClick={() => applyOp(op)}
                    className="px-2 py-1 rounded text-xs font-medium text-[#8b949e] bg-[#21262d] border border-[#30363d] hover:text-[#e6edf3] hover:border-[#484f58] transition-colors"
                  >
                    {op.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
