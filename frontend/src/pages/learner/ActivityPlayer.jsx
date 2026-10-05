import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams, useParams } from 'react-router-dom'
import {
  getJourney,
  getPublishedJourneys,
  getVoiceConfig,
  submitActivity,
} from '../../lib/learnerApi'
import { useAuth } from '../../context/AuthContext'
import VoiceOverlay from '../../components/learner/VoiceOverlay'
import { matchSpokenChoice, speechLocale, useSpeechRecognition, useTts } from '../../components/learner/speech'
import { saveLocalCompleted } from './JourneyMap'

const OPTION_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f']

function buildHints(type, data) {
  if (!data) return []
  switch (type) {
    case 'scenario':
      return [
        'Read the scenario once more and focus on what is actually being asked.',
        'Rule out any option that ignores the problem or makes it worse.',
        'The safest, most professional option is usually the right call.',
      ]
    case 'puzzle':
      return data.mode === 'order'
        ? [
            data.instruction || 'Order the items from first to last.',
            'Ask yourself: what must happen before anything else?',
            'Sequences usually flow from prevention → detection → response.',
          ]
        : [
            data.instruction || 'Place every item into the right bucket.',
            `There ${data.buckets?.length === 1 ? 'is' : 'are'} ${data.buckets?.length || 0} bucket(s) — each item fits exactly one.`,
            'Start with the items you are most confident about.',
          ]
    case 'simulation':
      return [
        data.scenario || 'Step through the situation one decision at a time.',
        'Each step builds on the previous one — stay consistent.',
        'Pick the option that keeps people informed and documents the issue.',
      ]
    case 'mission':
      return [
        data.briefing || 'Complete the real-world task and report back.',
        data.success_criteria || 'Complete as many tasks as you realistically can.',
        'Start with the easiest task to build momentum.',
      ]
    default:
      return []
  }
}

function buildPromptSpeech(activity, simStep = 0) {
  const d = activity?.data || {}
  const readOptions = (options = []) =>
    options.map((o, i) => `Option ${i + 1}. ${o.text}`).join('. ')
  switch (activity?.type) {
    case 'scenario':
      return `${d.prompt}. ${readOptions(d.options)}`
    case 'puzzle':
      return d.mode === 'order'
        ? `${d.instruction || 'Put these items in order'}. ${d.items?.map((i) => i.text).join(', ')}.`
        : `${d.instruction || 'Sort the items'}. Buckets: ${d.buckets?.join(', ')}. Items: ${d.items?.map((i) => i.text).join(', ')}.`
    case 'simulation': {
      const step = d.steps?.[simStep]
      return step ? `${step.prompt}. ${readOptions(step.options)}` : ''
    }
    case 'mission':
      return `${d.briefing}. Tasks: ${d.tasks?.map((t, i) => `${i + 1}. ${t}`).join('. ')}`
    default:
      return ''
  }
}

function XpCountUp({ value = 0 }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (!value) return
    let raf
    const start = performance.now()
    const duration = 900
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - (1 - t) ** 3
      setDisplay(Math.round(value * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span>{display}</span>
}

function Stars({ value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`Confidence ${n} of 5`}
          className={`text-2xl transition ${n <= value ? 'text-amber-400 scale-110' : 'text-slate-200 hover:text-amber-200'}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

export default function ActivityPlayer() {
  const { activityId } = useParams()
  const [search] = useSearchParams()
  const journeyParam = search.get('journey')
  const { user } = useAuth()

  const [journey, setJourney] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [voiceConfig, setVoiceConfig] = useState(null)

  // answer state
  const [selectedOption, setSelectedOption] = useState(null)
  const [solutions, setSolutions] = useState({})
  const [selectedItemId, setSelectedItemId] = useState(null)
  const [simStep, setSimStep] = useState(0)
  const [simChoices, setSimChoices] = useState([])
  const [checkedTasks, setCheckedTasks] = useState(() => new Set())
  const [confidence, setConfidence] = useState(0)
  const [hints, setHints] = useState([])
  const [corrections, setCorrections] = useState(0)

  // submit state
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState(null)
  const startedAt = useRef(Date.now())

  // --- data loading ---
  useEffect(() => {
    let cancelled = false
    getVoiceConfig().then((cfg) => !cancelled && setVoiceConfig(cfg)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (journeyParam) {
          const data = await getJourney(journeyParam)
          if (!cancelled) setJourney(data)
          return
        }
        const list = await getPublishedJourneys()
        for (const j of list || []) {
          try {
            const detail = await getJourney(j.id)
            if (detail.activities?.some((a) => String(a.id) === String(activityId))) {
              if (!cancelled) setJourney(detail)
              return
            }
          } catch {
            /* keep searching */
          }
        }
        if (!cancelled) setLoadError('Activity not found in any published journey.')
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Failed to load activity.')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [activityId, journeyParam])

  const activity = journey?.activities?.find((a) => String(a.id) === String(activityId))
  const type = activity?.type
  const data = activity?.data || {}

  // reset per-activity state when the activity changes
  useEffect(() => {
    setSelectedOption(null)
    setSolutions({})
    setSelectedItemId(null)
    setSimStep(0)
    setSimChoices([])
    setCheckedTasks(new Set())
    setConfidence(0)
    setHints([])
    setCorrections(0)
    setResult(null)
    setSubmitError('')
    startedAt.current = Date.now()
  }, [activity?.id])

  const lang = voiceConfig?.language || user?.profile?.language_pref || 'en'
  const ttsEnabled = voiceConfig ? voiceConfig.enabled !== false : true
  const { speak, speaking, stop: stopSpeaking } = useTts({ enabled: ttsEnabled, language: lang })

  const optionChoices = useMemo(() => {
    if (type === 'scenario') return data.options || []
    if (type === 'simulation') return data.steps?.[simStep]?.options || []
    return []
  }, [type, data, simStep])

  // --- voice: transcript → choice mapping ---
  const handleVoiceResult = useCallback(
    (transcript) => {
      if (!activity || result) return
      if (type === 'scenario' || type === 'simulation') {
        const idx = matchSpokenChoice(
          transcript,
          optionChoices.map((o) => o.text),
        )
        if (idx != null) {
          const option = optionChoices[idx]
          if (type === 'scenario') {
            if (selectedOption && selectedOption !== option.id) setCorrections((c) => c + 1)
            setSelectedOption(option.id)
          } else {
            setSimChoices((prev) => {
              const next = [...prev]
              if (next[simStep] && next[simStep] !== option.id) setCorrections((c) => c + 1)
              next[simStep] = option.id
              return next
            })
          }
        }
        return
      }
      if (type === 'puzzle') {
        const items = data.items || []
        const buckets = data.buckets || []
        const itemTexts = items.map((i) => i.text)
        if (data.mode === 'order') {
          const idx = matchSpokenChoice(transcript, itemTexts)
          if (idx != null) {
            const item = items[idx]
            if (!solutions[item.id]) {
              const nextPos = Object.keys(solutions).length + 1
              setSolutions((s) => ({ ...s, [item.id]: nextPos }))
            }
          }
          return
        }
        // match mode: first utterance picks an item, second picks a bucket
        if (!selectedItemId) {
          const idx = matchSpokenChoice(transcript, itemTexts)
          if (idx != null) setSelectedItemId(items[idx].id)
        } else {
          const bIdx = matchSpokenChoice(transcript, buckets)
          if (bIdx != null) {
            const bucket = buckets[bIdx]
            if (solutions[selectedItemId] && solutions[selectedItemId] !== bucket) {
              setCorrections((c) => c + 1)
            }
            setSolutions((s) => ({ ...s, [selectedItemId]: bucket }))
            setSelectedItemId(null)
          }
        }
        return
      }
      if (type === 'mission') {
        const idx = matchSpokenChoice(transcript, data.tasks || [])
        if (idx != null) {
          const task = data.tasks[idx]
          setCheckedTasks((prev) => {
            const next = new Set(prev)
            if (next.has(task)) next.delete(task)
            else next.add(task)
            return next
          })
        }
      }
    },
    [activity, result, type, data, optionChoices, simStep, selectedOption, selectedItemId, solutions],
  )

  const recognition = useSpeechRecognition({
    language: speechLocale(lang),
    onFinalResult: handleVoiceResult,
  })

  // --- TTS auto-read of the prompt ---
  const promptSpeech = useMemo(() => buildPromptSpeech(activity, simStep), [activity, simStep])
  useEffect(() => {
    if (!promptSpeech || result) return undefined
    const timer = setTimeout(() => speak(promptSpeech), 400)
    return () => clearTimeout(timer)
  }, [promptSpeech, result, speak])

  // --- interactions ---
  const chooseScenarioOption = (optionId) => {
    if (selectedOption && selectedOption !== optionId) setCorrections((c) => c + 1)
    setSelectedOption(optionId)
  }

  const clickItemMatch = (itemId) => {
    if (solutions[itemId]) {
      // unassign
      setSolutions((s) => {
        const next = { ...s }
        delete next[itemId]
        return next
      })
      setSelectedItemId(null)
      return
    }
    setSelectedItemId((prev) => (prev === itemId ? null : itemId))
    if (selectedItemId && selectedItemId !== itemId) setCorrections((c) => c + 1)
  }

  const clickBucketMatch = (bucket) => {
    if (!selectedItemId) return
    if (solutions[selectedItemId] && solutions[selectedItemId] !== bucket) {
      setCorrections((c) => c + 1)
    }
    setSolutions((s) => ({ ...s, [selectedItemId]: bucket }))
    setSelectedItemId(null)
  }

  const clickItemOrder = (itemId) => {
    if (solutions[itemId]) {
      const removedPos = solutions[itemId]
      setSolutions((s) => {
        const next = {}
        Object.entries(s).forEach(([id, pos]) => {
          if (pos < removedPos) next[id] = pos
          else if (pos > removedPos) next[id] = pos - 1
        })
        return next
      })
      return
    }
    const nextPos = Object.keys(solutions).length + 1
    if (selectedItemId && selectedItemId !== itemId) setCorrections((c) => c + 1)
    setSolutions((s) => ({ ...s, [itemId]: nextPos }))
    setSelectedItemId(null)
  }

  const chooseSimOption = (optionId) => {
    setSimChoices((prev) => {
      const next = [...prev]
      if (next[simStep] && next[simStep] !== optionId) setCorrections((c) => c + 1)
      next[simStep] = optionId
      return next
    })
  }

  const toggleTask = (task) => {
    setCheckedTasks((prev) => {
      const next = new Set(prev)
      if (next.has(task)) next.delete(task)
      else next.add(task)
      return next
    })
  }

  const revealHint = () => {
    if (hints.length >= 3) return
    setHints(buildHints(type, data).slice(0, hints.length + 1))
  }

  // --- submission ---
  const canSubmit = useMemo(() => {
    if (!activity || result) return false
    switch (type) {
      case 'scenario':
        return selectedOption != null && confidence > 0
      case 'puzzle':
        return (
          confidence > 0 &&
          (data.items || []).every((i) => solutions[i.id] != null) &&
          (data.mode === 'match'
            ? (data.buckets || []).length > 0
            : Object.keys(solutions).length === (data.items || []).length)
        )
      case 'simulation':
        return (
          confidence > 0 &&
          (data.steps || []).every((_, i) => simChoices[i] != null)
        )
      case 'mission':
        return confidence > 0
      default:
        return false
    }
  }, [activity, result, type, data, selectedOption, solutions, simChoices, confidence])

  const buildSubmitBody = () => {
    const duration_s = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000))
    const base = {
      duration_s,
      hints_used: hints.length,
      self_corrections: corrections,
      confidence,
    }
    switch (type) {
      case 'scenario':
        return { ...base, answers: { option_id: selectedOption } }
      case 'puzzle':
        return { ...base, answers: { solutions } }
      case 'simulation':
        return { ...base, answers: { option_ids: simChoices } }
      case 'mission': {
        const tasks_completed = checkedTasks.size
        return { ...base, answers: { tasks_completed }, tasks_completed }
      }
      default:
        return base
    }
  }

  const submit = async () => {
    if (!activity || submitting) return
    setSubmitting(true)
    setSubmitError('')
    stopSpeaking()
    try {
      const dataResult = await submitActivity(activity.id, buildSubmitBody())
      setResult(dataResult || {})
      if (user?.id) saveLocalCompleted(user.id, activity.id)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setSubmitError(err.message || 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

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

  if (!journey || !activity) {
    return <div className="h-64 animate-pulse rounded-2xl bg-white/70" />
  }

  // --- result state ---
  if (result) {
    const badges = (result.new_badges || []).map((b) =>
      typeof b === 'string' ? { title: b } : b,
    )
    const mastery = result.mastery || {}
    const explanation = Array.isArray(mastery.explanation)
      ? mastery.explanation
      : mastery.explanation
        ? [mastery.explanation]
        : []
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div
          className={`rounded-3xl p-8 text-center shadow-card ring-1 ${
            result.correct === false ? 'bg-white ring-amber-200' : 'bg-white ring-sky-200'
          }`}
        >
          <div className="text-5xl">{result.correct === false ? '💪' : '🎉'}</div>
          <h1 className="mt-3 text-2xl font-bold text-slate-800">
            {result.correct === false ? 'Almost there!' : 'Nice work!'}
          </h1>
          <p className="mt-2 text-4xl font-extrabold text-sky-600">
            +<XpCountUp value={result.xp_earned ?? 0} /> XP
          </p>
          {result.outcome_message && (
            <p className="mt-2 text-sm text-slate-500">{result.outcome_message}</p>
          )}

          {badges.length > 0 && (
            <div className="mt-6 rounded-2xl bg-gradient-to-r from-sky-50 to-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                New badge{badges.length > 1 ? 's' : ''} unlocked!
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
                {badges.map((b, i) => (
                  <span
                    key={b.code || b.title || i}
                    className="inline-flex scale-100 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-card ring-1 ring-amber-200 transition-transform"
                  >
                    <span className="text-lg">🏅</span> {b.title || b.code}
                  </span>
                ))}
              </div>
            </div>
          )}

          {mastery.score != null && (
            <div className="mt-6 rounded-2xl bg-sky-50 p-4 text-left">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-sky-800">Mastery</p>
                <p className="text-sm font-bold text-sky-700">{Math.round(mastery.score)}%</p>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-sky-100">
                <div
                  className="h-full rounded-full bg-sky-600 transition-all duration-1000"
                  style={{ width: `${Math.min(100, Math.max(0, mastery.score))}%` }}
                />
              </div>
              {explanation.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-sky-900/80">
                  {explanation.map((line, i) => (
                    <li key={i}>• {line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-3">
          <Link
            to={`/app/journeys/${journey.id}`}
            className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
          >
            Back to journey map
          </Link>
          <Link
            to="/app"
            className="rounded-xl border border-sky-200 bg-white px-5 py-2.5 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
          >
            Home
          </Link>
        </div>
      </div>
    )
  }

  const items = data.items || []
  const simSteps = data.steps || []
  const languageLabel = lang === 'ur' ? 'اردو' : 'English'

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/app/journeys/${journey.id}`}
            className="text-xs font-medium text-sky-600 hover:underline"
          >
            ← {journey.title}
          </Link>
          <h1 className="mt-1 truncate text-xl font-bold capitalize text-slate-800">
            {type} · {activity.xp} XP
          </h1>
        </div>
        <button
          onClick={() => speak(promptSpeech)}
          className="shrink-0 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-sky-700 transition hover:bg-sky-50"
          title="Replay the prompt"
        >
          {speaking ? '🔊 Speaking…' : '🔈 Replay'}
        </button>
      </header>

      {hints.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Hints</p>
          <ul className="mt-1 space-y-1 text-sm text-amber-900">
            {hints.map((h, i) => (
              <li key={i}>💡 {h}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-3xl bg-white p-6 shadow-card ring-1 ring-sky-100">
        {/* --- scenario --- */}
        {type === 'scenario' && (
          <div className="space-y-4">
            <p className="text-lg font-medium text-slate-800">{data.prompt}</p>
            <div className="space-y-2">
              {(data.options || []).map((o, i) => (
                <button
                  key={o.id}
                  onClick={() => chooseScenarioOption(o.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl p-4 text-left text-sm transition ring-1 ${
                    selectedOption === o.id
                      ? 'bg-sky-50 ring-2 ring-sky-500'
                      : 'bg-white ring-sky-100 hover:bg-sky-50'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      selectedOption === o.id ? 'bg-sky-600 text-white' : 'bg-sky-100 text-sky-700'
                    }`}
                  >
                    {OPTION_LETTERS[i]?.toUpperCase() || i + 1}
                  </span>
                  <span className="text-slate-700">{o.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* --- puzzle --- */}
        {type === 'puzzle' && (
          <div className="space-y-5">
            <p className="text-lg font-medium text-slate-800">{data.instruction}</p>
            {data.mode === 'order' ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">
                  Tap items in order. Tap a placed item to remove it.
                </p>
                {items.map((item) => {
                  const pos = solutions[item.id]
                  return (
                    <button
                      key={item.id}
                      onClick={() => clickItemOrder(item.id)}
                      className={`flex w-full items-center gap-3 rounded-2xl p-4 text-left text-sm ring-1 transition ${
                        pos
                          ? 'bg-sky-600 text-white ring-sky-600'
                          : 'bg-white text-slate-700 ring-sky-100 hover:bg-sky-50'
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                          pos ? 'bg-white/20' : 'bg-sky-100 text-sky-700'
                        }`}
                      >
                        {pos || '+'}
                      </span>
                      {item.text}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-slate-400">
                  Tap an item, then tap its bucket {selectedItemId ? '— now pick a bucket' : ''}
                </p>
                <div className="space-y-2">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => clickItemMatch(item.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-left text-sm ring-1 transition ${
                        selectedItemId === item.id
                          ? 'bg-sky-50 ring-2 ring-sky-500'
                          : 'bg-white ring-sky-100 hover:bg-sky-50'
                      }`}
                    >
                      <span className="text-slate-700">{item.text}</span>
                      {solutions[item.id] && (
                        <span className="rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white">
                          {solutions[item.id]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-sky-100 pt-4">
                  {(data.buckets || []).map((bucket) => (
                    <button
                      key={bucket}
                      onClick={() => clickBucketMatch(bucket)}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        selectedItemId
                          ? 'bg-sky-600 text-white hover:bg-sky-700'
                          : 'bg-sky-50 text-slate-400'
                      }`}
                    >
                      {bucket}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- simulation --- */}
        {type === 'simulation' && (
          <div className="space-y-5">
            <p className="text-sm text-slate-500">{data.scenario}</p>
            <div className="flex items-center gap-2">
              {simSteps.map((_, i) => (
                <span
                  key={i}
                  className={`h-2.5 w-2.5 rounded-full transition ${
                    i < simStep
                      ? 'bg-sky-600'
                      : i === simStep
                        ? 'bg-sky-400 ring-2 ring-sky-300'
                        : 'bg-sky-100'
                  }`}
                />
              ))}
              <span className="ml-2 text-xs text-slate-400">
                Step {simStep + 1} of {simSteps.length}
              </span>
            </div>
            <p className="text-lg font-medium text-slate-800">{simSteps[simStep]?.prompt}</p>
            <div className="space-y-2">
              {(simSteps[simStep]?.options || []).map((o, i) => (
                <button
                  key={o.id}
                  onClick={() => chooseSimOption(o.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl p-4 text-left text-sm ring-1 transition ${
                    simChoices[simStep] === o.id
                      ? 'bg-sky-50 ring-2 ring-sky-500'
                      : 'bg-white ring-sky-100 hover:bg-sky-50'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      simChoices[simStep] === o.id ? 'bg-sky-600 text-white' : 'bg-sky-100 text-sky-700'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="text-slate-700">{o.text}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-between">
              <button
                onClick={() => setSimStep((s) => Math.max(0, s - 1))}
                disabled={simStep === 0}
                className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50 disabled:opacity-40"
              >
                ← Back
              </button>
              {simStep < simSteps.length - 1 ? (
                <button
                  onClick={() => setSimStep((s) => Math.min(simSteps.length - 1, s + 1))}
                  disabled={simChoices[simStep] == null}
                  className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-40"
                >
                  Next →
                </button>
              ) : null}
            </div>
          </div>
        )}

        {/* --- mission --- */}
        {type === 'mission' && (
          <div className="space-y-5">
            <p className="text-lg font-medium text-slate-800">{data.briefing}</p>
            {data.success_criteria && (
              <p className="rounded-xl bg-sky-50 px-4 py-2 text-sm text-sky-800">
                Success: {data.success_criteria}
              </p>
            )}
            <div className="space-y-2">
              {(data.tasks || []).map((task) => (
                <label
                  key={task}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl p-4 text-sm ring-1 transition ${
                    checkedTasks.has(task)
                      ? 'bg-sky-50 ring-2 ring-sky-500'
                      : 'bg-white ring-sky-100 hover:bg-sky-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checkedTasks.has(task)}
                    onChange={() => toggleTask(task)}
                    className="h-4 w-4 accent-sky-600"
                  />
                  <span className={checkedTasks.has(task) ? 'text-sky-900 line-through' : 'text-slate-700'}>
                    {task}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              {checkedTasks.size} of {(data.tasks || []).length} tasks done
            </p>
          </div>
        )}
      </div>

      {/* --- confidence + submit --- */}
      <div className="rounded-3xl bg-white p-6 shadow-card ring-1 ring-sky-100">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-600">How confident do you feel?</p>
            <div className="mt-1">
              <Stars value={confidence} onChange={setConfidence} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={revealHint}
              disabled={hints.length >= 3}
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-40"
            >
              💡 Hint ({hints.length}/3)
            </button>
            {!(type === 'simulation' && simStep < simSteps.length - 1) && (
              <button
                onClick={submit}
                disabled={!canSubmit || submitting}
                className="rounded-xl bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            )}
          </div>
        </div>
        {!canSubmit && !result && (
          <p className="mt-2 text-xs text-slate-400">
            {confidence === 0
              ? 'Tap the stars to rate your confidence.'
              : 'Answer everything above to enable submit.'}
          </p>
        )}
        {submitError && (
          <p className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{submitError}</p>
        )}
      </div>

      <VoiceOverlay recognition={recognition} languageLabel={languageLabel} />
    </div>
  )
}
