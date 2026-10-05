import { useCallback, useEffect, useState } from 'react'
import {
  createUser,
  listUsers,
  resetPassword,
  updateUser,
} from '../../lib/adminApi'
import { useAuth } from '../../context/AuthContext'

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return value
  }
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card ring-1 ring-sky-100">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-sky-50 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

const inputClass =
  'mt-1 w-full rounded-xl border border-sky-200 px-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200'

function CreateUserModal({ onClose, onCreated }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('learner')
  const [languagePref, setLanguagePref] = useState('en')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setSubmitting(true)
    try {
      await createUser({ email: email.trim(), password, role, language_pref: languagePref })
      onCreated()
    } catch (err) {
      setError(err.message || 'Failed to create user.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title="Create user" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-500">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Password (min. 8 chars)</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
              <option value="learner">learner</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Language</label>
            <select value={languagePref} onChange={(e) => setLanguagePref(e.target.value)} className={inputClass}>
              <option value="en">English (en)</option>
              <option value="ur">Urdu (ur)</option>
            </select>
          </div>
        </div>
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ResetPasswordModal({ user, onClose }) {
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setSubmitting(true)
    try {
      await resetPassword(user.id, newPassword)
      setDone(true)
    } catch (err) {
      setError(err.message || 'Failed to reset password.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={`Reset password — ${user.email}`} onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Password updated.</p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-sky-700"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500">New password (min. 8 chars)</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-sky-200 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Reset password'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

export default function AdminUsers() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [rowErrors, setRowErrors] = useState({})
  const [showCreate, setShowCreate] = useState(false)
  const [resetTarget, setResetTarget] = useState(null)
  const [busyUserId, setBusyUserId] = useState(null)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setPageError('')
    try {
      setUsers(await listUsers())
    } catch (e) {
      setPageError(e.message || 'Failed to load users.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const setRowError = (userId, message) => {
    setRowErrors((prev) => ({ ...prev, [userId]: message }))
  }

  const handleUpdate = async (user, patch, confirmMessage) => {
    setRowError(user.id, '')
    if (confirmMessage && !window.confirm(confirmMessage)) return
    setBusyUserId(user.id)
    try {
      const updated = await updateUser(user.id, patch)
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updated } : u)))
    } catch (err) {
      setRowError(user.id, err.message || 'Update failed.')
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Users</h1>
          <p className="mt-1 text-sm text-slate-500">Manage admin and learner accounts.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-700"
        >
          Create user
        </button>
      </div>

      {pageError && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{pageError}</p>}

      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-card ring-1 ring-sky-100">
        <table className="min-w-full divide-y divide-sky-100 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Active</th>
              <th className="px-5 py-3 font-medium">XP</th>
              <th className="px-5 py-3 font-medium">Level</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sky-50">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                  <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isSelf = currentUser?.id === user.id
                const busy = busyUserId === user.id
                return (
                  <tr key={user.id} className="hover:bg-sky-50/50">
                    <td className="px-5 py-3 font-medium text-slate-700">
                      {user.email}
                      {isSelf && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700">you</span>}
                    </td>
                    <td className="px-5 py-3">
                      <select
                        value={user.role}
                        disabled={busy}
                        onChange={(e) =>
                          handleUpdate(
                            user,
                            { role: e.target.value },
                            `Change role of ${user.email} to "${e.target.value}"?`
                          )
                        }
                        className={`rounded-lg border px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-200 ${
                          user.role === 'admin'
                            ? 'border-sky-200 bg-sky-50 text-sky-700'
                            : 'border-slate-200 bg-slate-50 text-slate-600'
                        }`}
                      >
                        <option value="learner">learner</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        disabled={busy || isSelf}
                        title={isSelf ? 'You cannot deactivate your own account' : undefined}
                        onClick={() =>
                          handleUpdate(
                            user,
                            { is_active: !user.is_active },
                            `${user.is_active ? 'Deactivate' : 'Activate'} ${user.email}?`
                          )
                        }
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition disabled:opacity-40 ${
                          user.is_active ? 'bg-sky-600' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                            user.is_active ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{user.xp}</td>
                    <td className="px-5 py-3 text-slate-600">{user.level}</td>
                    <td className="px-5 py-3 text-slate-500">{formatDate(user.created_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setResetTarget(user)}
                        className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-50"
                      >
                        Reset password
                      </button>
                      {rowErrors[user.id] && (
                        <p className="mt-1 max-w-xs text-xs text-red-600">{rowErrors[user.id]}</p>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            loadUsers()
          }}
        />
      )}
      {resetTarget && <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />}
    </div>
  )
}
