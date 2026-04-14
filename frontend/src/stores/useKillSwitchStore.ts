import { create } from 'zustand'
import type { KillSwitchStatus } from '../types'
import { controlApi } from '../api/accounts'

const KILL_SWITCH_STORAGE_KEY = 'ultratrader.kill_switch_active'

function persistKillSwitchState(active: boolean) {
  if (active) {
    localStorage.setItem(KILL_SWITCH_STORAGE_KEY, '1')
    return
  }
  localStorage.removeItem(KILL_SWITCH_STORAGE_KEY)
}

interface KillSwitchStore {
  status: KillSwitchStatus | null
  platformMode: 'backtest' | 'paper' | 'live'
  fetch: () => Promise<void>
  killAll: (reason: string) => Promise<void>
  resumeAll: () => Promise<void>
}

export const useKillSwitchStore = create<KillSwitchStore>((set) => ({
  status: null,
  platformMode: 'backtest',

  fetch: async () => {
    try {
      const data = await controlApi.status()
      const isKilled = !!data.kill_switch?.global_killed
      persistKillSwitchState(isKilled)
      const newStatus = data.kill_switch
      const newMode = (data.platform_mode as 'backtest' | 'paper' | 'live') ?? 'backtest'
      const current = useKillSwitchStore.getState()
      const statusChanged = JSON.stringify(current.status) !== JSON.stringify(newStatus)
      const modeChanged = current.platformMode !== newMode
      if (statusChanged || modeChanged) {
        set({ status: newStatus, platformMode: newMode })
      }
    } catch {
      // silently ignore poll errors
    }
  },

  killAll: async (reason: string) => {
    await controlApi.killAll(reason)
    persistKillSwitchState(true)
    await useKillSwitchStore.getState().fetch()
  },

  resumeAll: async () => {
    await controlApi.resumeAll()
    persistKillSwitchState(false)
    await useKillSwitchStore.getState().fetch()
  },
}))
