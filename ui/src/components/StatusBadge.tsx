function statusColor(code: number): string {
  if (code < 200) return 'text-gray-400'
  if (code < 300) return 'text-emerald-400'
  if (code < 400) return 'text-sky-400'
  if (code < 500) return 'text-amber-400'
  return 'text-red-400'
}

export default function StatusBadge({ code }: { code: number | null }) {
  if (code === null) return <span className="text-[#484f58] text-sm font-mono">---</span>
  return (
    <span className={`text-sm font-mono font-semibold ${statusColor(code)}`}>
      {code}
    </span>
  )
}
