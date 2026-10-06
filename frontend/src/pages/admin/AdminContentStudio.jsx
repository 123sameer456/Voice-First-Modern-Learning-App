import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createContent,
  deleteContent,
  deleteJourney,
  generateJourney,
  getJourney,
  listContent,
  listJourneys,
  publishJourney,
  unpublishJourney,
} from '../../lib/adminApi'

const CREATE_TABS = [
  { id: 'topic', label: 'Topic' },
  { id: 'document', label: 'Document' },
  { id: 'url', label: 'URL' },
]

const TYPE_BADGE = {
  topic: 'bg-sky-100 text-sky-700',
  document: 'bg-violet-100 text-violet-700',
  url: 'bg-amber-100 text-amber-700',
}

const STATUS_BADGE = {
  ready: 'bg-emerald-100 text-emerald-700',
  processing: 'bg-sky-100 text-sky-700',
  pending: 'bg-slate-100 text-slate-600',
  error: 'bg-red-100 text-red-700',
}

const ACTIVITY_BADGE = {
  scenario: 'bg-sky-100 text-sky-700',
  puzzle: 'bg-amber-100 text-amber-700',
  simulation: 'bg-violet-100 text-violet-700',
  mission: 'bg-emerald-100 text-emerald-700',
}

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return value
  }
}

function Badge({ className, children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

function LearnerDataView({ type, data }) {
  if (!data) return null
  if (type === 'scenario') {
    return (
      <div>
        <p className="text-sm font-medium text-slate-700">{data.prompt}</p>
        <ul className="mt-2 space-y-1">
          {(data.options || []).map((opt) => (
            <li key={opt.id} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-600">
              <span className="font-semibold text-sky-700">{opt.id}.</span> {opt.text}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  if (type === 'puzzle') {
    return (
      <div>
        <p className="text-sm font-medium text-slate-700">{data.instruction}</p>
        <p className="mt-1 text-xs text-slate-500">Mode: {data.mode}</p>
        {Array.isArray(data.buckets) && data.buckets.length > 0 && (
          <p className="mt-1 text-xs text-slate-500">Buckets: {data.buckets.join(', ')}</p>
        )}
        <ul className="mt-2 space-y-1">
          {(data.items || []).map((item) => (
            <li key={item.id} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-600">
              {item.text}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  if (type === 'simulation') {
    return (
      <div>
        <p className="text-sm font-medium text-slate-700">{data.scenario}</p>
        <ol className="mt-2 space-y-2">
          {(data.steps || []).map((step, i) => (
            <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-sm font-medium text-slate-700">{i + 1}. {step.prompt}</p>
              <ul className="mt-1 space-y-0.5">
                {(step.options || []).map((opt) => (
                  <li key={opt.id} className="text-xs text-slate-500">
                    {opt.id}. {opt.text}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  if (type === 'mission') {
    return (
      <div>
        <p className="text-sm font-medium text-slate-700">{data.briefing}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {(data.tasks || []).map((task, i) => (
            <li key={i}>{task}</li>
          ))}
        </ul>
        {data.success_criteria && (
          <p className="mt-2 text-xs text-slate-500">Success criteria: {data.success_criteria}</p>
        )}
      </div>
    )
  }
  return <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{JSON.stringify(data, null, 2)}</pre>
}

function ActivityAccordion({ activity, isOpen, onToggle }) {
  const { payload } = activity
  return (
    <div className="rounded-xl ring-1 ring-sky-100">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left hover:bg-sky-50"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">#{activity.order + 1}</span>
          <Badge className={ACTIVITY_BADGE[activity.type] || 'bg-slate-100 text-slate-600'}>{activity.type}</Badge>
          <span className="text-xs text-slate-500">difficulty {activity.difficulty}/5</span>
          <span className="text-xs text-slate-500">{activity.xp} XP</span>
          {payload?.meta?.needs_review && <Badge className="bg-red-100 text-red-700">needs review</Badge>}
        </span>
        <span className="text-xs font-medium text-sky-600">{isOpen ? 'Hide' : 'Show'}</span>
      </button>
      {isOpen && (
        <div className="space-y-4 border-t border-sky-100 px-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Learner view</p>
            <div className="mt-2">
              <LearnerDataView type={activity.type} data={payload?.data} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Answer (server-only)</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-200">
              {JSON.stringify(payload?.answer ?? null, null, 2)}
            </pre>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Meta</p>
              {payload?.meta?.needs_review && <Badge className="bg-red-100 text-red-700">needs review</Badge>}
            </div>
            {Array.isArray(payload?.meta?.issues) && payload.meta.issues.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-600">
                {payload.meta.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
            {Array.isArray(payload?.meta?.source_refs) && payload.meta.source_refs.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-500">Source refs</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-500">
                  {payload.meta.source_refs.map((ref, i) => (
                    <li key={i} className="italic">"{ref}"</li>
                  ))}
                </ul>
              </div>
            )}
            <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              {JSON.stringify(payload?.meta ?? null, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function JourneyReview({ summary, onAction, busy }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openActivity, setOpenActivity] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setDetail(await getJourney(summary.id))
    } catch (e) {
      setError(e.message || 'Failed to load journey')
    } finally {
      setLoading(false)
    }
  }, [summary.id])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="mt-4 rounded-2xl bg-white p-6 shadow-card ring-1 ring-sky-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-800">{summary.title}</h3>
            <Badge className={summary.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
              {summary.status}
            </Badge>
            {summary.needs_review_count > 0 && (
              <Badge className="bg-red-100 text-red-700">{summary.needs_review_count} need review</Badge>
            )}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">{summary.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {summary.status === 'published' ? (
            <button
              type="button"
              onClick={() => onAction('unpublish', summary)}
              disabled={busy}
              className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50 disabled:opacity-50"
            >
              Unpublish
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onAction('publish', summary)}
              disabled={busy}
              className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
            >
              Publish
            </button>
          )}
          <button
            type="button"
            onClick={() => onAction('delete', summary)}
            disabled={busy}
            className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="rounded-xl border border-sky-200 px-3 py-2 text-sm text-sky-700 transition hover:bg-sky-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
          Loading journey…
        </div>
      ) : error ? (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      ) : detail ? (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-sky-50/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Objectives</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {(detail.objectives || []).map((obj, i) => (
                  <li key={i}>{obj}</li>
                ))}
                {(detail.objectives || []).length === 0 && <li className="list-none text-slate-400">None</li>}
              </ul>
            </div>
            <div className="rounded-xl bg-sky-50/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Glossary</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {(detail.glossary || []).map((entry, i) => {
                  const term = typeof entry === 'string' ? entry : entry?.term || entry?.title || ''
                  const def = typeof entry === 'string' ? '' : entry?.definition || entry?.description || ''
                  return (
                    <li key={i}>
                      {term && <span className="font-medium text-sky-700">{term}</span>}
                      {def && <span className="text-slate-500"> — {def}</span>}
                    </li>
                  )
                })}
                {(detail.glossary || []).length === 0 && <li className="text-slate-400">None</li>}
              </ul>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Concepts</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {(detail.concepts || []).map((concept) => (
                <div key={concept.id} className="rounded-xl bg-white p-3 ring-1 ring-sky-100">
                  <p className="text-sm font-medium text-slate-700">{concept.order + 1}. {concept.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{concept.description}</p>
                </div>
              ))}
              {(detail.concepts || []).length === 0 && <p className="text-sm text-slate-400">No concepts.</p>}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Activities ({(detail.activities || []).length})
            </p>
            <div className="mt-2 space-y-2">
              {(detail.activities || []).map((activity) => (
                <ActivityAccordion
                  key={activity.id}
                  activity={activity}
                  isOpen={openActivity === activity.id}
                  onToggle={() => setOpenActivity(openActivity === activity.id ? null : activity.id)}
                />
              ))}
              {(detail.activities || []).length === 0 && <p className="text-sm text-slate-400">No activities.</p>}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function AdminContentStudio() {
  const [sources, setSources] = useState([])
  const [journeys, setJourneys] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  const [tab, setTab] = useState('topic')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState('')

  const [generatingIds, setGeneratingIds] = useState(() => new Set())
  const [busyJourney, setBusyJourney] = useState(false)
  const [reviewSource, setReviewSource] = useState(null)
  // Per-source AI generation options: how many activities of each type.
  const [genMixes, setGenMixes] = useState({})
  const [showMixes, setShowMixes] = useState({})

  const loadData = useCallback(async () => {
    setLoading(true)
    setPageError('')
    try {
      const [src, jrn] = await Promise.all([listContent(), listJourneys()])
      setSources(src)
      setJourneys(jrn)
    } catch (e) {
      setPageError(e.message || 'Failed to load content')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const journeysForSource = useMemo(() => {
    if (!reviewSource) return []
    return journeys.filter((j) => j.source_id === reviewSource.id)
  }, [journeys, reviewSource])

  const resetCreateForm = () => {
    setTitle('')
    setText('')
    setUrl('')
    setFile(null)
    setCreateError('')
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setCreateError('')

    if (tab === 'topic') {
      if (text.trim().length < 50) {
        setCreateError('Topic text must be at least 50 characters.')
        return
      }
    } else if (tab === 'document' && !file) {
      setCreateError('Choose a document to upload.')
      return
    } else if (tab === 'url' && !url.trim()) {
      setCreateError('Enter a URL.')
      return
    }

    const formData = new FormData()
    formData.append('type', tab)
    formData.append('title', title.trim())
    if (tab === 'topic') formData.append('text', text.trim())
    if (tab === 'url') formData.append('url', url.trim())
    if (tab === 'document') formData.append('file', file)

    setSubmitting(true)
    try {
      await createContent(formData)
      resetCreateForm()
      await loadData()
    } catch (err) {
      setCreateError(err.message || 'Failed to create content source.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleGenerate = async (source) => {
    setCreateError('')
    const mix = genMixes[source.id]
    if (mix && Object.values(mix).reduce((a, b) => a + Number(b || 0), 0) < 4) {
      setCreateError('The activity mix must total at least 4 activities.')
      return
    }
    setGeneratingIds((prev) => new Set(prev).add(source.id))
    try {
      const detail = await generateJourney(source.id, mix ? { activity_mix: mix } : undefined)
      await loadData()
      setReviewSource(source)
      return detail
    } catch (err) {
      setCreateError(err.message || 'Journey generation failed.')
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev)
        next.delete(source.id)
        return next
      })
    }
    return null
  }

  const handleDeleteSource = async (source) => {
    if (!window.confirm(`Delete content source "${source.title}"? Its journeys will remain.`)) return
    try {
      await deleteContent(source.id)
      if (reviewSource?.id === source.id) setReviewSource(null)
      await loadData()
    } catch (err) {
      setPageError(err.message || 'Failed to delete content source.')
    }
  }

  const handleJourneyAction = async (action, summary) => {
    if (action === 'publish' && summary.needs_review_count > 0) {
      const ok = window.confirm(
        `${summary.needs_review_count} activity(ies) in "${summary.title}" are flagged as needs review. Publish anyway?`
      )
      if (!ok) return
    }
    if (action === 'delete') {
      if (!window.confirm(`Delete journey "${summary.title}"? This cannot be undone.`)) return
    }
    setBusyJourney(true)
    try {
      if (action === 'publish') await publishJourney(summary.id)
      if (action === 'unpublish') await unpublishJourney(summary.id)
      if (action === 'delete') await deleteJourney(summary.id)
      await loadData()
    } catch (err) {
      setPageError(err.message || `Failed to ${action} journey.`)
    } finally {
      setBusyJourney(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Content Studio</h1>
          <p className="mt-1 text-sm text-slate-500">
            Add learning material, generate adaptive journeys, review and publish them.
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
        >
          Refresh
        </button>
      </div>

      {pageError && (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{pageError}</p>
      )}

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-card ring-1 ring-sky-100">
        <h2 className="text-base font-semibold text-slate-800">Add content source</h2>
        <div className="mt-4 flex gap-2">
          {CREATE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id)
                setCreateError('')
              }}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                tab === t.id ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleCreate} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Phishing awareness basics"
              className="mt-1 w-full rounded-xl border border-sky-200 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          </div>

          {tab === 'topic' && (
            <div>
              <label className="block text-xs font-medium text-slate-500">
                Topic text (min. 50 characters)
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder="Describe the topic in enough detail for the AI to build a journey…"
                className="mt-1 w-full rounded-xl border border-sky-200 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
              <p className={`mt-1 text-xs ${text.trim().length >= 50 ? 'text-emerald-600' : 'text-slate-400'}`}>
                {text.trim().length}/50 characters
              </p>
            </div>
          )}

          {tab === 'document' && (
            <div>
              <label className="block text-xs font-medium text-slate-500">Document</label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mt-1 w-full rounded-xl border border-sky-200 px-4 py-2 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-600 file:px-4 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-sky-700"
              />
            </div>
          )}

          {tab === 'url' && (
            <div>
              <label className="block text-xs font-medium text-slate-500">URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="mt-1 w-full rounded-xl border border-sky-200 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </div>
          )}

          {createError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{createError}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Add source'}
          </button>
        </form>
      </div>

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-card ring-1 ring-sky-100">
        <h2 className="text-base font-semibold text-slate-800">Content sources</h2>
        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
            Loading…
          </div>
        ) : sources.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No content sources yet. Add one above.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {sources.map((source) => {
              const generating = generatingIds.has(source.id)
              const isReviewed = reviewSource?.id === source.id
              const mix = genMixes[source.id] || { scenario: 2, puzzle: 2, simulation: 1, mission: 1 }
              const mixTotal = Object.values(mix).reduce((a, b) => a + Number(b || 0), 0)
              const mixShown = Boolean(showMixes[source.id])
              const mixInvalid = mixTotal < 4 || mixTotal > 12
              return (
                <div
                  key={source.id}
                  className={`rounded-xl px-4 py-3 ring-1 transition ${
                    isReviewed ? 'bg-sky-50 ring-sky-300' : 'bg-white ring-sky-100'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={TYPE_BADGE[source.type] || 'bg-slate-100 text-slate-600'}>{source.type}</Badge>
                      <span className="text-sm font-medium text-slate-700">{source.title || `Source #${source.id}`}</span>
                      <Badge className={STATUS_BADGE[source.status] || 'bg-slate-100 text-slate-600'}>
                        {source.status}
                      </Badge>
                      {source.error && <span className="text-xs text-red-500">{source.error}</span>}
                      <span className="text-xs text-slate-400">
                        {source.journey_count || 0} journey{(source.journey_count || 0) === 1 ? '' : 's'} · created{' '}
                        {formatDate(source.created_at)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowMixes((prev) => ({ ...prev, [source.id]: !prev[source.id] }))}
                        className="rounded-xl border border-sky-200 px-3 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
                        title="Choose how many activities of each type the AI should generate"
                      >
                        ⚙ Mix ({mixTotal})
                      </button>
                      <button
                        type="button"
                        onClick={() => handleGenerate(source)}
                        disabled={generating || mixInvalid}
                        className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-60"
                      >
                        {generating && (
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-200 border-t-white" />
                        )}
                        {generating ? 'Generating… (up to a minute)' : 'Generate journey'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setReviewSource(isReviewed ? null : source)}
                        className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
                      >
                        {isReviewed ? 'Hide journeys' : 'View journeys'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSource(source)}
                        className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {mixShown && (
                    <div className="mt-2 rounded-xl bg-sky-50/70 p-3">
                      <p className="text-xs font-medium text-slate-500">
                        Generation mix — decide how many activities of each type the AI builds (total {mixTotal})
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {['scenario', 'puzzle', 'simulation', 'mission'].map((type) => (
                          <label key={type} className="block">
                            <span className="text-xs capitalize text-slate-500">{type}</span>
                            <input
                              type="number"
                              min="0"
                              max="6"
                              value={mix[type]}
                              onChange={(e) =>
                                setGenMixes((prev) => ({
                                  ...prev,
                                  [source.id]: {
                                    ...mix,
                                    [type]: Math.max(0, Math.min(6, Number(e.target.value) || 0)),
                                  },
                                }))
                              }
                              className="mt-1 w-full rounded-xl border border-sky-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                            />
                          </label>
                        ))}
                      </div>
                      {mixTotal < 4 && (
                        <p className="mt-1 text-xs text-red-500">Total must be at least 4 activities.</p>
                      )}
                      {mixTotal > 12 && (
                        <p className="mt-1 text-xs text-red-500">
                          Total must be at most 12 activities — lower some type counts.
                        </p>
                      )}
                    </div>
                  )}

                  {isReviewed && (
                    <div className="mt-1 space-y-2">
                      {journeysForSource.length === 0 ? (
                        <p className="rounded-xl bg-white px-4 py-3 text-sm text-slate-400 ring-1 ring-sky-100">
                          No journeys for this source yet — generate one.
                        </p>
                      ) : (
                        journeysForSource.map((summary) => (
                          <JourneyReview key={summary.id} summary={summary} onAction={handleJourneyAction} busy={busyJourney} />
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
