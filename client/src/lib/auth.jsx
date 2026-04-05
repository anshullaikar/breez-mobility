import { createContext, useContext, useState, useCallback } from 'react'
import { api } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    const saved = sessionStorage.getItem('breez_auth')
    return saved ? JSON.parse(saved) : null
  })

  const login = useCallback(async (type, credentials) => {
    let data
    if (type === 'passenger') {
      data = await api('POST', '/auth/verify-otp', credentials)
    } else if (type === 'driver') {
      data = await api('POST', '/auth/driver-login', credentials)
    } else if (type === 'admin') {
      data = await api('POST', '/auth/admin-login', credentials)
    }
    const authData = { token: data.token, user: data.user, type }
    setAuth(authData)
    sessionStorage.setItem('breez_auth', JSON.stringify(authData))
    return authData
  }, [])

  const sendOtp = useCallback(async (phone) => {
    return api('POST', '/auth/send-otp', { phone })
  }, [])

  const logout = useCallback(() => {
    setAuth(null)
    sessionStorage.removeItem('breez_auth')
  }, [])

  return (
    <AuthContext.Provider value={{ auth, login, sendOtp, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
