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
