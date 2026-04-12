import React, { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { accountsApi } from '../api/accounts'
import { servicesApi } from '../api/services'

type BrokerMode = 'paper' | 'live'
type Step = 1 | 2 | 3

const ALPACA_KEY_RE = /^(PK|AK)[A-Z0-9]{10,}$/

export function CreateAccountModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<BrokerMode>('paper')
  const [useSelfData, setUseSelfData] = useState(false)
  const [dataServiceId, setDataServiceId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [secretKey, setSecretKey] = useState('')

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: servicesApi.list,
    staleTime: 15_000,
  })

  const activeServices = useMemo(
    () => services.filter(s => s.is_active),
    [services],
  )

  const hasSelfCredentials = apiKey.trim().length > 0 && secretKey.trim().length > 0
  const selfCredentialsLookValid = !hasSelfCredentials || (ALPACA_KEY_RE.test(apiKey.trim()) && secretKey.trim().length >= 16)
  const hasAnyDataPath = useSelfData ? hasSelfCredentials : Boolean(dataServiceId)

  const canStep2 = name.trim().length > 0
  const canStep3 = hasAnyDataPath && selfCredentialsLookValid
  const canCreate = canStep2 && canStep3

  const createMutation = useMutation({
    mutationFn: async () => {
      const brokerConfig = useSelfData
        ? {
            paper: {
              api_key: apiKey.trim(),
              secret_key: secretKey.trim(),
            },
            live: {
              api_key: apiKey.trim(),
              secret_key: secretKey.trim(),
            },
          }
        : {}

      return accountsApi.create({
        name: name.trim(),
        mode,
        broker: useSelfData ? 'alpaca' : 'paper_broker',
        broker_config: brokerConfig,
        data_service_id: useSelfData ? null : dataServiceId,
      })
    },
    onSuccess: () => {
      onCreated()
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card w-full max-w-2xl space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Create Account Wizard</h3>
          <p className="mt-1 text-xs text-gray-500">Set up mode, data source, and optional Alpaca credentials in one flow.</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`rounded border px-3 py-2 text-xs ${step === n ? 'border-sky-600 bg-sky-950/30 text-sky-300' : 'border-gray-800 text-gray-500'}`}
            >
              Step {n}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="label">Name</label>
              <input className="input w-full" value={name} onChange={e => setName(e.target.value)} placeholder="Paper Account 1" />
            </div>
            <div>
              <label className="label">Mode</label>
              <select className="input w-full" value={mode} onChange={e => setMode(e.target.value as BrokerMode)}>
                <option value="paper">Paper</option>
                <option value="live">Live</option>
              </select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded border border-gray-700 bg-gray-900/60 px-4 py-3">
              <div className="text-xs text-gray-300 mb-2">Data Source</div>
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={useSelfData}
                    onChange={() => {
                      setUseSelfData(true)
                      setDataServiceId('')
                    }}
                  />
                  Self (enter Alpaca API keys on this account)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!useSelfData}
                    onChange={() => setUseSelfData(false)}
                  />
                  Use configured Data Service
                </label>
              </div>
            </div>

            {!useSelfData && (
              <div>
                <label className="label">Data Service</label>
                <select
                  className="input w-full"
                  value={dataServiceId}
                  onChange={e => setDataServiceId(e.target.value)}
                >
                  <option value="">Select data service...</option>
                  {activeServices.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.environment}){s.is_default ? ' - default' : ''}
                    </option>
                  ))}
                </select>
                {activeServices.length === 0 && (
                  <p className="text-xs text-amber-400 mt-1">No active data services found. Create one in the Services tab or use Self.</p>
                )}
              </div>
            )}

            {useSelfData && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Alpaca API Key</label>
                  <input
                    className="input w-full font-mono text-xs"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value.trim())}
                    placeholder="PK..."
                  />
                </div>
                <div>
                  <label className="label">Alpaca Secret Key</label>
                  <input
                    className="input w-full font-mono text-xs"
                    type="password"
                    value={secretKey}
                    onChange={e => setSecretKey(e.target.value.trim())}
                    placeholder="••••••••••"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 rounded border border-gray-700 bg-gray-900/60 px-4 py-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-400">Name</span><span>{name || '-'}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Mode</span><span className="uppercase">{mode}</span></div>
            <div className="flex justify-between">
              <span className="text-gray-400">Data Source</span>
              <span>{useSelfData ? 'Self (Alpaca keys)' : 'Shared Data Service'}</span>
            </div>
            {!useSelfData && (
              <div className="flex justify-between">
                <span className="text-gray-400">Service</span>
                <span>{activeServices.find(s => s.id === dataServiceId)?.name ?? '-'}</span>
              </div>
            )}
            {useSelfData && (
              <div className="text-xs text-gray-500">Credentials will be stored encrypted in broker_config.</div>
            )}
          </div>
        )}

        {mode === 'live' && (
          <div className="rounded border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            <strong>WARNING:</strong> LIVE mode. Any linked deployment can place real broker orders.
          </div>
        )}

        {!selfCredentialsLookValid && (
          <div className="rounded border border-amber-700 bg-amber-950/40 px-4 py-3 text-xs text-amber-300">
            Alpaca key format looks invalid. Use a valid key prefix (`PK` or `AK`) and a full secret.
          </div>
        )}

        <div className="rounded border border-gray-700 bg-gray-900/60 px-4 py-3 text-xs text-gray-400">
          Use <strong>Data Service</strong> for shared market data credentials, or choose <strong>Self</strong> if this account should hold its own Alpaca keys.
        </div>

        {createMutation.error && <div className="text-sm text-red-400">Error creating account: {(createMutation.error as Error).message}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost text-sm" onClick={onClose}>Cancel</button>
          {step > 1 && (
            <button className="btn-ghost text-sm" onClick={() => setStep((s) => (s - 1) as Step)}>Back</button>
          )}
          {step < 3 && (
            <button
              className="btn-primary text-sm"
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={(step === 1 && !canStep2) || (step === 2 && !canStep3)}
            >
              Next
            </button>
          )}
          {step === 3 && (
            <button className="btn-primary text-sm" onClick={() => createMutation.mutate()} disabled={!canCreate || createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Account'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
