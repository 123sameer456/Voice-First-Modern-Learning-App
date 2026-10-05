import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const NAV_ITEMS = [
  { to: '/app', label: 'Home', end: true },
  { to: '/app/nudges', label: 'Nudges' },
  { to: '/app/profile', label: 'Profile' },
]

export default function LearnerLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-sky-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-600 text-xs font-bold text-white">
              LE
            </span>
            <span className="text-sm font-bold text-slate-800">Learning Engine</span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-xl px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-600 hover:bg-sky-50 hover:text-sky-700'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <button
              onClick={async () => {
                await logout()
                navigate('/login', { replace: true })
              }}
              className="ml-2 rounded-xl border border-sky-200 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 pb-28">
        <Outlet />
      </main>
    </div>
  )
}
