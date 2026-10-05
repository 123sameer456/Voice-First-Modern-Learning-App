import { api } from './api'

// --- Journeys (committed contract, docs/openapi.json) ---
export const getPublishedJourneys = () => api('/learner/journeys')

export const getJourney = (id) => api(`/learner/journeys/${id}`)

// --- Activity submission ---
// body: { answers, duration_s, hints_used, self_corrections, confidence (1-5), tasks_completed? }
export const submitActivity = (activityId, body) =>
  api(`/learner/activities/${activityId}/submit`, { method: 'POST', body })

// --- Progress / gamification ---
// Response (server contract): { profile?, next_best_activity?, due_reinforcement?,
//   mastery?: [{concept_id, concept_title, score, confidence, signal_breakdown}],
//   badges?: [{code, title, description, earned}], completed_activity_ids?: [int] }
export const getProgress = () => api('/learner/progress')

// --- Nudges ---
export const getNudges = () => api('/learner/nudges')

export const markNudgeRead = (nudgeId) =>
  api(`/learner/nudges/${nudgeId}/read`, { method: 'POST' })

// --- Voice ---
// { enabled, tts_model, voice_id, stability, similarity_boost, style, language,
//   stt_provider, cache_tts }
export const getVoiceConfig = () => api('/learner/voice-config')

// Returns the synthesized audio as a Blob (audio/mpeg) for playback via object URL.
export async function tts(text, language) {
  const BASE = import.meta.env.VITE_API_BASE_URL || '/api'
  const token = localStorage.getItem('access_token')
  const res = await fetch(`${BASE}/learner/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text, language }),
  })
  if (!res.ok) throw new Error(`TTS request failed (${res.status})`)
  return res.blob()
}
