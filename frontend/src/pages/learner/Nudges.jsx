import { useEffect, useState } from 'react'
import { getNudges, markNudgeRead } from '../../lib/learnerApi'

const TYPE_ICONS = {
  streak: '🔥',
  reminder: '⏰',
  reinforcement: '🔁',
  achievement: '🏅',
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function Nudges() {
  const [nudges, setNudges] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let cancelled = false
    getNudges()
      .then((data) => !cancelled && setNudges(data || []))
      .catch((err) => !cancelled && setError(err.message || 'Could not load nudges.'))
    return () => {
      cancelled = true
    }
  }, [])

  const markRead = async (nudge) => {
    if (busyId) return
    setBusyId(nudge.id)
    const optimistic = nudges.map((n) => (n.id === nudge.id ? { ...n, status: 'read' } : n))
    setNudges(optimistic)
    try {
      await markNudgeRead(nudge.id)
    } catch {
      // roll back on failure
      setNudges((prev) => prev.map((n) => (n.id === nudge.id ? nudge : n)))
    } finally {
      setBusyId(null)
    }
  }

  const unreadCount = (nudges || []).filter((n) => n.status !== 'read').length

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">Nudges</h1>
        <p className="mt-1 text-sm text-slate-500">
          {nudges ? (unreadCount > 0 ? `${unreadCount} unread` : 'All caught up ✨') : 'Loading…'}
        </p>
      </header>

      {error && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</p>}

      {nudges && nudges.length === 0 && (
        <div className="rounded-2xl border border-dashed border-sky-300 bg-white/60 p-10 text-center">
          <p className="font-medium text-slate-600">No nudges yet</p>
          <p className="mt-1 text-sm text-slate-400">
            We'll nudge you about streaks, reviews and new content here.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {(nudges || []).map((nudge) => {
          const unread = nudge.status !== 'read'
          return (
            <li
              key={nudge.id}
              className={`flex items-start gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 transition ${
                unread ? 'ring-sky-200' : 'ring-slate-100 opacity-70'
              }`}
            >
              <span className="text-xl">{TYPE_ICONS[nudge.type] || '🔔'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold capitalize text-slate-800">
                    {String(nudge.type || 'nudge').replace('_', ' ')}
                  </p>
                  {unread && <span className="h-2 w-2 rounded-full bg-sky-500" />}
                </div>
                <p className="mt-0.5 text-sm text-slate-600">{nudge.message}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {formatDate(nudge.sent_at || nudge.scheduled_at)}
                </p>
              </div>
              {unread && (
                <button
                  onClick={() => markRead(nudge)}
                  disabled={busyId === nudge.id}
                  className="shrink-0 rounded-xl border border-sky-200 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-50 disabled:opacity-50"
                >
                  {busyId === nudge.id ? '…' : 'Mark read'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
