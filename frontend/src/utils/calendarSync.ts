import type { AcademicCountdown } from '@kiasucode/shared'

export interface GoogleCalendarEventItem {
  id?: string
  summary?: string
  description?: string
  start?: {
    dateTime?: string
    date?: string
  }
  end?: {
    dateTime?: string
    date?: string
  }
}

export interface GoogleCalendarEventsResponse {
  items?: GoogleCalendarEventItem[]
}

/**
 * Infer an academic category based on the event title.
 */
export function inferAcademicCategory(title: string): string {
  const lower = title.toLowerCase()
  if (/\b(exam|test|quiz|ca\s*\d|ras\s*\d|midterm|finals?)\b/i.test(lower)) {
    return 'Exam'
  }
  if (/\b(presentation|project|proposal|hack|ica\s*\d|demo|pitch)\b/i.test(lower)) {
    return 'Project'
  }
  if (/\b(assignment|homework|hw|lab|report|cutoff|submission|due)\b/i.test(lower)) {
    return 'Assignment'
  }
  return 'General'
}

/**
 * Fetch events from the primary Google Calendar via Google Calendar REST API v3.
 */
export async function fetchGoogleCalendarEvents(
  accessToken: string,
  timeMin?: string,
  timeMax?: string,
): Promise<GoogleCalendarEventItem[]> {
  const min = timeMin || new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  const max = timeMax || new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()

  const params = new URLSearchParams({
    timeMin: min,
    timeMax: max,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google Calendar API error (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as GoogleCalendarEventsResponse
  return data.items || []
}

/**
 * Create a new event on Google Calendar.
 */
export async function createGoogleCalendarEvent(
  accessToken: string,
  payload: {
    summary: string
    description?: string
    startIso: string
    endIso?: string
    isAllDay?: boolean
    startDateStr?: string
    endDateStr?: string
  },
): Promise<{ id: string }> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Singapore'

  const body: Record<string, unknown> = {
    summary: payload.summary,
    description: payload.description || 'Synced from KiasuCode Academic Radar',
  }

  if (payload.isAllDay && payload.startDateStr) {
    body.start = { date: payload.startDateStr }
    body.end = { date: payload.endDateStr || payload.startDateStr }
  } else {
    const start = payload.startIso
    const end = payload.endIso || new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString()
    body.start = { dateTime: start, timeZone }
    body.end = { dateTime: end, timeZone }
  }

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to create Google Calendar event (${response.status}): ${errorText}`)
  }

  return (await response.json()) as { id: string }
}

/**
 * Generate a direct web link to add/view an event in Google Calendar.
 */
export function buildGoogleCalendarWebUrl(event: {
  title: string
  targetDate: string
  isAllDay?: boolean
  description?: string
}): string {
  const date = new Date(event.targetDate)
  const formatUtc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const startStr = formatUtc(date)
  const endStr = formatUtc(new Date(date.getTime() + 60 * 60 * 1000))

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${startStr}/${endStr}`,
    details: event.description || 'Academic Deadline tracked on KiasuCode Radar',
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function escapeICalText(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function formatICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Generate RFC 5545 iCalendar (.ics) string for events (Apple Calendar compatible).
 */
export function generateIcsContent(
  events: AcademicCountdown[],
  calendarName = 'KiasuCode Academic Radar',
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KiasuCode//Academic Radar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${calendarName}`,
    'X-WR-TIMEZONE:Asia/Singapore',
  ]

  for (const item of events) {
    const d = new Date(item.targetDate)
    if (Number.isNaN(d.getTime())) continue
    const dtstamp = formatICalDate(new Date(item.createdAt || Date.now()))
    const dtstart = formatICalDate(d)
    const dtend = formatICalDate(new Date(d.getTime() + 60 * 60 * 1000))

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:kiasucode-${item.id}@kiasucode.com`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART:${dtstart}`)
    lines.push(`DTEND:${dtend}`)
    lines.push(`SUMMARY:${escapeICalText(item.title)}`)
    lines.push(`CATEGORIES:${escapeICalText(item.category || 'Academic')}`)
    lines.push(`DESCRIPTION:${escapeICalText(`Academic deadline on KiasuCode (${item.category})`)}`)
    if (item.isAnnual) {
      lines.push('RRULE:FREQ=YEARLY')
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/**
 * Trigger download of an .ics file in the browser (opens automatically in Apple Calendar on Apple devices).
 */
export function downloadIcsFile(filename: string, icsContent: string): void {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.ics') ? filename : `${filename}.ics`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/**
 * Parse an uploaded .ics file into event objects for import into KiasuCode Radar.
 */
export function parseIcsContent(
  icsText: string,
): Array<{ title: string; targetDate: string; category: string }> {
  const events: Array<{ title: string; targetDate: string; category: string }> = []
  const veventBlocks = icsText.split(/BEGIN:VEVENT/i).slice(1)

  for (const block of veventBlocks) {
    const cleanBlock = block.split(/END:VEVENT/i)[0] || ''
    const summaryMatch = cleanBlock.match(/SUMMARY(?::|;[^:]*:)(.*)/i)
    const dtstartMatch = cleanBlock.match(/DTSTART(?::|;[^:]*:)(.*)/i)
    const categoryMatch = cleanBlock.match(/CATEGORIES(?::|;[^:]*:)(.*)/i)

    if (!summaryMatch || !dtstartMatch) continue

    const title = summaryMatch[1].trim().replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
    const rawDt = dtstartMatch[1].trim()

    let date: Date | null = null
    // Format YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss or YYYYMMDD
    if (/^\d{8}T\d{6}Z?$/.test(rawDt)) {
      const year = Number(rawDt.slice(0, 4))
      const month = Number(rawDt.slice(4, 6)) - 1
      const day = Number(rawDt.slice(6, 8))
      const hours = Number(rawDt.slice(9, 11))
      const minutes = Number(rawDt.slice(11, 13))
      const seconds = Number(rawDt.slice(13, 15))
      date = rawDt.endsWith('Z')
        ? new Date(Date.UTC(year, month, day, hours, minutes, seconds))
        : new Date(year, month, day, hours, minutes, seconds)
    } else if (/^\d{8}$/.test(rawDt)) {
      const year = Number(rawDt.slice(0, 4))
      const month = Number(rawDt.slice(4, 6)) - 1
      const day = Number(rawDt.slice(6, 8))
      date = new Date(year, month, day, 9, 0, 0)
    } else {
      const parsed = new Date(rawDt)
      if (!Number.isNaN(parsed.getTime())) {
        date = parsed
      }
    }

    if (!date || Number.isNaN(date.getTime()) || !title) continue

    const category = categoryMatch ? categoryMatch[1].trim() : inferAcademicCategory(title)
    events.push({
      title,
      targetDate: date.toISOString(),
      category: category || 'Apple Calendar',
    })
  }

  return events
}
