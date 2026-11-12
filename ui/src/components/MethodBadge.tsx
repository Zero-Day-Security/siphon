const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-500/20 text-emerald-400',
  POST: 'bg-blue-500/20 text-blue-400',
  PUT: 'bg-amber-500/20 text-amber-400',
  PATCH: 'bg-purple-500/20 text-purple-400',
  DELETE: 'bg-red-500/20 text-red-400',
  OPTIONS: 'bg-gray-500/20 text-gray-400',
  HEAD: 'bg-gray-500/20 text-gray-400',
}

export default function MethodBadge({ method }: { method: string }) {
  const colors = METHOD_COLORS[method.toUpperCase()] || 'bg-gray-500/20 text-gray-400'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-semibold ${colors}`}>
      {method.toUpperCase()}
    </span>
  )
}
