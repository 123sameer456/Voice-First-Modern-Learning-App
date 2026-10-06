import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getJourney,
  getJourneySource,
  getVoiceConfig,
  studyChat,
  tts,
} from '../../lib/learnerApi'
import { useAuth } from '../../context/AuthContext'
import InfoTip from '../../components/InfoTip'
import { speechLocale, useSpeechRecognition, useTts } from '../../components/learner/speech'

const SOURCE_TYPE_BADGE = {
  topic: 'bg-sky-100 text-sky-700',
  document: 'bg-violet-100 text-violet-700',
  url: 'bg-amber-100 text-amber-700',
}

// Keep each spoken part under the server's MAX_TTS_CHARS (2000) cost guard.
const LISTEN_CHUNK_CHARS = 1200

/** Hard-split an oversized paragraph at word boundaries. */
export function hardSplit(text, target) {
  const pieces = []
  let rest = String(text || '')
  while (rest.length > target) {
    let cut = rest.lastIndexOf(' ', target)
    if (cut < target * 0.5) cut = target
    pieces.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) pieces.push(rest)
  return pieces
}

/** Split raw source text into speakable parts at paragraph boundaries. */
export function buildListenChunks(text, target = LISTEN_CHUNK_CHARS) {
  const paragraphs = String(text || '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const chunks = []
  let current = ''
  const pushCurrent = () => {
    if (current) chunks.push(current)
    current = ''
  }
  for (const paragraph of paragraphs) {
    // Oversized single paragraph: hard-split at word boundaries.
    if (paragraph.length > target) {
      pushCurrent()
      const pieces = hardSplit(paragraph, target)
      chunks.push(...pieces.slice(0, -1))
      current = pieces[pieces.length - 1]
      continue
    }
    if (current && current.length + paragraph.length + 1 > target) {
      pushCurrent()
    }
    current = current ? `${current}\n${paragraph}` : paragraph
  }
  pushCurrent()
  return chunks
}

/**
 * Pack AI-cleaned sections into speakable parts.
 * - Parts never cross a section boundary.
 * - The section heading is spoken once, at the start of its first part.
 * - `texts` holds the displayed paragraphs each part covers (highlighting).
 */
export function buildSectionParts(sections, target = LISTEN_CHUNK_CHARS) {
  const parts = []
  for (const sec of Array.isArray(sections) ? sections : []) {
    const heading = String(sec?.heading || '').trim()
    const paragraphs = (Array.isArray(sec?.paragraphs) ? sec.paragraphs : [])
      .map((p) => String(p || '').trim())
      .filter(Boolean)
    if (!paragraphs.length) continue

    let headingPending = heading
    let current = null
    const flush = () => {
      if (current) parts.push(current)
      current = null
    }
    const startPart = (text) => {
      flush()
      current = {
        heading: headingPending,
        texts: [text],
        spoken: headingPending ? `${headingPending}.\n${text}` : text,
      }
      headingPending = ''
    }
    for (const para of paragraphs) {
      if (para.length > target) {
        // Oversized paragraph: its hard-split pieces stand alone. Reserve room
        // for the heading prefix on the first piece so spoken stays ≤ target.
        flush()
        const firstTarget = headingPending
          ? Math.max(200, target - headingPending.length - 2)
          : target
        for (const piece of hardSplit(para, firstTarget)) {
          parts.push({
            heading: headingPending,
            texts: [piece],
            spoken: headingPending ? `${headingPending}.\n${piece}` : piece,
          })
          headingPending = ''
        }
        continue
      }
      if (current && current.spoken.length + para.length + 1 <= target) {
        current.texts.push(para)
        current.spoken += `\n${para}`
      } else {
        startPart(para)
      }
    }
    flush()
  }
  return parts
}

export default function StudyMode() {
  const { id } = useParams()
  const { user } = useAuth()

  const [journey, setJourney] = useState(null)
  const [source, setSource] = useState(null)
  const [voiceConfig, setVoiceConfig] = useState(null)
  const [loadError, setLoadError] = useState('')

  // stage: reading | chat
  const [stage, setStage] = useState('reading')

  // --- Listen (AI-cleaned material, TTS cached server-side) ---
  // With AI-cleaned sections, parts come from the structured content (junk
  // removed); otherwise the raw text is chunked as before.
  const parts = useMemo(
    () =>
      source?.sections?.length
        ? buildSectionParts(source.sections)
        : buildListenChunks(source?.text).map((t) => ({ heading: '', texts: [t], spoken: t })),
    [source?.sections, source?.text],
  )
  const displayBlocks = useMemo(
    () =>
      parts.flatMap((p, i) => [
        ...(p.heading ? [{ kind: 'h', text: p.heading, part: i }] : []),
        ...p.texts.map((t) => ({ kind: 'p', text: t, part: i })),
      ]),
    [parts],
  )
  const audioRef = useRef(null)
  const sessionRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [chunkIndex, setChunkIndex] = useState(0)
  const [listenError, setListenError] = useState('')

  // --- Two-way voice conversation ---
  const [messages, setMessages] = useState([]) // {role: 'tutor'|'user', text}
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState('')
  const [draft, setDraft] = useState('')
  const [handsFree, setHandsFree] = useState(true)
  const threadRef = useRef(null)
  const autoListenRef = useRef(0)

  const lang = voiceConfig?.language || user?.profile?.language_pref || 'en'
  const ttsEnabled = voiceConfig ? voiceConfig.enabled !== false : true
  const { speak, stop: stopSpeaking, speaking } = useTts({ enabled: ttsEnabled, language: lang })

  // --- data loading ---
  useEffect(() => {
    let cancelled = false
    getVoiceConfig().then((cfg) => !cancelled && setVoiceConfig(cfg)).catch(() => {})
    Promise.allSettled([getJourney(id), getJourneySource(id)]).then(([j, s]) => {
      if (cancelled) return
      if (j.status === 'fulfilled') setJourney(j.value)
      if (s.status === 'fulfilled') setSource(s.value)
      if (j.status !== 'fulfilled' && s.status !== 'fulfilled') {
        setLoadError(j.reason?.message || s.reason?.message || 'Failed to load study material.')
      }
    })
    return () => {
      cancelled = true
    }
  }, [id])

  const stopAudio = useCallback(() => {
    sessionRef.current += 1 // invalidate in-flight loads
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }, [])

  useEffect(
    () => () => {
      stopAudio()
      stopSpeaking()
    },
    [stopAudio, stopSpeaking],
  )

  // --- chunked playback (Play / Pause / Resume / Stop) ---
  const playFrom = useCallback(
    async (index) => {
      if (index < 0 || index >= parts.length) {
        stopAudio()
        setPlaying(false)
        setPaused(false)
        setChunkIndex(0)
        return
      }
      stopAudio()
      setListenError('')
      setPlaying(true)
      setPaused(false)
      setChunkIndex(index)
      const token = sessionRef.current
      try {
        const blob = await tts(parts[index].spoken, lang)
        if (token !== sessionRef.current) return
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => {
          URL.revokeObjectURL(url)
          if (token === sessionRef.current) playFrom(index + 1)
        }
        audio.onerror = () => {
          URL.revokeObjectURL(url)
          if (token === sessionRef.current) {
            setPlaying(false)
            setListenError('Audio playback failed.')
          }
        }
        await audio.play()
      } catch (err) {
        if (token !== sessionRef.current) return
        setPlaying(false)
        setPaused(false)
        setListenError(err?.message || 'Could not generate audio — check voice settings.')
      }
    },
    [parts, lang, stopAudio],
  )

  const pauseListen = () => {
    if (audioRef.current) audioRef.current.pause()
    setPaused(true)
  }

  const resumeListen = () => {
    if (audioRef.current) {
      audioRef.current.play()
      setPaused(false)
    } else {
      playFrom(chunkIndex)
    }
  }

  const stopListen = () => {
    stopAudio()
    setPlaying(false)
    setPaused(false)
    setChunkIndex(0)
  }

  // --- conversation ---
  const sendTurn = useCallback(
    async (rawText) => {
      const text = String(rawText || '').trim()
      // Empty input is only allowed as the very first (opener) turn.
      if (!text && messages.length > 0) return
      const base = text ? [...messages, { role: 'user', text }] : messages
      if (text) setMessages(base)
      setChatLoading(true)
      setChatError('')
      stopSpeaking()
      stopAudio()
      try {
        const data = await studyChat(id, {
          messages: base.slice(-16).map((m) => ({ role: m.role, text: m.text })),
          language: lang,
        })
        setMessages((prev) => [...prev, { role: 'tutor', text: data.reply }])
        if (ttsEnabled) speak(data.reply, lang)
      } catch (err) {
        setChatError(err.message || 'The tutor could not reply — try again.')
      } finally {
        setChatLoading(false)
      }
    },
    [id, lang, messages, speak, stopAudio, stopSpeaking, ttsEnabled],
  )

  const openConversation = () => {
    stopAudio()
    setStage('chat')
    if (messages.length === 0 && !chatLoading) sendTurn('')
  }

  const endConversation = () => {
    stopSpeaking()
    recognition.stop()
    setStage('reading')
  }

  const clearConversation = () => {
    if (!window.confirm('Drop this conversation? The thread will be cleared.')) return
    stopSpeaking()
    recognition.stop()
    setMessages([])
    setChatError('')
    autoListenRef.current = 0
    setStage('reading')
  }

  const recognition = useSpeechRecognition({
    language: speechLocale(lang),
    onFinalResult: (text) => sendTurn(text),
  })

  // Hands-free: after the tutor finishes a reply, listen again automatically.
  useEffect(() => {
    if (stage !== 'chat' || !handsFree) return
    if (!recognition.supported || recognition.listening) return
    if (speaking || chatLoading) return
    if (messages.length === 0 || autoListenRef.current === messages.length) return
    autoListenRef.current = messages.length
    recognition.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, handsFree, speaking, chatLoading, messages.length])

  // Keep the thread scrolled to the newest turn.
  useEffect(() => {
    const el = threadRef.current
    if (el && stage === 'chat') el.scrollTop = el.scrollHeight
  }, [messages.length, chatLoading, stage])

  // --- loading / error states ---
  if (loadError) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-card ring-1 ring-sky-100">
        <p className="font-medium text-red-600">{loadError}</p>
        <Link to="/app" className="mt-3 inline-block text-sm font-medium text-sky-700 hover:underline">
          ← Back to home
        </Link>
      </div>
    )
  }

  if (!journey || !source) {
    return <div className="h-64 animate-pulse rounded-2xl bg-white/70" />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/app/journeys/${journey.id}`} className="text-xs font-medium text-sky-600 hover:underline">
            ← {journey.title}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-800">Learn: {source.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Read (or listen to) the material, then talk it through with your AI tutor.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
          {lang === 'ur' ? 'اردو' : 'English'} voice
        </span>
      </header>

      {/* ------------------------------------------------ READING VIEW */}
      {stage === 'reading' && (
        <section className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-sky-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${SOURCE_TYPE_BADGE[source.type] || 'bg-slate-100 text-slate-600'}`}>
                {source.type}
              </span>
              {source.sections?.length > 0 && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                  ✨ AI-tidied
                </span>
              )}
              <h2 className="flex items-center text-base font-semibold text-slate-800">
                Study material
                <InfoTip tip="The actual content your course was built from — cleaned by AI (junk like site menus and page numbers removed). Press ▶ Listen to have it read aloud; the paragraph being spoken is highlighted. When you’re ready, start the voice conversation below."
                />
              </h2>
            </div>
            {/* Listen controls */}
            <div className="flex flex-wrap items-center gap-2">
              {!playing && !paused && (
                <button
                  onClick={() => playFrom(0)}
                  disabled={parts.length === 0}
                  className="rounded-xl border border-sky-200 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-50 disabled:opacity-40"
                >
                  ▶ Listen
                </button>
              )}
              {playing && !paused && (
                <button
                  onClick={pauseListen}
                  className="rounded-xl border border-sky-200 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
                >
                  ⏸ Pause
                </button>
              )}
              {paused && (
                <button
                  onClick={resumeListen}
                  className="rounded-xl border border-sky-200 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
                >
                  ▶ Resume
                </button>
              )}
              {(playing || paused) && (
                <>
                  <button
                    onClick={() => playFrom(Math.max(0, chunkIndex - 1))}
                    disabled={chunkIndex === 0}
                    className="rounded-xl border border-sky-200 px-3 py-1.5 text-sm text-sky-700 transition hover:bg-sky-50 disabled:opacity-40"
                  >
                    ⏮ Prev
                  </button>
                  <button
                    onClick={stopListen}
                    className="rounded-xl border border-sky-200 px-3 py-1.5 text-sm text-sky-700 transition hover:bg-sky-50"
                  >
                    ⏹ Stop
                  </button>
                  <button
                    onClick={() => playFrom(Math.min(parts.length - 1, chunkIndex + 1))}
                    disabled={chunkIndex >= parts.length - 1}
                    className="rounded-xl border border-sky-200 px-3 py-1.5 text-sm text-sky-700 transition hover:bg-sky-50 disabled:opacity-40"
                  >
                    Next ⏭
                  </button>
                </>
              )}
              {(playing || paused) && (
                <span className="text-xs text-slate-400">
                  Part {chunkIndex + 1} of {parts.length}
                </span>
              )}
            </div>
          </div>

          {listenError && (
            <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-700">{listenError}</p>
          )}
          {!ttsEnabled && (
            <p className="mt-3 rounded-xl bg-slate-50 px-4 py-2 text-xs text-slate-500">
              Voice is currently disabled in settings — you can still read below.
            </p>
          )}

          {/* Reading pane — headed sections, with spoken-part highlight */}
          <div className="mt-4 max-h-[28rem] space-y-3 overflow-y-auto rounded-xl bg-slate-50/70 p-5 text-sm leading-relaxed text-slate-700">
            {displayBlocks.map((b, i) =>
              b.kind === 'h' ? (
                <h3 key={i} className="pt-2 text-sm font-bold text-sky-800 first:pt-0">
                  {b.text}
                </h3>
              ) : (
                <p
                  key={i}
                  className={`whitespace-pre-line rounded-lg px-2 transition ${
                    playing && !paused && b.part === chunkIndex ? 'bg-sky-100/80' : ''
                  }`}
                >
                  {b.text}
                </p>
              ),
            )}
            {displayBlocks.length === 0 && (
              <p className="text-slate-400">No study material available for this journey.</p>
            )}
          </div>

          {/* Primary actions */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {messages.length === 0 ? (
              <button
                onClick={openConversation}
                className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
              >
                🎤 Start voice conversation
              </button>
            ) : (
              <>
                <button
                  onClick={openConversation}
                  className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
                >
                  💬 Continue conversation
                </button>
                <button
                  onClick={clearConversation}
                  className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                >
                  Drop conversation
                </button>
              </>
            )}
            <Link
              to={`/app/journeys/${journey.id}`}
              className="rounded-xl border border-sky-200 px-5 py-2.5 text-sm font-semibold text-sky-700 transition hover:bg-sky-50"
            >
              Skip — start the test →
            </Link>
          </div>
        </section>
      )}

      {/* ------------------------------------------------ CONVERSATION VIEW */}
      {stage === 'chat' && (
        <section className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-sky-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex flex-wrap items-center text-base font-semibold text-slate-800">
              Voice conversation{' '}
              {speaking && <span className="text-xs font-normal text-sky-600">🔊 tutor is speaking…</span>}
              <InfoTip tip="Two-way voice tutoring: ask anything about the material, or attempt an answer — the tutor motivates you when you’re right and patiently teaches the concept when you’re wrong. Hands-free mode listens again automatically after every tutor reply."
              />
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {recognition.supported && (
                <button
                  onClick={() => setHandsFree(!handsFree)}
                  title="Hands-free: the mic reopens automatically after each tutor reply, like a phone call."
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                    handsFree ? 'bg-emerald-50 text-emerald-700' : 'border border-sky-200 text-sky-700 hover:bg-sky-50'
                  }`}
                >
                  🎧 Hands-free {handsFree ? 'on' : 'off'}
                </button>
              )}
              <button
                onClick={endConversation}
                className="rounded-xl border border-sky-200 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-50"
              >
                ← Material
              </button>
              <button
                onClick={clearConversation}
                className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
              >
                Drop
              </button>
            </div>
          </div>

          {/* Thread */}
          <div
            ref={threadRef}
            className="mt-4 max-h-[26rem] space-y-3 overflow-y-auto rounded-xl bg-slate-50/70 p-5"
          >
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <p
                  className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm ${
                    m.role === 'user'
                      ? 'bg-sky-600 text-white'
                      : 'bg-white text-slate-700 ring-1 ring-sky-100'
                  }`}
                >
                  {m.text}
                </p>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <span className="flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm text-slate-400 ring-1 ring-sky-100">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
                  Tutor is thinking…
                </span>
              </div>
            )}
            {messages.length === 0 && !chatLoading && (
              <p className="py-6 text-center text-sm text-slate-400">
                Press the mic (or type below) to start talking with your tutor — ask anything about the
                material.
              </p>
            )}
          </div>

          {chatError && (
            <p className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{chatError}</p>
          )}

          {/* Voice + text controls */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {recognition.supported ? (
              <button
                onClick={() => (recognition.listening ? recognition.stop() : recognition.start())}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
                  recognition.listening
                    ? 'bg-sky-600 text-white'
                    : 'border border-sky-200 text-sky-700 hover:bg-sky-50'
                }`}
              >
                {recognition.listening ? '⏹ Stop mic' : '🎙 Speak'}
              </button>
            ) : (
              <span className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-400">
                Voice input not supported in this browser — type below.
              </span>
            )}
            {recognition.listening && (
              <span className="max-w-xs truncate text-xs text-slate-400">
                {recognition.transcript || 'Listening…'}
              </span>
            )}
            <Link
              to={`/app/journeys/${journey.id}`}
              className="ml-auto rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-50"
            >
              📝 Start the test →
            </Link>
          </div>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="…or type your question / answer to the tutor"
            className="mt-3 w-full rounded-xl border border-sky-200 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
          />
          <button
            onClick={() => {
              const text = draft
              setDraft('')
              sendTurn(text)
            }}
            disabled={!draft.trim() || chatLoading}
            className="mt-2 rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
          >
            Send
          </button>
        </section>
      )}
    </div>
  )
}
