import React, { useRef, useState } from 'react'
import { adminApi } from '../api/admin'
import { Download, Upload, ShieldAlert, CheckCircle, AlertTriangle } from 'lucide-react'

export function BackupRestore() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<{ status: string; bytes: number; message: string } | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadError(null)
    try {
      await adminApi.downloadBackup()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Download failed'
      setDownloadError(msg)
    } finally {
      setDownloading(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setRestoreResult(null)
    setRestoreError(null)
    setPendingFile(file)
    setConfirmRestore(true)
    e.target.value = ''
  }

  const handleRestoreConfirm = async () => {
    if (!pendingFile) return
    setRestoring(true)
    setConfirmRestore(false)
    try {
      const result = await adminApi.restore(pendingFile)
      setRestoreResult(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Restore failed'
      setRestoreError(msg)
    } finally {
      setRestoring(false)
      setPendingFile(null)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-gray-100">Backup &amp; Restore</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Download a snapshot of your database or restore from a previous backup.
        </p>
      </div>

      {/* Backup card */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <Download size={15} className="text-sky-400" />
          <h2 className="text-sm font-semibold text-gray-200">Download Backup</h2>
        </div>
        <p className="text-xs text-gray-400">
          Downloads the current SQLite database file. Includes all strategies, backtests, accounts, deployments,
          programs, and settings. File is timestamped — keep multiple copies.
        </p>
        {downloadError && (
          <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">
            {downloadError}
          </div>
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60"
        >
          <Download size={14} />
          {downloading ? 'Preparing download…' : 'Download Backup'}
        </button>
      </div>

      {/* Restore card */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <Upload size={15} className="text-amber-400" />
          <h2 className="text-sm font-semibold text-gray-200">Restore from Backup</h2>
        </div>
        <div className="flex items-start gap-2 bg-amber-950/20 border border-amber-900/40 rounded px-3 py-2">
          <ShieldAlert size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200">
            This replaces the <strong>entire database</strong>. All current data is overwritten.
            A pre-restore backup is automatically saved server-side before replacing.
            The server must be restarted after restore to reinitialize DB connections.
          </p>
        </div>

        {restoreResult && (
          <div className="flex items-start gap-2 bg-emerald-950/20 border border-emerald-900/40 rounded px-3 py-2">
            <CheckCircle size={14} className="text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-200">
              <p className="font-semibold">Restore successful</p>
              <p className="text-emerald-300/70 mt-0.5">{restoreResult.message}</p>
              <p className="text-emerald-300/50 mt-0.5">{(restoreResult.bytes / 1024).toFixed(1)} KB written</p>
            </div>
          </div>
        )}

        {restoreError && (
          <div className="flex items-start gap-2 bg-red-950/20 border border-red-900/40 rounded px-3 py-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{restoreError}</p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".db"
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Confirm dialog */}
        {confirmRestore && pendingFile && (
          <div className="rounded border border-amber-700 bg-amber-950/30 px-4 py-3 space-y-3">
            <p className="text-sm text-amber-200">
              Replace current database with <span className="font-semibold text-white">{pendingFile.name}</span>?
            </p>
            <p className="text-xs text-amber-300/70">
              ({(pendingFile.size / 1024).toFixed(1)} KB) — This cannot be undone from the UI.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRestoreConfirm}
                className="text-xs px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white font-semibold"
              >
                Yes, Replace Database
              </button>
              <button
                type="button"
                onClick={() => { setConfirmRestore(false); setPendingFile(null) }}
                className="text-xs text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!confirmRestore && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring}
            className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-60"
          >
            <Upload size={14} />
            {restoring ? 'Restoring…' : 'Select Backup File (.db)'}
          </button>
        )}
      </div>
    </div>
  )
}
