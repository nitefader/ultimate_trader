import React, { useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { strategiesApi } from '../api/strategies'
import { StrategyBuilderShell } from '../components/StrategyBuilder/StrategyBuilderShell'
import { DRAFT_STORAGE_KEY } from '../components/StrategyBuilder/constants'
import type { Condition } from '../types'

export function StrategyCreator() {
  const navigate = useNavigate()
  const location = useLocation()

  const aiState = location.state as { aiPrompt?: string; aiConditions?: Condition[]; aiLogic?: string } | null

  // If AI conditions were injected, build an initial config from them so the
  // shell's useStrategyForm can start with them pre-populated.
  const hasAi = Boolean(aiState?.aiConditions?.length)
  const initialRef = useRef(
    hasAi
      ? {
          description: aiState?.aiPrompt ?? '',
          config: {
            hypothesis: aiState?.aiPrompt ?? '',
            symbols: [],
            timeframe: '1d',
            duration_mode: 'swing' as const,
            entry: {
              directions: ['long'] as string[],
              logic: (aiState?.aiLogic ?? 'all_of') as string,
              conditions: aiState?.aiConditions ?? [],
            },
            stop_loss: { method: 'fixed_pct', value: 2.0 },
            targets: [{ method: 'r_multiple', r: 2.0 }],
          },
        }
      : undefined
  )

  // Clear the location state so a refresh doesn't re-inject AI conditions
  useEffect(() => {
    if (hasAi) {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY)
      window.history.replaceState({}, '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <StrategyBuilderShell
      mode="create"
      initial={initialRef.current}
      initialTab={hasAi ? 'signals' : 'core'}
      saveLabel="Save Strategy"
      onSave={async ({ name, description, category, durationMode, config }) => {
        const data = await strategiesApi.create({
          name,
          description,
          category,
          duration_mode: durationMode,
          config,
        })
        navigate(`/strategies/${data.id}`)
      }}
    />
  )
}
