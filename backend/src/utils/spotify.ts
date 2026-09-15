import type { RowDataPacket } from 'mysql2/promise'

import { db } from '../config/db.js'

interface SpotifyTokenRow extends RowDataPacket {
  spotify_access_token: string | null
  spotify_refresh_token: string | null
  spotify_token_expiry: number | null
}

export interface CurrentlyPlayingTrack {
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

export interface SpotifyPlaybackStatus {
  connected: boolean
  isPlaying: boolean
  track: CurrentlyPlayingTrack | null
}

export function getSpotifyClientId(): string {
  return process.env.SPOTIFY_CLIENT_ID?.trim() || ''
}

export function getSpotifyClientSecret(): string {
  return process.env.SPOTIFY_CLIENT_SECRET?.trim() || ''
}

export function getSpotifyRedirectUri(customOrigin?: string): string {
  if (process.env.SPOTIFY_REDIRECT_URI?.trim()) {
    return process.env.SPOTIFY_REDIRECT_URI.trim()
  }

  const base = customOrigin || process.env.VITE_API_URL || process.env.API_URL || 'http://localhost:3000'
  return `${base.replace(/\/$/, '')}/api/auth/spotify/callback`
}

/**
 * Generates Spotify OAuth authorization URL
 */
export function getSpotifyAuthorizeUrl(state: string, redirectUri?: string): string {
  const clientId = getSpotifyClientId()
  const effectiveRedirectUri = redirectUri || getSpotifyRedirectUri()
  const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
  ].join(' ')

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: scopes,
    redirect_uri: effectiveRedirectUri,
    state,
  })

  return `https://accounts.spotify.com/authorize?${params.toString()}`
}

/**
 * Exchanges authorization code for access and refresh tokens
 */
export async function exchangeSpotifyCode(
  code: string,
  redirectUri?: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const clientId = getSpotifyClientId()
  const clientSecret = getSpotifyClientSecret()
  const effectiveRedirectUri = redirectUri || getSpotifyRedirectUri()

  if (!clientId || !clientSecret) {
    throw new Error('Spotify client credentials are not configured.')
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: effectiveRedirectUri,
  })

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: body.toString(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Spotify token exchange failed (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresIn: data.expires_in,
  }
}

/**
 * Automatically retrieves a valid Spotify access token for a user,
 * refreshing it with the refresh token if expired or about to expire.
 */
export async function getValidSpotifyToken(userId: string): Promise<string | null> {
  const [rows] = await db.execute<SpotifyTokenRow[]>(
    `SELECT spotify_access_token, spotify_refresh_token, spotify_token_expiry
       FROM users
      WHERE id = ?
      LIMIT 1`,
    [userId],
  )

  const user = rows[0]
  if (!user || !user.spotify_access_token) {
    return null
  }

  const now = Date.now()
  const expiry = Number(user.spotify_token_expiry || 0)
  // Refresh if expired or expiring in less than 60 seconds
  const isExpiringSoon = !expiry || now >= expiry - 60_000

  if (!isExpiringSoon) {
    return user.spotify_access_token
  }

  if (!user.spotify_refresh_token) {
    return null
  }

  const clientId = getSpotifyClientId()
  const clientSecret = getSpotifyClientSecret()

  if (!clientId || !clientSecret) {
    console.error('Spotify client credentials missing during token refresh.')
    return user.spotify_access_token
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: user.spotify_refresh_token,
    })

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: body.toString(),
    })

    if (!response.ok) {
      console.error(`Spotify token refresh error: ${response.status}`)
      return null
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    const newExpiry = Date.now() + data.expires_in * 1000
    const newRefreshToken = data.refresh_token || user.spotify_refresh_token

    await db.execute(
      `UPDATE users
          SET spotify_access_token = ?,
              spotify_refresh_token = ?,
              spotify_token_expiry = ?
        WHERE id = ?`,
      [data.access_token, newRefreshToken, newExpiry, userId],
    )

    return data.access_token
  } catch (error) {
    console.error('Failed to refresh Spotify access token:', error)
    return null
  }
}

/**
 * Fetches the currently playing track from Spotify for the authenticated user.
 */
export async function fetchCurrentlyPlaying(userId: string): Promise<SpotifyPlaybackStatus> {
  const token = await getValidSpotifyToken(userId)

  if (!token) {
    return {
      connected: false,
      isPlaying: false,
      track: null,
    }
  }

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (response.status === 204 || response.status === 202) {
      // Nothing is currently playing
      return {
        connected: true,
        isPlaying: false,
        track: null,
      }
    }

    if (response.status === 401) {
      return {
        connected: false,
        isPlaying: false,
        track: null,
      }
    }

    if (!response.ok) {
      console.warn(`Spotify currently-playing endpoint returned status ${response.status}`)
      return {
        connected: true,
        isPlaying: false,
        track: null,
      }
    }

    const data = (await response.json()) as {
      is_playing: boolean
      progress_ms?: number
      item?: {
        id: string
        name: string
        duration_ms: number
        external_urls?: { spotify?: string }
        artists?: Array<{ name: string }>
        album?: {
          name: string
          images?: Array<{ url: string; height?: number; width?: number }>
        }
      } | null
    }

    if (!data || !data.item) {
      return {
        connected: true,
        isPlaying: Boolean(data?.is_playing),
        track: null,
      }
    }

    const artists = (data.item.artists || []).map((a) => a.name).join(', ') || 'Unknown Artist'
    const albumArtUrl = data.item.album?.images?.[0]?.url || null

    return {
      connected: true,
      isPlaying: Boolean(data.is_playing),
      track: {
        id: data.item.id,
        name: data.item.name,
        artist: artists,
        albumName: data.item.album?.name || '',
        albumArtUrl,
        isPlaying: Boolean(data.is_playing),
        durationMs: data.item.duration_ms || 0,
        progressMs: data.progress_ms || 0,
        spotifyUrl: data.item.external_urls?.spotify || null,
      },
    }
  } catch (error) {
    console.error('Error fetching currently playing track from Spotify:', error)
    return {
      connected: true,
      isPlaying: false,
      track: null,
    }
  }
}
