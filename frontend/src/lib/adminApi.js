import { api, ApiError, tryRefresh } from './api'

const BASE = import.meta.env.VITE_API_BASE_URL || '/api'

// The shared `api` wrapper always sends JSON. Content upload is multipart
// (the browser must set the Content-Type boundary), so it gets its own
// fetch path that mirrors api.js auth + refresh behaviour.
async function apiMultipart(path, formData) {
  const headers = {}
  const token = localStorage.getItem('access_token')
  if (token) headers.Authorization = `Bearer ${token}`

  const send = () =>
    fetch(`${BASE}${path}`, { method: 'POST', headers, body: formData })

  let res = await send()
  if (res.status === 401) {
    if (await tryRefresh()) {
      headers.Authorization = `Bearer ${localStorage.getItem('access_token')}`
      res = await send()
    } else {
      window.dispatchEvent(new Event('auth:logout'))
      throw new ApiError(401, 'Session expired')
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (Array.isArray(data.detail)) message = data.detail.map((d) => d.msg).join(', ')
    } catch {
      /* keep default message */
    }
    throw new ApiError(res.status, message)
  }
  return res.json()
}

// ---- Content sources ----

export const createContent = (formData) => apiMultipart('/admin/content', formData)

export const listContent = () => api('/admin/content')

export const deleteContent = (sourceId) => api(`/admin/content/${sourceId}`, { method: 'DELETE' })

// config: optional { activity_mix: { scenario, puzzle, simulation, mission } }
export const generateJourney = (sourceId, config) =>
  api(`/admin/content/${sourceId}/generate`, { method: 'POST', body: config ?? undefined })

// ---- Journeys ----

export const listJourneys = () => api('/admin/journeys')

export const getJourney = (journeyId) => api(`/admin/journeys/${journeyId}`)

export const publishJourney = (journeyId) =>
  api(`/admin/journeys/${journeyId}/publish`, { method: 'POST' })

export const unpublishJourney = (journeyId) =>
  api(`/admin/journeys/${journeyId}/unpublish`, { method: 'POST' })

export const deleteJourney = (journeyId) =>
  api(`/admin/journeys/${journeyId}`, { method: 'DELETE' })

// Per-course settings overrides (see Settings page course dropdown)
export const getJourneySettings = (journeyId) =>
  api(`/admin/journeys/${journeyId}/settings`)

export const updateJourneySetting = (journeyId, group, value) =>
  api(`/admin/journeys/${journeyId}/settings/${group}`, { method: 'PUT', body: { value } })

// ---- Users ----

export const listUsers = () => api('/admin/users')

export const createUser = ({ email, password, role, language_pref }) =>
  api('/admin/users', { method: 'POST', body: { email, password, role, language_pref } })

export const updateUser = (userId, patch) =>
  api(`/admin/users/${userId}`, { method: 'PATCH', body: patch })

export const resetPassword = (userId, newPassword) =>
  api(`/admin/users/${userId}/reset-password`, {
    method: 'POST',
    body: { new_password: newPassword },
  })

// ---- Settings & stats ----

export const getSettings = () => api('/admin/settings')

export const updateSetting = (key, partialValue) =>
  api(`/admin/settings/${key}`, { method: 'PUT', body: { value: partialValue } })

export const getStats = () => api('/admin/stats')
