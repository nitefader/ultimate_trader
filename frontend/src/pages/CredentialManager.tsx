import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { accountsApi } from '../api/accounts'
import { CreateAccountModal } from '../components/CreateAccountModal'
import clsx from 'clsx'
import type { Account } from '../types'

const DEFAULT_BASE_URL = 'https://paper-api.alpaca.markets'
const LIVE_BASE_URL = 'https://api.alpaca.markets'

type BrokerMode = 'paper' | 'live'

export function CredentialManager() {
  // ── State ────────────────────────────────────────────────────────────────
  const [searchParams] = useSearchParams()
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(searchParams.get('account'))
  const [showCreateAccount, setShowCreateAccount] = useState(false)
  const [mode, setMode] = useState<BrokerMode>('paper')
  const [apiKey, setApiKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showSecretKey, setShowSecretKey] = useState(false)
  const [validationStatus, setValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle')
  const [validationMessage, setValidationMessage] = useState('')

  const queryClient = useQueryClient()

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: accounts = [], isLoading, error } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
    refetchInterval: 15_000,
  })

  const credentialsQuery = useQuery({
    queryKey: ['credentials', selectedAccountId],
    queryFn: () => selectedAccountId ? accountsApi.getCredentials(selectedAccountId) : null,
    enabled: !!selectedAccountId,
  })

  const selectedAccount = accounts.find(acc => acc.id === selectedAccountId) ?? null

  // Populate form when credentials load or mode switches
  useEffect(() => {
    const config = (credentialsQuery.data?.broker_config as Record<string, any>) ?? {}
    const modeSettings = (config[mode] ?? {}) as Record<string, string>
    setApiKey(modeSettings.api_key ?? '')
    setSecretKey(modeSettings.secret_key ?? '')
    setBaseUrl(modeSettings.base_url ?? (mode === 'live' ? LIVE_BASE_URL : DEFAULT_BASE_URL))
    setValidationStatus('idle')
    setValidationMessage('')
  }, [credentialsQuery.data, mode])

  // When account changes, reset mode to paper
  useEffect(() => {
    setMode('paper')
  }, [selectedAccountId])

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (payload: { broker_config: Record<string, unknown> }) =>
      accountsApi.updateCredentials(selectedAccountId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials', selectedAccountId] })
    },
  })

  const validateMutation = useMutation({
    mutationFn: () => accountsApi.validateCredentials(selectedAccountId!),
    onMutate: () => {
      setValidationStatus('validating')
      setValidationMessage('Connecting to Alpaca...')
    },
    onSuccess: (data: any) => {
      if (data.valid) {
        setValidationStatus('valid')
        setValidationMessage(`Connected — Account ${data.account_id} | Equity $${Number(data.portfolio_value ?? 0).toLocaleString()}`)
      } else {
        setValidationStatus('invalid')
        setValidationMessage(`Invalid credentials: ${data.error}`)
      }
    },
    onError: (error: any) => {
      setValidationStatus('invalid')
      setValidationMessage(`Validation failed: ${error.message}`)
    },
  })

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!selectedAccount) return
    // Merge the current mode's settings into the existing config
    const existingConfig = (credentialsQuery.data?.broker_config as Record<string, any>) ?? {}
    const updatedConfig = {
      ...existingConfig,
      [mode]: {
        ...((existingConfig[mode] as Record<string, unknown>) ?? {}),
        api_key: apiKey,
        secret_key: secretKey,
        base_url: baseUrl,
      },
    }
    saveMutation.mutate({ broker_config: updatedConfig })
  }

  // ── Early returns ─────────────────────────────────────────────────────────
  if (isLoading) {
    return <div className="text-gray-400">Loading accounts...</div>
  }
  if (error) {
    return (
      <div className="card border-red-800 bg-red-900/20 p-4 text-red-300">
        Error loading accounts: {(error as Error).message}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Security Center</h1>
          <p className="text-sm text-gray-500">
            Manage Alpaca API credentials per account. Paper and live keys are stored separately and encrypted at rest.
          </p>
        </div>
        <button type="button" className="btn-primary text-sm" onClick={() => setShowCreateAccount(true)}>
          Add Account
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* ── Account sidebar ─────────────────────────────────────────────── */}
        <div className="card space-y-4 p-4">
          <div className="text-sm font-semibold text-gray-200">Accounts</div>
          {accounts.length === 0 ? (
            <div className="text-sm text-gray-400">
              No accounts yet. Create one here, then add keys for paper or live trading.
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map(account => (
                <button
                  key={account.id}
                  type="button"
                  className={clsx(
                    'w-full text-left rounded border px-3 py-3 transition',
                    selectedAccountId === account.id
                      ? 'border-sky-500 bg-sky-900/30 text-sky-100'
                      : 'border-gray-800 bg-gray-950 text-gray-300 hover:border-gray-600 hover:bg-gray-900',
                  )}
                  onClick={() => setSelectedAccountId(account.id)}
                >
                  <div className="font-semibold text-sm">{account.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={clsx(
                      'text-xs px-1.5 py-0.5 rounded',
                      account.mode === 'live'
                        ? 'bg-orange-900/60 text-orange-300'
                        : 'bg-blue-900/60 text-blue-300',
                    )}>
                      {account.mode}
                    </span>
                    <span className="text-xs text-gray-500">{account.broker}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Credential form ──────────────────────────────────────────────── */}
        <div className="card p-6 space-y-6">
          {!selectedAccount ? (
            <div className="text-sm text-gray-400 pt-4">
              Select an account from the left to configure its Alpaca credentials.
            </div>
          ) : (
            <>
              {/* Account + mode selector */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Account</label>
                  <div className="input bg-gray-950 text-gray-200 cursor-default">
                    {selectedAccount.name}
                  </div>
                </div>
                <div>
                  <label className="label">Key Set</label>
                  <div className="flex rounded border border-gray-700 overflow-hidden">
                    {(['paper', 'live'] as BrokerMode[]).map(m => (
                      <button
                        key={m}
                        type="button"
                        className={clsx(
                          'flex-1 py-2 text-sm font-medium transition',
                          mode === m
                            ? m === 'live'
                              ? 'bg-orange-800/70 text-orange-100'
                              : 'bg-sky-800/70 text-sky-100'
                            : 'bg-gray-900 text-gray-400 hover:bg-gray-800',
                        )}
                        onClick={() => setMode(m)}
                      >
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Live warning */}
              {mode === 'live' && (
                <div className="rounded border border-orange-700 bg-orange-950/40 px-4 py-3 text-sm text-orange-300">
                  <strong>Live trading keys</strong> — real money at risk. Double-check before saving.
                </div>
              )}

              {/* Credential fields */}
              <div className="space-y-4">
                <div>
                  <label className="label">Alpaca API Key ({mode})</label>
                  <div className="relative">
                    <input
                      className="input w-full pr-10 font-mono text-sm"
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder={`${mode === 'live' ? 'AK...' : 'PK...'}`}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 text-xs"
                      onClick={() => setShowApiKey(v => !v)}
                    >
                      {showApiKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label">Alpaca Secret Key ({mode})</label>
                  <div className="relative">
                    <input
                      className="input w-full pr-10 font-mono text-sm"
                      type={showSecretKey ? 'text' : 'password'}
                      value={secretKey}
                      onChange={e => setSecretKey(e.target.value)}
                      placeholder="Secret key..."
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 text-xs"
                      onClick={() => setShowSecretKey(v => !v)}
                    >
                      {showSecretKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label">Base URL</label>
                  <input
                    className="input w-full font-mono text-sm"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                  />
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-sky-400 hover:text-sky-300"
                      onClick={() => setBaseUrl(DEFAULT_BASE_URL)}
                    >
                      Use Paper URL
                    </button>
                    <span className="text-gray-600">·</span>
                    <button
                      type="button"
                      className="text-xs text-orange-400 hover:text-orange-300"
                      onClick={() => setBaseUrl(LIVE_BASE_URL)}
                    >
                      Use Live URL
                    </button>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between gap-3 pt-2">
                <p className="text-xs text-gray-500 max-w-xs">
                  Keys are AES-256 encrypted before storage. Masked values shown after save.
                </p>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    onClick={() => validateMutation.mutate()}
                    disabled={!selectedAccount || validateMutation.isPending || !apiKey || !secretKey}
                  >
                    {validateMutation.isPending ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    onClick={handleSave}
                    disabled={saveMutation.isPending || !apiKey || !secretKey}
                    title={(!apiKey || !secretKey) ? 'Both API key and secret key are required' : undefined}
                  >
                    {saveMutation.isPending ? 'Saving...' : 'Save Keys'}
                  </button>
                </div>
              </div>

              {/* Validation result */}
              {validationStatus !== 'idle' && (
                <div className={clsx(
                  'rounded border p-3 text-sm',
                  validationStatus === 'valid' && 'border-green-700 bg-green-950/50 text-green-300',
                  validationStatus === 'invalid' && 'border-red-700 bg-red-950/50 text-red-300',
                  validationStatus === 'validating' && 'border-gray-700 bg-gray-900 text-gray-300',
                )}>
                  {validationMessage}
                </div>
              )}

              {saveMutation.isSuccess && (
                <div className="text-sm text-green-400">
                  Credentials saved and encrypted successfully.
                </div>
              )}
              {saveMutation.isError && (
                <div className="text-sm text-red-400">
                  Error saving: {(saveMutation.error as Error).message}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showCreateAccount && (
        <CreateAccountModal
          onClose={() => setShowCreateAccount(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['accounts'] })}
        />
      )}
    </div>
  )
}
