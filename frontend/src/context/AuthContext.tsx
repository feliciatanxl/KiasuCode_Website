import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'

import { getApiBaseUrl, setUnauthorizedHandler } from '../utils/api'

export type AuthProviderName = 'telegram' | 'google' | 'local'

export interface AuthUser {
  id: string
  name: string
  email?: string
  photoUrl?: string
  provider: AuthProviderName
  hasConsented?: boolean
  has_password?: boolean
  telegramChatId?: string
  googleId?: string
  hasSpotify?: boolean
}

interface AuthContextValue {
  isAuthenticated: boolean
  isLoading: boolean
  user: AuthUser | null
  login: (user: AuthUser) => void
  logout: () => Promise<void>
  updateUser: (user: AuthUser) => void
}

interface SessionResponse {
  user: AuthUser
}

const legacyStorageKeys = [
  'kiasucode.auth.session',
  'kiasucode.auth.user',
]
const AuthContext = createContext<AuthContextValue | null>(null)

function isAuthProvider(value: unknown): value is AuthProviderName {
  return value === 'telegram' || value === 'google' || value === 'local'
}

// oxlint-disable-next-line react/only-export-components -- Runtime guard accompanies the shared auth type.
export function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== 'object') return false

  const user = value as Partial<AuthUser>

  return (
    typeof user.id === 'string'
    && user.id.length > 0
    && typeof user.name === 'string'
    && user.name.length > 0
    && (user.email === undefined || typeof user.email === 'string')
    && (user.photoUrl === undefined || typeof user.photoUrl === 'string')
    && (user.hasConsented === undefined || typeof user.hasConsented === 'boolean')
    && (user.has_password === undefined || typeof user.has_password === 'boolean')
    && (user.telegramChatId === undefined || typeof user.telegramChatId === 'string')
    && (user.googleId === undefined || typeof user.googleId === 'string')
    && (user.hasSpotify === undefined || typeof user.hasSpotify === 'boolean')
    && isAuthProvider(user.provider)
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const restoreControllerRef = useRef<AbortController | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    for (const key of legacyStorageKeys) window.localStorage.removeItem(key)

    const controller = new AbortController()
    restoreControllerRef.current = controller

    void fetch(`${getApiBaseUrl()}/auth/session`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          setUser(null)
          return
        }

        const body = (await response.json().catch(() => null)) as
          | Partial<SessionResponse>
          | null

        if (!response.ok || !isAuthUser(body?.user)) {
          throw new Error('Unable to restore the browser session.')
        }

        setUser(body.user)
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Unable to restore authentication session.', error)
          setUser(null)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
        if (restoreControllerRef.current === controller) {
          restoreControllerRef.current = null
        }
      })

    return () => {
      controller.abort()
      if (restoreControllerRef.current === controller) {
        restoreControllerRef.current = null
      }
    }
  }, [])

  useEffect(
    () => setUnauthorizedHandler(() => {
      if (localStorage.getItem('kiasucode_timer_active') === 'true') {
        void fetch(`${getApiBaseUrl()}/api/auth/me`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }).catch((error) => {
          console.error('Failed to keep session alive during active timer:', error)
        })
        return
      }

      setUser(null)
      setIsLoading(false)
      navigate('/login', {
        replace: true,
        state: { reason: 'session-expired' },
      })
    }),
    [navigate],
  )

  const login = useCallback((authenticatedUser: AuthUser) => {
    restoreControllerRef.current?.abort()
    restoreControllerRef.current = null
    setUser(authenticatedUser)
    setIsLoading(false)
  }, [])

  const logout = useCallback(async () => {
    restoreControllerRef.current?.abort()
    restoreControllerRef.current = null
    setUser(null)
    setIsLoading(false)

    try {
      await fetch(`${getApiBaseUrl()}/auth/session`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
    } catch (error) {
      console.error('Unable to notify the server about logout.', error)
    }
  }, [])

  const updateUser = useCallback((updatedUser: AuthUser) => {
    setUser(updatedUser)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: user !== null,
      isLoading,
      user,
      login,
      logout,
      updateUser,
    }),
    [isLoading, login, logout, updateUser, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// oxlint-disable-next-line react/only-export-components -- Provider and hook form one public auth API.
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)

  if (!context) throw new Error('useAuth must be used inside an AuthProvider')

  return context
}
