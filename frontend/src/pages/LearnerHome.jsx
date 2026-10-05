import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function LearnerHome() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const profile = user?.profile

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Welcome{profile ? `, ${user.email.split('@')[0]}` : ''}!
          </h1>
          <p className="text-sm text-slate-500">Your learning journey lives here.</p>
        </div>
        <button
          onClick={async () => {
            await logout()
            navigate('/login', { replace: true })
          }}
          className="rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
        >
          Sign out
        </button>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Level', value: profile?.level ?? 1 },
          { label: 'XP', value: profile?.xp ?? 0 },
          { label: 'Streak', value: `${profile?.streak_count ?? 0}d` },
          { label: 'Language', value: (profile?.language_pref ?? 'en').toUpperCase() },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-sky-100">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{stat.label}</p>
            <p className="mt-1 text-2xl font-bold text-sky-700">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-sky-300 bg-white/60 p-10 text-center">
        <p className="font-medium text-slate-600">Journey map coming in Phase 3</p>
        <p className="mt-1 text-sm text-slate-400">
          Missions, scenarios, puzzles and simulations will appear here.
        </p>
      </div>
    </div>
  )
}
