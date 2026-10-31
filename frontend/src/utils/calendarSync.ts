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
  calendarSummary?: string
  calendarColor?: string
}

export interface GoogleCalendarEventsResponse {
  items?: GoogleCalendarEventItem[]
}

interface GoogleCalendarListItem {
  id: string
  summary?: string
  backgroundColor?: string
  primary?: boolean
  selected?: boolean
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
 * Fetch events from ALL calendars in the user's Google account (Primary, Folderly, etc.)
 */
export async function fetchGoogleCalendarEvents(
  accessToken: string,
  timeMin?: string,
  timeMax?: string,
): Promise<GoogleCalendarEventItem[]> {
  // Query 90 days back to 180 days forward
  const min = timeMin || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const max = timeMax || new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()

  const params = new URLSearchParams({
    timeMin: min,
    timeMax: max,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })

  // 1. Discover all user calendars (e.g. Felicia Tan, Folderly, etc.)
  let targetCalendars: Array<{ id: string; summary: string; color?: string }> = [
    { id: 'primary', summary: 'Primary', color: '#4285F4' },
  ]

  try {
    const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (listRes.ok) {
      const listData = (await listRes.json()) as { items?: GoogleCalendarListItem[] }
      if (Array.isArray(listData.items) && listData.items.length > 0) {
        // Include all selected user calendars (like Folderly), excluding public holiday feeds
        const userCalendars = listData.items
          .filter(
            (c) =>
              Boolean(c.id)
              && c.selected !== false
              && !c.id.includes('#holiday@group.v.calendar.google.com'),
          )
          .map((c) => ({
            id: c.id,
            summary: c.summary || (c.primary ? 'Primary' : 'Google Calendar'),
            color: c.backgroundColor || (c.primary ? '#4285F4' : '#f59e0b'),
          }))

        if (userCalendars.length > 0) {
          targetCalendars = userCalendars
        }
      }
    }
  } catch {
    // If calendarList fails, keep default primary calendar
  }

  // 2. Fetch events from every target calendar
  const allEvents: GoogleCalendarEventItem[] = []
  const seenIds = new Set<string>()

  for (const cal of targetCalendars) {
    try {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params.toString()}`
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        if (cal.id === 'primary') {
          const errorText = await response.text()
          if (
            response.status === 403
            && (errorText.includes('SERVICE_DISABLED')
              || errorText.includes('accessNotConfigured')
              || errorText.includes('Google Calendar API has not been used'))
          ) {
            throw new Error(
              'Google Calendar API is not enabled in your Google Cloud project. Please click "Enable" in Google Cloud Console.',
            )
          }
          throw new Error(`Google Calendar API error (${response.status}): ${errorText}`)
        }
        continue
      }

      const data = (await response.json()) as GoogleCalendarEventsResponse
      if (Array.isArray(data.items)) {
        for (const item of data.items) {
          const key = item.id || `${item.summary}-${item.start?.dateTime || item.start?.date}`
          if (!seenIds.has(key)) {
            seenIds.add(key)
            allEvents.push({
              ...item,
              calendarSummary: cal.summary,
              calendarColor: cal.color,
            })
          }
        }
      }
    } catch (err) {
      if (cal.id === 'primary') throw err
    }
  }

  return allEvents
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
    if (
      response.status === 403
      && (errorText.includes('SERVICE_DISABLED')
        || errorText.includes('accessNotConfigured')
        || errorText.includes('Google Calendar API has not been used'))
    ) {
      throw new Error(
        'Google Calendar API is not enabled in your Google Cloud project. Please click "Enable" in Google Cloud Console.',
      )
    }
    throw new Error(`Failed to create Google Calendar event (${response.status}): ${errorText}`)
  }

  return (await response.json()) as { id: string }
}

/**
 * Generate a direct web link to add/view an event in Google Calendar.
 * Works instantly in any browser without requiring OAuth consent!
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
