/**
 * Tooltip — pure CSS hover tooltip, zero mouse/focus events.
 *
 * Zero React state, zero event handlers → cannot cause re-renders or
 * trigger the Windows/Chromium focus-event flash.
 *
 * The wrapper span is `inline-flex align-top` by default so it shrink-wraps
 * inline children (buttons, links, badges) without adding extra baseline gap.
 * Pass className="block" when wrapping block-level children (divs, etc.)
 * so the wrapper doesn't force them inline.
 *
 * Usage:
 *   <Tooltip content="tip text">
 *     <button>hover me</button>
 *   </Tooltip>
 *
 *   <Tooltip content="tip" className="block">
 *     <div>block child</div>
 *   </Tooltip>
 *
 *   <Tooltip content="tip" side="right">…</Tooltip>
 */
import React from 'react'
import clsx from 'clsx'

export interface TooltipProps {
  /** Tooltip text. Falsy → children rendered as-is, no wrapper. */
  content?: string | null
  /** Which side the bubble appears on. Default: 'top'. */
  side?: 'top' | 'bottom' | 'left' | 'right'
  /**
   * Extra classes on the wrapper span.
   * Use "block" when the child is a block-level element (div, etc.)
   * Use "inline-block" for fixed-size children like colored squares.
   * Default behaviour is "inline-flex align-top" which suits buttons/links.
   */
  className?: string
  children: React.ReactNode
}

const BUBBLE_POS: Record<string, string> = {
  top:    'bottom-full left-1/2 -translate-x-1/2 pb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 pt-1.5',
  left:   'right-full top-1/2 -translate-y-1/2 pr-1.5',
  right:  'left-full top-1/2 -translate-y-1/2 pl-1.5',
}

export function Tooltip({ content, side = 'top', className, children }: TooltipProps) {
  if (!content) return <>{children}</>

  // If the caller passes a display class (block / inline-block / flex / …) we
  // honour it directly. Otherwise default to inline-flex align-top which
  // shrink-wraps inline children without a baseline gap.
  const hasDisplayClass = className
    ? /\b(block|inline-block|inline|flex|grid|contents)\b/.test(className)
    : false

  return (
    <span
      className={clsx(
        'group relative',
        !hasDisplayClass && 'inline-flex align-top',
        className,
      )}
    >
      {children}
      <span
        role="tooltip"
        aria-hidden="true"
        className={clsx(
          'pointer-events-none absolute z-[9999]',
          BUBBLE_POS[side],
          // sizing — wraps long text cleanly
          'w-max max-w-[14rem] whitespace-normal',
          // appearance
          'rounded border border-gray-700 bg-gray-950',
          'px-2 py-1 text-xs leading-snug text-gray-200',
          'shadow-xl shadow-black/60',
          // CSS-only visibility
          'opacity-0 group-hover:opacity-100 transition-opacity duration-100',
        )}
      >
        {content}
      </span>
    </span>
  )
}
