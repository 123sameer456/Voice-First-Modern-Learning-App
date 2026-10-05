import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { getProgress } from '../../lib/learnerApi'

const SIGNAL_LABELS = {
  correctness: 'Correct answers',
  hints_used: 'Hint usage',
  self_corrections: 'Self-corrections',
  confidence: 'Confidence',
  duration_s: 'Time on task',
}

function MasteryCard({ mastery }) {
  const [open, setOpen] = useState(false)
  const score = Math.round(mastery.score ?? 0)
  const breakdown = mastery.signal_breakdown || {}
  const entries = Object.entries(breakdown)
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-sky-100">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-800">{mastery.concept_title || 'Concept'}</p>
          <p className="text-xs text-slate-400">
            Confidence: {mastery.confidence != null ? `${mastery.confidence}` : '—'}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            score >= 70 ? 'bg-sky-600 text-white' : score >= 40 ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {score}%
        </span>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-sky-100">
        <div
          className="h-full rounded-full bg-sky-600 transition-all duration-700"
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
      {entries.length > 0 && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-3 text-xs font-medium text-sky-700 hover:underline"
          >
            {open ? 'Hide' : 'Why this level?'}
          </button>
          {open && (
            <ul className="mt-2 space-y-1 rounded-xl bg-sky-50 p-3 text-xs text-sky-900/80">
              {entries.map(([signal, value]) => (
                <li key={signal}>
                  • {SIGNAL_LABELS[signal] || signal}: {typeof value === 'number' ? value.toFixed(2) : String(value)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

export default function Profile() {
  const { user } = useAuth()
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getProgress()
      .then((data) => !cancelled && setProgress(data))
      .catch((err) => !cancelled && setError(err.message || 'Could not load progress.'))
    return () => {
      cancelled = true
    }
  }, [])

  const profile = progress?.profile || user?.profile
  const mastery = progress?.mastery || []
  const badges = progress?.badges || []
  const earned = badges.filter((b) => b.earned)
  const locked = badges.filter((b) => !b.earned)
  const languagePref = (profile?.language_pref || 'en').toUpperCase()

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">Your progress</h1>
        <p className="mt-1 text-sm text-slate-500">
          {(user?.email || '').split('@')[0]} · Language preference: {languagePref}
        </p>
      </header>

      {error && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {error} — showing what we know locally.
        </p>
      )}

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Level', value: profile?.level ?? 1 },
          { label: 'XP', value: profile?.xp ?? 0 },
          { label: 'Streak', value: `${profile?.streak_count ?? 0}d` },
          { label: 'Language', value: languagePref },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-sky-100">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{stat.label}</p>
            <p className="mt-1 text-2xl font-bold text-sky-700">{stat.value}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-800">Mastery by concept</h2>
        {mastery.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-sky-300 bg-white/60 p-6 text-center text-sm text-slate-400">
            Complete activities to build mastery.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {mastery.map((m) => (
              <MasteryCard key={m.concept_id ?? m.concept_title} mastery={m} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-800">
          Badges{' '}
          <span className="text-sm font-medium text-slate-400">
            {earned.length}/{badges.length}
          </span>
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[...earned, ...locked].map((badge) => (
            <div
              key={badge.code || badge.title}
              className={`rounded-2xl p-4 text-center shadow-card ring-1 transition ${
                badge.earned ? 'bg-white ring-amber-200' : 'bg-white/60 ring-slate-100 opacity-60'
              }`}
            >
              <p className="text-3xl">{badge.earned ? '🏅' : '🔒'}</p>
              <p className="mt-2 text-sm font-semibold text-slate-800">{badge.title || badge.code}</p>
              {badge.description && (
                <p className="mt-1 text-xs text-slate-400">{badge.description}</p>
              )}
            </div>
          ))}
          {badges.length === 0 && (
            <p className="col-span-full rounded-2xl border border-dashed border-sky-300 bg-white/60 p-6 text-center text-sm text-slate-400">
              Badges will appear here as you learn.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
