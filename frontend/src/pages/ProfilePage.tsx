import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { Link } from 'react-router-dom'

import { ActivityCalendar } from '../components/ActivityCalendar'
import { Navbar } from '../components/Navbar'
import { TelegramConnectModal } from '../components/TelegramConnectModal'
import { useAuth, type AuthUser } from '../context/AuthContext'
import { useSocket } from '../context/SocketContext'
import { useToast } from '../context/ToastContext'
import { apiRequest, formatApiError, isAbortError } from '../utils/api'

interface ProfileUpdateResponse {
  success?: boolean
  user: AuthUser
}

interface UserPresenceResponse {
  status: 'online' | 'offline'
  roomId: string | null
}

interface SpotifyPlaybackResponse {
  connected: boolean
  isPlaying: boolean
  track: {
    id: string
    name: string
    artist: string
    albumName: string
    albumArtUrl: string | null
    isPlaying: boolean
    spotifyUrl: string | null
  } | null
}

const maxProfileImageBytes = 2 * 1024 * 1024
const supportedProfileImageTypes = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Unable to read the selected image.'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the selected image.'))
    reader.readAsDataURL(file)
  })
}

export function ProfilePage() {
  const { user, updateUser } = useAuth()
  const { getUserPresence } = useSocket()
  const { showToast } = useToast()

  const [isTelegramOpen, setIsTelegramOpen] = useState(false)

  // Live Presence Status
  const [presence, setPresence] = useState<UserPresenceResponse>({
    status: 'offline',
    roomId: null,
  })

  const livePres = user ? getUserPresence(user.id) : null
  const currentPresence = livePres && livePres.status === 'online' ? livePres : presence

  // Profile Edit State
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(user?.name || 'Felicia Tan')
  const [editPhotoUrl, setEditPhotoUrl] = useState(user?.photoUrl || '')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const displayName = user?.name || editName || 'Student'
  const displayEmail = user?.email?.trim() ? user.email : 'None'

  const userInitials = displayName
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  useEffect(() => {
    const controller = new AbortController()

    void apiRequest<UserPresenceResponse>('/api/user/presence', {
      signal: controller.signal,
    })
      .then(({ data }) => setPresence(data))
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          console.error('Failed to load user presence:', err)
        }
      })

    return () => controller.abort()
  }, [])

  // Live Spotify Playback State
  const [spotifyData, setSpotifyData] = useState<SpotifyPlaybackResponse | null>(null)

  useEffect(() => {
    let isSubscribed = true

    const fetchSpotify = async () => {
      try {
        const { data } = await apiRequest<SpotifyPlaybackResponse>('/api/spotify/now-playing')
        if (isSubscribed) {
          setSpotifyData(data)
        }
      } catch {
        // silent fallback
      }
    }

    void fetchSpotify()
    const timer = window.setInterval(fetchSpotify, 10_000)

    return () => {
      isSubscribed = false
      window.clearInterval(timer)
    }
  }, [])

  const handleStartEdit = () => {
    setEditName(user?.name || 'Felicia Tan')
    setEditPhotoUrl(user?.photoUrl || '')
    setSelectedImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setProfileError(null)
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setEditName(user?.name || 'Felicia Tan')
    setEditPhotoUrl(user?.photoUrl || '')
    setSelectedImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setProfileError(null)
    setIsEditing(false)
  }

  const handleImageSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!supportedProfileImageTypes.has(file.type)) {
      setProfileError('Please select a PNG, JPEG, WebP, or GIF image.')
      event.target.value = ''
      return
    }

    if (file.size > maxProfileImageBytes) {
      setProfileError('Profile pictures must be 2 MB or smaller.')
      event.target.value = ''
      return
    }

    setSelectedImage(file)
    setProfileError(null)
  }

  const handleSaveProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmedName = editName.trim()

    if (!trimmedName) {
      setProfileError('Name cannot be empty.')
      return
    }

    setIsSavingProfile(true)
    setProfileError(null)

    try {
      const nextPhotoUrl = selectedImage
        ? await fileToDataUrl(selectedImage)
        : editPhotoUrl.trim() || null

      const response = await apiRequest<ProfileUpdateResponse>(
        '/api/user/profile',
        {
          method: 'PUT',
          body: JSON.stringify({
            name: trimmedName,
            photo_url: nextPhotoUrl,
          }),
        },
      )

      if (response.data.user) {
        updateUser(response.data.user)
      }

      setEditPhotoUrl(nextPhotoUrl || '')
      setSelectedImage(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      showToast('Profile updated successfully.')
      setIsEditing(false)
    } catch (error) {
      setProfileError(formatApiError(error))
    } finally {
      setIsSavingProfile(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-900 dark:text-slate-100 flex flex-col justify-between">
      <Navbar onConnectTelegram={() => setIsTelegramOpen(true)} />

      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8 flex-1">
        {/* HEADER WITH WELL-STYLED BACK TO DASHBOARD BUTTON */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <span>Profile</span>
              <span>/</span>
              <span>Account</span>
            </div>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100">
              User Profile
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Manage your personal student details and view your 30-day focus activity.
            </p>
          </div>

          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 self-start sm:self-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-700/80 whitespace-nowrap"
          >
            <span>Back to Dashboard</span>
            <span>→</span>
          </Link>
        </div>

        <div className="grid gap-8">
          {/* Personal Information Card */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-800/80">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-800/40">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Personal Information
              </h2>
              {!isEditing && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  ✏️ Edit Profile
                </button>
              )}
            </div>

            {isEditing ? (
              <form onSubmit={handleSaveProfile} className="p-6 sm:p-8">
                {profileError && (
                  <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                    {profileError}
                  </div>
                )}

                <div className="flex flex-col items-center md:flex-row md:items-start lg:items-center gap-8">
                  {/* Avatar Upload Container */}
                  <div className="flex shrink-0 flex-col items-center">
                    <div className="relative group flex size-28 items-center justify-center overflow-hidden rounded-3xl bg-blue-600 font-black text-3xl text-white shadow-lg ring-4 ring-blue-50 dark:ring-blue-950/50">
                      {editPhotoUrl ? (
                        <img
                          src={editPhotoUrl}
                          alt={editName || displayName}
                          className="size-full rounded-3xl object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        userInitials
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-600 shadow-2xs hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-400 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      📷 Change Picture
                    </button>
                    <input
                      type="file"
                      accept="image/*"
                      ref={fileInputRef}
                      className="hidden"
                      onChange={handleImageSelect}
                    />
                    {selectedImage && (
                      <p className="mt-2 max-w-36 truncate text-center text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        {selectedImage.name}
                      </p>
                    )}
                  </div>

                  {/* Form Inputs */}
                  <div className="flex-1 w-full space-y-4">
                    <div>
                      <label
                        htmlFor="profile-name"
                        className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                      >
                        Full Student Name
                      </label>
                      <input
                        id="profile-name"
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Your full name"
                        className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
                      />
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="submit"
                        disabled={isSavingProfile}
                        className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSavingProfile ? 'Saving Changes…' : 'Save Changes'}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        disabled={isSavingProfile}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            ) : (
              <div className="p-6 sm:p-8 flex flex-col items-center md:flex-row md:items-start lg:items-center gap-8">
                {/* Profile Picture with Live Status Badge Directly Underneath */}
                <div className="flex shrink-0 flex-col items-center">
                  <div className="flex size-28 items-center justify-center rounded-3xl bg-blue-600 font-black text-3xl text-white shadow-lg ring-4 ring-blue-50 dark:ring-blue-950/50 overflow-hidden">
                    {user?.photoUrl ? (
                      <img
                        src={user.photoUrl}
                        alt={displayName}
                        className="size-full rounded-3xl object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      userInitials
                    )}
                  </div>

                  {/* LIVE STATUS INDICATOR BADGE UNDER USER'S PROFILE PICTURE */}
                  <div className="mt-3.5">
                    {currentPresence.status === 'online' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 shadow-2xs">
                        <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>{currentPresence.roomId ? `🟢 Studying in #${currentPresence.roomId}` : '🟢 Online'}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                        <span className="size-2 rounded-full bg-slate-400" />
                        <span>⚪ Offline</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Profile Information Flex Grid */}
                <div className="flex-1 w-full space-y-4 text-center md:text-left">
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                    <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                      {displayName}
                    </h3>
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      Active Student
                    </span>
                  </div>

                  <div className="grid gap-3 grid-cols-1 md:grid-cols-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                    <div className="rounded-xl bg-slate-50/70 p-3.5 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Registered Email
                      </span>
                      <span className="mt-0.5 block text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {displayEmail}
                      </span>
                    </div>

                    <div className="rounded-xl bg-slate-50/70 p-3.5 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Student / User ID
                      </span>
                      <span className="mt-0.5 block text-xs font-mono font-bold text-slate-700 dark:text-slate-300 truncate">
                        {user?.id || 'kc-local-user'}
                      </span>
                    </div>
                  </div>

                  {/* SPOTIFY LIVE PLAYBACK */}
                  {spotifyData?.isPlaying && spotifyData.track && (
                    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 dark:bg-emerald-950/20 text-left">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {spotifyData.track.albumArtUrl ? (
                            <img
                              src={spotifyData.track.albumArtUrl}
                              alt={spotifyData.track.albumName || 'Album art'}
                              className="size-11 rounded-lg object-cover shadow-xs border border-emerald-500/30 shrink-0"
                            />
                          ) : (
                            <div className="flex size-11 items-center justify-center rounded-lg bg-emerald-500/10 text-base shrink-0">
                              🎵
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <svg className="size-3 text-[#1DB954]" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                              </svg>
                              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                Currently Listening on Spotify
                              </span>
                              <span className="size-1.5 rounded-full bg-emerald-500 animate-ping" />
                            </div>
                            <p className="truncate text-xs font-bold text-slate-900 dark:text-white" title={spotifyData.track.name}>
                              {spotifyData.track.name}
                            </p>
                            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={spotifyData.track.artist}>
                              {spotifyData.track.artist}
                            </p>
                          </div>
                        </div>
                        {spotifyData.track.spotifyUrl && (
                          <a
                            href={spotifyData.track.spotifyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:text-[#1DB954] hover:bg-white/60 dark:hover:bg-slate-800 transition"
                            title="Listen on Spotify"
                            aria-label="Listen on Spotify"
                          >
                            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-center md:justify-start gap-2 text-xs text-slate-400 dark:text-slate-500">
                    <span>Need to manage linked Google or Telegram accounts?</span>
                    <Link to="/settings" className="font-bold text-blue-600 dark:text-blue-400 hover:underline">
                      Go to Settings →
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Activity Heatmap Card */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-800/80 sm:p-8">
            <ActivityCalendar />
          </section>
        </div>
      </main>

      <TelegramConnectModal
        isOpen={isTelegramOpen}
        onClose={() => setIsTelegramOpen(false)}
      />
    </div>
  )
}
