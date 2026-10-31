import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import type {
  AcademicCountdown,
  CountdownCategory,
  CreateCountdownInput,
} from '@kiasucode/shared'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'

import { db } from '../config/db.js'
import { authenticateRequest } from '../middleware/authenticate.js'
import { AppError } from '../middleware/errorHandler.js'

interface CountdownRow extends RowDataPacket {
  id: string
  module_id: string | null
  title: string
  target_date: Date | string
  category: CountdownCategory
  color: string | null
  is_annual: number | boolean
  google_event_id?: string | null
  source?: string | null
  created_at: Date | string
}

type ParsedCountdownInput = Omit<CreateCountdownInput, 'color'> & {
  color: string
  isAnnual: boolean
  googleEventId: string | null
  source: string
}

const router = Router()
const defaultCountdownColor = '#3b82f6'

async function ensureCountdownsTable() {
  const columnsToAdd = [
    { name: 'is_annual', ddl: 'ADD COLUMN is_annual BOOLEAN NOT NULL DEFAULT FALSE' },
    { name: 'google_event_id', ddl: 'ADD COLUMN google_event_id VARCHAR(255) NULL' },
    { name: 'source', ddl: "ADD COLUMN source VARCHAR(50) NULL DEFAULT 'local'" },
  ]

  for (const col of columnsToAdd) {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'academic_countdowns' AND COLUMN_NAME = ?`,
        [col.name],
      )
      if (Array.isArray(rows) && rows.length === 0) {
        await db.execute(`ALTER TABLE academic_countdowns ${col.ddl}`)
      }
    } catch {
      // Ignore if table doesn't exist yet or column check failed
    }
  }
}
void ensureCountdownsTable()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getUserId(response: Response): string {
  return response.locals.userId as string
}

function getCountdownId(request: Request): string {
  const countdownId = request.params.id

  if (typeof countdownId !== 'string' || !countdownId.trim()) {
    throw new AppError(400, 'Countdown ID is required.', 'INVALID_COUNTDOWN_ID')
  }

  return countdownId.trim()
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new Error('Database returned an invalid countdown timestamp.')
  }

  return date.toISOString()
}

function serializeCountdown(row: CountdownRow): AcademicCountdown {
  return {
    id: row.id,
    moduleId: row.module_id,
    title: row.title,
    targetDate: toIsoString(row.target_date),
    category: row.category,
    color: row.color || defaultCountdownColor,
    isAnnual: Boolean(row.is_annual),
    googleEventId: row.google_event_id || null,
    source: row.source || 'local',
    createdAt: toIsoString(row.created_at),
  }
}

function parseCreateCountdownInput(body: unknown): ParsedCountdownInput {
  if (!isRecord(body)) {
    throw new AppError(400, 'A JSON request body is required.', 'INVALID_REQUEST_BODY')
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const rawTargetDate = body.targetDate ?? body.target_date
  const targetDate = typeof rawTargetDate === 'string'
    ? new Date(rawTargetDate)
    : new Date(Number.NaN)
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const color = typeof body.color === 'string' && body.color.trim()
    ? body.color.trim()
    : defaultCountdownColor
  const rawModuleId = body.moduleId ?? body.module_id ?? null
  const moduleId = typeof rawModuleId === 'string' && rawModuleId.trim()
    ? rawModuleId.trim()
    : null
  const isAnnual = Boolean(body.isAnnual ?? body.is_annual)
  const rawGoogleEventId = body.googleEventId ?? body.google_event_id ?? null
  const googleEventId = typeof rawGoogleEventId === 'string' && rawGoogleEventId.trim()
    ? rawGoogleEventId.trim()
    : null
  const rawSource = body.source ?? null
  const source = typeof rawSource === 'string' && rawSource.trim()
    ? rawSource.trim()
    : 'local'

  if (!title || title.length > 255) {
    throw new AppError(
      400,
      'Countdown title must be between 1 and 255 characters.',
      'INVALID_COUNTDOWN_TITLE',
    )
  }

  if (Number.isNaN(targetDate.getTime())) {
    throw new AppError(400, 'Target date must be a valid date and time.', 'INVALID_TARGET_DATE')
  }

  if (!category || category.length > 50) {
    throw new AppError(
      400,
      'Countdown category must be between 1 and 50 characters.',
      'INVALID_COUNTDOWN_CATEGORY',
    )
  }

  if (
    color.length > 30
    || (!/^bg-[a-z]+-\d{2,3}$/.test(color) && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color))
  ) {
    throw new AppError(
      400,
      'Countdown color must be a valid hex color or background color class.',
      'INVALID_COUNTDOWN_COLOR',
    )
  }

  if (moduleId && moduleId.length !== 36) {
    throw new AppError(400, 'Module ID is invalid.', 'INVALID_MODULE_ID')
  }

  return {
    title,
    targetDate: targetDate.toISOString(),
    category,
    color,
    moduleId,
    isAnnual,
    googleEventId,
    source,
  }
}

router.get(
  '/countdowns',
  authenticateRequest,
  async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const [rows] = await db.execute<CountdownRow[]>(
        `SELECT id, module_id, title, target_date, category, color, is_annual, google_event_id, source, created_at
           FROM academic_countdowns
          WHERE user_id = ?
          ORDER BY target_date ASC, created_at ASC`,
        [getUserId(response)],
      )

      response.status(200).json({ countdowns: rows.map(serializeCountdown) })
    } catch (error) {
      next(error)
    }
  },
)

router.post(
  '/countdowns',
  authenticateRequest,
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = parseCreateCountdownInput(request.body)
      const userId = getUserId(response)

      if (input.moduleId) {
        const [moduleRows] = await db.execute<RowDataPacket[]>(
          `SELECT m.id
             FROM modules AS m
             INNER JOIN semesters AS s ON s.id = m.semester_id
             INNER JOIN institutions AS i ON i.id = s.institution_id
            WHERE m.id = ? AND i.user_id = ?
            LIMIT 1`,
          [input.moduleId, userId],
        )

        if (!moduleRows[0]) {
          throw new AppError(404, 'Module not found.', 'MODULE_NOT_FOUND')
        }
      }

      const countdownId = uuidv4()
      await db.execute<ResultSetHeader>(
        `INSERT INTO academic_countdowns
          (id, user_id, module_id, title, target_date, category, color, is_annual, google_event_id, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          countdownId,
          userId,
          input.moduleId,
          input.title,
          new Date(input.targetDate),
          input.category,
          input.color,
          input.isAnnual ? 1 : 0,
          input.googleEventId,
          input.source,
        ],
      )

      const [rows] = await db.execute<CountdownRow[]>(
        `SELECT id, module_id, title, target_date, category, color, is_annual, google_event_id, source, created_at
           FROM academic_countdowns
          WHERE id = ? AND user_id = ?
          LIMIT 1`,
        [countdownId, userId],
      )
      const countdown = rows[0]

      if (!countdown) throw new Error('Unable to load the created countdown.')

      response.status(201).json({ countdown: serializeCountdown(countdown) })
    } catch (error) {
      next(error)
    }
  },
)

const updateCountdownHandler = async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    const input = parseCreateCountdownInput(request.body)
    const countdownId = getCountdownId(request)
    const userId = getUserId(response)
    const [existingRows] = await db.execute<CountdownRow[]>(
      `SELECT id, module_id, title, target_date, category, color, is_annual, google_event_id, source, created_at
         FROM academic_countdowns
        WHERE id = ? AND user_id = ?
        LIMIT 1`,
      [countdownId, userId],
    )

    if (!existingRows[0]) {
      throw new AppError(404, 'Countdown not found.', 'COUNTDOWN_NOT_FOUND')
    }

    if (input.moduleId) {
      const [moduleRows] = await db.execute<RowDataPacket[]>(
        `SELECT m.id
           FROM modules AS m
           INNER JOIN semesters AS s ON s.id = m.semester_id
           INNER JOIN institutions AS i ON i.id = s.institution_id
          WHERE m.id = ? AND i.user_id = ?
          LIMIT 1`,
        [input.moduleId, userId],
      )

      if (!moduleRows[0]) {
        throw new AppError(404, 'Module not found.', 'MODULE_NOT_FOUND')
      }
    }

    await db.execute<ResultSetHeader>(
      `UPDATE academic_countdowns
          SET title = ?, target_date = ?, category = ?, color = ?, module_id = ?, is_annual = ?,
              google_event_id = COALESCE(?, google_event_id),
              source = COALESCE(?, source)
        WHERE id = ? AND user_id = ?`,
      [
        input.title,
        new Date(input.targetDate),
        input.category,
        input.color,
        input.moduleId,
        input.isAnnual ? 1 : 0,
        input.googleEventId,
        input.source,
        countdownId,
        userId,
      ],
    )

    const [rows] = await db.execute<CountdownRow[]>(
      `SELECT id, module_id, title, target_date, category, color, is_annual, google_event_id, source, created_at
         FROM academic_countdowns
        WHERE id = ? AND user_id = ?
        LIMIT 1`,
      [countdownId, userId],
    )
    const countdown = rows[0]

    if (!countdown) {
      throw new AppError(404, 'Countdown not found.', 'COUNTDOWN_NOT_FOUND')
    }

    response.status(200).json({ countdown: serializeCountdown(countdown) })
  } catch (error) {
    next(error)
  }
}

router.put('/countdowns/:id', authenticateRequest, updateCountdownHandler)
router.patch('/countdowns/:id', authenticateRequest, updateCountdownHandler)

router.delete(
  '/countdowns/:id',
  authenticateRequest,
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const [result] = await db.execute<ResultSetHeader>(
        `DELETE FROM academic_countdowns
          WHERE id = ? AND user_id = ?`,
        [getCountdownId(request), getUserId(response)],
      )

      if (result.affectedRows === 0) {
        throw new AppError(404, 'Countdown not found.', 'COUNTDOWN_NOT_FOUND')
      }

      response.status(200).json({ success: true })
    } catch (error) {
      next(error)
    }
  },
)

/**
 * POST /api/countdowns/sync-google
 * Synchronizes events imported from Google Calendar into academic_countdowns.
 */
router.post(
  '/countdowns/sync-google',
  authenticateRequest,
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = getUserId(response)
      const rawEvents = Array.isArray(request.body.events) ? request.body.events : []

      if (!rawEvents.length) {
        response.status(200).json({
          success: true,
          count: 0,
          message: 'No events provided to sync.',
        })
        return
      }

      let upsertCount = 0

      for (const item of rawEvents) {
        if (!item || typeof item !== 'object') continue
        const title = typeof item.title === 'string' ? item.title.trim() : ''
        const rawDate = item.targetDate || item.start
        const targetDate = rawDate ? new Date(rawDate) : null
        if (!title || !targetDate || Number.isNaN(targetDate.getTime())) continue

        const googleEventId = typeof item.googleEventId === 'string' && item.googleEventId.trim()
          ? item.googleEventId.trim()
          : null
        const category = typeof item.category === 'string' && item.category.trim()
          ? item.category.trim()
          : 'Google Calendar'
        const color = typeof item.color === 'string' && item.color.trim()
          ? item.color.trim()
          : '#4285F4'

        if (googleEventId) {
          const [existingById] = await db.execute<CountdownRow[]>(
            `SELECT id FROM academic_countdowns WHERE user_id = ? AND google_event_id = ? LIMIT 1`,
            [userId, googleEventId],
          )

          if (existingById[0]) {
            await db.execute(
              `UPDATE academic_countdowns
                  SET title = ?, target_date = ?, category = ?, color = ?
                WHERE id = ? AND user_id = ?`,
              [title, targetDate, category, color, existingById[0].id, userId],
            )
            upsertCount++
            continue
          }
        }

        // Match by title and target date (same day)
        const [existingByTitleDate] = await db.execute<CountdownRow[]>(
          `SELECT id, google_event_id FROM academic_countdowns
            WHERE user_id = ? AND title = ? AND DATE(target_date) = DATE(?)
            LIMIT 1`,
          [userId, title, targetDate],
        )

        if (existingByTitleDate[0]) {
          if (googleEventId && !existingByTitleDate[0].google_event_id) {
            await db.execute(
              `UPDATE academic_countdowns SET google_event_id = ? WHERE id = ? AND user_id = ?`,
              [googleEventId, existingByTitleDate[0].id, userId],
            )
          }
          upsertCount++
          continue
        }

        const newId = uuidv4()
        await db.execute(
          `INSERT INTO academic_countdowns
            (id, user_id, title, target_date, category, color, is_annual, google_event_id, source)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'google')`,
          [newId, userId, title, targetDate, category, color, googleEventId],
        )
        upsertCount++
      }

      const [allRows] = await db.execute<CountdownRow[]>(
        `SELECT id, module_id, title, target_date, category, color, is_annual, google_event_id, source, created_at
           FROM academic_countdowns
          WHERE user_id = ?
          ORDER BY target_date ASC, created_at ASC`,
        [userId],
      )

      response.status(200).json({
        success: true,
        count: upsertCount,
        countdowns: allRows.map(serializeCountdown),
      })
    } catch (error) {
      next(error)
    }
  },
)

export default router

