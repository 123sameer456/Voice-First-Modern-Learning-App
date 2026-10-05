import { useCallback, useEffect, useRef, useState } from 'react'
import { getSettings, updateSetting } from '../../lib/adminApi'

const GROUPS = ['content', 'gamification', 'adaptive', 'engagement', 'voice']

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

const inputClass =
  'mt-1 w-full rounded-xl border border-sky-200 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200'

function normalizeRange(value) {
  if (Array.isArray(value) && value.length >= 2) return { min: value[0], max: value[1], asArray: true }
  if (value && typeof value === 'object') return { min: value.min, max: value.max, asArray: false }
  return { min: 1, max: 5, asArray: true }
}

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl bg-sky-50/60 px-4 py-3">
      <span className="text-sm text-slate-600">{label}</span>
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

function Slider({ label, value, onChange, disabled }) {
  return (
    <div className="rounded-xl bg-sky-50/60 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-600">{label}</span>
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

function NumberField({ label, value, onChange, step = '1', min, max, disabled }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500">{label}</label>
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

function ContentForm({ value, onChange, disabled }) {
  const range = normalizeRange(value.difficulty_range)
  const setRange = (key, v) => {
    const next = { ...range, [key]: v === '' ? '' : Number(v) }
    onChange({ ...value, difficulty_range: next })
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label className="block text-xs font-medium text-slate-500">Default language</label>
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
        <label className="block text-xs font-medium text-slate-500">Audience level</label>
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
        <label className="block text-xs font-medium text-slate-500">Tone</label>
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
        <label className="block text-xs font-medium text-slate-500">Difficulty range</label>
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

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setPageError('')
    try {
      const rows = await getSettings()
      const byKey = {}
      for (const row of rows) byKey[row.key] = row.value || {}
      const merged = {}
      for (const group of GROUPS) {
        merged[group] = { ...DEFAULTS[group], ...(byKey[group] || {}) }
      }
      setOriginals(byKey)
      setForms(merged)
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

  const setFormValue = (group, next) => {
    setForms((prev) => ({ ...prev, [group]: next }))
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
      const before = original[key]
      const after = current[key]
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        changes[key] = after
      }
    }
    return changes
  }

  const handleSave = async (group) => {
    setTabErrors((prev) => ({ ...prev, [group]: '' }))
    const changes = diffForGroup(group)
    if (Object.keys(changes).length === 0) {
      setSavedTab(group)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSavedTab(null), 3000)
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
      setSavedTab(group)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSavedTab(null), 3000)
    } catch (err) {
      setTabErrors((prev) => ({ ...prev, [group]: err.message || 'Failed to save settings.' }))
    } finally {
      setSavingTab(null)
    }
  }

  const voice = forms.voice || {}
  const adaptive = forms.adaptive || {}
  const gamification = forms.gamification || {}
  const engagement = forms.engagement || {}
  const content = forms.content || {}

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        Configure content defaults, gamification, adaptivity, engagement and voice.
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
            <div className="flex flex-wrap gap-2">
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
                </button>
              ))}
            </div>

            <div className="mt-6">
              {activeTab === 'content' && (
                <ContentForm value={content} onChange={(v) => setFormValue('content', v)} disabled={savingTab === 'content'} />
              )}

              {activeTab === 'gamification' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <NumberField
                    label="XP per activity (base)"
                    value={gamification.xp_per_activity_base}
                    min="0"
                    disabled={savingTab === 'gamification'}
                    onChange={(v) => setFormValue('gamification', { ...gamification, xp_per_activity_base: v })}
                  />
                  <NumberField
                    label="Level curve (XP per level)"
                    value={gamification.level_curve}
                    min="1"
                    disabled={savingTab === 'gamification'}
                    onChange={(v) => setFormValue('gamification', { ...gamification, level_curve: v })}
                  />
                  <NumberField
                    label="Hint cost (XP)"
                    value={gamification.hint_cost_xp}
                    min="0"
                    disabled={savingTab === 'gamification'}
                    onChange={(v) => setFormValue('gamification', { ...gamification, hint_cost_xp: v })}
                  />
                  <Toggle
                    label="Streaks enabled"
                    checked={Boolean(gamification.streaks_enabled)}
                    disabled={savingTab === 'gamification'}
                    onChange={(v) => setFormValue('gamification', { ...gamification, streaks_enabled: v })}
                  />
                </div>
              )}

              {activeTab === 'adaptive' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl bg-sky-50/60 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Mastery pass percent</span>
                      <span className="text-xs font-medium text-sky-700">{adaptive.mastery_pass_percent ?? 70}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={adaptive.mastery_pass_percent ?? 70}
                      disabled={savingTab === 'adaptive'}
                      onChange={(e) =>
                        setFormValue('adaptive', { ...adaptive, mastery_pass_percent: Number(e.target.value) })
                      }
                      className="mt-2 w-full accent-sky-600"
                    />
                  </div>
                  <NumberField
                    label="Hint penalty (mastery fraction, e.g. 0.1)"
                    step="0.05"
                    min="0"
                    max="1"
                    value={adaptive.hint_penalty}
                    disabled={savingTab === 'adaptive'}
                    onChange={(v) => setFormValue('adaptive', { ...adaptive, hint_penalty: v })}
                  />
                  <NumberField
                    label="Reinforcement interval (days)"
                    value={adaptive.reinforcement_interval_days}
                    min="1"
                    disabled={savingTab === 'adaptive'}
                    onChange={(v) => setFormValue('adaptive', { ...adaptive, reinforcement_interval_days: v })}
                  />
                </div>
              )}

              {activeTab === 'engagement' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Toggle
                    label="Nudges enabled"
                    checked={Boolean(engagement.nudges_enabled)}
                    disabled={savingTab === 'engagement'}
                    onChange={(v) => setFormValue('engagement', { ...engagement, nudges_enabled: v })}
                  />
                  <NumberField
                    label="Nudge frequency (days)"
                    value={engagement.nudge_frequency_days}
                    min="1"
                    disabled={savingTab === 'engagement'}
                    onChange={(v) => setFormValue('engagement', { ...engagement, nudge_frequency_days: v })}
                  />
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-500">
                      Quiet hours (e.g. 22:00-07:00)
                    </label>
                    <input
                      type="text"
                      value={engagement.quiet_hours ?? ''}
                      placeholder="22:00-07:00"
                      disabled={savingTab === 'engagement'}
                      onChange={(e) => setFormValue('engagement', { ...engagement, quiet_hours: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'voice' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Toggle
                    label="Voice enabled"
                    checked={Boolean(voice.enabled)}
                    disabled={savingTab === 'voice'}
                    onChange={(v) => setFormValue('voice', { ...voice, enabled: v })}
                  />
                  <Toggle
                    label="Cache TTS audio"
                    checked={Boolean(voice.cache_tts)}
                    disabled={savingTab === 'voice'}
                    onChange={(v) => setFormValue('voice', { ...voice, cache_tts: v })}
                  />
                  <div>
                    <label className="block text-xs font-medium text-slate-500">TTS model</label>
                    <input
                      type="text"
                      value={voice.tts_model ?? ''}
                      placeholder="eleven_flash_v2_5"
                      disabled={savingTab === 'voice'}
                      onChange={(e) => setFormValue('voice', { ...voice, tts_model: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500">Voice ID</label>
                    <input
                      type="text"
                      value={voice.voice_id ?? ''}
                      placeholder="ElevenLabs voice ID"
                      disabled={savingTab === 'voice'}
                      onChange={(e) => setFormValue('voice', { ...voice, voice_id: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500">Language</label>
                    <select
                      value={voice.language ?? 'en'}
                      disabled={savingTab === 'voice'}
                      onChange={(e) => setFormValue('voice', { ...voice, language: e.target.value })}
                      className={inputClass}
                    >
                      <option value="en">English (en)</option>
                      <option value="ur">Urdu (ur)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500">STT provider</label>
                    <select
                      value={voice.stt_provider ?? 'browser_first'}
                      disabled={savingTab === 'voice'}
                      onChange={(e) => setFormValue('voice', { ...voice, stt_provider: e.target.value })}
                      className={inputClass}
                    >
                      <option value="browser_first">browser_first (free Web Speech API)</option>
                      <option value="elevenlabs">elevenlabs (paid)</option>
                    </select>
                  </div>
                  <Slider
                    label="Stability"
                    value={voice.stability ?? 0.5}
                    disabled={savingTab === 'voice'}
                    onChange={(v) => setFormValue('voice', { ...voice, stability: v })}
                  />
                  <Slider
                    label="Similarity boost"
                    value={voice.similarity_boost ?? 0.75}
                    disabled={savingTab === 'voice'}
                    onChange={(v) => setFormValue('voice', { ...voice, similarity_boost: v })}
                  />
                  <Slider
                    label="Style"
                    value={voice.style ?? 0}
                    disabled={savingTab === 'voice'}
                    onChange={(v) => setFormValue('voice', { ...voice, style: v })}
                  />
                </div>
              )}
            </div>

            {tabErrors[activeTab] && (
              <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{tabErrors[activeTab]}</p>
            )}

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleSave(activeTab)}
                disabled={savingTab === activeTab}
                className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
              >
                {savingTab === activeTab ? 'Saving…' : `Save ${activeTab} settings`}
              </button>
              {savedTab === activeTab && (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  Saved ✓
                </span>
              )}
              <span className="text-xs text-slate-400">Only changed keys are sent and merged on the server.</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
