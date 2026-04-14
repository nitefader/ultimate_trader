import React, { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle, XCircle, Loader } from 'lucide-react'
import { accountsApi } from '../api/accounts'
import { servicesApi } from '../api/services'
import { SelectMenu } from './SelectMenu'

type BrokerMode = 'paper' | 'live'
type Step = 1 | 2 | 3

const ALPACA_KEY_RE = /^(PK|AK)[A-Z0-9]{10,}$/

export const CreateAccountModal = React.memo(function CreateAccountModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<BrokerMode>('paper')
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

  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null)
  const [testError, setTestError] = useState<string>('')

  const testMutation = useMutation({
    mutationFn: () =>
      servicesApi.testInline({
        api_key: apiKey.trim(),
        secret_key: secretKey.trim(),
        environment: mode === 'live' ? 'live' : 'paper',
      }),
    onSuccess: () => {
      setTestResult('ok')
      setTestError('')
    },
    onError: (e: any) => {
      setTestResult('fail')
      setTestError(e?.response?.data?.detail ?? e?.message ?? 'Connection failed')
    },
  })

  const hasCredentials = apiKey.trim().length > 0 && secretKey.trim().length > 0
  const credentialsLookValid = !hasCredentials || (ALPACA_KEY_RE.test(apiKey.trim()) && secretKey.trim().length >= 16)

  const canStep2 = name.trim().length > 0
  const canStep3 = hasCredentials && credentialsLookValid
  const canCreate = canStep2 && canStep3

  const createMutation = useMutation({
    mutationFn: async () => {
      const brokerConfig = {
        paper: { api_key: apiKey.trim(), secret_key: secretKey.trim() },
        live: { api_key: apiKey.trim(), secret_key: secretKey.trim() },
      }

      return accountsApi.create({
        name: name.trim(),
        mode,
        broker: 'alpaca',
        broker_config: brokerConfig,
        data_service_id: dataServiceId || null,
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
          {[
            { n: 1, title: 'Account Setup', sub: 'Name & trading mode' },
            { n: 2, title: 'Credentials', sub: 'Alpaca keys & data' },
            { n: 3, title: 'Review', sub: 'Confirm & create' },
          ].map(({ n, title, sub }) => (
            <div
              key={n}
              className={`rounded border px-3 py-2 text-xs ${step === n ? 'border-sky-600 bg-sky-950/30 text-sky-300' : step > n ? 'border-gray-700 text-gray-500' : 'border-gray-800 text-gray-600'}`}
            >
              <div className="font-semibold">{`${n}. ${title}`}</div>
              <div className={`mt-0.5 ${step === n ? 'text-sky-500' : 'text-gray-600'}`}>{sub}</div>
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
              <SelectMenu
                value={mode}
                onChange={v => setMode(v as BrokerMode)}
                options={[
                  { value: 'paper', label: 'Paper' },
                  { value: 'live', label: 'Live' },
                ]}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {/* Alpaca credentials — always required */}
            <div className="space-y-1">
              <div className="text-xs font-semibold text-gray-300">Alpaca Credentials <span className="text-red-400">*</span></div>
              <p className="text-xs text-gray-500">Required for all accounts — used to connect to the Alpaca broker.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">API Key</label>
                <input
                  className="input w-full font-mono text-xs"
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value.trim()); setTestResult(null) }}
                  placeholder="PK..."
                />
              </div>
              <div>
                <label className="label">Secret Key</label>
                <input
                  className="input w-full font-mono text-xs"
                  type="password"
                  value={secretKey}
                  onChange={e => { setSecretKey(e.target.value.trim()); setTestResult(null) }}
                  placeholder="••••••••••"
                />
              </div>
            </div>

            {/* Test connection */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn-ghost text-xs flex items-center gap-1.5"
                onClick={() => testMutation.mutate()}
                disabled={!hasCredentials || !credentialsLookValid || testMutation.isPending}
              >
                {testMutation.isPending
                  ? <><Loader size={12} className="animate-spin" /> Testing…</>
                  : 'Test Connection'}
              </button>
              {testResult === 'ok' && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle size={13} /> Connected successfully
                </span>
              )}
              {testResult === 'fail' && (
                <span className="flex items-center gap-1.5 text-xs text-red-400">
                  <XCircle size={13} /> {testError || 'Connection failed'}
                </span>
              )}
            </div>

            {/* Data Service — optional, only needed without premium Alpaca data */}
            <div className="rounded border border-gray-700 bg-gray-900/40 px-4 py-3 space-y-3">
              <div>
                <div className="text-xs font-semibold text-gray-300">Data Service <span className="text-gray-600 font-normal">(optional)</span></div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Only required if your Alpaca account does not include a premium market data subscription.
                  If you have Alpaca Unlimited data, leave this blank.
                </p>
              </div>
              <div>
                <SelectMenu
                  value={dataServiceId}
                  onChange={setDataServiceId}
                  placeholder="— None (using Alpaca premium data) —"
                  options={[
                    { value: '', label: '— None (using Alpaca premium data) —' },
                    ...activeServices.map(s => ({
                      value: s.id,
                      label: `${s.name} (${s.environment})${s.is_default ? ' ★ default' : ''}`,
                    })),
                  ]}
                />
                {activeServices.length === 0 && (
                  <p className="text-xs text-amber-400 mt-1">
                    No active data services configured.{' '}
                    <a href="/services" className="underline hover:text-amber-300">Create one in Services</a>{' '}
                    if needed.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 rounded border border-gray-700 bg-gray-900/60 px-4 py-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-400">Name</span><span>{name || '-'}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Mode</span><span className="uppercase">{mode}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Broker</span><span>Alpaca</span></div>
            <div className="flex justify-between">
              <span className="text-gray-400">API Key</span>
              <span className="font-mono text-xs">{apiKey.slice(0, 6)}••••</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Data Service</span>
              <span>
                {dataServiceId
                  ? (activeServices.find(s => s.id === dataServiceId)?.name ?? '-')
                  : <span className="text-gray-500">None — Alpaca premium data</span>
                }
              </span>
            </div>
            <div className="text-xs text-gray-500 border-t border-gray-800 pt-2">
              Credentials will be stored encrypted.
            </div>
          </div>
        )}

        {mode === 'live' && (
          <div className="rounded border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            <strong>WARNING:</strong> LIVE mode. Any linked deployment can place real broker orders.
          </div>
        )}

        {!credentialsLookValid && (
          <div className="rounded border border-amber-700 bg-amber-950/40 px-4 py-3 text-xs text-amber-300">
            Alpaca key format looks invalid. API key should start with <code>PK</code> or <code>AK</code>, and the secret must be at least 16 characters.
          </div>
        )}

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
})
