import bcrypt from 'bcrypt'
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'

import { db } from '../config/db.js'
import { authenticateRequest } from '../middleware/authenticate.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  AuthVerificationError,
  verifyGoogleToken,
} from '../utils/auth.js'
import { clearSessionCookie, setSessionCookie } from '../utils/session.js'
import {
  findTelegramChatIdForUser,
  sendTelegramNotification,
} from '../utils/telegramBot.js'
import {
  requireTelegramClientId,
  verifyTelegramAuth,
  verifyTelegramIdToken,
  type VerifiedTelegramUser,
} from '../utils/telegramAuth.js'
import {
  exchangeSpotifyCode,
  getSpotifyAuthorizeUrl,
  getSpotifyRedirectUri,
} from '../utils/spotify.js'

type AuthProvider = 'google' | 'telegram' | 'local'

interface UserRow extends RowDataPacket {
  id: string
  provider: AuthProvider
  provider_id: string
  email: string | null
  password_hash?: string | null
  name: string
  photo_url: string | null
  public_key?: string | null
  has_consented?: boolean | number
  telegram_chat_id?: string | null
  google_id?: string | null
  session_version?: number
  spotify_access_token?: string | null
  spotify_refresh_token?: string | null
  spotify_token_expiry?: number | null
}

interface PasswordHistoryRow extends RowDataPacket {
  password_hash: string
}

interface AuthUser {
  id: string
  provider: AuthProvider
  name: string
  email?: string
  photoUrl?: string
  hasConsented?: boolean
  has_password?: boolean
  hasPassword?: boolean
  telegramChatId?: string
  googleId?: string
  hasSpotify?: boolean
}

interface VerifiedIdentity {
  provider: AuthProvider
  providerId: string
  email: string | null
  name: string
  photoUrl: string | null
}

class InvalidAuthRequestError extends Error {}

const router = Router()
const passwordReuseError = 'For security reasons, you cannot reuse your last 3 passwords.'
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
})

router.use(authRateLimiter)

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function generateSessionToken(userId: string, sessionVersion: number = 1): string {
  return jwt.sign(
    { sub: userId, session_version: sessionVersion },
    requireEnvironmentVariable('JWT_SECRET'),
    {
      algorithm: 'HS256',
      expiresIn: '1h',
      issuer: 'kiasucode',
      audience: 'kiasucode-frontend',
    },
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getGoogleCredential(payload: unknown): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim()

  if (isRecord(payload)) {
    if (typeof payload.access_token === 'string' && payload.access_token.trim()) {
      return payload.access_token.trim()
    }
    if (typeof payload.credential === 'string' && payload.credential.trim()) {
      return payload.credential.trim()
    }
    if (typeof payload.token === 'string' && payload.token.trim()) {
      return payload.token.trim()
    }
    if (typeof payload.payload === 'string' && payload.payload.trim()) {
      return payload.payload.trim()
    }
  }

  throw new InvalidAuthRequestError('Google access token is required.')
}

async function verifyIdentity(
  provider: AuthProvider,
  payload: unknown,
): Promise<VerifiedIdentity> {
  if (provider === 'google') {
    const googleUser = await verifyGoogleToken(getGoogleCredential(payload))

    return {
      provider,
      providerId: googleUser.providerId,
      email: googleUser.email ?? null,
      name: googleUser.name,
      photoUrl: googleUser.picture ?? null,
    }
  }

  const telegramUser = typeof payload === 'string'
    ? await verifyTelegramIdToken(payload)
    : verifyTelegramAuth(payload)
  const name = [telegramUser.firstName, telegramUser.lastName]
    .filter(Boolean)
    .join(' ') || telegramUser.username || 'Telegram user'

  return {
    provider,
    providerId: `telegram:${telegramUser.providerId}`,
    email: null,
    name,
    photoUrl: telegramUser.photoUrl ?? null,
  }
}

function serializeUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    ...(row.email ? { email: row.email } : {}),
    ...(row.photo_url ? { photoUrl: row.photo_url } : {}),
    hasConsented: Boolean(row.has_consented),
    has_password: Boolean(row.password_hash),
    hasPassword: Boolean(row.password_hash),
    ...(row.telegram_chat_id ? { telegramChatId: row.telegram_chat_id } : {}),
    ...(row.google_id ? { googleId: row.google_id } : {}),
    hasSpotify: Boolean(row.spotify_refresh_token),
  }
}

function sendAuthenticatedUser(
  request: Request,
  response: Response,
  status: number,
  user: AuthUser,
  sessionVersion: number = 1,
): void {
  setSessionCookie(request, response, generateSessionToken(user.id, sessionVersion))
  response.set('Cache-Control', 'no-store')
  response.status(status).json({ user })
}

async function hasRecentlyUsedPassword(
  connection: PoolConnection,
  userId: string,
  password: string,
): Promise<boolean> {
  const [rows] = await connection.execute<PasswordHistoryRow[]>(
    `SELECT password_hash
       FROM password_history
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 3`,
    [userId],
  )

  const matches = await Promise.all(
    rows.map((row) => bcrypt.compare(password, row.password_hash)),
  )

  return matches.some(Boolean)
}

async function upsertTelegramUser(
  telegramUser: VerifiedTelegramUser,
): Promise<UserRow> {
  const canonicalProviderId = `telegram:${telegramUser.providerId}`
  const name = (
    [telegramUser.firstName, telegramUser.lastName]
      .filter(Boolean)
      .join(' ')
    || telegramUser.username
    || 'Telegram user'
  ).slice(0, 160)
  const photoUrl = telegramUser.photoUrl ?? null
  const [existingRows] = await db.execute<UserRow[]>(
    `SELECT *
       FROM users
      WHERE provider = 'telegram'
        AND provider_id IN (?, ?)
      LIMIT 1`,
    [canonicalProviderId, telegramUser.providerId],
  )
  const existingUser = existingRows[0]

  if (existingUser) {
    await db.execute<ResultSetHeader>(
      `UPDATE users
          SET name = ?, photo_url = ?, session_version = session_version + 1
        WHERE id = ?`,
      [name, photoUrl, existingUser.id],
    )
  } else {
    await db.execute<ResultSetHeader>(
      `INSERT INTO users
        (id, provider, provider_id, email, password_hash, name, photo_url, session_version)
       VALUES (?, 'telegram', ?, NULL, NULL, ?, ?, 1)
       ON DUPLICATE KEY UPDATE name = ?, photo_url = ?, session_version = session_version + 1`,
      [
        uuidv4(),
        canonicalProviderId,
        name,
        photoUrl,
        name,
        photoUrl,
      ],
    )
  }

  const [rows] = await db.execute<UserRow[]>(
    `SELECT *
       FROM users
      WHERE provider = 'telegram'
        AND provider_id IN (?, ?)
      LIMIT 1`,
    [canonicalProviderId, telegramUser.providerId],
  )
  const user = rows[0]

  if (!user) throw new Error('Unable to load Telegram user after authentication.')

  return user
}

router.post('/register', async (request: Request, response: Response) => {
  try {
    const body: unknown = request.body

    if (!isRecord(body)) {
      throw new InvalidAuthRequestError('A JSON request body is required.')
    }

    const { name, username, email, password } = body
    const rawUsername = username ?? name

    if (typeof rawUsername !== 'string' || !rawUsername.trim()) {
      throw new InvalidAuthRequestError('A valid username is required.')
    }

    if (typeof email !== 'string' || !email.trim() || !email.includes('@')) {
      throw new InvalidAuthRequestError('A valid email address is required.')
    }

    if (typeof password !== 'string' || password.length < 6) {
      throw new InvalidAuthRequestError('Password must be at least 6 characters long.')
    }

    const normalizedEmail = email.trim().toLowerCase()
    const trimmedName = rawUsername.trim()

    // Check if username is already taken
    const [existingUsernames] = await db.execute<UserRow[]>(
      'SELECT id FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1',
      [trimmedName],
    )

    if (existingUsernames.length > 0) {
      response.status(400).json({ error: 'Username is already taken. Please choose another.' })
      return
    }

    // Check if user already exists with this email
    const [existingRows] = await db.execute<UserRow[]>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [normalizedEmail],
    )

    if (existingRows.length > 0) {
      response.status(409).json({ error: 'An account with this email address already exists.' })
      return
    }

    const id = uuidv4()
    const providerId = `local:${normalizedEmail}`
    const connection = await db.getConnection()

    try {
      await connection.beginTransaction()

      if (await hasRecentlyUsedPassword(connection, id, password)) {
        await connection.rollback()
        response.status(400).json({ error: passwordReuseError })
        return
      }

      const passwordHash = await bcrypt.hash(password, 10)

      await connection.execute<ResultSetHeader>(
        `INSERT INTO users
          (id, provider, provider_id, email, password_hash, name, photo_url, session_version)
         VALUES (?, 'local', ?, ?, ?, ?, NULL, 1)`,
        [id, providerId, normalizedEmail, passwordHash, trimmedName],
      )
      await connection.execute<ResultSetHeader>(
        `INSERT INTO password_history (id, user_id, password_hash)
         VALUES (?, ?, ?)`,
        [uuidv4(), id, passwordHash],
      )

      await connection.commit()
    } catch (error) {
      await connection.rollback().catch(() => undefined)
      throw error
    } finally {
      connection.release()
    }

    const [rows] = await db.execute<UserRow[]>(
      'SELECT * FROM users WHERE id = ? LIMIT 1',
      [id],
    )
    const userRow = rows[0]

    if (!userRow) {
      throw new Error('Unable to create the user account.')
    }

    sendAuthenticatedUser(request, response, 201, serializeUser(userRow), userRow.session_version ?? 1)
  } catch (error) {
    if (error instanceof InvalidAuthRequestError) {
      response.status(400).json({ error: error.message })
      return
    }

    console.error('Unable to register user: %o', error)
    response.status(500).json({ error: 'Unable to register user account.' })
  }
})

router.post('/login', async (request: Request, response: Response) => {
  try {
    const body: unknown = request.body

    if (!isRecord(body)) {
      throw new InvalidAuthRequestError('A JSON request body is required.')
    }

    const { email, password } = body

    if (typeof email !== 'string' || !email.trim()) {
      throw new InvalidAuthRequestError('Email address is required.')
    }

    if (typeof password !== 'string' || !password) {
      throw new InvalidAuthRequestError('Password is required.')
    }

    const normalizedEmail = email.trim().toLowerCase()

    const [rows] = await db.execute<UserRow[]>(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [normalizedEmail],
    )
    const userRow = rows[0]

    if (!userRow || !userRow.password_hash) {
      response.status(401).json({ error: 'Invalid email or password.' })
      return
    }

    const isMatch = await bcrypt.compare(password, userRow.password_hash)

    if (!isMatch) {
      response.status(401).json({ error: 'Invalid email or password.' })
      return
    }

    // Increment session_version for single active device constraint
    await db.execute<ResultSetHeader>(
      'UPDATE users SET session_version = session_version + 1 WHERE id = ?',
      [userRow.id],
    )
    const newSessionVersion = (userRow.session_version ?? 1) + 1

    sendAuthenticatedUser(request, response, 200, serializeUser(userRow), newSessionVersion)
  } catch (error) {
    if (error instanceof InvalidAuthRequestError) {
      response.status(400).json({ error: error.message })
      return
    }

    console.error('Unable to sign in user: %o', error)
    response.status(500).json({ error: 'Unable to sign in.' })
  }
})

router.get('/telegram/config', (_request: Request, response: Response) => {
  try {
    response.set('Cache-Control', 'no-store')
    response.status(200).json({ clientId: requireTelegramClientId() })
  } catch (error) {
    console.error('Unable to load Telegram login configuration: %o', error)
    response.status(503).json({ error: 'Telegram login is not configured.' })
  }
})

router.post(
  '/telegram',
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const telegramUser = verifyTelegramAuth(request.body)
      const user = await upsertTelegramUser(telegramUser)

      sendAuthenticatedUser(request, response, 200, serializeUser(user), user.session_version ?? 1)
    } catch (error) {
      if (error instanceof AuthVerificationError) {
        next(new AppError(401, error.message, 'TELEGRAM_AUTH_INVALID'))
        return
      }

      next(error)
    }
  },
)

router.post('/session', async (request: Request, response: Response) => {
  try {
    const body: unknown = request.body

    if (!isRecord(body)) {
      throw new InvalidAuthRequestError('A JSON request body is required.')
    }

    const provider = body.provider

    if (provider !== 'google' && provider !== 'telegram') {
      throw new InvalidAuthRequestError('Unsupported authentication provider.')
    }

    // `payload` is the canonical API field. The fallbacks keep the current
    // frontend request format working while clients migrate to the new shape.
    const payload = body.payload ?? (
      provider === 'google'
        ? (body.access_token ?? body.credential ?? body.token)
        : (body.credential ?? body.authData ?? body.token)
    )

    if (payload === undefined || payload === null || (typeof payload === 'string' && !payload.trim())) {
      throw new InvalidAuthRequestError(
        provider === 'google'
          ? 'Google access token is required.'
          : 'Authentication payload is required.',
      )
    }

    const identity = await verifyIdentity(provider, payload)
    const [rows] = await db.execute<UserRow[]>(
      'SELECT * FROM users WHERE provider_id = ? LIMIT 1',
      [identity.providerId],
    )
    let userRow = rows[0]
    let newSessionVersion = 1

    if (!userRow) {
      const id = uuidv4()

      await db.execute<ResultSetHeader>(
        `INSERT INTO users
          (id, provider, provider_id, email, name, photo_url, session_version)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [
          id,
          identity.provider,
          identity.providerId,
          identity.email,
          identity.name,
          identity.photoUrl,
        ],
      )

      const [createdRows] = await db.execute<UserRow[]>(
        'SELECT * FROM users WHERE provider_id = ? LIMIT 1',
        [identity.providerId],
      )
      userRow = createdRows[0]
      newSessionVersion = 1
    } else {
      // Increment session_version for concurrent login prevention
      await db.execute<ResultSetHeader>(
        'UPDATE users SET session_version = session_version + 1 WHERE id = ?',
        [userRow.id],
      )
      newSessionVersion = (userRow.session_version ?? 1) + 1
    }

    if (!userRow) {
      throw new Error('Unable to load the authenticated user.')
    }

    if (userRow.provider !== identity.provider) {
      throw new Error('Provider ID collision detected.')
    }

    sendAuthenticatedUser(request, response, 200, serializeUser(userRow), newSessionVersion)
  } catch (error) {
    if (error instanceof InvalidAuthRequestError) {
      response.status(400).json({ error: error.message, receivedBody: request.body })
      return
    }

    if (error instanceof AuthVerificationError) {
      response.status(401).json({ error: error.message })
      return
    }

    console.error('Unable to create authentication session: %o', error)
    response.status(500).json({ error: 'Unable to create authentication session.' })
  }
})

router.get(
  '/session',
  authenticateRequest,
  async (request: Request, response: Response) => {
    try {
      const [rows] = await db.execute<UserRow[]>(
        'SELECT * FROM users WHERE id = ? LIMIT 1',
        [response.locals.userId as string],
      )
      const userRow = rows[0]

      if (!userRow) {
        clearSessionCookie(request, response)
        response.status(401).json({ error: 'The session user no longer exists.' })
        return
      }

      response.set('Cache-Control', 'no-store')
      response.status(200).json({
        user: serializeUser(userRow),
        has_password: Boolean(userRow.password_hash),
        hasPassword: Boolean(userRow.password_hash),
      })
    } catch (error) {
      console.error('Unable to restore authentication session: %o', error)
      response.status(500).json({ error: 'Unable to restore authentication session.' })
    }
  },
)

router.get(
  '/me',
  authenticateRequest,
  async (request: Request, response: Response) => {
    try {
      const [rows] = await db.execute<UserRow[]>(
        'SELECT * FROM users WHERE id = ? LIMIT 1',
        [response.locals.userId as string],
      )
      const userRow = rows[0]

      if (!userRow) {
        clearSessionCookie(request, response)
        response.status(401).json({ error: 'The session user no longer exists.' })
        return
      }

      response.set('Cache-Control', 'no-store')
      response.status(200).json({
        user: serializeUser(userRow),
        has_password: Boolean(userRow.password_hash),
        hasPassword: Boolean(userRow.password_hash),
      })
    } catch (error) {
      console.error('Unable to fetch user profile: %o', error)
      response.status(500).json({ error: 'Unable to fetch user profile.' })
    }
  },
)

router.delete('/session', (request: Request, response: Response) => {
  clearSessionCookie(request, response)
  response.status(204).send()
})

// OTP In-Memory Fallback Cache (15 min expiration)
interface MemoryOtp {
  userId: string
  code: string
  expiresAt: number
}
const memoryOtpCache = new Map<string, MemoryOtp>()

// POST /auth/forgot-password - Request 6-digit OTP
router.post('/forgot-password', async (request: Request, response: Response) => {
  try {
    if (!isRecord(request.body)) {
      throw new InvalidAuthRequestError('A JSON request body is required.')
    }

    const rawIdentifier = request.body.email ?? request.body.identifier ?? request.body.username
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : ''

    if (!identifier) {
      throw new InvalidAuthRequestError('Please provide your email address or username.')
    }

    const [rows] = await db.execute<UserRow[]>(
      `SELECT id, provider, provider_id, email, name
         FROM users
        WHERE LOWER(email) = LOWER(?)
           OR LOWER(name) = LOWER(?)
        LIMIT 1`,
      [identifier, identifier],
    )
    const user = rows[0]

    if (!user) {
      // Return neutral message for security
      response.status(200).json({
        success: true,
        message: 'If an account exists, a 6-digit OTP code has been dispatched.',
        channel: 'email',
      })
      return
    }

    // Generate secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

    // Store in database
    await db.execute<ResultSetHeader>(
      `INSERT INTO password_reset_otps (id, user_id, otp_code, expires_at)
       VALUES (?, ?, ?, ?)`,
      [uuidv4(), user.id, otp, expiresAt],
    ).catch(() => undefined)

    // Store in memory cache
    memoryOtpCache.set(user.id, {
      userId: user.id,
      code: otp,
      expiresAt: Date.now() + 15 * 60 * 1000,
    })
    if (user.email) {
      memoryOtpCache.set(user.email.toLowerCase(), {
        userId: user.id,
        code: otp,
        expiresAt: Date.now() + 15 * 60 * 1000,
      })
    }

    // Check if user has linked Telegram chat ID
    const telegramChatId = await findTelegramChatIdForUser(user.id)
    let channel: 'telegram' | 'email' = 'email'

    if (telegramChatId) {
      channel = 'telegram'
      const message = `🔐 *KiasuCode Security*: Your 6-digit password reset OTP is *${otp}*.\n\nThis code expires in 15 minutes. If you did not request a password reset, please secure your account.`
      await sendTelegramNotification(telegramChatId, message)
    } else {
      channel = 'email'
      console.log(`[Email Dispatch Mock] Password reset OTP for user "${user.name}" (${user.email || 'no-email'}): ${otp}`)
    }

    response.status(200).json({
      success: true,
      message: channel === 'telegram'
        ? 'A 6-digit OTP has been sent to your linked Telegram account.'
        : `A 6-digit OTP has been dispatched to ${user.email || 'your email'}.`,
      channel,
      email: user.email || user.name,
    })
  } catch (error) {
    if (error instanceof InvalidAuthRequestError) {
      response.status(400).json({ error: error.message })
      return
    }

    console.error('Unable to send password reset OTP: %o', error)
    response.status(500).json({ error: 'Unable to send password reset OTP.' })
  }
})

// POST /auth/reset-password - Verify OTP and set new password
router.post('/reset-password', async (request: Request, response: Response) => {
  try {
    if (!isRecord(request.body)) {
      throw new InvalidAuthRequestError('A JSON request body is required.')
    }

    const rawIdentifier = request.body.email ?? request.body.identifier ?? request.body.username
    const rawOtp = request.body.otp ?? request.body.code
    const rawPassword = request.body.password ?? request.body.newPassword

    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : ''
    const otp = typeof rawOtp === 'string' ? rawOtp.trim() : ''
    const newPassword = typeof rawPassword === 'string' ? rawPassword : ''

    if (!identifier || !otp || !newPassword) {
      throw new InvalidAuthRequestError('Email/username, OTP code, and new password are required.')
    }

    if (!/^\d{6}$/.test(otp)) {
      throw new InvalidAuthRequestError('OTP code must be a 6-digit number.')
    }

    if (newPassword.length < 6) {
      throw new InvalidAuthRequestError('New password must be at least 6 characters long.')
    }

    const [rows] = await db.execute<UserRow[]>(
      `SELECT id, provider, provider_id, email, name, password_hash
         FROM users
        WHERE LOWER(email) = LOWER(?)
           OR LOWER(name) = LOWER(?)
        LIMIT 1`,
      [identifier, identifier],
    )
    const user = rows[0]

    if (!user) {
      response.status(400).json({ error: 'Invalid or expired OTP code.' })
      return
    }

    // Verify OTP against DB or memory cache
    let isOtpValid = false

    const [otpRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM password_reset_otps
        WHERE user_id = ? AND otp_code = ? AND expires_at > CURRENT_TIMESTAMP
        ORDER BY created_at DESC LIMIT 1`,
      [user.id, otp],
    ).catch(() => [[], []] as unknown as [RowDataPacket[], unknown])

    if (otpRows.length > 0) {
      isOtpValid = true
    } else {
      const cached = memoryOtpCache.get(user.id) || (user.email ? memoryOtpCache.get(user.email.toLowerCase()) : undefined)
      if (cached && cached.code === otp && cached.expiresAt > Date.now()) {
        isOtpValid = true
      }
    }

    if (!isOtpValid) {
      response.status(400).json({ error: 'Invalid or expired OTP code.' })
      return
    }

    // Enforce Password Reuse Rule (last 3 passwords)
    const [historyRows] = await db.execute<PasswordHistoryRow[]>(
      `SELECT password_hash FROM password_history
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 3`,
      [user.id],
    )

    for (const record of historyRows) {
      if (await bcrypt.compare(newPassword, record.password_hash)) {
        response.status(400).json({ error: passwordReuseError })
        return
      }
    }

    // Hash and update password
    const newPasswordHash = await bcrypt.hash(newPassword, 12)

    await db.execute<ResultSetHeader>(
      `UPDATE users
          SET password_hash = ?, session_version = session_version + 1
        WHERE id = ?`,
      [newPasswordHash, user.id],
    )

    await db.execute<ResultSetHeader>(
      `INSERT INTO password_history (id, user_id, password_hash)
       VALUES (?, ?, ?)`,
      [uuidv4(), user.id, newPasswordHash],
    )

    // Clean up OTPs
    await db.execute<ResultSetHeader>(
      'DELETE FROM password_reset_otps WHERE user_id = ?',
      [user.id],
    ).catch(() => undefined)
    memoryOtpCache.delete(user.id)
    if (user.email) memoryOtpCache.delete(user.email.toLowerCase())

    response.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now sign in with your new password.',
    })
  } catch (error) {
    if (error instanceof InvalidAuthRequestError) {
      response.status(400).json({ error: error.message })
      return
    }

    console.error('Unable to reset password with OTP: %o', error)
    response.status(500).json({ error: 'Unable to reset password.' })
  }
})

router.get(
  '/spotify',
  authenticateRequest,
  (request: Request, response: Response) => {
    const userId = response.locals.userId as string
    const redirectOrigin = `${request.protocol}://${request.get('host')}`
    const authUrl = getSpotifyAuthorizeUrl(userId, getSpotifyRedirectUri(redirectOrigin))
    response.redirect(authUrl)
  },
)

router.get('/spotify/callback', async (request: Request, response: Response) => {
  const code = typeof request.query.code === 'string' ? request.query.code : null
  const state = typeof request.query.state === 'string' ? request.query.state : null
  const error = typeof request.query.error === 'string' ? request.query.error : null

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

  if (error || !code || !state) {
    console.error('Spotify authorization failed or was denied:', error)
    response.redirect(`${frontendUrl}/settings?spotify=error`)
    return
  }

  const userId = state
  const redirectOrigin = `${request.protocol}://${request.get('host')}`
  const redirectUri = getSpotifyRedirectUri(redirectOrigin)

  try {
    const { accessToken, refreshToken, expiresIn } = await exchangeSpotifyCode(code, redirectUri)
    const tokenExpiry = Date.now() + expiresIn * 1000

    await db.execute(
      `UPDATE users
          SET spotify_access_token = ?,
              spotify_refresh_token = ?,
              spotify_token_expiry = ?
        WHERE id = ?`,
      [accessToken, refreshToken, tokenExpiry, userId],
    )

    response.redirect(`${frontendUrl}/settings?spotify=connected`)
  } catch (err) {
    console.error('Spotify code exchange error:', err)
    response.redirect(`${frontendUrl}/settings?spotify=error`)
  }
})

export default router


