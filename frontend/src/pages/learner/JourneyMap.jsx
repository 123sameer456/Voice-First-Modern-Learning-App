import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getJourney, getProgress } from '../../lib/learnerApi'
import { useAuth } from '../../context/AuthContext'

const TYPE_META = {
  scenario: { label: 'Scenario', icon: '🎭' },
  puzzle: { label: 'Puzzle', icon: '🧩' },
  simulation: { label: 'Simulation', icon: '🧭' },
  mission: { label: 'Mission', icon: '🎯' },
}

const LS_PREFIX = 'learner:completed:'

export function loadLocalCompleted(userId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`${LS_PREFIX}${userId}`) || '[]'))
  } catch {
    return new Set()
  }
}

export function saveLocalCompleted(userId, activityId) {
  try {
    const set = loadLocalCompleted(userId)
    set.add(activityId)
    localStorage.setItem(`${LS_PREFIX}${userId}`, JSON.stringify([...set]))
  } catch {
    /* storage unavailable */
  }
}

export default function JourneyMap() {
  const { id } = useParams()
  const { user } = useAuth()
  const [journey, setJourney] = useState(null)
  const [error, setError] = useState('')
  const [completedIds, setCompletedIds] = useState(new Set())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await getJourney(id)
        if (cancelled) return
        setJourney(data)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load journey')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    // Server-reported completions take precedence; localStorage fills the gap
    // until per-activity state exists server-side.
    const local = loadLocalCompleted(user?.id)
    setCompletedIds(new Set(local))
    getProgress()
      .then((progress) => {
        if (cancelled || !Array.isArray(progress?.completed_activity_ids)) return
        setCompletedIds((prev) => new Set([...prev, ...progress.completed_activity_ids]))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.id])

  if (error) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-card ring-1 ring-sky-100">
        <p className="font-medium text-red-600">{error}</p>
        <p className="mt-1 text-sm text-slate-400">This journey may have been unpublished.</p>
      </div>
    )
  }

  if (!journey) {
    return <div className="h-64 animate-pulse rounded-2xl bg-white/70" />
  }

  const concepts = [...(journey.concepts || [])].sort((a, b) => a.order - b.order)
  const activities = [...(journey.activities || [])].sort((a, b) => a.order - b.order)

  const groups = [
    ...concepts.map((c) => ({
      id: `c${c.id}`,
      title: c.title,
      description: c.description,
      activities: activities.filter((a) => a.concept_id === c.id),
    })),
    ...(activities.some((a) => a.concept_id == null)
      ? [
          {
            id: 'general',
            title: 'General',
            description: '',
            activities: activities.filter((a) => a.concept_id == null),
          },
        ]
      : []),
  ]

  // The first activity (in journey order) not yet completed is the current one;
  // everything after it is locked.
  const currentId = activities.find((a) => !completedIds.has(a.id))?.id ?? null

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">{journey.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{journey.description}</p>
        {journey.objectives?.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {journey.objectives.map((o) => (
              <li
                key={o}
                className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700"
              >
                {o}
              </li>
            ))}
          </ul>
        )}
      </header>

      {groups.map((group) => (
        <section key={group.id}>
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
              {group.title}
            </h2>
            <div className="h-px flex-1 bg-sky-100" />
          </div>
          {group.description && (
            <p className="mb-4 text-sm text-slate-500">{group.description}</p>
          )}
          <ol className="relative space-y-3 border-l-2 border-sky-100 pl-6">
            {group.activities.map((activity) => {
              const done = completedIds.has(activity.id)
              const isCurrent = activity.id === currentId
              const locked = !done && !isCurrent
              const meta = TYPE_META[activity.type] || { label: activity.type, icon: '✳️' }
              const body = (
                <div
                  className={`relative flex items-center gap-4 rounded-2xl bg-white p-4 ring-1 transition ${
                    isCurrent
                      ? 'ring-2 ring-sky-500'
                      : done
                        ? 'ring-sky-100'
                        : 'opacity-60 ring-sky-100'
                  }`}
                >
                  {isCurrent && (
                    <span className="absolute -inset-0.5 -z-10 animate-pulse rounded-2xl bg-sky-200/50" />
                  )}
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${
                      done
                        ? 'bg-sky-600 text-white'
                        : isCurrent
                          ? 'bg-sky-100 text-sky-700 ring-2 ring-sky-500'
                          : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {done ? (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                        <path
                          fillRule="evenodd"
                          d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : locked ? (
                      '🔒'
                    ) : (
                      meta.icon
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {activity.data?.prompt?.slice(0, 60) ||
                        activity.data?.instruction?.slice(0, 60) ||
                        activity.data?.briefing?.slice(0, 60) ||
                        `${meta.label} activity`}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {meta.label} · {activity.xp} XP
                    </p>
                  </div>
                  {isCurrent && (
                    <span className="rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white">
                      Start →
                    </span>
                  )}
                  {locked && (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-400">
                      Locked
                    </span>
                  )}
                </div>
              )
              return (
                <li key={activity.id} className="relative">
                  <span
                    className={`absolute -left-[1.95rem] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white ${
                      done ? 'bg-sky-600' : isCurrent ? 'bg-sky-400' : 'bg-slate-300'
                    }`}
                  />
                  {isCurrent ? (
                    <Link to={`/app/activities/${activity.id}?journey=${journey.id}`} className="block">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
