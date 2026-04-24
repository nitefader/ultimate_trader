import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, Star, Trash2, TestTube, Eye, EyeOff, Pencil, Check, X, Server, Sparkles, Brain } from 'lucide-react'
import clsx from 'clsx'
import { servicesApi, type DataServiceRecord, type DataServiceCreate } from '../api/services'
import { SelectMenu } from '../components/SelectMenu'
import { Tooltip } from '../components/Tooltip'

// ── Constants ────────────────────────────────────────────────────────────────

const DATA_PROVIDERS = [
  { value: 'alpaca', label: 'Alpaca Markets' },
  { value: 'yfinance', label: 'yfinance (free, no keys)' },
] as const

const AI_PROVIDERS = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'groq', label: 'Groq (Llama / Mixtral)' },
] as const

const ENVIRONMENTS = [
  { value: 'paper', label: 'Paper' },
  { value: 'live', label: 'Live' },
] as const

const AI_MODELS: Record<string, { value: string; label: string }[]> = {
  gemini: [
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (free tier)' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Experimental)' },
    { value: 'gemini-2.0-flash-lite-preview-02-05', label: 'Gemini 2.0 Flash-Lite' },
  ],
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile (free)' },
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (free, fastest)' },
    { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B (free)' },
    { value: 'llama3-70b-8192', label: 'Llama 3 70B' },
  ],
}

const isAiProvider = (p: string) => p === 'gemini' || p === 'groq'
const isDataProvider = (p: string) => !isAiProvider(p)

// ── Validation helpers ────────────────────────────────────────────────────────

function validateDataService(name: string, provider: string, apiKey: string, secretKey: string): string | null {
  if (!name.trim()) return 'Name is required.'
  if (provider === 'alpaca') {
    if (!apiKey.trim()) return 'API Key is required for Alpaca.'
    if (!apiKey.startsWith('PK') && !apiKey.startsWith('AK') && !apiKey.includes('****'))
      return 'Alpaca API keys start with PK (paper) or AK (live).'
    if (!secretKey.trim()) return 'Secret Key is required for Alpaca.'
  }
  return null
}

function validateAiService(name: string, provider: string, apiKey: string): string | null {
  if (!name.trim()) return 'Name is required.'
  if (provider === 'gemini') {
    if (!apiKey.trim()) return 'API Key is required for Gemini.'
    if (!apiKey.startsWith('AIza') && !apiKey.includes('****'))
      return 'Gemini API keys start with AIza.'
  }
  if (provider === 'groq') {
    if (!apiKey.trim()) return 'API Key is required for Groq.'
    if (!apiKey.startsWith('gsk_') && !apiKey.includes('****'))
      return 'Groq API keys start with gsk_.'
  }
  return null
}

// ── Main page ────────────────────────────────────────────────────────────────

export function Services() {
  const qc = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: allServices = [], isLoading } = useQuery({
    queryKey: ['services'],
    queryFn: servicesApi.list,
  })

  const tab = location.pathname.startsWith('/services/ai') ? 'ai' : 'data'
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Reset form state whenever tab changes (including sidebar nav clicks)
  React.useEffect(() => {
    setShowCreate(false)
    setEditingId(null)
  }, [tab])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['services'] })

  const dataServices = allServices.filter(s => isDataProvider(s.provider))
  const aiServices = allServices.filter(s => isAiProvider(s.provider))

  const handleTabChange = (t: 'data' | 'ai') => {
    navigate(t === 'ai' ? '/services/ai' : '/services/data')
    setShowCreate(false)
    setEditingId(null)
  }

  return (
    <div className="space-y-4 max-w-4xl">

      {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          <button
            className={clsx(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === 'data' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
            )}
            onClick={() => handleTabChange('data')}
          >
            <Server size={14} /> Data Services
            {dataServices.length > 0 && (
              <span className={clsx('ml-1 text-xs px-1.5 py-0.5 rounded-full', tab === 'data' ? 'bg-indigo-500' : 'bg-gray-700 text-gray-400')}>
                {dataServices.length}
              </span>
            )}
          </button>
          <button
            className={clsx(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === 'ai' ? 'bg-purple-700 text-white' : 'text-gray-400 hover:text-gray-200'
            )}
            onClick={() => handleTabChange('ai')}
          >
            <Brain size={14} /> AI Services
            {aiServices.length > 0 && (
              <span className={clsx('ml-1 text-xs px-1.5 py-0.5 rounded-full', tab === 'ai' ? 'bg-purple-600' : 'bg-gray-700 text-gray-400')}>
                {aiServices.length}
              </span>
            )}
          </button>
        </div>

        <button
          className="btn-primary flex items-center gap-1.5"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={14} /> Add {tab === 'ai' ? 'AI' : 'Data'} Service
        </button>
      </div>

      {/* ── Tab Description ─────────────────────────────────────────────── */}
      {tab === 'data' ? (
        <p className="text-sm text-gray-500">
          Market data sources for backtesting and live trading. Alpaca requires an API + Secret key pair.
        </p>
      ) : (
        <p className="text-sm text-gray-500">
          LLM providers for AI-assisted strategy creation and NLP condition parsing.
          Free keys: <span className="text-purple-400">aistudio.google.com</span> (Gemini) · <span className="text-orange-400">console.groq.com</span> (Groq).
        </p>
      )}

      {/* ── Data Tab ────────────────────────────────────────────────────── */}
      {tab === 'data' && (
        <section className="space-y-3">
          {showCreate && (
            <ServiceForm
              formType="data"
              onClose={() => setShowCreate(false)}
              onCreated={() => { setShowCreate(false); invalidate() }}
            />
          )}

          {isLoading ? (
            <div className="text-gray-500 text-sm">Loading…</div>
          ) : dataServices.length === 0 && !showCreate ? (
            <div className="card border border-gray-800 text-center py-10">
              <Server size={36} className="mx-auto text-gray-700 mb-2" />
              <p className="text-gray-400 text-sm">No data services configured.</p>
              <p className="text-gray-600 text-xs mt-1">Add Alpaca credentials to enable live data and backtesting.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {dataServices.map(svc =>
                editingId === svc.id ? (
                  <ServiceEditCard
                    key={svc.id}
                    service={svc}
                    formType="data"
                    onClose={() => setEditingId(null)}
                    onSaved={() => { setEditingId(null); invalidate() }}
                  />
                ) : (
                  <ServiceCard
                    key={svc.id}
                    service={svc}
                    onEdit={() => setEditingId(svc.id)}
                  />
                )
              )}
            </div>
          )}
        </section>
      )}

      {/* ── AI Tab ──────────────────────────────────────────────────────── */}
      {tab === 'ai' && (
        <section className="space-y-3">
          {showCreate && (
            <ServiceForm
              formType="ai"
              onClose={() => setShowCreate(false)}
              onCreated={() => { setShowCreate(false); invalidate() }}
            />
          )}

          {isLoading ? (
            <div className="text-gray-500 text-sm">Loading…</div>
          ) : aiServices.length === 0 && !showCreate ? (
            <div className="card border border-purple-900/30 text-center py-10">
              <Sparkles size={36} className="mx-auto text-purple-900 mb-2" />
              <p className="text-gray-400 text-sm">No AI services configured.</p>
              <p className="text-gray-600 text-xs mt-1">Add a Gemini or Groq key to enable AI-assisted strategy creation.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {aiServices.map(svc =>
                editingId === svc.id ? (
                  <ServiceEditCard
                    key={svc.id}
                    service={svc}
                    formType="ai"
                    onClose={() => setEditingId(null)}
                    onSaved={() => { setEditingId(null); invalidate() }}
                  />
                ) : (
                  <ServiceCard
                    key={svc.id}
                    service={svc}
                    onEdit={() => setEditingId(svc.id)}
                  />
                )
              )}
            </div>
          )}
        </section>
      )}

    </div>
  )
}

// ── Service Card (read-only) ──────────────────────────────────────────────────

function ServiceCard({ service: svc, onEdit }: { service: DataServiceRecord; onEdit: () => void }) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['services'] })

  const isAi = isAiProvider(svc.provider)

  const deleteMut = useMutation({
    mutationFn: () => servicesApi.delete(svc.id),
    onSuccess: invalidate,
  })

  const setDefaultMut = useMutation({
    mutationFn: () => servicesApi.setDefault(svc.id),
    onSuccess: invalidate,
  })

  const setDefaultAiMut = useMutation({
    mutationFn: () => servicesApi.setDefaultAi(svc.id),
    onSuccess: invalidate,
  })

  const testMut = useMutation({ mutationFn: () => servicesApi.test(svc.id) })

  const isDefaultForType = isAi ? svc.is_default_ai : svc.is_default

  return (
    <div className={clsx(
      'card border transition-colors',
      isDefaultForType
        ? isAi ? 'border-purple-700/60 bg-purple-950/10' : 'border-sky-800/60 bg-sky-950/10'
        : 'border-gray-800',
      !svc.is_active && 'opacity-55',
    )}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-200">{svc.name}</h3>

          {/* Default badge */}
          {isDefaultForType && (
            <span className={clsx(
              'badge text-xs flex items-center gap-1',
              isAi ? 'bg-purple-900 text-purple-300' : 'badge-sky',
            )}>
              <Star size={9} fill="currentColor" /> {isAi ? 'Default AI' : 'Default'}
            </span>
          )}

          {/* Provider badge */}
          <span className={clsx('badge text-xs', {
            'badge-indigo': svc.provider === 'alpaca',
            'bg-purple-900 text-purple-300': svc.provider === 'gemini',
            'bg-orange-900 text-orange-300': svc.provider === 'groq',
            'badge-gray': svc.provider === 'yfinance',
          })}>
            {svc.provider}
          </span>

          {/* Environment badge — only for data providers */}
          {!isAi && svc.environment !== 'n/a' && (
            <span className={clsx('badge text-xs', svc.environment === 'live' ? 'badge-red' : 'badge-green')}>
              {svc.environment}
            </span>
          )}

          {!svc.is_active && <span className="badge badge-gray text-xs">Disabled</span>}
          {svc.has_credentials && !isDefaultForType && (
            <span className="badge badge-green text-xs">Key stored</span>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {/* Set as default button */}
          {!isDefaultForType && svc.is_active && svc.has_credentials && (
            <Tooltip content={isAi ? 'Set as default AI service' : 'Set as default data service'}>
              <button
                className="btn-ghost text-xs text-gray-500 hover:text-yellow-400"
                onClick={() => isAi ? setDefaultAiMut.mutate() : setDefaultMut.mutate()}
                disabled={setDefaultMut.isPending || setDefaultAiMut.isPending}
              >
                <Star size={13} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Edit">
            <button className="btn-ghost text-xs" onClick={onEdit}><Pencil size={12} /></button>
          </Tooltip>
          <Tooltip content="Delete">
            <button
              className="btn-ghost text-xs text-red-400 hover:text-red-300"
              onClick={() => { if (confirm(`Delete "${svc.name}"?`)) deleteMut.mutate() }}
              disabled={deleteMut.isPending}
            >
              <Trash2 size={12} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Credential display */}
      <div className="grid grid-cols-2 gap-x-8 mt-2 text-xs">
        <div>
          <span className="text-gray-600">API Key</span>
          <span className="ml-2 font-mono text-gray-400">{svc.api_key || '—'}</span>
        </div>
        {!isAi && (
          <div>
            <span className="text-gray-600">Secret Key</span>
            <span className="ml-2 font-mono text-gray-400">{svc.secret_key || '—'}</span>
          </div>
        )}
      </div>

      {/* Test button */}
      <div className="flex items-center gap-2 mt-3">
        <Tooltip content={!svc.has_credentials ? 'Add credentials first' : svc.provider === 'groq' ? 'Ping Groq API' : isAi ? 'Ping Gemini API' : 'Test Alpaca connection'}>
          <button
            className="btn-secondary text-xs flex items-center gap-1"
            onClick={() => testMut.mutate()}
            disabled={testMut.isPending || !svc.has_credentials}
          >
            <TestTube size={12} /> {testMut.isPending ? 'Testing…' : 'Test Connection'}
          </button>
        </Tooltip>
        {testMut.data && (
          <span className={clsx('text-xs', (testMut.data as any).valid ? 'text-green-400' : 'text-red-400')}>
            {(testMut.data as any).valid
              ? isAi
                ? `✓ ${(testMut.data as any).status}`
                : `✓ Connected — ${(testMut.data as any).status} — $${Number((testMut.data as any).buying_power ?? 0).toLocaleString()}`
              : `✗ ${(testMut.data as any).error}`}
          </span>
        )}
      </div>

      {svc.created_at && (
        <p className="text-xs text-gray-700 mt-2">{svc.created_at.replace('T', ' ').slice(0, 19)}</p>
      )}
    </div>
  )
}

// ── Shared Create / Edit Form ─────────────────────────────────────────────────

type FormType = 'data' | 'ai'

function ServiceForm({ formType, onClose, onCreated }: {
  formType: FormType
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState(formType === 'ai' ? 'gemini' : 'alpaca')
  const [environment, setEnvironment] = useState('paper')
  const [apiKey, setApiKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const defaultModel = provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gemini-1.5-flash'
  const [model, setModel] = useState(defaultModel)
  const [isDefault, setIsDefault] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const createMut = useMutation({
    mutationFn: (data: DataServiceCreate) => servicesApi.create(data),
    onSuccess: onCreated,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const err = formType === 'ai'
      ? validateAiService(name, provider, apiKey)
      : validateDataService(name, provider, apiKey, secretKey)
    if (err) { setValidationError(err); return }
    setValidationError(null)
    createMut.mutate({
      name: name.trim(),
      provider,
      environment: formType === 'ai' ? 'n/a' : environment,
      api_key: apiKey,
      secret_key: formType === 'ai' ? '' : secretKey,
      ...(formType === 'ai' ? { is_default_ai: isDefault } : { is_default: isDefault }),
      ...(formType === 'ai' ? { model } : {}),
    })
  }

  const providerOptions = formType === 'ai'
    ? AI_PROVIDERS.map(p => ({ value: p.value, label: p.label }))
    : DATA_PROVIDERS.map(p => ({ value: p.value, label: p.label }))

  const isAlpaca = provider === 'alpaca'
  const isGemini = provider === 'gemini'
  const isGroq = provider === 'groq'
  const isYfinance = provider === 'yfinance'

  const accentBorder = formType === 'ai' ? 'border-purple-800/50' : 'border-sky-900/50'

  return (
    <form onSubmit={handleSubmit} className={clsx('card border space-y-4', accentBorder)}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          {formType === 'ai' ? <Brain size={14} className="text-purple-400" /> : <Server size={14} className="text-indigo-400" />}
          New {formType === 'ai' ? 'AI' : 'Data'} Service
        </h2>
        <button type="button" className="text-gray-500 hover:text-gray-300" onClick={onClose}><X size={16} /></button>
      </div>

      {/* Name + Provider (+ Environment for data) */}
      <div className={clsx('grid gap-3', formType === 'data' && !isYfinance ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2')}>
        <div>
          <label className="label">Name</label>
          <input
            className="input w-full"
            value={name}
            onChange={e => { setName(e.target.value); setValidationError(null) }}
            placeholder={isGemini ? 'My Gemini Key' : isYfinance ? 'Yahoo Finance' : 'My Alpaca Data'}
            required
          />
        </div>
        <div>
          <label className="label">Provider</label>
          <SelectMenu value={provider} onChange={v => {
          setProvider(v)
          setModel(v === 'groq' ? 'llama-3.3-70b-versatile' : 'gemini-1.5-flash')
          setValidationError(null)
        }} options={providerOptions} />
        </div>
        {formType === 'data' && !isYfinance && (
          <div>
            <label className="label">Environment</label>
            <SelectMenu value={environment} onChange={setEnvironment} options={ENVIRONMENTS.map(e => ({ value: e.value, label: e.label }))} />
          </div>
        )}
      </div>

      {/* Alpaca: API + Secret */}
      {isAlpaca && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">API Key</label>
            <div className="relative">
              <input
                className={clsx('input w-full pr-8 font-mono', validationError?.includes('API Key') && 'border-red-600')}
                type={showKeys ? 'text' : 'password'}
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setValidationError(null) }}
                placeholder="PKxxxxxxxx..."
                autoComplete="off"
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" onClick={() => setShowKeys(!showKeys)}>
                {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-1">Paper keys start with PK, live with AK.</p>
          </div>
          <div>
            <label className="label">Secret Key</label>
            <div className="relative">
              <input
                className={clsx('input w-full pr-8 font-mono', validationError?.includes('Secret Key') && 'border-red-600')}
                type={showKeys ? 'text' : 'password'}
                value={secretKey}
                onChange={e => { setSecretKey(e.target.value); setValidationError(null) }}
                placeholder="xxxxxxxx..."
                autoComplete="off"
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" onClick={() => setShowKeys(!showKeys)}>
                {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gemini: API key only + model */}
      {isGemini && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">API Key</label>
            <div className="relative">
              <input
                className={clsx('input w-full pr-8 font-mono', validationError?.includes('API Key') && 'border-red-600')}
                type={showKeys ? 'text' : 'password'}
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setValidationError(null) }}
                placeholder="AIzaxxxxxxxx..."
                autoComplete="off"
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" onClick={() => setShowKeys(!showKeys)}>
                {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Get a free key at <span className="text-purple-400">aistudio.google.com</span> → API keys
            </p>
          </div>
          <div>
            <label className="label">Default Model</label>
            <SelectMenu
              value={model}
              onChange={setModel}
              options={AI_MODELS.gemini}
            />
            <p className="text-xs text-gray-600 mt-1">Flash is free-tier; Pro is higher quality.</p>
          </div>
        </div>
      )}

      {/* Groq: API key only + model */}
      {isGroq && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">API Key</label>
            <div className="relative">
              <input
                className={clsx('input w-full pr-8 font-mono', validationError?.includes('API Key') && 'border-red-600')}
                type={showKeys ? 'text' : 'password'}
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setValidationError(null) }}
                placeholder="gsk_xxxxxxxx..."
                autoComplete="off"
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" onClick={() => setShowKeys(!showKeys)}>
                {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Get a free key at <span className="text-purple-400">console.groq.com</span> → API Keys
            </p>
          </div>
          <div>
            <label className="label">Default Model</label>
            <SelectMenu value={model} onChange={setModel} options={AI_MODELS.groq} />
            <p className="text-xs text-gray-600 mt-1">All listed models are on Groq's free tier.</p>
          </div>
        </div>
      )}

      {/* yfinance info */}
      {isYfinance && (
        <div className="rounded bg-gray-800/50 border border-gray-700 px-3 py-2 text-xs text-gray-400">
          yfinance uses public Yahoo Finance data — no API key required.
        </div>
      )}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={e => setIsDefault(e.target.checked)}
            className="accent-purple-500"
          />
          Set as default {formType === 'ai' ? 'AI service' : 'data service'}
        </label>
      </div>

      {(validationError || createMut.isError) && (
        <div className="text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded px-3 py-1.5">
          {validationError ?? (createMut.error as Error).message}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost text-sm" onClick={onClose}>Cancel</button>
        <button
          type="submit"
          className="btn-primary text-sm flex items-center gap-1"
          disabled={createMut.isPending}
        >
          <Check size={14} /> {createMut.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

// ── Inline Edit Card ──────────────────────────────────────────────────────────

function ServiceEditCard({ service: svc, formType, onClose, onSaved }: {
  service: DataServiceRecord
  formType: FormType
  onClose: () => void
  onSaved: () => void
}) {
  const isAi = formType === 'ai'
  const isAlpaca = svc.provider === 'alpaca'
  const isGemini = svc.provider === 'gemini'
  const isGroq = svc.provider === 'groq'
  const isYfinance = svc.provider === 'yfinance'

  const [name, setName] = useState(svc.name)
  const [environment, setEnvironment] = useState(svc.environment)
  const [apiKey, setApiKey] = useState(svc.api_key)
  const [secretKey, setSecretKey] = useState(svc.secret_key)
  const [model, setModel] = useState(svc.model || (svc.provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gemini-1.5-flash'))
  const [isActive, setIsActive] = useState(svc.is_active)
  const [showKeys, setShowKeys] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const updateMut = useMutation({
    mutationFn: () => servicesApi.update(svc.id, {
      name: name.trim(),
      environment: isAi ? 'n/a' : environment,
      api_key: apiKey,
      secret_key: isAi ? '' : secretKey,
      ...(isAi ? { model } : {}),
      is_active: isActive,
    }),
    onSuccess: onSaved,
  })

  const handleSave = () => {
    const err = isAi
      ? validateAiService(name, svc.provider, apiKey)
      : validateDataService(name, svc.provider, apiKey, secretKey)
    if (err) { setValidationError(err); return }
    setValidationError(null)
    updateMut.mutate()
  }

  const accentBorder = isAi ? 'border-purple-700/50' : 'border-indigo-800/50'
  const accentText = isAi ? 'text-purple-300' : 'text-indigo-300'

  return (
    <div className={clsx('card border space-y-4', accentBorder)}>
      <div className="flex items-center justify-between">
        <h2 className={clsx('text-sm font-semibold', accentText)}>
          Editing: {svc.name}
          <span className="ml-2 text-gray-600 font-normal">({svc.provider})</span>
        </h2>
        <button className="text-gray-500 hover:text-gray-300" onClick={onClose}><X size={16} /></button>
      </div>

      <div className={clsx('grid gap-3', isAlpaca && !isAi ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2')}>
        <div>
          <label className="label">Name</label>
          <input className="input w-full" value={name} onChange={e => { setName(e.target.value); setValidationError(null) }} />
        </div>
        <div>
          <label className="label">Provider</label>
          <input className="input w-full bg-gray-800/50 text-gray-500 cursor-not-allowed" value={svc.provider} readOnly />
        </div>
        {isAlpaca && !isAi && (
          <div>
            <label className="label">Environment</label>
            <SelectMenu value={environment} onChange={setEnvironment} options={ENVIRONMENTS.map(e => ({ value: e.value, label: e.label }))} />
          </div>
        )}
      </div>

      {isAlpaca && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">API Key</label>
            <div className="relative">
              <input
                className={clsx('input w-full pr-8 font-mono', validationError?.includes('API Key') && 'border-red-600')}
                type={showKeys ? 'text' : 'password'}
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setValidationError(null) }}
                autoComplete="off"
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" onClick={() => setShowKeys(!showKeys)}>
                {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Secret Key</label>
            <div className="relative">
              <input
                className={clsx('input w-full pr-8 font-mono', validationError?.includes('Secret Key') && 'border-red-600')}
                type={showKeys ? 'text' : 'password'}
                value={secretKey}
                onChange={e => { setSecretKey(e.target.value); setValidationError(null) }}
                autoComplete="off"
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" onClick={() => setShowKeys(!showKeys)}>
                {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {isGemini && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">API Key</label>
            <div className="relative">
              <input
                className={clsx('input w-full pr-8 font-mono', validationError?.includes('API Key') && 'border-red-600')}
                type={showKeys ? 'text' : 'password'}
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setValidationError(null) }}
                placeholder="AIzaxxxxxxxx..."
                autoComplete="off"
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" onClick={() => setShowKeys(!showKeys)}>
                {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Default Model</label>
            <SelectMenu
              value={model}
              onChange={setModel}
              options={AI_MODELS.gemini}
            />
          </div>
        </div>
      )}

      {isGroq && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">API Key</label>
            <div className="relative">
              <input
                className={clsx('input w-full pr-8 font-mono', validationError?.includes('API Key') && 'border-red-600')}
                type={showKeys ? 'text' : 'password'}
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setValidationError(null) }}
                placeholder="gsk_xxxxxxxx..."
                autoComplete="off"
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" onClick={() => setShowKeys(!showKeys)}>
                {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Default Model</label>
            <SelectMenu value={model} onChange={setModel} options={AI_MODELS.groq} />
          </div>
        </div>
      )}

      {isYfinance && (
        <div className="text-xs text-gray-500 bg-gray-800/40 rounded px-3 py-2">
          yfinance uses public data — no credentials needed.
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
        Service is active
      </label>

      {(validationError || updateMut.isError) && (
        <div className="text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded px-3 py-1.5">
          {validationError ?? (updateMut.error as Error).message}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button className="btn-ghost text-sm" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary text-sm flex items-center gap-1"
          onClick={handleSave}
          disabled={updateMut.isPending}
        >
          <Check size={14} /> {updateMut.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
