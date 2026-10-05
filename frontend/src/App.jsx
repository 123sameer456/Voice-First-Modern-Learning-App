import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import LearnerHome from './pages/LearnerHome'
import LearnerLayout from './components/learner/LearnerLayout'
import JourneyMap from './pages/learner/JourneyMap'
import ActivityPlayer from './pages/learner/ActivityPlayer'
import Profile from './pages/learner/Profile'
import Nudges from './pages/learner/Nudges'
import AdminLayout from './pages/admin/AdminLayout'
import AdminDashboard from './pages/admin/AdminDashboard'

function Protected({ admin = false, children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (admin && user.role !== 'admin') return <Navigate to="/app" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/app"
            element={
              <Protected>
                <LearnerLayout />
              </Protected>
            }
          >
            <Route index element={<LearnerHome />} />
            <Route path="journeys/:id" element={<JourneyMap />} />
            <Route path="activities/:activityId" element={<ActivityPlayer />} />
            <Route path="profile" element={<Profile />} />
            <Route path="nudges" element={<Nudges />} />
          </Route>
          <Route
            path="/admin"
            element={
              <Protected admin>
                <AdminLayout />
              </Protected>
            }
          >
            <Route index element={<AdminDashboard />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
