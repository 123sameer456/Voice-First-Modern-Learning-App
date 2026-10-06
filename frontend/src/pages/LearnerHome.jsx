import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getProgress, getPublishedJourneys, getJourney } from '../lib/learnerApi'

const TYPE_META = {
  scenario: { label: 'Scenario', icon: '🎭' },
  puzzle: { label: 'Puzzle', icon: '🧩' },
  simulation: { label: 'Simulation', icon: '🧭' },
  mission: { label: 'Mission', icon: '🎯' },
}

const TYPE_COLORS = {
  scenario: 'bg-sky-100 text-sky-700',
  puzzle: 'bg-indigo-100 text-indigo-700',
  simulation: 'bg-cyan-100 text-cyan-700',
  mission: 'bg-amber-100 text-amber-700',
}

function DifficultyDots({ level = 1 }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`Difficulty ${level}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`h-1.5 w-1.5 rounded-full ${n <= level ? 'bg-sky-600' : 'bg-sky-100'}`}
        />
      ))}
    </span>
  )
}

export default function LearnerHome() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [progress, setProgress] = useState(null)
  const [journeys, setJourneys] = useState([])
  const [journeyDetails, setJourneyDetails] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [progressResult, journeyResult] = await Promise.allSettled([
        getProgress(),
        getPublishedJourneys(),
      ])
      if (cancelled) return
      if (progressResult.status === 'fulfilled') setProgress(progressResult.value)
      if (journeyResult.status === 'fulfilled') {
        const list = journeyResult.value || []
        setJourneys(list)
        // Enrich cards with per-type/difficulty counts from details (small N).
        const details = await Promise.allSettled(list.map((j) => getJourney(j.id)))
        if (cancelled) return
        const map = {}
        details.forEach((r, i) => {
          if (r.status === 'fulfilled') map[list[i].id] = r.value
        })
        setJourneyDetails(map)
      }
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const profile = progress?.profile || user?.profile
  const firstName = (user?.email || '').split('@')[0]
  const nextBest = progress?.next_best_activity
  const dueList = Array.isArray(progress?.due_reinforcement)
    ? progress.due_reinforcement
    : []
  const dueReinforcement = dueList[0]

  const stats = [
    { label: 'Level', value: profile?.level ?? 1 },
    { label: 'XP', value: profile?.xp ?? 0 },
    { label: 'Streak', value: `${profile?.streak_count ?? 0}d` },
    { label: 'Language', value: (profile?.language_pref ?? 'en').toUpperCase() },
  ]

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold text-slate-800">Welcome back, {firstName}! 👋</h1>
        <p className="mt-1 text-sm text-slate-500">Pick up where you left off — or just say hello to your mic.</p>
      </section>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-sky-100">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{stat.label}</p>
            <p className="mt-1 text-2xl font-bold text-sky-700">{stat.value}</p>
          </div>
        ))}
      </section>

      {(nextBest || dueReinforcement) && (
        <section className="grid gap-4 sm:grid-cols-2">
          {nextBest && (
            <button
              onClick={() =>
                navigate(
                  `/app/activities/${nextBest.id}?journey=${nextBest.journey_id ?? ''}`,
                )
              }
              className="group rounded-2xl bg-sky-600 p-5 text-left text-white shadow-card transition hover:bg-sky-700"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-200">Resume</p>
              <p className="mt-1 font-semibold">{nextBest.title || 'Your next activity'}</p>
              {nextBest.reason && <p className="mt-1 text-sm text-sky-100">{nextBest.reason}</p>}
              <span className="mt-3 inline-block text-sm font-medium group-hover:underline">
                Start now →
              </span>
            </button>
          )}
          {dueReinforcement && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                Reinforcement due
              </p>
              <p className="mt-1 font-semibold text-amber-900">
                {dueReinforcement.concept_title || 'Review a concept'}
              </p>
              <p className="mt-1 text-sm text-amber-700">
                Strengthen what you learned before it fades.
              </p>
              {dueReinforcement.recommended_activity?.id && (
                <Link
                  to={`/app/activities/${dueReinforcement.recommended_activity.id}`}
                  className="mt-3 inline-block text-sm font-medium text-amber-800 hover:underline"
                >
                  Review now →
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-800">Your journeys</h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-white/70" />
            ))}
          </div>
        ) : journeys.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-sky-300 bg-white/60 p-10 text-center">
            <p className="font-medium text-slate-600">No journeys yet</p>
            <p className="mt-1 text-sm text-slate-400">
              When your admin publishes a journey, it will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {journeys.map((j) => {
              const detail = journeyDetails[j.id]
              const activities = detail?.activities || []
              const typeCounts = activities.reduce((acc, a) => {
                acc[a.type] = (acc[a.type] || 0) + 1
                return acc
              }, {})
              const avgDifficulty = activities.length
                ? Math.round(
                    activities.reduce((sum, a) => sum + (a.difficulty || 1), 0) / activities.length,
                  )
                : 0
              return (
                <div
                  key={j.id}
                  className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-sky-100 transition hover:ring-sky-400"
                >
                  <Link to={`/app/journeys/${j.id}`} className="group block">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-800 group-hover:text-sky-700">{j.title}</h3>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-500">{j.description}</p>
                      </div>
                      <DifficultyDots level={avgDifficulty} />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {Object.entries(typeCounts).map(([type, count]) => (
                        <span
                          key={type}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            TYPE_COLORS[type] || 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {TYPE_META[type]?.icon} {TYPE_META[type]?.label || type} × {count}
                        </span>
                      ))}
                      {!detail && (
                        <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                          {j.activity_count} activities · {j.concept_count} concepts
                        </span>
                      )}
                    </div>
                  </Link>
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-sky-50 pt-4">
                    <Link
                      to={`/app/journeys/${j.id}/learn`}
                      className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
                    >
                      📖 Start learning
                    </Link>
                    <Link
                      to={`/app/journeys/${j.id}`}
                      className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
                    >
                      📝 Start the test
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
