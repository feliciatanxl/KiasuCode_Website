import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Navbar } from '../components/Navbar'
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter'
import { TelegramConnectModal } from '../components/TelegramConnectModal'
import { useAuth, type AuthUser } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import { apiRequest, formatApiError, getApiBaseUrl } from '../utils/api'

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? ''

interface SetPasswordResponse {
  success?: boolean
  message?: string
}

interface LinkGoogleResponse {
  success?: boolean
  message?: string
  user?: AuthUser
}

function EyeIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  )
}

function SelectChevron() {
  return (
    <svg
      className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-slate-400"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SettingsPageContent() {
  const { user, updateUser, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [isTelegramOpen, setIsTelegramOpen] = useState(false)
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false)
  const [hasLocalPassword, setHasLocalPassword] = useState(
    Boolean(user?.has_password || (user as unknown as { hasPassword?: boolean })?.hasPassword || user?.provider === 'local'),
  )

  useEffect(() => {
    if (typeof user?.has_password === 'boolean') {
      setHasLocalPassword(user.has_password)
    }
    apiRequest<{ has_password?: boolean; user?: { has_password?: boolean } }>('/api/auth/me')
      .then(({ data }) => {
        if (typeof data.has_password === 'boolean') {
          setHasLocalPassword(data.has_password)
        } else if (typeof data.user?.has_password === 'boolean') {
          setHasLocalPassword(data.user.has_password)
        }
      })
      .catch(() => {})
  }, [user])

  // Google Linking State
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false)

  // Spotify Integration State
  const [searchParams, setSearchParams] = useSearchParams()
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false)
  const [isCheckingSpotify, setIsCheckingSpotify] = useState(true)

  useEffect(() => {
    const spotifyParam = searchParams.get('spotify')
    if (spotifyParam === 'connected') {
      showToast('Spotify connected successfully! Steady pom pi pi!')
      setIsSpotifyConnected(true)
      setSearchParams(
        (params) => {
          params.delete('spotify')
          return params
        },
        { replace: true },
      )
    } else if (spotifyParam === 'error') {
      showToast('Could not link Spotify account. Please check your setup and try again.')
      setSearchParams(
        (params) => {
          params.delete('spotify')
          return params
        },
        { replace: true },
      )
    }

    apiRequest<{ connected: boolean }>('/api/spotify/status')
      .then(({ data }) => {
        setIsSpotifyConnected(Boolean(data.connected))
      })
      .catch(() => {
        if (user && 'hasSpotify' in user) {
          setIsSpotifyConnected(Boolean((user as unknown as { hasSpotify?: boolean }).hasSpotify))
        }
      })
      .finally(() => {
        setIsCheckingSpotify(false)
      })
  }, [searchParams, setSearchParams, showToast, user])

  const handleConnectSpotify = () => {
    window.location.href = `${getApiBaseUrl()}/api/auth/spotify`
  }

  const handleDisconnectSpotify = async () => {
    try {
      await apiRequest('/api/spotify/disconnect', { method: 'POST' })
      setIsSpotifyConnected(false)
      showToast('Spotify account disconnected.')
    } catch {
      showToast('Failed to disconnect Spotify account.')
    }
  }

  // Password Modal State
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isSettingPassword, setIsSettingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Delete Account Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('')
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Settings states
  const [telegramReminders, setTelegramReminders] = useState(true)
  const [gradingScale, setGradingScale] = useState('UNI')
  const [defaultTerm, setDefaultTerm] = useState('Semester 1')

  const provider = user?.provider || 'local'
  const isGoogleLinked = provider === 'google' || Boolean(user?.googleId)
  const displayEmail = user?.email?.trim() ? user.email : 'None'

  const linkGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setIsLinkingGoogle(true)
      try {
        const response = await apiRequest<LinkGoogleResponse>(
          '/api/user/link-google',
          {
            method: 'POST',
            body: JSON.stringify({ credential: tokenResponse.access_token }),
          },
        )

        if (response.data.user) {
          updateUser(response.data.user)
        }
        showToast('Google account linked successfully.')
      } catch (err) {
        showToast(formatApiError(err))
      } finally {
        setIsLinkingGoogle(false)
      }
    },
    onError: () => {
      showToast('Google linking was cancelled.')
    },
  })

  const handleSetPassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPasswordError(null)

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters long.')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }

    setIsSettingPassword(true)

    try {
      await apiRequest<SetPasswordResponse>(
        '/api/auth/set-password',
        {
          method: 'POST',
          body: JSON.stringify({ password: newPassword }),
        },
      )

      setHasLocalPassword(true)
      setIsPasswordModalOpen(false)
      setNewPassword('')
      setConfirmPassword('')
      showToast(hasLocalPassword ? 'Local password updated successfully.' : 'Local password configured successfully.')
    } catch (error) {
      setPasswordError(formatApiError(error))
    } finally {
      setIsSettingPassword(false)
    }
  }

  const handleDeleteAccount = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (deleteConfirmationText !== 'DELETE') {
      setDeleteError('Please type DELETE exactly to confirm.')
      return
    }

    setIsDeletingAccount(true)
    setDeleteError(null)

    try {
      await apiRequest<{ success: boolean }>(
        '/api/user/me',
        { method: 'DELETE' },
      )

      showToast('Account permanently deleted.')
      await logout()
      navigate('/login', { replace: true })
    } catch (err) {
      setDeleteError(formatApiError(err))
      setIsDeletingAccount(false)
    }
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    showToast('Preferences saved successfully.')
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-900 dark:text-slate-100 flex flex-col justify-between">
      <Navbar onConnectTelegram={() => setIsTelegramOpen(true)} />

      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8 flex-1">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <span>Settings</span>
              <span>/</span>
              <span>Preferences</span>
            </div>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100">
              Application Settings
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Manage authentication providers, account syncing, appearance, and privacy defaults.
            </p>
          </div>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-700/80 whitespace-nowrap shrink-0"
          >
            <span>Back to Dashboard</span>
            <span>→</span>
          </Link>
        </div>

        <form onSubmit={handleSave} className="grid gap-6">
          {/* Account Overview & Email Display */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-800/80">
            <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-800/40">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Account Information
              </h2>
            </div>
            <div className="p-6 grid gap-4 sm:grid-cols-2">
              <div>
                <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Student Name
                </span>
                <span className="mt-1 block text-sm font-bold text-slate-900 dark:text-white">
                  {user?.name || 'Student'}
                </span>
              </div>
              <div>
                <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Registered Email
                </span>
                <span className="mt-1 block text-sm font-bold text-slate-900 dark:text-white">
                  {displayEmail}
                </span>
              </div>
            </div>
          </section>

          {/* Connected Authentication Providers */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-800/80">
            <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-800/40">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Connected Authentication Providers
              </h2>
            </div>

            <div className="divide-y divide-slate-100 p-6 dark:divide-slate-700/50">
              {/* Local Credentials */}
              <div className="flex items-center justify-between pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700">
                    🔑
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Local Password
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Standard email & password authentication
                    </p>
                  </div>
                </div>
                <div>
                  {provider === 'local' || hasLocalPassword ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        {provider === 'local' ? 'Primary' : 'Configured'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setPasswordError(null)
                          setNewPassword('')
                          setConfirmPassword('')
                          setIsPasswordModalOpen(true)
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Change Password
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordError(null)
                        setNewPassword('')
                        setConfirmPassword('')
                        setIsPasswordModalOpen(true)
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Set Password
                    </button>
                  )}
                </div>
              </div>

              {/* Telegram */}
              <div className="flex items-center justify-between py-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-[#229ed9]/10 text-[#229ed9] dark:bg-[#229ed9]/20">
                    ➤
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Telegram Bot Sync
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Sync modules and query GPA directly inside Telegram
                    </p>
                  </div>
                </div>
                <div>
                  {provider === 'telegram' ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      Connected
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsTelegramOpen(true)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Connect Telegram
                    </button>
                  )}
                </div>
              </div>

              {/* Google */}
              <div className="flex items-center justify-between pt-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700">
                    <svg className="size-4" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Google OAuth
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Single sign-on via Google workspace
                    </p>
                  </div>
                </div>
                <div>
                  {isGoogleLinked ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      Connected
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isLinkingGoogle || !googleClientId}
                      onClick={() => linkGoogleLogin()}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <svg className="size-3.5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" />
                        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z" />
                        <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                      </svg>
                      <span>{isLinkingGoogle ? 'Linking…' : 'Link Google'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Spotify */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-700/60">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-[#1DB954]/10 text-[#1DB954] dark:bg-[#1DB954]/20">
                    <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Spotify Integration
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Connect your account to view live playback in Pomodoro focus sprints
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isSpotifyConnected ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Connected
                      </span>
                      <button
                        type="button"
                        onClick={handleDisconnectSpotify}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-red-400"
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={isCheckingSpotify}
                      onClick={handleConnectSpotify}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-500/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                    >
                      <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                      </svg>
                      <span>Connect Spotify</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Appearance Section */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-800/80">
            <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-800/40">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Appearance & Theme
              </h2>
            </div>

            <div className="p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Interface Theme
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Switch between dark engineering mode and light documentation mode.
                  </p>
                </div>

                <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-900 shrink-0">
                  <button
                    type="button"
                    onClick={() => theme === 'dark' && toggleTheme()}
                    className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                      theme === 'light'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <span>☀️</span>
                    <span>Light</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => theme === 'light' && toggleTheme()}
                    className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                      theme === 'dark'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    <span>🌙</span>
                    <span>Dark</span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Notifications Section */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-800/80">
            <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-800/40">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Notification Preferences
              </h2>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-700/60">
              <div className="flex items-center justify-between gap-4 p-6">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Telegram Calendar Alerts
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Receive automated reminders in your Telegram chat when exams and assignment deadlines on your calendar are approaching.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={telegramReminders}
                  aria-label="Telegram Calendar Alerts"
                  onClick={() => setTelegramReminders((enabled) => !enabled)}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-slate-800 ${
                    telegramReminders ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                >
                  <span
                    className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow-sm transition-transform ${
                      telegramReminders ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>

          {/* Academic Settings Section */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-800/80">
            <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-800/40">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Academic Settings
              </h2>
            </div>

            <div className="grid gap-4 p-6 sm:grid-cols-2">
              <div>
                <label htmlFor="grading-scale" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Default Grading Scale
                </label>
                <div className="relative mt-1.5">
                  <select
                    id="grading-scale"
                    value={gradingScale}
                    onChange={(e) => setGradingScale(e.target.value)}
                    className="block w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3.5 pr-12 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="UNI">5.0 Scale (NUS / NTU / SIT / SMU / SUTD)</option>
                    <option value="POLY">4.0 Scale (Polytechnics: NYP / NP / SP / TP / RP)</option>
                    <option value="ITE">4.0 Scale (Institute of Technical Education)</option>
                  </select>
                  <SelectChevron />
                </div>
              </div>

              <div>
                <label htmlFor="default-term" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Default Semester Term
                </label>
                <div className="relative mt-1.5">
                  <select
                    id="default-term"
                    value={defaultTerm}
                    onChange={(e) => setDefaultTerm(e.target.value)}
                    className="block w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3.5 pr-12 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="Semester 1">Semester 1</option>
                    <option value="Semester 2">Semester 2</option>
                    <option value="Special Term 1">Special Term 1</option>
                    <option value="Special Term 2">Special Term 2</option>
                  </select>
                  <SelectChevron />
                </div>
              </div>
            </div>
          </section>

          {/* Danger Zone: Hard Delete Account */}
          <section className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-sm dark:border-red-900/60 dark:bg-slate-800/80">
            <div className="border-b border-red-100 bg-red-50/50 px-6 py-4 dark:border-red-900/40 dark:bg-red-950/20">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
                Danger Zone
              </h2>
            </div>
            <div className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Delete Student Account
                </h4>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 max-w-lg">
                  Permanently delete your account, virtual companion, study logs, encrypted messages, and module countdowns. This action is irreversible.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmationText('')
                  setDeleteError(null)
                  setIsDeleteModalOpen(true)
                }}
                className="shrink-0 rounded-xl bg-red-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
              >
                Delete Account
              </button>
            </div>
          </section>

          <div className="flex justify-end">
            <button
              type="submit"
              className="shrink-0 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              Save Preferences
            </button>
          </div>
        </form>
      </main>

      {/* Set / Change Password Modal */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {hasLocalPassword ? 'Change Local Password' : 'Set Local Password'}
              </h3>
              <button
                type="button"
                onClick={() => setIsPasswordModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {hasLocalPassword
                ? 'Update your password for standard email and password sign-in.'
                : 'Link a local password to enable standard email and password sign-in for your account.'}
            </p>

            <form onSubmit={handleSetPassword} className="mt-4 space-y-4">
              {passwordError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                  {passwordError}
                </div>
              )}

              <div>
                <label
                  htmlFor="set-new-password"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                >
                  New Password
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="set-new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="block w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600 focus:outline-none dark:hover:text-slate-200"
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    title={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                  </button>
                </div>
                <PasswordStrengthMeter password={newPassword} />
              </div>

              <div>
                <label
                  htmlFor="set-confirm-password"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                >
                  Confirm Password
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="set-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="block w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600 focus:outline-none dark:hover:text-slate-200"
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    title={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  >
                    {showConfirmPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsPasswordModalOpen(false)
                    navigate('/forgot-password')
                  }}
                  className="text-left text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  Forgot password? Reset via OTP →
                </button>
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsPasswordModalOpen(false)}
                    disabled={isSettingPassword}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSettingPassword}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSettingPassword
                      ? hasLocalPassword
                        ? 'Updating Password…'
                        : 'Setting Password…'
                      : hasLocalPassword
                        ? 'Change Password'
                        : 'Set Password'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-2xl dark:border-red-900/60 dark:bg-slate-800 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-red-100 text-2xl text-red-600 dark:bg-red-950/60 dark:text-red-400">
                ⚠️
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Permanently Delete Account?
                </h3>
                <span className="text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                  This action is irreversible
                </span>
              </div>
            </div>

            <p className="my-6 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              This will permanently delete your account, academic records, countdowns, focus coins, virtual pets, and encrypted chat messages.
            </p>

            <form onSubmit={handleDeleteAccount} className="space-y-4">
              {deleteError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                  {deleteError}
                </div>
              )}

              <div>
                <label
                  htmlFor="delete-confirm-input"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5"
                >
                  To confirm, type <span className="font-mono font-black text-red-600 dark:text-red-400">DELETE</span> below:
                </label>
                <input
                  id="delete-confirm-input"
                  type="text"
                  required
                  value={deleteConfirmationText}
                  onChange={(e) => setDeleteConfirmationText(e.target.value)}
                  placeholder="DELETE"
                  className="block w-full rounded-lg border border-red-300 bg-white px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder-slate-400 shadow-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-red-800 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDeleteModalOpen(false)}
                  disabled={isDeletingAccount}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDeletingAccount || deleteConfirmationText !== 'DELETE'}
                  className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isDeletingAccount ? 'Deleting Account…' : 'Permanently Delete Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <TelegramConnectModal
        isOpen={isTelegramOpen}
        onClose={() => setIsTelegramOpen(false)}
      />
    </div>
  )
}

export function SettingsPage() {
  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <SettingsPageContent />
    </GoogleOAuthProvider>
  )
}
