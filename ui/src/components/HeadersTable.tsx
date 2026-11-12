export default function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers)
  if (entries.length === 0) {
    return <p className="text-[#484f58] text-sm italic p-3">No headers</p>
  }
  return (
    <div className="overflow-auto max-h-80">
      <table className="w-full text-sm font-mono">
        <tbody>
          {entries.map(([name, value]) => (
            <tr key={name} className="border-b border-[#21262d] hover:bg-[#21262d]/50 transition-colors">
              <td className="px-3 py-1.5 text-[#e6edf3] font-semibold whitespace-nowrap align-top w-48">
                {name}
              </td>
              <td className="px-3 py-1.5 text-[#8b949e] break-all">
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
