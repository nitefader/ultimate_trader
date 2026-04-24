import React, { useCallback, useRef, useState } from 'react'
import { Mic, MicOff, Loader2 } from 'lucide-react'

type SpeechState = 'idle' | 'listening' | 'error'

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  0?: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike extends Event {
  results: SpeechRecognitionResultLike[]
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => void) | null
  onerror: ((this: SpeechRecognitionLike, ev: Event) => void) | null
  onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null
  start(): void
  stop(): void
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function useSpeechInput(onTranscript: (text: string) => void) {
  const [state, setState] = useState<SpeechState>('idle')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const toggle = useCallback(() => {
    const SR = getSpeechRecognition()
    if (!SR) {
      setState('error')
      return
    }

    if (state === 'listening') {
      recognitionRef.current?.stop()
      setState('idle')
      return
    }

    const rec = new SR()
    rec.continuous = false
    rec.interimResults = false
    rec.lang = 'en-US'

    rec.onstart = () => setState('listening')
    rec.onresult = (e: SpeechRecognitionEventLike) => {
      const transcript = e.results[0]?.[0]?.transcript ?? ''
      if (transcript) onTranscript(transcript)
    }
    rec.onerror = () => setState('error')
    rec.onend = () => setState(s => s === 'listening' ? 'idle' : s)

    recognitionRef.current = rec
    rec.start()
  }, [state, onTranscript])

  return { state, toggle, supported: Boolean(getSpeechRecognition()) }
}

export function MicButton({
  onTranscript,
  className = '',
}: {
  onTranscript: (text: string) => void
  className?: string
}) {
  const { state, toggle, supported } = useSpeechInput(onTranscript)

  if (!supported) return null

  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={toggle}
      title={state === 'listening' ? 'Stop recording' : state === 'error' ? 'Mic unavailable' : 'Dictate'}
      className={[
        'shrink-0 flex items-center justify-center w-6 h-6 rounded transition-colors',
        state === 'listening' ? 'text-red-400 bg-red-950/40 animate-pulse' :
        state === 'error'     ? 'text-gray-600 cursor-not-allowed' :
                                'text-gray-500 hover:text-sky-400 hover:bg-sky-950/30',
        className,
      ].join(' ')}
    >
      {state === 'listening' ? <MicOff size={13} /> :
       state === 'error'     ? <Mic size={13} /> :
                               <Mic size={13} />}
    </button>
  )
}
