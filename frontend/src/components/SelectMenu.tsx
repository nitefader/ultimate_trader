import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import clsx from 'clsx'

export interface SelectMenuOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectMenuProps {
  value: string
  options: SelectMenuOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function SelectMenu({
  value,
  options,
  onChange,
  placeholder = 'Select an option',
  className,
  disabled = false,
}: SelectMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  )

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!selectedOption && value) {
      setOpen(false)
    }
  }, [selectedOption, value])

  return (
    <div
      ref={rootRef}
      className={clsx('relative', className)}
      data-pause-polling="true"
    >
      <button
        type="button"
        className={clsx(
          'input w-full flex items-center justify-between gap-3 text-left',
          disabled && 'opacity-50 cursor-not-allowed',
          open && 'border-sky-500',
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        role="combobox"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current)
          }
        }}
      >
        <span className={clsx(!selectedOption && 'text-gray-400')}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown
          size={16}
          className={clsx(
            'flex-shrink-0 text-gray-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 shadow-xl"
        >
          {options.map((option) => {
            const isSelected = option.value === value

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                className={clsx(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors',
                  option.disabled
                    ? 'cursor-not-allowed text-gray-600'
                    : 'text-gray-100 hover:bg-gray-800',
                  isSelected && 'bg-sky-950/40 text-sky-200',
                )}
                onClick={() => {
                  if (option.disabled) return
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {isSelected && <Check size={14} className="flex-shrink-0 text-sky-400" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
