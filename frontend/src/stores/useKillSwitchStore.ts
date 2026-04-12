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
  loading: boolean
  fetch: () => Promise<void>
  killAll: (reason: string) => Promise<void>
  resumeAll: () => Promise<void>
}

export const useKillSwitchStore = create<KillSwitchStore>((set) => ({
  status: null,
  platformMode: 'backtest',
  loading: false,

  fetch: async () => {
    set({ loading: true })
    try {
      const data = await controlApi.status()
      const isKilled = !!data.kill_switch?.global_killed
      persistKillSwitchState(isKilled)
      set({
        status: data.kill_switch,
        platformMode: (data.platform_mode as 'backtest' | 'paper' | 'live') ?? 'backtest',
      })
    } finally {
      set({ loading: false })
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
