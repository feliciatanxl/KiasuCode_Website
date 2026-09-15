import { useEffect, useState } from 'react'

import { apiRequest, getApiBaseUrl } from '../utils/api'

interface CurrentlyPlayingTrack {
  id: string
  name: string
  artist: string
  albumName: string
  albumArtUrl: string | null
  isPlaying: boolean
  durationMs: number
  progressMs: number
  spotifyUrl: string | null
}

interface SpotifyPlaybackResponse {
  connected: boolean
  isPlaying: boolean
  track: CurrentlyPlayingTrack | null
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function SpotifyPlayer() {
  const [data, setData] = useState<SpotifyPlaybackResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isSubscribed = true

    const fetchPlayback = async () => {
      try {
        const { data: response } = await apiRequest<SpotifyPlaybackResponse>('/api/spotify/now-playing')
        if (isSubscribed) {
          setData(response)
          setIsLoading(false)
        }
      } catch {
        if (isSubscribed) {
          setData((prev) => prev ?? { connected: false, isPlaying: false, track: null })
          setIsLoading(false)
        }
      }
    }

    void fetchPlayback()
    const interval = window.setInterval(fetchPlayback, 10_000)

    return () => {
      isSubscribed = false
      window.clearInterval(interval)
    }
  }, [])

  const handleConnect = () => {
    window.location.href = `${getApiBaseUrl()}/api/auth/spotify`
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800/90 transition-colors">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700/60">
        <div className="flex items-center gap-2">
          <svg className="size-4 text-[#1DB954]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Spotify Live Session
          </span>
        </div>

        {data?.connected && data.isPlaying && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            Streaming
          </span>
        )}
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="flex items-center gap-3 animate-pulse">
            <div className="size-14 rounded-xl bg-slate-200 dark:bg-slate-700" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-2.5 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          </div>
        ) : !data?.connected ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-700 dark:bg-slate-900/30">
            <div>
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Connect your Spotify account
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Play your Lo-Fi focus beats and track playback in real time.
              </p>
            </div>
            <button
              type="button"
              onClick={handleConnect}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1DB954] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#1aa34a]"
            >
              <span>Connect</span>
            </button>
          </div>
        ) : !data.track ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-700 dark:bg-slate-900/30">
            <div className="flex size-11 items-center justify-center rounded-lg bg-slate-200/70 text-slate-400 dark:bg-slate-700/60 dark:text-slate-500">
              🎵
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                No track playing right now
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Play any song in your Spotify app to display here.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3.5">
              {data.track.albumArtUrl ? (
                <img
                  src={data.track.albumArtUrl}
                  alt={data.track.albumName || 'Album artwork'}
                  className="size-14 rounded-xl object-cover shadow-sm border border-slate-200/60 dark:border-slate-700"
                />
              ) : (
                <div className="flex size-14 items-center justify-center rounded-xl bg-slate-100 text-xl dark:bg-slate-700">
                  💿
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h4
                    className="truncate text-sm font-bold text-slate-900 dark:text-white"
                    title={data.track.name}
                  >
                    {data.track.name}
                  </h4>
                  {data.track.spotifyUrl && (
                    <a
                      href={data.track.spotifyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-slate-400 hover:text-[#1DB954] transition-colors"
                      title="Open in Spotify"
                      aria-label="Open track in Spotify"
                    >
                      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  )}
                </div>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={data.track.artist}>
                  {data.track.artist}
                </p>
                <p className="truncate text-[11px] text-slate-400 dark:text-slate-500" title={data.track.albumName}>
                  {data.track.albumName}
                </p>
              </div>
            </div>

            {data.track.durationMs > 0 && (
              <div className="space-y-1 pt-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div
                    className="h-full bg-[#1DB954] rounded-full transition-all duration-1000 ease-linear"
                    style={{
                      width: `${Math.min(100, Math.max(0, (data.track.progressMs / data.track.durationMs) * 100))}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
                  <span>{formatDuration(data.track.progressMs)}</span>
                  <span>{formatDuration(data.track.durationMs)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
