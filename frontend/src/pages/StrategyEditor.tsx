import React from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { strategiesApi } from '../api/strategies'
import { StrategyBuilderShell } from '../components/StrategyBuilder/StrategyBuilderShell'
import type { StrategyConfig } from '../types'

interface Props {
  mode: 'edit' | 'new_version'
}

export function StrategyEditor({ mode }: Props) {
  const { strategyId } = useParams<{ strategyId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['strategy', strategyId],
    queryFn: () => strategiesApi.get(strategyId!),
    enabled: !!strategyId,
  })

  if (isLoading) return <div className="text-gray-500 text-sm p-4">Loading strategy...</div>
  if (error || !data) return <div className="text-red-400 text-sm p-4">Failed to load strategy.</div>

  const versions = data.versions ?? []
  const latest = versions[0]

  if (!latest) return <div className="text-gray-500 text-sm p-4">No versions found.</div>

  const canEditInPlace = Boolean(
    latest.promotion_status == null || latest.promotion_status === 'backtest_only'
  ) && !(latest as any).has_runs

  const initial = {
    name: data.name,
    description: data.description ?? '',
    category: data.category ?? 'custom',
    config: JSON.parse(JSON.stringify(latest.config ?? {})) as StrategyConfig,
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-3 pt-2 pb-1 text-xs text-gray-500">
        <Link to="/strategies" className="hover:text-gray-300">Strategies</Link>
        <span>/</span>
        <Link to={`/strategies/${strategyId}`} className="hover:text-gray-300">{data.name}</Link>
        <span>/</span>
        <span className="text-gray-300">{mode === 'edit' ? 'Edit' : 'New Version'}</span>
      </div>

      <StrategyBuilderShell
        mode={mode}
        initial={initial}
        contextLabel={mode === 'new_version' ? 'New Version' : canEditInPlace ? 'Edit (in place)' : 'Edit'}
        saveLabel={
          mode === 'edit'
            ? canEditInPlace ? 'Save Changes' : 'Save as New Version'
            : 'Create Version'
        }
        headerSlot={
          mode === 'new_version' || (mode === 'edit' && !canEditInPlace) ? (
            <VersionNotesSlot mode={mode} canEditInPlace={canEditInPlace} />
          ) : (
            <div className="rounded-lg px-3 py-2 text-xs text-sky-300/80 border border-sky-900/40 bg-sky-950/20">
              This version has no backtest runs yet — changes save directly without creating a new version.
            </div>
          )
        }
        onSave={async ({ config }) => {
          if (mode === 'edit' && canEditInPlace) {
            await strategiesApi.patchVersion(data.id, latest.id, { config })
          } else {
            const notes = (document.getElementById('version-notes-input') as HTMLInputElement | null)?.value?.trim()
            if (!notes) throw new Error('Version notes are required')
            await strategiesApi.createVersion(data.id, { config, notes })
          }
          await qc.invalidateQueries({ queryKey: ['strategy', strategyId] })
          navigate(`/strategies/${strategyId}`)
        }}
      />
    </div>
  )
}

function VersionNotesSlot({ mode, canEditInPlace }: { mode: 'edit' | 'new_version'; canEditInPlace: boolean }) {
  const label = mode === 'new_version' || !canEditInPlace
    ? 'Version notes (required — describe what changed)'
    : 'Version notes (optional)'

  return (
    <div className="space-y-1.5">
      <label className="label">{label}</label>
      <input
        id="version-notes-input"
        className="input w-full"
        placeholder={mode === 'new_version' ? 'What changed in this version?' : 'What changed?'}
        autoFocus
      />
    </div>
  )
}
