import {
  Router,
  type Request,
  type Response,
} from 'express'
import type { FriendshipItem, FriendshipStatus } from '@kiasucode/shared'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'

import { db } from '../config/db.js'
import { authenticateRequest } from '../middleware/authenticate.js'
import {
  findTelegramChatIdForUser,
  sendTelegramNotification,
} from '../utils/telegramBot.js'
import { fetchCurrentlyPlaying } from '../utils/spotify.js'

interface UserLookupRow extends RowDataPacket {
  id: string
  name: string
  email: string | null
  photo_url: string | null
}

interface FriendshipDbRow extends RowDataPacket {
  id: string
  status: FriendshipStatus
  requester_id: string
  addressee_id: string
  created_at: Date | string
  friend_id: string
  friend_name: string
  friend_email: string | null
  friend_photo_url: string | null
}

const router = Router()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getUserId(response: Response): string {
  return response.locals.userId as string
}

function getParam(request: Request, name: string): string {
  const value = request.params[name]
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) {
    return value[0].trim()
  }
  throw new Error(`Parameter ${name} is required.`)
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Database returned an invalid timestamp.')
  }
  return date.toISOString()
}

function serializeFriendship(row: FriendshipDbRow, currentUserId: string): FriendshipItem {
  return {
    id: row.id,
    status: row.status,
    isRequester: row.requester_id === currentUserId,
    createdAt: toIsoString(row.created_at),
    friend: {
      id: row.friend_id,
      name: row.friend_name,
      email: null,
      photoUrl: row.friend_photo_url,
    },
  }
}

// GET /api/friends - List all accepted friends
router.get(
  '/friends',
  authenticateRequest,
  async (_request: Request, response: Response) => {
    try {
      const currentUserId = getUserId(response)

      const [rows] = await db.execute<FriendshipDbRow[]>(
        `SELECT 
           f.id,
           f.status,
           f.requester_id,
           f.addressee_id,
           f.created_at,
           u.id AS friend_id,
           u.name AS friend_name,
           u.email AS friend_email,
           u.photo_url AS friend_photo_url
         FROM friendships f
         INNER JOIN users u ON u.id = IF(f.requester_id = ?, f.addressee_id, f.requester_id)
         WHERE (f.requester_id = ? OR f.addressee_id = ?)
           AND f.status = 'Accepted'
         ORDER BY u.name ASC`,
        [currentUserId, currentUserId, currentUserId],
      )

      response.status(200).json({
        friends: rows.map((row) => serializeFriendship(row, currentUserId)),
      })
    } catch (error) {
      console.error('Unable to load friends: %o', error)
      response.status(500).json({ error: 'Unable to load friends list.' })
    }
  },
)

// GET /api/friends/requests - List pending incoming and outgoing friend requests
router.get(
  '/friends/requests',
  authenticateRequest,
  async (_request: Request, response: Response) => {
    try {
      const currentUserId = getUserId(response)

      const [incomingRows] = await db.execute<FriendshipDbRow[]>(
        `SELECT 
           f.id,
           f.status,
           f.requester_id,
           f.addressee_id,
           f.created_at,
           u.id AS friend_id,
           u.name AS friend_name,
           u.email AS friend_email,
           u.photo_url AS friend_photo_url
         FROM friendships f
         INNER JOIN users u ON u.id = f.requester_id
         WHERE f.addressee_id = ? AND f.status = 'Pending'
         ORDER BY f.created_at DESC`,
        [currentUserId],
      )

      const [outgoingRows] = await db.execute<FriendshipDbRow[]>(
        `SELECT 
           f.id,
           f.status,
           f.requester_id,
           f.addressee_id,
           f.created_at,
           u.id AS friend_id,
           u.name AS friend_name,
           u.email AS friend_email,
           u.photo_url AS friend_photo_url
         FROM friendships f
         INNER JOIN users u ON u.id = f.addressee_id
         WHERE f.requester_id = ? AND f.status = 'Pending'
         ORDER BY f.created_at DESC`,
        [currentUserId],
      )

      response.status(200).json({
        incoming: incomingRows.map((r) => serializeFriendship(r, currentUserId)),
        outgoing: outgoingRows.map((r) => serializeFriendship(r, currentUserId)),
      })
    } catch (error) {
      console.error('Unable to load friend requests: %o', error)
      response.status(500).json({ error: 'Unable to load friend requests.' })
    }
  },
)

// POST /api/friends/request - Send a friend request
router.post(
  '/friends/request',
  authenticateRequest,
  async (request: Request, response: Response) => {
    try {
      if (!isRecord(request.body)) {
        response.status(400).json({ error: 'A JSON request body is required.' })
        return
      }

      const rawTarget = request.body.target ?? request.body.email ?? request.body.username
      if (typeof rawTarget !== 'string' || !rawTarget.trim()) {
        response.status(400).json({ error: 'Friend email or username is required.' })
        return
      }

      const target = rawTarget.trim().toLowerCase()
      const currentUserId = getUserId(response)

      // Validation 1: Query the database to find the user by the provided email/username
      const [users] = await db.execute<UserLookupRow[]>(
        `SELECT id, name, email, photo_url
           FROM users
          WHERE LOWER(email) = ?
             OR LOWER(name) = ?
             OR provider_id = ?
             OR id = ?
          LIMIT 1`,
        [target, target, target, target],
      )

      const addressee = users[0]
      if (!addressee) {
        response.status(404).json({ error: 'Student not found. Check the email and try again.' })
        return
      }

      // Validation 2: If the target user's ID matches the authenticated user's ID
      if (addressee.id === currentUserId) {
        response.status(400).json({ error: 'You cannot add yourself as a friend.' })
        return
      }

      // Check existing friendship
      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT id, requester_id, addressee_id, status
           FROM friendships
          WHERE (requester_id = ? AND addressee_id = ?)
             OR (requester_id = ? AND addressee_id = ?)
          LIMIT 1`,
        [currentUserId, addressee.id, addressee.id, currentUserId],
      )

      if (existing[0]) {
        const existingStatus = existing[0].status
        if (existingStatus === 'Accepted') {
          response.status(409).json({ error: 'You are already friends with this student.' })
          return
        }
        if (existing[0].requester_id === currentUserId) {
          response.status(409).json({ error: 'Friend request already sent.' })
          return
        } else {
          // If the other user already requested us, automatically accept!
          await db.execute<ResultSetHeader>(
            `UPDATE friendships SET status = 'Accepted' WHERE id = ?`,
            [existing[0].id],
          )
          response.status(200).json({
            success: true,
            message: `Friend request accepted! You and ${addressee.name} are now connected.`,
          })
          return
        }
      }

      // Only execute the INSERT query if both validations pass
      const friendshipId = uuidv4()
      await db.execute<ResultSetHeader>(
        `INSERT INTO friendships (id, requester_id, addressee_id, status)
         VALUES (?, ?, ?, 'Pending')`,
        [friendshipId, currentUserId, addressee.id],
      )

      // Telegram Notification Hook: Check if addressee has linked Telegram chat_id
      try {
        const [requesterRows] = await db.execute<UserLookupRow[]>(
          'SELECT name FROM users WHERE id = ? LIMIT 1',
          [currentUserId],
        )
        const requesterName = requesterRows[0]?.name || 'A classmate'
        const addresseeTelegramChatId = await findTelegramChatIdForUser(addressee.id)

        if (addresseeTelegramChatId) {
          const telegramMessage = `👋 Hey! You have a new friend request from ${requesterName} on KiasuCode.`
          void sendTelegramNotification(addresseeTelegramChatId, telegramMessage)
        }
      } catch (notifyErr) {
        console.warn('Failed to send Telegram friend request notification:', notifyErr)
      }

      response.status(201).json({
        success: true,
        message: `Friend request sent to ${addressee.name}.`,
        friendshipId,
      })
    } catch (error) {
      console.error('Unable to send friend request: %o', error)
      response.status(500).json({ error: 'Unable to send friend request. Please try again.' })
    }
  },
)

// POST /api/friends/:id/accept - Accept a friend request
router.post(
  '/friends/:id/accept',
  authenticateRequest,
  async (request: Request, response: Response) => {
    try {
      const friendshipId = getParam(request, 'id')
      const currentUserId = getUserId(response)

      const [result] = await db.execute<ResultSetHeader>(
        `UPDATE friendships
            SET status = 'Accepted'
          WHERE id = ? AND addressee_id = ? AND status = 'Pending'`,
        [friendshipId, currentUserId],
      )

      if (result.affectedRows === 0) {
        response.status(404).json({ error: 'Pending friend request not found.' })
        return
      }

      response.status(200).json({ success: true, message: 'Friend request accepted.' })
    } catch (error) {
      console.error('Unable to accept friend request: %o', error)
      response.status(500).json({ error: 'Unable to accept friend request.' })
    }
  },
)

// DELETE /api/friends/:id - Remove a friend or cancel/reject request
router.delete(
  '/friends/:id',
  authenticateRequest,
  async (request: Request, response: Response) => {
    try {
      const friendshipId = getParam(request, 'id')
      const currentUserId = getUserId(response)

      const [result] = await db.execute<ResultSetHeader>(
        `DELETE FROM friendships
          WHERE id = ? AND (requester_id = ? OR addressee_id = ?)`,
        [friendshipId, currentUserId, currentUserId],
      )

      if (result.affectedRows === 0) {
        response.status(404).json({ error: 'Friendship not found.' })
        return
      }

      response.status(200).json({ success: true, message: 'Friendship removed.' })
    } catch (error) {
      console.error('Unable to remove friendship: %o', error)
      response.status(500).json({ error: 'Unable to remove friendship.' })
    }
  },
)

// PUT or POST /api/user/public-key - Register user's E2EE public key
const handleSavePublicKey = async (request: Request, response: Response) => {
  try {
    const currentUserId = getUserId(response)
    if (!isRecord(request.body)) {
      response.status(400).json({ error: 'A JSON request body is required.' })
      return
    }

    const rawPublicKey = request.body.publicKey ?? request.body.public_key
    const publicKey = typeof rawPublicKey === 'string' ? rawPublicKey.trim() : ''

    if (!publicKey) {
      response.status(400).json({ error: 'Public key is required.' })
      return
    }

    await db.execute<ResultSetHeader>(
      'UPDATE users SET public_key = ? WHERE id = ?',
      [publicKey, currentUserId],
    )

    response.status(200).json({ success: true, message: 'Public key registered successfully.' })
  } catch (error) {
    console.error('Unable to save public key: %o', error)
    response.status(500).json({ error: 'Unable to register public key.' })
  }
}

router.put('/user/public-key', authenticateRequest, handleSavePublicKey)
router.post('/user/public-key', authenticateRequest, handleSavePublicKey)

// GET /api/user/:id/public-key - Get a friend's public key
router.get(
  '/user/:id/public-key',
  authenticateRequest,
  async (request: Request, response: Response) => {
    try {
      const targetUserId = getParam(request, 'id')

      const [rows] = await db.execute<RowDataPacket[]>(
        'SELECT id, name, public_key FROM users WHERE id = ? LIMIT 1',
        [targetUserId],
      )
      const targetUser = rows[0]

      if (!targetUser) {
        response.status(404).json({ error: 'User not found.' })
        return
      }

      response.status(200).json({
        userId: targetUser.id,
        name: targetUser.name,
        publicKey: targetUser.public_key || null,
      })
    } catch (error) {
      console.error('Unable to get user public key: %o', error)
      response.status(500).json({ error: 'Unable to retrieve public key.' })
    }
  },
)

// GET /api/friends/:friendId/profile & GET /api/user/:id/public-profile - Get public stats, presence & pet details
const handleGetFriendPublicProfile = async (request: Request, response: Response) => {
  try {
    const rawId = request.params.friendId || request.params.id
    const friendId = Array.isArray(rawId) ? rawId[0] : rawId
    if (!friendId || typeof friendId !== 'string') {
      response.status(400).json({ error: 'User ID is required.' })
      return
    }

    const [userRows] = await db.execute<RowDataPacket[]>(
      'SELECT id, name, photo_url, created_at FROM users WHERE id = ? LIMIT 1',
      [friendId],
    )
    const user = userRows[0]
    if (!user) {
      response.status(404).json({ error: 'User not found.' })
      return
    }

    const [petRows] = await db.execute<RowDataPacket[]>(
      'SELECT id, name, first_name, pet_type, hunger_level, happiness_level, last_interacted_at FROM pets WHERE user_id = ? LIMIT 1',
      [friendId],
    )
    const pet = petRows[0]

    const [sessionRows] = await db.execute<RowDataPacket[]>(
      'SELECT COALESCE(SUM(duration_minutes), 0) AS total_study_minutes, COUNT(id) AS total_sessions FROM study_sessions WHERE user_id = ?',
      [friendId],
    )
    const totalMinutes = Number(sessionRows[0]?.total_study_minutes ?? 0)
    const totalSessions = Number(sessionRows[0]?.total_sessions ?? 0)
    const petLevel = pet ? Math.max(1, Math.floor(totalMinutes / 60) + 1) : 0

    const spotifyPlayback = await fetchCurrentlyPlaying(friendId).catch(() => ({
      connected: false,
      isPlaying: false,
      track: null,
    }))

    response.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        photoUrl: user.photo_url || null,
        createdAt: toIsoString(user.created_at),
      },
      pet: pet
        ? {
            id: pet.id,
            name: pet.name,
            firstName: pet.first_name || pet.name || 'Byte',
            petType: pet.pet_type || 'hatchling',
            hungerLevel: Number(pet.hunger_level),
            happinessLevel: Number(pet.happiness_level),
            level: petLevel,
          }
        : null,
      stats: {
        totalStudyMinutes: totalMinutes,
        totalSessions,
      },
      spotify: spotifyPlayback.isPlaying && spotifyPlayback.track
        ? spotifyPlayback.track
        : null,
    })
  } catch (error) {
    console.error('Unable to retrieve public friend profile: %o', error)
    response.status(500).json({ error: 'Unable to retrieve friend profile.' })
  }
}

router.get('/friends/:friendId/profile', authenticateRequest, handleGetFriendPublicProfile)
router.get('/user/:id/public-profile', authenticateRequest, handleGetFriendPublicProfile)

// GET /api/messages/:friendId - Get encrypted message history
const handleGetMessageHistory = async (request: Request, response: Response) => {
  try {
    const friendId = getParam(request, 'friendId')
    const currentUserId = getUserId(response)

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, sender_id, receiver_id, encrypted_content, created_at
         FROM private_messages
        WHERE (sender_id = ? AND receiver_id = ?)
           OR (sender_id = ? AND receiver_id = ?)
        ORDER BY created_at ASC`,
      [currentUserId, friendId, friendId, currentUserId],
    )

    const messages = rows.map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      encryptedContent: row.encrypted_content,
      createdAt: toIsoString(row.created_at),
    }))

    response.status(200).json({ messages })
  } catch (error) {
    console.error('Unable to retrieve message history: %o', error)
    response.status(500).json({ error: 'Unable to retrieve message history.' })
  }
}

// PUT or POST /api/user/wrapped-private-key - Escrow user's PIN-wrapped private key
const handleSaveWrappedPrivateKey = async (request: Request, response: Response) => {
  try {
    const currentUserId = getUserId(response)
    if (!isRecord(request.body)) {
      response.status(400).json({ error: 'A JSON request body is required.' })
      return
    }

    const rawWrappedKey = request.body.wrappedPrivateKey ?? request.body.wrapped_private_key
    const wrappedPrivateKey = typeof rawWrappedKey === 'string' ? rawWrappedKey.trim() : ''

    if (!wrappedPrivateKey) {
      response.status(400).json({ error: 'Wrapped private key is required.' })
      return
    }

    await db.execute<ResultSetHeader>(
      'UPDATE users SET wrapped_private_key = ? WHERE id = ?',
      [wrappedPrivateKey, currentUserId],
    )

    response.status(200).json({
      success: true,
      message: 'Wrapped private key escrowed successfully.',
    })
  } catch (error) {
    console.error('Unable to save wrapped private key: %o', error)
    response.status(500).json({ error: 'Unable to escrow wrapped private key.' })
  }
}

router.put('/user/wrapped-private-key', authenticateRequest, handleSaveWrappedPrivateKey)
router.post('/user/wrapped-private-key', authenticateRequest, handleSaveWrappedPrivateKey)

// GET /api/user/wrapped-private-key - Retrieve current user's escrowed wrapped private key
router.get(
  '/user/wrapped-private-key',
  authenticateRequest,
  async (_request: Request, response: Response) => {
    try {
      const currentUserId = getUserId(response)

      const [rows] = await db.execute<RowDataPacket[]>(
        'SELECT id, public_key, wrapped_private_key FROM users WHERE id = ? LIMIT 1',
        [currentUserId],
      )
      const user = rows[0]

      if (!user) {
        response.status(404).json({ error: 'User not found.' })
        return
      }

      response.status(200).json({
        wrappedPrivateKey: user.wrapped_private_key || null,
        publicKey: user.public_key || null,
      })
    } catch (error) {
      console.error('Unable to retrieve wrapped private key: %o', error)
      response.status(500).json({ error: 'Unable to retrieve wrapped private key.' })
    }
  },
)

export default router

