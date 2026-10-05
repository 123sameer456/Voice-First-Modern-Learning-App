import { useSpeechRecognition } from './speech'

/**
 * Mic-first overlay: floating mic button + heard-transcript panel.
 * The player owns TTS auto-read (via useTts) and transcript→choice mapping
 * (via matchSpokenChoice); this component visualizes listening state.
 */
export default function VoiceOverlay({ recognition, languageLabel = 'English' }) {
  if (!recognition) return null
  const { supported, listening, transcript, start, stop } = recognition

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center pb-6">
      {listening && (
        <div className="pointer-events-auto mb-3 flex max-w-md items-center gap-3 rounded-2xl bg-slate-800/90 px-5 py-3 text-white shadow-card backdrop-blur">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-sky-400" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-sky-200">
              Listening ({languageLabel})
            </p>
            <p className="max-w-xs truncate text-sm">{transcript || 'Say an option number or its text…'}</p>
          </div>
        </div>
      )}
      {supported ? (
        <button
          type="button"
          onClick={() => (listening ? stop() : start())}
          aria-label={listening ? 'Stop microphone' : 'Start microphone'}
          className={`pointer-events-auto relative flex h-16 w-16 items-center justify-center rounded-full shadow-card transition ${
            listening
              ? 'bg-sky-600 text-white'
              : 'bg-white text-sky-600 ring-1 ring-sky-200 hover:bg-sky-50'
          }`}
        >
          {listening && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-40" />
          )}
          <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" stroke="currentColor" strokeWidth="2">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 18.75a6 6 0 0 0 6-6v-3m0 3a6 6 0 0 1-12 0m12 0h2m-14 0H4m8 9v3m0 0h4m-4 0H8"
            />
            <rect x="9" y="2.5" width="6" height="11.5" rx="3" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <span className="pointer-events-auto rounded-full bg-white px-4 py-2 text-xs text-slate-400 ring-1 ring-sky-100">
          Voice input not supported in this browser — use tap inputs below.
        </span>
      )}
    </div>
  )
}
