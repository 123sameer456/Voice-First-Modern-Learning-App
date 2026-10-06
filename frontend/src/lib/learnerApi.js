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

// --- Study mode (learn from the source material, then voice Q&A) ---
export const getJourneySource = (id) => api(`/learner/journeys/${id}/source`)

// body: { count (1-5, default 5), language 'en'|'ur', avoid: [previously asked questions] }
export const getStudyQuestions = (journeyId, body) =>
  api(`/learner/journeys/${journeyId}/study/questions`, { method: 'POST', body })

// body: { question, answer (transcript), language 'en'|'ur' } -> { correct, feedback }
export const evaluateStudyAnswer = (journeyId, body) =>
  api(`/learner/journeys/${journeyId}/study/evaluate`, { method: 'POST', body })

// Two-way voice tutoring conversation (stateless — client sends recent history).
// body: { messages: [{role: 'user'|'tutor', text}], language 'en'|'ur' } -> { reply }
export const studyChat = (journeyId, body) =>
  api(`/learner/journeys/${journeyId}/study/chat`, { method: 'POST', body })

// --- Voice (server proxies ElevenLabs; browser STT stays client-side) ---
// GET /voice/config -> { enabled, stt_provider, language }
export const getVoiceConfig = () => api('/voice/config')

// Returns the synthesized audio as a Blob (audio/mpeg) for playback via object URL.
export async function tts(text, language) {
  const BASE = import.meta.env.VITE_API_BASE_URL || '/api'
  const token = localStorage.getItem('access_token')
  const res = await fetch(`${BASE}/voice/tts`, {
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
