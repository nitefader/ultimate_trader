import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { strategiesApi } from '../api/strategies'
import { X, GitCompare } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  strategyId: string
  v1Id: string
  v2Id: string
  onClose: () => void
}

function ValDisplay({ val }: { val: unknown }) {
  if (val === null || val === undefined) return <span className="text-gray-600 italic">—</span>
  if (typeof val === 'boolean') return <span className="font-mono text-amber-300">{String(val)}</span>
  if (typeof val === 'number') return <span className="font-mono text-sky-300">{val}</span>
  if (typeof val === 'string') return <span className="font-mono text-emerald-300">"{val}"</span>
  return <span className="font-mono text-gray-300">{JSON.stringify(val)}</span>
}

export function VersionDiffPanel({ strategyId, v1Id, v2Id, onClose }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['strategy-diff', strategyId, v1Id, v2Id],
    queryFn: () => strategiesApi.diffVersions(strategyId, v1Id, v2Id),
    enabled: !!(v1Id && v2Id && v1Id !== v2Id),
  })

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[520px] flex flex-col bg-gray-950 border-l border-gray-800 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <GitCompare size={15} className="text-sky-400" />
          <span className="text-sm font-semibold text-gray-100">
            {data ? `v${data.v1.version} → v${data.v2.version}` : 'Version Diff'}
          </span>
          {data && (
            <span className="text-xs text-gray-500">
              {data.total_changes} change{data.total_changes !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition">
          <X size={15} />
        </button>
      </div>

      {/* Version meta */}
      {data && (
        <div className="grid grid-cols-2 gap-px bg-gray-800 border-b border-gray-800">
          <div className="bg-gray-950 px-4 py-2">
            <div className="text-xs text-red-400 font-semibold mb-0.5">v{data.v1.version} (from)</div>
            <div className="text-xs text-gray-500">{data.v1.notes || '—'}</div>
            <div className="text-[10px] text-gray-700 mt-0.5">{data.v1.created_at?.slice(0, 10)}</div>
          </div>
          <div className="bg-gray-950 px-4 py-2">
            <div className="text-xs text-emerald-400 font-semibold mb-0.5">v{data.v2.version} (to)</div>
            <div className="text-xs text-gray-500">{data.v2.notes || '—'}</div>
            <div className="text-[10px] text-gray-700 mt-0.5">{data.v2.created_at?.slice(0, 10)}</div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {isLoading && (
          <div className="text-sm text-gray-500 text-center py-8">Loading diff…</div>
        )}
        {isError && (
          <div className="text-sm text-red-400 text-center py-8">Failed to load diff</div>
        )}
        {data && data.total_changes === 0 && (
          <div className="text-sm text-gray-500 text-center py-8">No config differences between these versions.</div>
        )}

        {data && data.changed.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-2">
              Changed ({data.changed.length})
            </h3>
            <div className="space-y-1">
              {data.changed.map(item => (
                <div key={item.path} className="rounded border border-amber-900/40 bg-amber-950/10 px-3 py-2">
                  <div className="text-xs font-mono text-gray-300 mb-1">{item.path}</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-gray-600 text-[10px] uppercase tracking-wide">was </span>
                      <ValDisplay val={item.v1_value} />
                    </div>
                    <div>
                      <span className="text-gray-600 text-[10px] uppercase tracking-wide">now </span>
                      <ValDisplay val={item.v2_value} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {data && data.added.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2">
              Added ({data.added.length})
            </h3>
            <div className="space-y-1">
              {data.added.map(item => (
                <div key={item.path} className="rounded border border-emerald-900/40 bg-emerald-950/10 px-3 py-2">
                  <div className="text-xs font-mono text-gray-300 mb-0.5">{item.path}</div>
                  <ValDisplay val={item.v2_value} />
                </div>
              ))}
            </div>
          </section>
        )}

        {data && data.removed.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">
              Removed ({data.removed.length})
            </h3>
            <div className="space-y-1">
              {data.removed.map(item => (
                <div key={item.path} className="rounded border border-red-900/40 bg-red-950/10 px-3 py-2">
                  <div className="text-xs font-mono text-gray-300 mb-0.5">{item.path}</div>
                  <ValDisplay val={item.v1_value} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
