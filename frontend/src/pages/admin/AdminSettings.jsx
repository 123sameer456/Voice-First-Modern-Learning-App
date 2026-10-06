import { useCallback, useEffect, useRef, useState } from 'react'
import InfoTip from '../../components/InfoTip'
import {
  getJourneySettings,
  getSettings,
  listJourneys,
  updateJourneySetting,
  updateSetting,
} from '../../lib/adminApi'

const GROUPS = ['content', 'gamification', 'adaptive', 'engagement', 'voice']
// Groups consumed per-course at runtime (must match the backend).
const PER_COURSE_GROUPS = ['gamification', 'adaptive']

const DEFAULTS = {
  content: {
    default_language: 'en',
    audience_level: 'general',
    tone: 'friendly',
    difficulty_range: [1, 5],
  },
  gamification: {
    xp_per_activity_base: 10,
    level_curve: 100,
    streaks_enabled: true,
    hint_cost_xp: 2,
  },
  adaptive: {
    mastery_pass_percent: 70,
    hint_penalty: 0.1,
    reinforcement_interval_days: 3,
  },
  engagement: {
    nudges_enabled: true,
    nudge_frequency_days: 7,
    quiet_hours: '22:00-07:00',
  },
  voice: {
    enabled: true,
    tts_model: 'eleven_flash_v2_5',
    voice_id: '',
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0,
    language: 'en',
    stt_provider: 'browser_first',
    cache_tts: true,
  },
}

// Named ElevenLabs voices admins can pick directly.
const VOICE_PRESETS = [
  { name: 'Kai — Clean, Modern, Global', id: 'hfqsl1OMbiWsgPpht3el' },
  { name: 'Alex — Business Book Narrator', id: '17bSMslPF4HPyQrGIXAG' },
  { name: 'Lyan — Female, Casual & Friendly', id: 'PStJ2DzQnh8zxG5PDf1s' },
  { name: 'Rober — Calm, Clear and Professional', id: 'BtWabtumIemAotTjP5sk' },
]

// Plain-language definition + example for every field on the page.
const TIPS = {
  content: {
    default_language:
      'The language the AI uses when generating NEW courses. Example: "ur" makes every generated activity, question and voice reply Urdu (Urdu script), keeping technical terms in English.',
    audience_level:
      'Who the content is written for — fed straight into the AI prompt. Example: "beginner" produces simpler sentences; "professional" assumes background knowledge.',
    tone:
      'The writing style of generated content. Example: "friendly" sounds like a helpful coach; "formal" sounds like a textbook.',
    difficulty_range:
      'The difficulty span (1 = very easy, 5 = hard) the AI may assign to activities. Example: 1–3 keeps everything gentle for new learners.',
  },
  gamification: {
    xp_per_activity_base:
      'Base XP before the difficulty multiplier. Example: base 10 → a difficulty-3 activity awards 30 XP on pass.',
    level_curve:
      'XP needed for each level-up. Example: 100 → 100 XP = level 2, 200 XP = level 3.',
    hint_cost_xp:
      'XP deducted every time a learner reveals a hint. Example: 2 → using 3 hints costs 6 XP in total.',
    streaks_enabled:
      'Tracks consecutive active days and shows the 🔥 streak counter. Example: a learner active Mon–Wed shows "3d".',
  },
  adaptive: {
    mastery_pass_percent:
      'The mastery % that counts as "passed" for a concept. Example: 70 → a learner needs ≥70% to clear the concept.',
    hint_penalty:
      'Fraction subtracted from mastery growth when hints were used. Example: 0.1 → using hints removes 10% of that attempt\'s mastery gain.',
    reinforcement_interval_days:
      'Days after mastering a concept before a review becomes due. Example: 3 → the review resurfaces on day 4.',
  },
  engagement: {
    nudges_enabled:
      'Master switch for the nudge system (the learner\'s Nudges inbox). Example: off hides all reminders immediately.',
    nudge_frequency_days:
      'Minimum days between re-engagement nudges per learner. Example: 7 → at most one "come back" nudge per week.',
    quiet_hours:
      'Window in which no nudges are sent (wraps midnight). Example: 22:00-07:00 → no nudges during the night.',
  },
  voice: {
    enabled:
      'Master switch for AI voice in the learner app. Example: off hides the Listen/speak controls and the tutor replies text-only.',
    cache_tts:
      'Reuses generated audio for identical text instead of calling ElevenLabs again. Example: replaying the same paragraph costs 0 extra credits after the first play.',
    tts_model:
      'ElevenLabs model id. Example: eleven_flash_v2_5 is the cheapest multilingual tier.',
    voice_id:
      'Which voice speaks. Pick a named preset from the list, or choose "Custom voice ID…" and paste any voice ID from your ElevenLabs dashboard.',
    language:
      'Voice + speech-recognition locale. Example: "ur" speaks Urdu and expects Urdu answers (English voice for "en").',
    stt_provider:
      'How spoken answers become text. browser_first = free browser mic (Chrome/Edge); elevenlabs = paid ElevenLabs Scribe, works in more browsers.',
    stability:
      '0–1: higher = steadier, flatter delivery; lower = more expressive variation. Example: 0.5 suits a friendly tutor.',
    similarity_boost:
      '0–1: how closely the voice sticks to the original speaker\'s timbre. Example: 0.75 keeps the preset voice recognisable.',
    style:
      '0–1: exaggerates expressiveness; higher costs more credits. Example: 0 for narration, 0.4 for an upbeat promo voice.',
  },
}

const inputClass =
  'mt-1 w-full rounded-xl border border-sky-200 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200'

function normalizeRange(value) {
  if (Array.isArray(value) && value.length >= 2) return { min: value[0], max: value[1], asArray: true }
  if (value && typeof value === 'object') return { min: value.min, max: value.max, asArray: false }
  return { min: 1, max: 5, asArray: true }
}

function FieldLabel({ text, tip }) {
  return (
    <label className="flex items-center text-xs font-medium text-slate-500">
      {text}
      <InfoTip tip={tip} />
    </label>
  )
}

function OverrideChip({ show }) {
  if (!show) return null
  return (
    <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
      this course
    </span>
  )
}

function Toggle({ label, checked, onChange, disabled, tip, overridden }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl bg-sky-50/60 px-4 py-3">
      <span className="flex items-center text-sm text-slate-600">
        {label}
        <OverrideChip show={overridden} />
        <InfoTip tip={tip} />
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-40 ${
          checked ? 'bg-sky-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}

function Slider({ label, value, onChange, disabled, tip, overridden }) {
  return (
    <div className="rounded-xl bg-sky-50/60 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center text-sm text-slate-600">
          {label}
          <OverrideChip show={overridden} />
          <InfoTip tip={tip} />
        </span>
        <span className="text-xs font-medium text-sky-700">{Number(value).toFixed(2)}</span>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-sky-600"
      />
    </div>
  )
}

function NumberField({ label, tip, value, onChange, step = '1', min, max, disabled, overridden }) {
  return (
    <div>
      <FieldLabel text={label} tip={tip} />
      <OverrideChip show={overridden} />
      <input
        type="number"
        value={value ?? ''}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className={inputClass}
      />
    </div>
  )
}

function ContentForm({ value, onChange, disabled, tips }) {
  const range = normalizeRange(value.difficulty_range)
  const setRange = (key, v) => {
    const next = { ...range, [key]: v === '' ? '' : Number(v) }
    onChange({ ...value, difficulty_range: next })
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <FieldLabel text="Default language" tip={tips.default_language} />
        <select
          value={value.default_language ?? 'en'}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, default_language: e.target.value })}
          className={inputClass}
        >
          <option value="en">English (en)</option>
          <option value="ur">Urdu (ur)</option>
        </select>
      </div>
      <div>
        <FieldLabel text="Audience level" tip={tips.audience_level} />
        <input
          type="text"
          value={value.audience_level ?? ''}
          placeholder="e.g. general, beginner, professional"
          disabled={disabled}
          onChange={(e) => onChange({ ...value, audience_level: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <FieldLabel text="Tone" tip={tips.tone} />
        <input
          type="text"
          value={value.tone ?? ''}
          placeholder="e.g. friendly, formal"
          disabled={disabled}
          onChange={(e) => onChange({ ...value, tone: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <FieldLabel text="Difficulty range" tip={tips.difficulty_range} />
        <div className="mt-1 flex items-center gap-2">
          <input
            type="number"
            min="1"
            max="5"
            value={range.min}
            disabled={disabled}
            onChange={(e) => setRange('min', e.target.value)}
            className="w-full rounded-xl border border-sky-200 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
          />
          <span className="text-slate-400">to</span>
          <input
            type="number"
            min="1"
            max="5"
            value={range.max}
            disabled={disabled}
            onChange={(e) => setRange('max', e.target.value)}
            className="w-full rounded-xl border border-sky-200 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
          />
        </div>
      </div>
    </div>
  )
}

function serializeRange(value) {
  const range = normalizeRange(value)
  const min = range.min === '' ? 1 : Number(range.min)
  const max = range.max === '' ? 5 : Number(range.max)
  return range.asArray ? [min, max] : { min, max }
}

export default function AdminSettings() {
  const [forms, setForms] = useState({})
  const [originals, setOriginals] = useState({})
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [activeTab, setActiveTab] = useState('content')
  const [savingTab, setSavingTab] = useState(null)
  const [savedTab, setSavedTab] = useState(null)
  const [tabErrors, setTabErrors] = useState({})
  const savedTimer = useRef(null)

  // Per-course settings
  const [journeysList, setJourneysList] = useState([])
  const [courseId, setCourseId] = useState('')
  const [jOverrides, setJOverrides] = useState({})
  const course = journeysList.find((j) => j.id === courseId) || null

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setPageError('')
    try {
      const [rows, journeys] = await Promise.all([getSettings(), listJourneys()])
      const byKey = {}
      for (const row of rows) byKey[row.key] = row.value || {}
      const merged = {}
      for (const group of GROUPS) {
        merged[group] = { ...DEFAULTS[group], ...(byKey[group] || {}) }
      }
      setOriginals(byKey)
      setForms(merged)
      setJourneysList(journeys)
    } catch (e) {
      setPageError(e.message || 'Failed to load settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [loadSettings])

  // Load the selected course's overrides whenever the course changes.
  useEffect(() => {
    if (!courseId) {
      setJOverrides({})
      return
    }
    let cancelled = false
    getJourneySettings(courseId)
      .then((data) => {
        if (!cancelled) setJOverrides(data.overrides || {})
      })
      .catch(() => {
        if (!cancelled) setJOverrides({})
      })
    return () => {
      cancelled = true
    }
  }, [courseId])

  // Display value for a group: global merged with the course's overrides.
  const valueFor = (group) => {
    const base = forms[group] || {}
    if (!course) return base
    return { ...base, ...(jOverrides[group] || {}) }
  }

  const setValueFor = (group, next) => {
    if (!course) {
      setForms((prev) => ({ ...prev, [group]: next }))
      return
    }
    const base = forms[group] || {}
    const override = {}
    for (const key of Object.keys(next)) {
      if (JSON.stringify(next[key]) !== JSON.stringify(base[key])) override[key] = next[key]
    }
    setJOverrides((prev) => ({ ...prev, [group]: override }))
  }

  const diffForGroup = (group) => {
    const original = originals[group] || {}
    const current = forms[group] || {}
    const changes = {}
    for (const key of Object.keys(current)) {
      if (key === 'difficulty_range') {
        const before = JSON.stringify(original[key] ?? null)
        const after = JSON.stringify(serializeRange(current[key]))
        if (before !== after) changes[key] = serializeRange(current[key])
        continue
      }
      if (JSON.stringify(original[key]) !== JSON.stringify(current[key])) {
        changes[key] = current[key]
      }
    }
    return changes
  }

  const flashSaved = (group) => {
    setSavedTab(group)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSavedTab(null), 3000)
  }

  const handleSave = async (group) => {
    setTabErrors((prev) => ({ ...prev, [group]: '' }))

    if (course && PER_COURSE_GROUPS.includes(group)) {
      setSavingTab(group)
      try {
        const value = jOverrides[group] || {}
        const updated = await updateJourneySetting(courseId, group, value)
        setJOverrides(updated?.overrides || {})
        flashSaved(group)
      } catch (err) {
        setTabErrors((prev) => ({ ...prev, [group]: err.message || 'Failed to save course settings.' }))
      } finally {
        setSavingTab(null)
      }
      return
    }

    const changes = diffForGroup(group)
    if (Object.keys(changes).length === 0) {
      flashSaved(group)
      return
    }
    setSavingTab(group)
    try {
      const updated = await updateSetting(group, changes)
      setOriginals((prev) => ({ ...prev, [group]: { ...(prev[group] || {}), ...changes } }))
      if (updated?.value) {
        setForms((prev) => ({
          ...prev,
          [group]: { ...prev[group], ...updated.value },
        }))
      }
      flashSaved(group)
    } catch (err) {
      setTabErrors((prev) => ({ ...prev, [group]: err.message || 'Failed to save settings.' }))
    } finally {
      setSavingTab(null)
    }
  }

  const handleResetCourseGroup = async (group) => {
    if (!window.confirm(`Reset this group to the global settings for "${course.title}"?`)) return
    setSavingTab(group)
    try {
      const updated = await updateJourneySetting(courseId, group, {})
      setJOverrides(updated?.overrides || {})
      flashSaved(group)
    } catch (err) {
      setTabErrors((prev) => ({ ...prev, [group]: err.message || 'Failed to reset course settings.' }))
    } finally {
      setSavingTab(null)
    }
  }

  const isOverridden = (group, key) => Boolean(course && jOverrides[group]?.[key] !== undefined)
  const groupHasOverrides = (group) =>
    Boolean(course && Object.keys(jOverrides[group] || {}).length > 0)

  const voice = valueFor('voice') || {}
  const adaptive = valueFor('adaptive') || {}
  const gamification = valueFor('gamification') || {}
  const engagement = valueFor('engagement') || {}
  const content = valueFor('content') || {}

  const courseApplies = course && PER_COURSE_GROUPS.includes(activeTab)

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        Configure content defaults, gamification, adaptivity, engagement and voice — globally or per
        course.
      </p>

      {pageError && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{pageError}</p>}

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-card ring-1 ring-sky-100">
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
            Loading settings…
          </div>
        ) : (
          <>
            {/* Course scope selector */}
            <div className="flex flex-wrap items-center gap-3 border-b border-sky-100 pb-4">
              <label className="flex items-center gap-1 text-sm font-medium text-slate-600">
                Course scope
                <InfoTip tip="Pick a course to view and edit its own settings. Gamification and Adaptive can differ per course; the other groups are global in this version. Marked fields show a “this course” chip when the course overrides the global value." />
              </label>
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value ? Number(e.target.value) : '')}
                className="w-full max-w-sm rounded-xl border border-sky-200 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="">🌐 Global (all courses)</option>
                {journeysList.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} {j.status === 'draft' ? '(draft)' : ''}
                  </option>
                ))}
              </select>
              {course && (
                <span className="text-xs text-slate-400">
                  Editing: <span className="font-medium text-slate-600">{course.title}</span>
                </span>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {GROUPS.map((group) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => setActiveTab(group)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium capitalize transition ${
                    activeTab === group ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                  }`}
                >
                  {group}
                  {course && PER_COURSE_GROUPS.includes(group) && groupHasOverrides(group) && ' •'}
                </button>
              ))}
            </div>

            {course && !PER_COURSE_GROUPS.includes(activeTab) && (
              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2 text-xs text-amber-700">
                In this version <span className="font-semibold capitalize">{activeTab}</span> settings
                are global — they apply to every course. Per-course overrides apply to{' '}
                <span className="font-semibold">gamification</span> and{' '}
                <span className="font-semibold">adaptive</span>.
              </p>
            )}

            <div className="mt-6">
              {activeTab === 'content' && (
                <ContentForm
                  value={content}
                  onChange={(v) => setValueFor('content', v)}
                  disabled={savingTab === 'content'}
                  tips={TIPS.content}
                />
              )}

              {activeTab === 'gamification' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <NumberField
                    label="XP per activity (base)"
                    tip={TIPS.gamification.xp_per_activity_base}
                    value={gamification.xp_per_activity_base}
                    min="0"
                    disabled={savingTab === 'gamification'}
                    overridden={isOverridden('gamification', 'xp_per_activity_base')}
                    onChange={(v) => setValueFor('gamification', { ...gamification, xp_per_activity_base: v })}
                  />
                  <NumberField
                    label="Level curve (XP per level)"
                    tip={TIPS.gamification.level_curve}
                    value={gamification.level_curve}
                    min="1"
                    disabled={savingTab === 'gamification'}
                    overridden={isOverridden('gamification', 'level_curve')}
                    onChange={(v) => setValueFor('gamification', { ...gamification, level_curve: v })}
                  />
                  <NumberField
                    label="Hint cost (XP)"
                    tip={TIPS.gamification.hint_cost_xp}
                    value={gamification.hint_cost_xp}
                    min="0"
                    disabled={savingTab === 'gamification'}
                    overridden={isOverridden('gamification', 'hint_cost_xp')}
                    onChange={(v) => setValueFor('gamification', { ...gamification, hint_cost_xp: v })}
                  />
                  <Toggle
                    label="Streaks enabled"
                    tip={TIPS.gamification.streaks_enabled}
                    checked={Boolean(gamification.streaks_enabled)}
                    disabled={savingTab === 'gamification'}
                    overridden={isOverridden('gamification', 'streaks_enabled')}
                    onChange={(v) => setValueFor('gamification', { ...gamification, streaks_enabled: v })}
                  />
                </div>
              )}

              {activeTab === 'adaptive' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl bg-sky-50/60 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center text-sm text-slate-600">
                        Mastery pass percent
                        <OverrideChip show={isOverridden('adaptive', 'mastery_pass_percent')} />
                        <InfoTip tip={TIPS.adaptive.mastery_pass_percent} />
                      </span>
                      <span className="text-xs font-medium text-sky-700">
                        {adaptive.mastery_pass_percent ?? 70}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={adaptive.mastery_pass_percent ?? 70}
                      disabled={savingTab === 'adaptive'}
                      onChange={(e) =>
                        setValueFor('adaptive', {
                          ...adaptive,
                          mastery_pass_percent: Number(e.target.value),
                        })
                      }
                      className="mt-2 w-full accent-sky-600"
                    />
                  </div>
                  <NumberField
                    label="Hint penalty (mastery fraction, e.g. 0.1)"
                    tip={TIPS.adaptive.hint_penalty}
                    step="0.05"
                    min="0"
                    max="1"
                    value={adaptive.hint_penalty}
                    disabled={savingTab === 'adaptive'}
                    overridden={isOverridden('adaptive', 'hint_penalty')}
                    onChange={(v) => setValueFor('adaptive', { ...adaptive, hint_penalty: v })}
                  />
                  <NumberField
                    label="Reinforcement interval (days)"
                    tip={TIPS.adaptive.reinforcement_interval_days}
                    value={adaptive.reinforcement_interval_days}
                    min="1"
                    disabled={savingTab === 'adaptive'}
                    overridden={isOverridden('adaptive', 'reinforcement_interval_days')}
                    onChange={(v) =>
                      setValueFor('adaptive', { ...adaptive, reinforcement_interval_days: v })
                    }
                  />
                </div>
              )}

              {activeTab === 'engagement' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Toggle
                    label="Nudges enabled"
                    tip={TIPS.engagement.nudges_enabled}
                    checked={Boolean(engagement.nudges_enabled)}
                    disabled={savingTab === 'engagement'}
                    onChange={(v) => setValueFor('engagement', { ...engagement, nudges_enabled: v })}
                  />
                  <NumberField
                    label="Nudge frequency (days)"
                    tip={TIPS.engagement.nudge_frequency_days}
                    value={engagement.nudge_frequency_days}
                    min="1"
                    disabled={savingTab === 'engagement'}
                    onChange={(v) => setValueFor('engagement', { ...engagement, nudge_frequency_days: v })}
                  />
                  <div className="md:col-span-2">
                    <FieldLabel text="Quiet hours (e.g. 22:00-07:00)" tip={TIPS.engagement.quiet_hours} />
                    <input
                      type="text"
                      value={engagement.quiet_hours ?? ''}
                      placeholder="22:00-07:00"
                      disabled={savingTab === 'engagement'}
                      onChange={(e) => setValueFor('engagement', { ...engagement, quiet_hours: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'voice' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Toggle
                    label="Voice enabled"
                    tip={TIPS.voice.enabled}
                    checked={Boolean(voice.enabled)}
                    disabled={savingTab === 'voice'}
                    onChange={(v) => setValueFor('voice', { ...voice, enabled: v })}
                  />
                  <Toggle
                    label="Cache TTS audio"
                    tip={TIPS.voice.cache_tts}
                    checked={Boolean(voice.cache_tts)}
                    disabled={savingTab === 'voice'}
                    onChange={(v) => setValueFor('voice', { ...voice, cache_tts: v })}
                  />
                  <div>
                    <FieldLabel text="TTS model" tip={TIPS.voice.tts_model} />
                    <input
                      type="text"
                      value={voice.tts_model ?? ''}
                      placeholder="eleven_flash_v2_5"
                      disabled={savingTab === 'voice'}
                      onChange={(e) => setValueFor('voice', { ...voice, tts_model: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <FieldLabel text="Voice" tip={TIPS.voice.voice_id} />
                    <select
                      value={VOICE_PRESETS.find((v) => v.id === (voice.voice_id ?? ''))?.id ?? 'custom'}
                      disabled={savingTab === 'voice'}
                      onChange={(e) =>
                        setValueFor('voice', {
                          ...voice,
                          voice_id: e.target.value === 'custom' ? '' : e.target.value,
                        })
                      }
                      className={inputClass}
                    >
                      {VOICE_PRESETS.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                      <option value="custom">Custom voice ID…</option>
                    </select>
                    {voice.voice_id && !VOICE_PRESETS.some((v) => v.id === voice.voice_id) && (
                      <input
                        type="text"
                        value={voice.voice_id}
                        placeholder="Paste an ElevenLabs voice ID"
                        disabled={savingTab === 'voice'}
                        onChange={(e) => setValueFor('voice', { ...voice, voice_id: e.target.value })}
                        className={inputClass}
                      />
                    )}
                    {!voice.voice_id && (
                      <p className="mt-1 text-xs text-slate-400">
                        Empty = falls back to the ELEVENLABS_VOICE_ID env var or the built-in demo voice.
                      </p>
                    )}
                  </div>
                  <div>
                    <FieldLabel text="Language" tip={TIPS.voice.language} />
                    <select
                      value={voice.language ?? 'en'}
                      disabled={savingTab === 'voice'}
                      onChange={(e) => setValueFor('voice', { ...voice, language: e.target.value })}
                      className={inputClass}
                    >
                      <option value="en">English (en)</option>
                      <option value="ur">Urdu (ur)</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel text="STT provider" tip={TIPS.voice.stt_provider} />
                    <select
                      value={voice.stt_provider ?? 'browser_first'}
                      disabled={savingTab === 'voice'}
                      onChange={(e) => setValueFor('voice', { ...voice, stt_provider: e.target.value })}
                      className={inputClass}
                    >
                      <option value="browser_first">browser_first (free Web Speech API)</option>
                      <option value="elevenlabs">elevenlabs (paid)</option>
                    </select>
                  </div>
                  <Slider
                    label="Stability"
                    tip={TIPS.voice.stability}
                    value={voice.stability ?? 0.5}
                    disabled={savingTab === 'voice'}
                    onChange={(v) => setValueFor('voice', { ...voice, stability: v })}
                  />
                  <Slider
                    label="Similarity boost"
                    tip={TIPS.voice.similarity_boost}
                    value={voice.similarity_boost ?? 0.75}
                    disabled={savingTab === 'voice'}
                    onChange={(v) => setValueFor('voice', { ...voice, similarity_boost: v })}
                  />
                  <Slider
                    label="Style"
                    tip={TIPS.voice.style}
                    value={voice.style ?? 0}
                    disabled={savingTab === 'voice'}
                    onChange={(v) => setValueFor('voice', { ...voice, style: v })}
                  />
                </div>
              )}
            </div>

            {tabErrors[activeTab] && (
              <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{tabErrors[activeTab]}</p>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleSave(activeTab)}
                disabled={savingTab === activeTab}
                className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
              >
                {savingTab === activeTab
                  ? 'Saving…'
                  : course && PER_COURSE_GROUPS.includes(activeTab)
                    ? `Save ${activeTab} for this course`
                    : `Save ${activeTab} settings`}
              </button>
              {courseApplies && groupHasOverrides(activeTab) && (
                <button
                  type="button"
                  onClick={() => handleResetCourseGroup(activeTab)}
                  disabled={savingTab === activeTab}
                  className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  Reset to global
                </button>
              )}
              {savedTab === activeTab && (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  Saved ✓
                </span>
              )}
              <span className="text-xs text-slate-400">
                {course && PER_COURSE_GROUPS.includes(activeTab)
                  ? 'Only fields you change from the global value are stored as this course’s overrides.'
                  : 'Only changed keys are sent and merged on the server.'}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
