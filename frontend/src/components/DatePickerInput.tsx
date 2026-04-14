import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

interface DatePickerInputProps {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  className?: string
  placeholder?: string
  disabled?: boolean
}

const weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function parseDateValue(value?: string): Date | null {
  if (!value) return null
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function isDayDisabled(day: Date, min?: string, max?: string): boolean {
  const dayKey = toDateKey(day)
  if (min && dayKey < min) return true
  if (max && dayKey > max) return true
  return false
}

export function DatePickerInput({
  value,
  onChange,
  min,
  max,
  className,
  placeholder = 'Select date',
  disabled = false,
}: DatePickerInputProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedDate = useMemo(() => parseDateValue(value), [value])
  const [open, setOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState<Date>(
    () => startOfMonth(selectedDate ?? parseDateValue(max) ?? new Date()),
  )

  useEffect(() => {
    if (selectedDate) {
      setVisibleMonth(startOfMonth(selectedDate))
    }
  }, [selectedDate])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
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

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(visibleMonth))
    const end = endOfWeek(endOfMonth(visibleMonth))
    return eachDayOfInterval({ start, end })
  }, [visibleMonth])

  const prevMonthDisabled = useMemo(() => {
    if (!min) return false
    const prevMonth = subMonths(visibleMonth, 1)
    return toDateKey(endOfMonth(prevMonth)) < min
  }, [min, visibleMonth])

  const nextMonthDisabled = useMemo(() => {
    if (!max) return false
    const nextMonth = addMonths(visibleMonth, 1)
    return toDateKey(startOfMonth(nextMonth)) > max
  }, [max, visibleMonth])

  const todayKey = toDateKey(new Date())
  const canPickToday = !isDayDisabled(new Date(), min, max)

  return (
    <div ref={rootRef} className={clsx('relative', className)} data-pause-polling="true">
      <button
        type="button"
        className={clsx(
          'input flex w-full items-center justify-between gap-3 text-left',
          disabled && 'cursor-not-allowed opacity-50',
          open && 'border-sky-500',
        )}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current)
          }
        }}
      >
        <span className={clsx(!selectedDate && 'text-gray-400')}>
          {selectedDate ? toDateKey(selectedDate) : placeholder}
        </span>
        <CalendarDays size={16} className="flex-shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-[18rem] rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              className={clsx(
                'rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200',
                prevMonthDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-gray-400',
              )}
              disabled={prevMonthDisabled}
              onClick={() => setVisibleMonth((current) => subMonths(current, 1))}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="text-sm font-semibold text-gray-100">
              {format(visibleMonth, 'MMMM yyyy')}
            </div>
            <button
              type="button"
              className={clsx(
                'rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200',
                nextMonthDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-gray-400',
              )}
              disabled={nextMonthDisabled}
              onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wide text-gray-500">
            {weekdayLabels.map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const disabledDay = isDayDisabled(day, min, max)
              const selected = selectedDate ? isSameDay(day, selectedDate) : false
              const dayIsToday = isToday(day)

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={disabledDay}
                  className={clsx(
                    'flex h-9 items-center justify-center rounded text-sm transition-colors',
                    !isSameMonth(day, visibleMonth) && 'text-gray-600',
                    isSameMonth(day, visibleMonth) && 'text-gray-200',
                    dayIsToday && !selected && 'ring-1 ring-sky-800',
                    selected && 'bg-sky-600 text-white',
                    !selected && !disabledDay && 'hover:bg-gray-800',
                    disabledDay && 'cursor-not-allowed text-gray-700',
                  )}
                  onClick={() => {
                    onChange(toDateKey(day))
                    setOpen(false)
                  }}
                >
                  {format(day, 'd')}
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-gray-800 pt-3">
            <button
              type="button"
              className={clsx(
                'text-xs text-sky-400 transition-colors hover:text-sky-300',
                !canPickToday && 'cursor-not-allowed opacity-40 hover:text-sky-400',
              )}
              disabled={!canPickToday}
              onClick={() => {
                onChange(todayKey)
                setVisibleMonth(startOfMonth(new Date()))
                setOpen(false)
              }}
            >
              Use today
            </button>
            <button
              type="button"
              className="text-xs text-gray-500 transition-colors hover:text-gray-300"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
