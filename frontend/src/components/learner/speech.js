import { useCallback, useEffect, useRef, useState } from 'react'
import { tts } from '../../lib/learnerApi'

const BCP47 = { en: 'en-US', ur: 'ur-PK' }

export const speechLocale = (lang) => BCP47[lang] || 'en-US'

/**
 * Text-to-speech. Prefers the server ElevenLabs endpoint (cached server-side),
 * falls back to the free browser speechSynthesis when TTS fails or is disabled.
 */
export function useTts({ enabled = true, language = 'en' } = {}) {
  const [speaking, setSpeaking] = useState(false)
  const audioRef = useRef(null)
  const cancelledRef = useRef(false)

  const stop = useCallback(() => {
    cancelledRef.current = true
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    setSpeaking(false)
  }, [])

  const speak = useCallback(
    async (text, langOverride) => {
      if (!text || !enabled) return
      stop()
      cancelledRef.current = false
      setSpeaking(true)
      const lang = langOverride || language

      try {
        const blob = await tts(text, lang)
        if (cancelledRef.current) return
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => {
          URL.revokeObjectURL(url)
          setSpeaking(false)
        }
        audio.onerror = () => {
          URL.revokeObjectURL(url)
          setSpeaking(false)
        }
        await audio.play()
        return
      } catch {
        // Server TTS unavailable — fall through to browser synthesis.
      }

      if (cancelledRef.current) return
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        const utterance = new window.SpeechSynthesisUtterance(text)
        utterance.lang = speechLocale(lang)
        utterance.onend = () => setSpeaking(false)
        utterance.onerror = () => setSpeaking(false)
        window.speechSynthesis.speak(utterance)
      } else {
        setSpeaking(false)
      }
    },
    [enabled, language, stop],
  )

  useEffect(() => () => stop(), [stop])

  return { speak, stop, speaking }
}

/**
 * Web Speech API recognition (webkitSpeechRecognition). Degrades to a no-op
 * when the browser does not support it (mic button will report unsupported).
 */
export function useSpeechRecognition({ language = 'en-US', onFinalResult } = {}) {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recognitionRef = useRef(null)
  const onFinalRef = useRef(onFinalResult)
  onFinalRef.current = onFinalResult

  const supported =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        /* already stopped */
      }
    }
    setListening(false)
  }, [])

  const start = useCallback(() => {
    if (!supported) return
    stop()
    setTranscript('')
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)()
    recognition.lang = language
    recognition.interimResults = true
    recognition.maxAlternatives = 3
    recognition.continuous = false

    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (result.isFinal) finalText += result[0].transcript
        else interimText += result[0].transcript
      }
      setTranscript(finalText || interimText)
      if (finalText && onFinalRef.current) onFinalRef.current(finalText.trim())
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)

    recognitionRef.current = recognition
    setListening(true)
    try {
      recognition.start()
    } catch {
      setListening(false)
    }
  }, [language, stop, supported])

  useEffect(() => () => stop(), [stop])

  return { supported: Boolean(supported), listening, transcript, start, stop }
}

const normalize = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
}

/**
 * Maps a spoken transcript to one of the provided choices.
 * `choices` are plain strings (option texts); returns the matched index or null.
 * Strategies: spoken option letter ("option b" / "b"), spoken number or number
 * word ("option 2", "second"), then fuzzy containment / word-overlap on text.
 */
export function matchSpokenChoice(transcript, choices) {
  const said = normalize(transcript)
  if (!said || !choices.length) return null

  // 1. Spoken option letter: "option b", "choice b", or a bare letter a-d.
  const letterMatch = said.match(/(?:option|choice|answer)\s+([a-z])\b/) ||
    (said.length === 1 ? [null, said] : null)
  if (letterMatch) {
    const idx = choices.findIndex((_, i) => String.fromCharCode(97 + i) === letterMatch[1])
    if (idx >= 0) return idx
  }

  // 2. Spoken number: digit or number word, optionally after "option".
  const numMatch = said.match(/(?:option|choice|number)?\s*(\d+)\b/) ||
    Object.keys(NUMBER_WORDS).reduce(
      (acc, word) =>
        acc || (new RegExp(`\\b${word}\\b`).test(said) ? [null, String(NUMBER_WORDS[word])] : null),
      null,
    )
  if (numMatch) {
    const idx = Number(numMatch[1]) - 1
    if (idx >= 0 && idx < choices.length) return idx
  }

  // 3. Fuzzy text match: longest option text contained in the transcript, else
  // best word-overlap score above a threshold.
  const saidWords = new Set(normalize(said).split(' '))
  let bestIdx = null
  let bestScore = 0
  choices.forEach((choice, i) => {
    const text = normalize(choice)
    if (text && said.includes(text)) {
      bestScore = text.length
      bestIdx = i
      return
    }
    const words = text.split(' ').filter(Boolean)
    const overlap = words.filter((w) => saidWords.has(w)).length
    const score = words.length ? overlap / words.length : 0
    if (overlap >= 2 && score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  })
  return bestIdx
}
