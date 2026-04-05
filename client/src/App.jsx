import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import LoginPage from './pages/Login'
import PassengerPage from './pages/Passenger'
import DriverPage from './pages/Driver'
import AdminPage from './pages/Manager'

function ProtectedRoute({ children, allowedRoles }) {
  const { auth } = useAuth()
  if (!auth) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(auth.user.role)) {
    return <Navigate to="/login" replace />
  }
  return children
}

function AppRoutes() {
  const { auth } = useAuth()

  // Redirect root to appropriate page based on role
  const getDefaultRoute = () => {
    if (!auth) return '/login'
    switch (auth.type) {
      case 'passenger': return '/passenger'
      case 'driver': return '/driver'
      case 'admin': return '/manager'
      default: return '/login'
    }
  }

  return (
    <Routes>
      <Route path="/login" element={auth ? <Navigate to={getDefaultRoute()} replace /> : <LoginPage />} />
      <Route path="/passenger" element={
        <ProtectedRoute allowedRoles={['PASSENGER']}>
          <PassengerPage />
        </ProtectedRoute>
      } />
      <Route path="/driver" element={
        <ProtectedRoute allowedRoles={['DRIVER']}>
          <DriverPage />
        </ProtectedRoute>
      } />
      <Route path="/manager" element={
        <ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN']}>
          <AdminPage />
        </ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to={getDefaultRoute()} replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
