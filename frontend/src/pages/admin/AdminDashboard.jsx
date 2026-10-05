import { useEffect, useMemo, useState } from 'react'
import { getStats, listJourneys } from '../../lib/adminApi'

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return value
  }
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-sky-100">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-sky-700">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

function JourneyBarChart({ journeys }) {
  const max = Math.max(1, ...journeys.map((j) => j.activity_count || 0))
  const shown = journeys.slice(0, 8)
  return (
    <div className="space-y-3">
      {shown.map((journey) => (
        <div key={journey.id}>
          <div className="flex items-center justify-between text-xs">
            <span className="truncate pr-2 font-medium text-slate-600">{journey.title}</span>
            <span className="shrink-0 text-slate-400">{journey.activity_count} activities</span>
          </div>
          <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-sky-50 ring-1 ring-sky-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-sky-600 transition-all"
              style={{ width: `${Math.round(((journey.activity_count || 0) / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
      {shown.length === 0 && <p className="text-sm text-slate-400">No journeys yet.</p>}
    </div>
  )
}

const EFFECTIVENESS_METRICS = [
  {
    name: 'Activation',
    detail: 'Share of new learners who finish their first activity — the strongest predictor of continued use.',
  },
  {
    name: 'Engagement',
    detail: 'Interactions per active learner and current streak counts (gamification hooks doing their job).',
  },
  {
    name: 'Mastery',
    detail: 'Average mastery score vs. the pass threshold — are concepts actually being learned, not just attempted?',
  },
  {
    name: 'Reinforcement',
    detail: 'Share of due reinforcements completed after 3 days — the adaptive engine pulling learners back.',
  },
  {
    name: 'Retention',
    detail: 'Learners active again after 7 days — the number a sponsor ultimately cares about.',
  },
  {
    name: 'Content quality',
    detail: 'Needs-review activity count trending down — the AI generation loop improving with feedback.',
  },
]

export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [journeys, setJourneys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [s, j] = await Promise.all([getStats(), listJourneys()])
        if (!cancelled) {
          setStats(s)
          setJourneys(j)
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load dashboard data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const journeysWithActivity = useMemo(
    () =>
      [...journeys]
        .sort((a, b) => (b.activity_count || 0) - (a.activity_count || 0))
        .filter((j) => (j.activity_count || 0) > 0),
    [journeys]
  )

  const avgMasteryDisplay = stats
    ? stats.avg_mastery != null && stats.avg_mastery > 0
      ? `${Math.round(stats.avg_mastery)}%`
      : '—'
    : '—'

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">Platform health at a glance.</p>

      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard label="Users" value={loading ? '—' : stats?.users_total ?? '—'} hint="All accounts" />
        <StatCard label="Learners" value={loading ? '—' : stats?.learners_total ?? '—'} hint="Role = learner" />
        <StatCard
          label="Published / draft"
          value={loading ? '—' : `${stats?.journeys_published ?? 0} / ${stats?.journeys_draft ?? 0}`}
          hint="Journeys"
        />
        <StatCard label="Interactions" value={loading ? '—' : stats?.interactions_total ?? '—'} hint="Activity attempts" />
        <StatCard label="Avg. mastery" value={loading ? '—' : avgMasteryDisplay} hint="Across graded attempts" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <div className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-sky-100 lg:col-span-3">
          <h2 className="text-base font-semibold text-slate-800">Journeys</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-sky-100 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-medium">Title</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Activities</th>
                  <th className="py-2 pr-4 font-medium">Needs review</th>
                  <th className="py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-50">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">Loading…</td>
                  </tr>
                ) : journeys.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      No journeys yet — generate one in the Content Studio.
                    </td>
                  </tr>
                ) : (
                  journeys.map((journey) => (
                    <tr key={journey.id} className="hover:bg-sky-50/50">
                      <td className="py-2.5 pr-4 font-medium text-slate-700">{journey.title}</td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            journey.status === 'published'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {journey.status}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">
                        {journey.activity_count} in {journey.concept_count} concepts
                      </td>
                      <td className="py-2.5 pr-4">
                        {journey.needs_review_count > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                            {journey.needs_review_count}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">0</span>
                        )}
                      </td>
                      <td className="py-2.5 text-slate-500">{formatDate(journey.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-sky-100 lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-800">Activities per journey</h2>
          <p className="mt-1 text-xs text-slate-400">Top journeys by activity count</p>
          <div className="mt-4">
            <JourneyBarChart journeys={journeysWithActivity} />
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-white p-6 shadow-card ring-1 ring-sky-100">
        <h2 className="text-base font-semibold text-slate-800">How to measure effectiveness</h2>
        <p className="mt-1 text-sm text-slate-500">
          The metrics this demo tracks, and why each one matters for the judging criteria.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {EFFECTIVENESS_METRICS.map((metric) => (
            <div key={metric.name} className="rounded-xl bg-sky-50/60 p-4">
              <p className="text-sm font-semibold text-sky-700">{metric.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{metric.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
