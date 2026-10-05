const STATS = [
  { label: 'Active learners', value: '—' },
  { label: 'Journeys published', value: '—' },
  { label: 'Avg. mastery', value: '—' },
  { label: '7-day retention', value: '—' },
]

export default function AdminDashboard() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">
        Engagement, progress and mastery metrics arrive in Phase 6.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-sky-100">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{stat.label}</p>
            <p className="mt-2 text-3xl font-bold text-sky-700">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-sky-300 bg-white/60 p-10 text-center">
        <p className="font-medium text-slate-600">Charts and CSV export coming in Phase 6</p>
      </div>
    </div>
  )
}
