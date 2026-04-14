import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Star, Trash2, TestTube, Eye, EyeOff, Pencil, Check, X, Server } from 'lucide-react'
import clsx from 'clsx'
import { servicesApi, type DataServiceRecord, type DataServiceCreate } from '../api/services'
import { SelectMenu } from '../components/SelectMenu'
import { Tooltip } from '../components/Tooltip'

// ── Constants ────────────────────────────────────────────────────────────────

const PROVIDERS = [
  { value: 'alpaca', label: 'Alpaca' },
  { value: 'yfinance', label: 'yfinance (no keys needed)' },
] as const

const ENVIRONMENTS = [
  { value: 'paper', label: 'Paper' },
  { value: 'live', label: 'Live' },
] as const

// ── Main page ────────────────────────────────────────────────────────────────

export function Services() {
  const qc = useQueryClient()
  const { data: services = [], isLoading } = useQuery({
    queryKey: ['services'],
    queryFn: servicesApi.list,
  })

  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Data Services</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure Alpaca API keys for market data. Used by the backtester and live accounts.
          </p>
        </div>
        <button
          className="btn-primary flex items-center gap-1.5"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={14} /> Add Service
        </button>
      </div>

      {showCreate && (
        <CreateServiceForm
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            qc.invalidateQueries({ queryKey: ['services'] })
          }}
        />
      )}

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading services…</div>
      ) : services.length === 0 ? (
        <div className="card text-center py-12">
          <Server size={40} className="mx-auto text-gray-700 mb-3" />
          <p className="text-gray-400 text-sm">No data services configured yet.</p>
          <p className="text-gray-600 text-xs mt-1">
            Add a service to provide Alpaca market data for backtesting and live trading.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map(svc => (
            editingId === svc.id ? (
              <EditServiceCard
                key={svc.id}
                service={svc}
                onClose={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null)
                  qc.invalidateQueries({ queryKey: ['services'] })
                }}
              />
            ) : (
              <ServiceCard
                key={svc.id}
                service={svc}
                onEdit={() => setEditingId(svc.id)}
              />
            )
          ))}
        </div>
      )}
    </div>
  )
}

// ── Service Card (read-only) ─────────────────────────────────────────────────

function ServiceCard({ service: svc, onEdit }: { service: DataServiceRecord; onEdit: () => void }) {
  const qc = useQueryClient()

  const deleteMut = useMutation({
    mutationFn: () => servicesApi.delete(svc.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  })

  const setDefaultMut = useMutation({
    mutationFn: () => servicesApi.setDefault(svc.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  })

  const testMut = useMutation({
    mutationFn: () => servicesApi.test(svc.id),
  })

  return (
    <div className={clsx(
      'card border',
      svc.is_default ? 'border-sky-800/60 bg-sky-950/10' : 'border-gray-800',
      !svc.is_active && 'opacity-60',
    )}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-200">{svc.name}</h3>
          {svc.is_default && (
            <span className="badge badge-sky text-xs flex items-center gap-1">
              <Star size={10} /> Default
            </span>
          )}
          <span className={clsx('badge text-xs', svc.provider === 'alpaca' ? 'badge-indigo' : 'badge-gray')}>
            {svc.provider}
          </span>
          <span className={clsx('badge text-xs', svc.environment === 'live' ? 'badge-red' : 'badge-green')}>
            {svc.environment}
          </span>
          {!svc.is_active && <span className="badge badge-gray text-xs">Disabled</span>}
        </div>
        <div className="flex items-center gap-1">
          {!svc.is_default && svc.is_active && (
            <Tooltip content="Set as default data service">
              <button
                className="btn-ghost text-xs"
                onClick={() => setDefaultMut.mutate()}
                disabled={setDefaultMut.isPending}
              >
                <Star size={12} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Edit service">
            <button className="btn-ghost text-xs" onClick={onEdit}>
              <Pencil size={12} />
            </button>
          </Tooltip>
          <Tooltip content="Delete service">
            <button
              className="btn-ghost text-xs text-red-400 hover:text-red-300"
              onClick={() => {
                if (confirm(`Delete "${svc.name}"?`)) deleteMut.mutate()
              }}
              disabled={deleteMut.isPending}
            >
              <Trash2 size={12} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-1 mt-3 text-xs">
        <div>
          <span className="text-gray-600">API Key</span>
          <span className="ml-2 text-gray-300 font-mono">{svc.api_key || '—'}</span>
        </div>
        <div>
          <span className="text-gray-600">Secret Key</span>
          <span className="ml-2 text-gray-300 font-mono">{svc.secret_key || '—'}</span>
        </div>
      </div>

      {/* Test connection */}
      <div className="flex items-center gap-2 mt-3">
        <Tooltip content={!svc.has_credentials ? 'Add credentials first' : 'Test connection to Alpaca'}>
          <button
            className="btn-secondary text-xs flex items-center gap-1"
            onClick={() => testMut.mutate()}
            disabled={testMut.isPending || !svc.has_credentials}
          >
            <TestTube size={12} /> {testMut.isPending ? 'Testing…' : 'Test Connection'}
          </button>
        </Tooltip>
        {testMut.data && (
          <span className={clsx('text-xs', testMut.data.valid ? 'text-green-400' : 'text-red-400')}>
            {testMut.data.valid
              ? `✓ Connected — ${testMut.data.status} — $${Number(testMut.data.buying_power ?? 0).toLocaleString()}`
              : `✗ ${testMut.data.error}`}
          </span>
        )}
      </div>

      {svc.created_at && (
        <div className="text-xs text-gray-600 mt-2">
          Created {svc.created_at.replace('T', ' ').slice(0, 19)}
        </div>
      )}
    </div>
  )
}

// ── Create form ──────────────────────────────────────────────────────────────

function CreateServiceForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('alpaca')
  const [environment, setEnvironment] = useState('paper')
  const [apiKey, setApiKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [showKeys, setShowKeys] = useState(false)

  const createMut = useMutation({
    mutationFn: (data: DataServiceCreate) => servicesApi.create(data),
    onSuccess: onCreated,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMut.mutate({
      name: name.trim(),
      provider,
      environment,
      api_key: apiKey,
      secret_key: secretKey,
      is_default: isDefault,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="card border border-sky-900/50 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200">New Data Service</h2>
        <button type="button" className="text-gray-500 hover:text-gray-300" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Name</label>
          <input className="input w-full" value={name} onChange={e => setName(e.target.value)} placeholder="My Alpaca Data" required />
        </div>
        <div>
          <label className="label">Provider</label>
          <SelectMenu
            value={provider}
            onChange={setProvider}
            options={PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
          />
        </div>
        <div>
          <label className="label">Environment</label>
          <SelectMenu
            value={environment}
            onChange={setEnvironment}
            options={ENVIRONMENTS.map(e => ({ value: e.value, label: e.label }))}
          />
        </div>
      </div>

      {provider === 'alpaca' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">API Key</label>
            <div className="relative">
              <input
                className="input w-full pr-8 font-mono"
                type={showKeys ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="PK..."
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                onClick={() => setShowKeys(!showKeys)}
              >
                {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Secret Key</label>
            <input
              className="input w-full font-mono"
              type={showKeys ? 'text' : 'password'}
              value={secretKey}
              onChange={e => setSecretKey(e.target.value)}
              placeholder="Secret..."
              autoComplete="off"
            />
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
        <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
        Set as default data service
      </label>

      {createMut.isError && (
        <div className="text-xs text-red-400">{(createMut.error as Error).message}</div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost text-sm" onClick={onClose}>Cancel</button>
        <button
          type="submit"
          className="btn-primary text-sm flex items-center gap-1"
          disabled={createMut.isPending || !name.trim()}
        >
          <Plus size={14} /> {createMut.isPending ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  )
}

// ── Edit form (inline) ───────────────────────────────────────────────────────

function EditServiceCard({ service: svc, onClose, onSaved }: {
  service: DataServiceRecord
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(svc.name)
  const [provider, setProvider] = useState(svc.provider)
  const [environment, setEnvironment] = useState(svc.environment)
  const [apiKey, setApiKey] = useState(svc.api_key)
  const [secretKey, setSecretKey] = useState(svc.secret_key)
  const [isActive, setIsActive] = useState(svc.is_active)
  const [showKeys, setShowKeys] = useState(false)

  const updateMut = useMutation({
    mutationFn: () => servicesApi.update(svc.id, {
      name: name.trim(),
      provider,
      environment,
      api_key: apiKey,
      secret_key: secretKey,
      is_active: isActive,
    }),
    onSuccess: onSaved,
  })

  return (
    <div className="card border border-indigo-800/50 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-indigo-300">Editing: {svc.name}</h2>
        <button className="text-gray-500 hover:text-gray-300" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">Name</label>
          <input className="input w-full" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Provider</label>
          <SelectMenu
            value={provider}
            onChange={setProvider}
            options={PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
          />
        </div>
        <div>
          <label className="label">Environment</label>
          <SelectMenu
            value={environment}
            onChange={setEnvironment}
            options={ENVIRONMENTS.map(e => ({ value: e.value, label: e.label }))}
          />
        </div>
      </div>

      {provider === 'alpaca' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">API Key</label>
            <div className="relative">
              <input
                className="input w-full pr-8 font-mono"
                type={showKeys ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                onClick={() => setShowKeys(!showKeys)}
              >
                {showKeys ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Secret Key</label>
            <input
              className="input w-full font-mono"
              type={showKeys ? 'text' : 'password'}
              value={secretKey}
              onChange={e => setSecretKey(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
        Service is active
      </label>

      {updateMut.isError && (
        <div className="text-xs text-red-400">{(updateMut.error as Error).message}</div>
      )}

      <div className="flex justify-end gap-2">
        <button className="btn-ghost text-sm" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary text-sm flex items-center gap-1"
          onClick={() => updateMut.mutate()}
          disabled={updateMut.isPending || !name.trim()}
        >
          <Check size={14} /> {updateMut.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
