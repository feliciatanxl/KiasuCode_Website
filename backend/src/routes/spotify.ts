import { Router, type Request, type Response } from 'express'
import type { RowDataPacket } from 'mysql2/promise'

import { db } from '../config/db.js'
import { authenticateRequest } from '../middleware/authenticate.js'
import { fetchCurrentlyPlaying } from '../utils/spotify.js'

interface UserSpotifyStatusRow extends RowDataPacket {
  spotify_refresh_token: string | null
}

const router = Router()

/**
 * GET /api/spotify/now-playing
 * Fetches the user's currently playing track from the Spotify API.
 */
router.get(
  '/now-playing',
  authenticateRequest,
  async (_request: Request, response: Response) => {
    try {
      const userId = response.locals.userId as string
      const playback = await fetchCurrentlyPlaying(userId)
      response.status(200).json(playback)
    } catch (error) {
      console.error('Failed to get Spotify now-playing track:', error)
      response.status(500).json({
        error: 'Unable to retrieve Spotify playback status.',
        connected: false,
        isPlaying: false,
        track: null,
      })
    }
  },
)

/**
 * GET /api/spotify/status
 * Check if the user has an active Spotify connection.
 */
router.get(
  '/status',
  authenticateRequest,
  async (_request: Request, response: Response) => {
    try {
      const userId = response.locals.userId as string
      const [rows] = await db.execute<UserSpotifyStatusRow[]>(
        'SELECT spotify_refresh_token FROM users WHERE id = ? LIMIT 1',
        [userId],
      )

      const user = rows[0]
      const connected = Boolean(user?.spotify_refresh_token)

      response.status(200).json({ connected })
    } catch (error) {
      console.error('Failed to check Spotify status:', error)
      response.status(500).json({ connected: false })
    }
  },
)

/**
 * POST /api/spotify/disconnect
 * Disconnects the user's Spotify account.
 */
router.post(
  '/disconnect',
  authenticateRequest,
  async (_request: Request, response: Response) => {
    try {
      const userId = response.locals.userId as string
      await db.execute(
        `UPDATE users
            SET spotify_access_token = NULL,
                spotify_refresh_token = NULL,
                spotify_token_expiry = NULL
          WHERE id = ?`,
        [userId],
      )

      response.status(200).json({ success: true, message: 'Spotify disconnected successfully.' })
    } catch (error) {
      console.error('Failed to disconnect Spotify:', error)
      response.status(500).json({ error: 'Unable to disconnect Spotify.' })
    }
  },
)

export default router
