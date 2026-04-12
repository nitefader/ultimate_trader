import React, { useEffect, useRef } from 'react'
import clsx from 'clsx'

interface ConfirmationModalProps {
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'default'
  isPending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmationModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onCancel()
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="card w-full max-w-md space-y-4 p-6">
        <h3 className={clsx(
          'text-sm font-semibold',
          variant === 'danger' && 'text-red-400',
          variant === 'warning' && 'text-amber-400',
          variant === 'default' && 'text-gray-100',
        )}>{title}</h3>
        <div className="text-sm text-gray-300">{message}</div>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-ghost text-sm" onClick={onCancel} disabled={isPending}>
            {cancelLabel}
          </button>
          <button
            className={clsx(
              'text-sm px-4 py-2 rounded font-medium transition',
              variant === 'danger' && 'btn-danger',
              variant === 'warning' && 'bg-amber-700 hover:bg-amber-600 text-white',
              variant === 'default' && 'btn-primary',
            )}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
