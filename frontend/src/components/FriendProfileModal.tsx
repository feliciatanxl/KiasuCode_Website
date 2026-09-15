import { useEffect, useState } from 'react'

import { apiRequest, formatApiError, isAbortError } from '../utils/api'
import { getPetConfig } from '../utils/petRoster'

export interface FriendProfileModalTarget {
  id: string
  name: string
  photoUrl?: string | null
}

interface FriendProfileData {
  user: {
    id: string
    name: string
    photoUrl: string | null
    createdAt: string
  }
  pet: {
    id: string
    name: string
    firstName: string
    petType: string
    hungerLevel: number
    happinessLevel: number
    level: number
  } | null
  stats: {
    totalStudyMinutes: number
    totalSessions: number
  }
  spotify?: {
    id: string
    name: string
    artist: string
    albumName: string
    albumArtUrl: string | null
    isPlaying: boolean
    spotifyUrl: string | null
  } | null
}

interface FriendProfileModalProps {
  friend: FriendProfileModalTarget | null
  isOpen: boolean
  onClose: () => void
  presence?: {
    status: 'online' | 'offline'
    roomId?: string | null
  }
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function FriendProfileModal({
  friend,
  isOpen,
  onClose,
  presence,
}: FriendProfileModalProps) {
  const [profileData, setProfileData] = useState<FriendProfileData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !friend) {
      setProfileData(null)
      setError(null)
      return
    }

    const controller = new AbortController()
    setIsLoading(true)
    setError(null)

    void apiRequest<FriendProfileData>(`/api/friends/${friend.id}/profile`, {
      signal: controller.signal,
    })
      .then(({ data }) => setProfileData(data))
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          setError(formatApiError(err))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      })

    return () => controller.abort()
  }, [isOpen, friend])

  if (!isOpen || !friend) return null

  const displayName = profileData?.user.name || friend.name
  const photoUrl = profileData?.user.photoUrl || friend.photoUrl
  const initials = getInitials(displayName)
  const isOnline = presence?.status === 'online'
  const studyingRoom = presence?.roomId

  const pet = profileData?.pet
  const petConfig = pet ? getPetConfig(pet.petType) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="friend-profile-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-800 sm:p-7">
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-700/80">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Student Dossier / Profile
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* PROFILE BODY */}
        <div className="mt-5 space-y-5">
          {/* USER AVATAR & PRESENCE STATUS */}
          <div className="flex items-center gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-blue-600 font-extrabold text-xl text-white shadow-md overflow-hidden">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={displayName}
                  className="size-full rounded-2xl object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                initials
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3
                  className="text-lg font-black text-slate-900 dark:text-white truncate"
                  id="friend-profile-title"
                >
                  {displayName}
                </h3>
              </div>
              <div className="mt-1 flex items-center gap-2">
                {isOnline ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>{studyingRoom ? `Studying in #${studyingRoom}` : 'Online'}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700">
                    <span className="size-1.5 rounded-full bg-slate-400" />
                    <span>Offline</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* SPOTIFY LIVE PLAYBACK */}
          {profileData?.spotify && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {profileData.spotify.albumArtUrl ? (
                    <img
                      src={profileData.spotify.albumArtUrl}
                      alt={profileData.spotify.albumName || 'Album art'}
                      className="size-10 rounded-lg object-cover shadow-xs border border-emerald-500/30 shrink-0"
                    />
                  ) : (
                    <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-base shrink-0">
                      🎵
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <svg className="size-3 text-[#1DB954]" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                      </svg>
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Listening on Spotify
                      </span>
                      <span className="size-1.5 rounded-full bg-emerald-500 animate-ping" />
                    </div>
                    <p className="truncate text-xs font-bold text-slate-900 dark:text-white" title={profileData.spotify.name}>
                      {profileData.spotify.name}
                    </p>
                    <p className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={profileData.spotify.artist}>
                      {profileData.spotify.artist}
                    </p>
                  </div>
                </div>
                {profileData.spotify.spotifyUrl && (
                  <a
                    href={profileData.spotify.spotifyUrl}
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

          {/* COMPANION PET CARD */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Companion Pet
              </span>
              {pet && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-extrabold text-blue-700 dark:bg-blue-950/80 dark:text-blue-300">
                  Level {pet.level}
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="h-16 w-full animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
            ) : pet && petConfig ? (
              <div className="flex items-center gap-3">
                <div className="grid size-14 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-2xl shadow-inner dark:border-blue-900/60 dark:bg-blue-950/40">
                  {petConfig.avatar}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <strong className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {pet.name}
                    </strong>
                    {pet.firstName && pet.firstName !== pet.name && (
                      <span className="text-xs text-slate-400">({pet.firstName})</span>
                    )}
                  </div>
                  <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                    {petConfig.title}
                  </p>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
                    <span>🍖 Hunger: {pet.hungerLevel}%</span>
                    <span>💖 Happiness: {pet.happinessLevel}%</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-2 text-center text-xs text-slate-400">
                Companion not yet adopted.
              </div>
            )}
          </div>

          {/* STUDY STATS */}
          {profileData?.stats && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-center dark:border-slate-700/60 dark:bg-slate-900/50">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Total Focus Time
                </span>
                <strong className="mt-0.5 block text-base font-extrabold text-slate-900 dark:text-white">
                  {profileData.stats.totalStudyMinutes >= 60
                    ? `${(profileData.stats.totalStudyMinutes / 60).toFixed(1)} hrs`
                    : `${profileData.stats.totalStudyMinutes} mins`}
                </strong>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-center dark:border-slate-700/60 dark:bg-slate-900/50">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Focus Sessions
                </span>
                <strong className="mt-0.5 block text-base font-extrabold text-slate-900 dark:text-white">
                  {profileData.stats.totalSessions} completed
                </strong>
              </div>
            </div>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-100 px-5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
