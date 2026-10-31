import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google'
import type { AcademicCountdown } from '@kiasucode/shared'

import { Logo } from '../components/Logo'
import { Navbar } from '../components/Navbar'
import { TelegramConnectModal } from '../components/TelegramConnectModal'
import { useToast } from '../context/ToastContext'
import { apiRequest, formatApiError, isAbortError } from '../utils/api'
import {
  buildGoogleCalendarWebUrl,
  createGoogleCalendarEvent,
  fetchGoogleCalendarEvents,
  inferAcademicCategory,
} from '../utils/calendarSync'
import { defaultCountdownColor, resolveCountdownColor } from '../utils/colors'
import { fetchSingaporePublicHolidays } from '../utils/holidays'

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? ''

interface CountdownsResponse {
  countdowns: AcademicCountdown[]
}

interface CountdownResponse {
  countdown: AcademicCountdown
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function isSameCalendarDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear()
    && d1.getMonth() === d2.getMonth()
    && d1.getDate() === d2.getDate()
  )
}

function matchesCalendarDay(event: AcademicCountdown, cellDate: Date): boolean {
  const eventDate = new Date(event.targetDate)
  if (event.isAnnual) {
    return (
      eventDate.getMonth() === cellDate.getMonth()
      && eventDate.getDate() === cellDate.getDate()
    )
  }
  return (
    eventDate.getFullYear() === cellDate.getFullYear()
    && eventDate.getMonth() === cellDate.getMonth()
    && eventDate.getDate() === cellDate.getDate()
  )
}

function getEventForCalendarDate(event: AcademicCountdown, cellDate: Date): AcademicCountdown {
  if (!event.isAnnual) return event

  const orig = new Date(event.targetDate)
  const adjusted = new Date(
    cellDate.getFullYear(),
    orig.getMonth(),
    orig.getDate(),
    orig.getHours(),
    orig.getMinutes(),
    orig.getSeconds(),
    orig.getMilliseconds(),
  )
  return {
    ...event,
    targetDate: adjusted.toISOString(),
  }
}

function sortCountdowns(countdowns: AcademicCountdown[]): AcademicCountdown[] {
  return [...countdowns].sort(
    (left, right) =>
      new Date(left.targetDate).getTime() - new Date(right.targetDate).getTime(),
  )
}

function formatDateInput(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(dateStr: string, timeStr = '00:00'): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hours, minutes] = timeStr.split(':').map(Number)
  return new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0)
}

function CountdownsViewContent() {
  const [isTelegramOpen, setIsTelegramOpen] = useState(false)
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [countdowns, setCountdowns] = useState<AcademicCountdown[]>([])
  const [publicHolidays, setPublicHolidays] = useState<AcademicCountdown[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Google Calendar Sync State
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(() => {
    const token = localStorage.getItem('kiasucode_google_cal_token')
    const exp = Number(localStorage.getItem('kiasucode_google_cal_token_exp') || '0')
    if (token && exp > Date.now()) return token
    return null
  })
  const isGoogleCalConnected = Boolean(googleAccessToken)
  const [isGoogleSyncing, setIsGoogleSyncing] = useState(false)
  const [isPushingToGoogle, setIsPushingToGoogle] = useState(false)
  const [syncToGoogleOnSave, setSyncToGoogleOnSave] = useState(true)
  const [isGoogleMenuOpen, setIsGoogleMenuOpen] = useState(false)


  // Create / Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCountdownId, setEditingCountdownId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [title, setTitle] = useState('')
  const [isAllDay, setIsAllDay] = useState(false)
  const [isMultipleDays, setIsMultipleDays] = useState(false)
  const [isAnnual, setIsAnnual] = useState(false)
  const [startDate, setStartDate] = useState(() => formatDateInput(new Date()))
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()))
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [color, setColor] = useState(defaultCountdownColor)
  const [modalError, setModalError] = useState<string | null>(null)
  const { showToast } = useToast()

  const currentYear = currentDate.getFullYear()
  const currentMonth = currentDate.getMonth()

  useEffect(() => {
    const controller = new AbortController()

    void apiRequest<CountdownsResponse>('/api/countdowns', {
      signal: controller.signal,
    })
      .then(({ data }) => setCountdowns(data.countdowns))
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          console.error('Failed to load countdowns for calendar:', err)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    void fetchSingaporePublicHolidays(currentYear, controller.signal).then((holidays) => {
      setPublicHolidays(holidays)
    })

    return () => controller.abort()
  }, [currentYear])

  // Navigation handlers
  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1))
    setSelectedDate(null)
  }

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1))
    setSelectedDate(null)
  }

  const handleToday = () => {
    const now = new Date()
    setCurrentDate(now)
    setSelectedDate(now)
  }

  // Combined countdowns with Singapore Public Holidays
  const allCountdowns = useMemo(() => {
    return [...countdowns, ...publicHolidays]
  }, [countdowns, publicHolidays])

  // Calendar Grid computation
  const calendarCells = useMemo(() => {
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay()
    const totalDaysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
    const totalDaysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate()

    const cells: Array<{
      date: Date
      isCurrentMonth: boolean
      dayNumber: number
      countdowns: AcademicCountdown[]
      isToday: boolean
    }> = []

    const today = new Date()

    // 1. Previous month trailing days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNumber = totalDaysInPrevMonth - i
      const date = new Date(currentYear, currentMonth - 1, dayNumber)
      const dayCountdowns = allCountdowns
        .filter((c) => matchesCalendarDay(c, date))
        .map((c) => getEventForCalendarDate(c, date))
      cells.push({
        date,
        isCurrentMonth: false,
        dayNumber,
        countdowns: dayCountdowns,
        isToday: isSameCalendarDay(today, date),
      })
    }

    // 2. Current month days
    for (let dayNumber = 1; dayNumber <= totalDaysInMonth; dayNumber++) {
      const date = new Date(currentYear, currentMonth, dayNumber)
      const dayCountdowns = allCountdowns
        .filter((c) => matchesCalendarDay(c, date))
        .map((c) => getEventForCalendarDate(c, date))
      cells.push({
        date,
        isCurrentMonth: true,
        dayNumber,
        countdowns: dayCountdowns,
        isToday: isSameCalendarDay(today, date),
      })
    }

    // 3. Next month leading days to complete full weeks
    const remainingCells = (7 - (cells.length % 7)) % 7
    for (let dayNumber = 1; dayNumber <= remainingCells; dayNumber++) {
      const date = new Date(currentYear, currentMonth + 1, dayNumber)
      const dayCountdowns = allCountdowns
        .filter((c) => matchesCalendarDay(c, date))
        .map((c) => getEventForCalendarDate(c, date))
      cells.push({
        date,
        isCurrentMonth: false,
        dayNumber,
        countdowns: dayCountdowns,
        isToday: isSameCalendarDay(today, date),
      })
    }

    return cells
  }, [currentYear, currentMonth, allCountdowns])

  const monthName = currentDate.toLocaleString('default', { month: 'long' })

  // Selected date countdowns
  const selectedDateCountdowns = useMemo(() => {
    if (!selectedDate) return []
    return allCountdowns
      .filter((c) => matchesCalendarDay(c, selectedDate))
      .map((c) => getEventForCalendarDate(c, selectedDate))
  }, [selectedDate, allCountdowns])

  const openCreateForm = () => {
    if (isSubmitting) return

    const todayStr = formatDateInput(selectedDate || new Date())
    setEditingCountdownId(null)
    setTitle('')
    setIsAllDay(false)
    setIsMultipleDays(false)
    setIsAnnual(false)
    setStartDate(todayStr)
    setEndDate(todayStr)
    setStartTime('09:00')
    setEndTime('10:00')
    setColor(defaultCountdownColor)
    setModalError(null)
    setIsModalOpen(true)
  }

  const openEditForm = (item: AcademicCountdown) => {
    if (isSubmitting || item.isReadOnly || item.category === 'PH') return

    const targetDateObj = new Date(item.targetDate)
    const dateStr = formatDateInput(targetDateObj)
    const hours = String(targetDateObj.getHours()).padStart(2, '0')
    const minutes = String(targetDateObj.getMinutes()).padStart(2, '0')
    const isAllDayEvent = targetDateObj.getHours() === 0 && targetDateObj.getMinutes() === 0

    setEditingCountdownId(item.id)
    setTitle(item.title)
    setIsAllDay(isAllDayEvent)
    setIsMultipleDays(false)
    setIsAnnual(Boolean(item.isAnnual))
    setStartDate(dateStr)
    setEndDate(dateStr)
    setStartTime(`${hours}:${minutes}`)
    setEndTime('10:00')
    setColor(resolveCountdownColor(item.color || defaultCountdownColor))
    setModalError(null)
    setIsModalOpen(true)
  }

  const handleDeleteCountdown = async (id: string, eventTitle: string) => {
    const original = [...countdowns]
    setCountdowns((prev) => prev.filter((c) => c.id !== id))

    try {
      await apiRequest(`/api/countdowns/${id}`, {
        method: 'DELETE',
      })
      showToast(`Removed "${eventTitle}".`)
    } catch (err) {
      setCountdowns(original)
      showToast(formatApiError(err))
    }
  }

  const handleToggleAllDay = () => {
    setIsAllDay((prev) => !prev)
  }

  const handleToggleMultipleDays = () => {
    setIsMultipleDays((prev) => {
      const next = !prev
      if (next && !endDate) {
        setEndDate(startDate)
      }
      return next
    })
  }

  // Google Calendar Auth Hook
  const startGoogleCalendarAuth = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
    onSuccess: async (tokenResponse) => {
      const token = tokenResponse.access_token
      setGoogleAccessToken(token)
      localStorage.setItem('kiasucode_google_cal_token', token)
      localStorage.setItem('kiasucode_google_cal_token_exp', String(Date.now() + 3500 * 1000))
      showToast('Google Calendar linked! Syncing events now...')
      await handleSyncFromGoogle(token)
    },
    onError: (err) => {
      console.warn('Google Calendar login cancelled or blocked:', err)
      showToast('Google login was cancelled or blocked. Ensure your email is added to Test Users in Google Cloud.')
    },
  })

  // Sync events from Google Calendar to Radar
  const handleSyncFromGoogle = async (explicitToken?: string) => {
    if (!googleClientId) {
      showToast('Google Client ID is not configured (missing VITE_GOOGLE_CLIENT_ID).')
      return
    }
    const token = explicitToken || googleAccessToken
    if (!token) {
      startGoogleCalendarAuth()
      return
    }

    setIsGoogleSyncing(true)
    try {
      const items = await fetchGoogleCalendarEvents(token)
      const events = items
        .filter((item) => Boolean(item.summary && (item.start?.dateTime || item.start?.date)))
        .map((item) => {
          const inferred = inferAcademicCategory(item.summary || '')
          const category =
            inferred !== 'General'
              ? inferred
              : (item.calendarSummary && item.calendarSummary !== 'Primary' ? item.calendarSummary : 'General')
          const targetDate =
            item.start?.dateTime || (item.start?.date ? `${item.start.date}T00:00:00` : new Date().toISOString())
          return {
            googleEventId: item.id || '',
            title: item.summary || 'Google Calendar Event',
            targetDate,
            category,
            color: item.calendarColor || '#4285F4',
          }
        })

      if (!events.length) {
        showToast('No upcoming Google Calendar events found in range.')
        return
      }

      const { data } = await apiRequest<{
        success: boolean
        count: number
        countdowns: AcademicCountdown[]
      }>('/api/countdowns/sync-google', {
        method: 'POST',
        body: JSON.stringify({ events }),
      })

      if (data.countdowns) {
        setCountdowns(sortCountdowns(data.countdowns))
      }
      showToast(`Synced ${data.count} event(s) from Google Calendar! Steady pom pi pi!`)
    } catch (err) {
      console.error('Google Calendar sync error:', err)
      const errStr = String(err)
      if (errStr.includes('401') || errStr.includes('invalid_token')) {
        setGoogleAccessToken(null)
        localStorage.removeItem('kiasucode_google_cal_token')
        localStorage.removeItem('kiasucode_google_cal_token_exp')
        showToast('Google session expired. Please reconnect Google Calendar.')
      } else {
        showToast(formatApiError(err))
      }
    } finally {
      setIsGoogleSyncing(false)
    }
  }

  // Push all unsynced countdowns to Google Calendar
  const handlePushAllToGoogle = async () => {
    if (!googleAccessToken) {
      startGoogleCalendarAuth()
      return
    }

    setIsPushingToGoogle(true)
    try {
      let pushedCount = 0
      for (const item of countdowns) {
        if (item.category === 'PH' || item.googleEventId) continue
        try {
          const gRes = await createGoogleCalendarEvent(googleAccessToken, {
            summary: item.title,
            startIso: item.targetDate,
            description: `Academic deadline on KiasuCode (${item.category})`,
          })
          pushedCount++
          await apiRequest(`/api/countdowns/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              googleEventId: gRes.id,
              source: 'google',
            }),
          })
        } catch (e) {
          console.warn('Failed to push event to Google Calendar:', item.title, e)
        }
      }
      showToast(`Pushed ${pushedCount} event(s) to Google Calendar!`)
      const { data } = await apiRequest<CountdownsResponse>('/api/countdowns')
      setCountdowns(sortCountdowns(data.countdowns))
    } catch (err) {
      showToast(formatApiError(err))
    } finally {
      setIsPushingToGoogle(false)
      setIsGoogleMenuOpen(false)
    }
  }

  const handleDisconnectGoogle = () => {
    setGoogleAccessToken(null)
    localStorage.removeItem('kiasucode_google_cal_token')
    localStorage.removeItem('kiasucode_google_cal_token_exp')
    setIsGoogleMenuOpen(false)
    showToast('Google Calendar disconnected.')
  }

  const saveCountdown = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!title.trim() || !startDate) return
    if (isMultipleDays && !endDate) return
    if (!isAllDay && (!startTime || !endTime)) return

    setIsSubmitting(true)
    setModalError(null)

    try {
      if (editingCountdownId) {
        const targetDateIso = parseLocalDate(
          startDate,
          isAllDay ? '00:00' : startTime,
        ).toISOString()

        const { data } = await apiRequest<CountdownResponse>(`/api/countdowns/${editingCountdownId}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: title.trim(),
            targetDate: targetDateIso,
            category: 'General',
            color,
            moduleId: null,
            isAnnual,
          }),
        })

        setCountdowns((current) =>
          sortCountdowns(current.map((c) => (c.id === editingCountdownId ? data.countdown : c)))
        )
        setIsModalOpen(false)
        setEditingCountdownId(null)
        setTitle('')
        showToast('Event updated successfully.')
      } else {
        const datesToCreate: string[] = []

        if (isMultipleDays && endDate && endDate >= startDate) {
          const startObj = parseLocalDate(startDate, isAllDay ? '00:00' : startTime)
          const endObj = parseLocalDate(endDate, isAllDay ? '00:00' : startTime)

          const curr = new Date(startObj)
          while (curr <= endObj) {
            datesToCreate.push(curr.toISOString())
            curr.setDate(curr.getDate() + 1)
          }
        } else {
          datesToCreate.push(
            parseLocalDate(startDate, isAllDay ? '00:00' : startTime).toISOString(),
          )
        }

        let googleEventId: string | null = null
        if (syncToGoogleOnSave && googleAccessToken) {
          try {
            const gRes = await createGoogleCalendarEvent(googleAccessToken, {
              summary: title.trim(),
              startIso: datesToCreate[0],
              isAllDay,
              startDateStr: startDate,
              endDateStr: isMultipleDays ? endDate : startDate,
              description: 'Academic deadline tracked on KiasuCode Radar',
            })
            googleEventId = gRes.id
          } catch (gErr) {
            console.warn('Could not sync to Google Calendar:', gErr)
          }
        }

        const createdList: AcademicCountdown[] = []

        for (const targetDateIso of datesToCreate) {
          const { data } = await apiRequest<CountdownResponse>('/api/countdowns', {
            method: 'POST',
            body: JSON.stringify({
              title: title.trim(),
              targetDate: targetDateIso,
              category: 'General',
              color,
              moduleId: null,
              isAnnual,
              googleEventId,
              source: googleEventId ? 'google' : 'local',
            }),
          })
          createdList.push(data.countdown)
        }

        setCountdowns((current) => sortCountdowns([...current, ...createdList]))
        setIsModalOpen(false)
        setTitle('')
        showToast(
          googleEventId
            ? 'Event saved & synced to Google Calendar!'
            : createdList.length > 1
              ? `Created multi-day event (${createdList.length} days).`
              : 'Event created successfully.'
        )
      }
    } catch (createError) {
      setModalError(formatApiError(createError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="app-shell bg-slate-50 text-slate-900 transition-colors duration-300 dark:bg-slate-900 dark:text-slate-100 min-h-screen flex flex-col justify-between">
      <Navbar onConnectTelegram={() => setIsTelegramOpen(true)} />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 flex-1">
        {/* HEADER WITH RELOCATED + NEW COUNTDOWN BUTTON */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <span className="eyebrow">daysmatter/calendar.sync</span>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Academic Deadlines & Calendar
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Track upcoming exams, assignment cutoffs, and milestones with monthly visual radar.
            </p>
          </div>

          {/* CALENDAR SYNC & EVENT BUTTONS */}
          <div className="flex flex-wrap items-center gap-2 relative">
            {/* Google Calendar Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  if (isGoogleCalConnected) {
                    setIsGoogleMenuOpen((prev) => !prev)
                  } else {
                    startGoogleCalendarAuth()
                  }
                }}
                disabled={isGoogleSyncing || isPushingToGoogle}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold shadow-sm transition-all ${
                  isGoogleCalConnected
                    ? 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
                title={isGoogleCalConnected ? 'Manage Google Calendar connection' : 'Connect Google Calendar'}
              >
                <svg className="size-4 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>
                  {isGoogleSyncing
                    ? 'Syncing Google…'
                    : isPushingToGoogle
                      ? 'Pushing to Google…'
                      : isGoogleCalConnected
                        ? 'Google Calendar ▾'
                        : 'Link Google'}
                </span>
                {isGoogleCalConnected && (
                  <span className="size-2 rounded-full bg-emerald-500" title="Connected" />
                )}
              </button>

              {/* Google Menu Dropdown */}
              {isGoogleMenuOpen && isGoogleCalConnected && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl z-20 dark:border-slate-700 dark:bg-slate-800">
                  <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-700 mb-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Google Calendar Linked
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsGoogleMenuOpen(false)
                      void handleSyncFromGoogle()
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700 text-left"
                  >
                    <span>🔄</span>
                    <span>Sync Events from Google</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handlePushAllToGoogle()
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700 text-left"
                  >
                    <span>⬆️</span>
                    <span>Push All Radar to Google</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnectGoogle}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 text-left"
                  >
                    <span>🔌</span>
                    <span>Disconnect Google</span>
                  </button>
                </div>
              )}
            </div>

            {/* + New Event Button (Manual Add) */}
            <button
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-500 transition-colors disabled:opacity-50 whitespace-nowrap"
              type="button"
              onClick={openCreateForm}
              disabled={isSubmitting}
            >
              <span aria-hidden="true">+</span> New Event
            </button>
          </div>
        </div>

        {/* CALENDAR GRID CARD */}
        <section
          className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-8"
          aria-labelledby="calendar-title"
        >
          {/* MONTH NAVIGATION BAR */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100" id="calendar-title">
                {monthName} {currentYear}
              </h2>
              {isLoading && (
                <span className="text-xs font-mono text-slate-400 animate-pulse">syncing deadlines…</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToday}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Today
              </button>
              <div className="flex items-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="px-3 py-1.5 text-xs font-bold text-gray-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                  aria-label="Previous month"
                >
                  ←
                </button>
                <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="px-3 py-1.5 text-xs font-bold text-gray-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                  aria-label="Next month"
                >
                  →
                </button>
              </div>
            </div>
          </div>

          {/* 7-COLUMN DAYS HEADER */}
          <div className="grid grid-cols-7 gap-px border-b border-slate-200 py-3 text-center text-xs font-bold uppercase tracking-wider text-gray-700 dark:border-slate-700 dark:text-slate-300">
            {DAYS_OF_WEEK.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          {/* 7-COLUMN DAYS GRID */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2 pt-3">
            {calendarCells.map((cell, idx) => {
              const isSelected = selectedDate ? isSameCalendarDay(selectedDate, cell.date) : false

              return (
                <button
                  type="button"
                  key={idx}
                  onClick={() => setSelectedDate(cell.date)}
                  className={`relative flex min-h-[58px] sm:min-h-[72px] flex-col items-center justify-start rounded-xl p-1.5 text-center transition-all ${
                    !cell.isCurrentMonth
                      ? 'text-slate-400/50 opacity-40 dark:text-slate-600'
                      : cell.isToday
                        ? 'bg-blue-50/80 font-black text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 ring-2 ring-blue-500/40'
                        : 'text-gray-900 hover:bg-slate-100 dark:text-white dark:hover:bg-slate-700/40'
                  } ${
                    isSelected
                      ? 'ring-2 ring-blue-600 dark:ring-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                      : ''
                  }`}
                >
                  <span className={`text-xs sm:text-sm font-bold ${!cell.isCurrentMonth ? 'text-slate-400 dark:text-slate-600' : 'text-gray-900 dark:text-white'}`}>{cell.dayNumber}</span>

                  {/* DOTS FOR COUNTDOWN DEADLINES */}
                  {cell.countdowns.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap justify-center gap-1">
                      {cell.countdowns.slice(0, 3).map((countdown) => (
                        <span
                          key={countdown.id}
                          className="size-1.5 rounded-full sm:size-2"
                          style={{ backgroundColor: resolveCountdownColor(countdown.color || defaultCountdownColor) }}
                          title={`${countdown.category}: ${countdown.title}`}
                        />
                      ))}
                      {cell.countdowns.length > 3 && (
                        <span className="text-[8px] font-mono text-slate-400 font-bold leading-none">
                          +{cell.countdowns.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* SELECTED DAY DETAILS ACCORDION */}
          {selectedDate && (
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {selectedDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                </span>
                <span className="text-xs font-mono text-slate-500">
                  {selectedDateCountdowns.length} {selectedDateCountdowns.length === 1 ? 'event' : 'events'}
                </span>
              </div>

              {selectedDateCountdowns.length > 0 ? (
                <ul className="mt-3 divide-y divide-slate-200/60 dark:divide-slate-700/60">
                  {selectedDateCountdowns.map((item) => (
                    <li key={item.id} className="group flex items-center justify-between py-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: resolveCountdownColor(item.color || defaultCountdownColor) }}
                        />
                        <strong className="text-slate-900 dark:text-slate-100 truncate">{item.title}</strong>
                        {item.category === 'PH' ? (
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                            PH
                          </span>
                        ) : item.category && item.category !== 'General' ? (
                          <span className="text-slate-400 uppercase text-[10px]">({item.category})</span>
                        ) : null}
                        {item.source === 'google' || item.googleEventId ? (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"
                            title="Synced with Google Calendar"
                          >
                            <svg className="size-2.5 shrink-0" viewBox="0 0 24 24">
                              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                            </svg>
                            Google
                          </span>
                        ) : null}
                        {item.isAnnual && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
                            🔁 Yearly
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <time className="font-mono text-slate-500">
                          {new Date(item.targetDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </time>
                        {!item.isReadOnly && item.category !== 'PH' && (
                          <div className="flex items-center gap-1">
                            <a
                              href={buildGoogleCalendarWebUrl(item)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="size-6 flex items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 dark:hover:text-blue-400 transition-colors"
                              title={item.googleEventId ? 'Open in Google Calendar' : 'Add to Google Calendar'}
                              aria-label="Google Calendar"
                            >
                              <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z"/>
                              </svg>
                            </a>
                            <button
                              type="button"
                              onClick={() => openEditForm(item)}
                              className="size-6 flex items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 dark:hover:text-blue-400 transition-colors"
                              title="Edit event"
                              aria-label="Edit event"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteCountdown(item.id, item.title)}
                              className="size-6 flex items-center justify-center rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                              title="Delete event"
                              aria-label="Delete event"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-slate-400">
                  No deadlines yet. Checkout to a new branch and chiong your assignments!
                </p>
              )}
            </div>
          )}
        </section>
      </main>

      {/* CREATE EVENT MODAL */}
      {isModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl relative dark:border-slate-700 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  {editingCountdownId ? 'calendar.event.edit' : 'calendar.event.create'}
                </span>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  {editingCountdownId ? 'Edit Event' : 'New Event'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form className="mt-5 space-y-4" onSubmit={saveCountdown}>
              {modalError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300" role="alert">
                  {modalError}
                </div>
              ) : null}

              {/* Event Title */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Event Title
                </label>
                <input
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-normal text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={255}
                  placeholder="e.g. CS2103 Final Project Demo, Finals Exam…"
                  autoFocus
                  required
                />
              </div>

              {/* Toggle Buttons: All Day, Multiple Days */}
              <div>
                <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Event Options
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleToggleAllDay}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                      isAllDay
                        ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span>☀️</span>
                    <span>All day</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleMultipleDays}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                      isMultipleDays
                        ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span>📅</span>
                    <span>Multiple days</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsAnnual((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                      isAnnual
                        ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span>🔁</span>
                    <span>Repeats Yearly</span>
                  </button>
                </div>
              </div>

              {/* Date Inputs */}
              <div className={`grid gap-4 ${isMultipleDays ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    {isMultipleDays ? 'Start Date' : 'Date'}
                  </label>
                  <input
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    required
                  />
                </div>

                {isMultipleDays && (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                      End Date
                    </label>
                    <input
                      className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      type="date"
                      value={endDate}
                      min={startDate}
                      onChange={(event) => setEndDate(event.target.value)}
                      required
                    />
                  </div>
                )}
              </div>

              {/* Time Inputs (Hidden when 'All day' is selected) */}
              {!isAllDay && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                      Start Time
                    </label>
                    <input
                      className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      type="time"
                      value={startTime}
                      onChange={(event) => setStartTime(event.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                      End Time
                    </label>
                    <input
                      className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      type="time"
                      value={endTime}
                      onChange={(event) => setEndTime(event.target.value)}
                      required
                    />
                  </div>
                </div>
              )}

              {/* Color */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Color Badge
                </label>
                <div className="flex h-11 items-center gap-2 max-w-xs">
                  <input
                    type="color"
                    value={resolveCountdownColor(color)}
                    onChange={(event) => setColor(event.target.value)}
                    className="size-11 cursor-pointer rounded-xl border border-slate-300 p-0.5 dark:border-slate-700 bg-white dark:bg-slate-800"
                    title="Pick a color"
                  />
                  <input
                    type="text"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    className="h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500"
                    placeholder="#3b82f6"
                    maxLength={7}
                  />
                </div>
              </div>

              {/* Google Calendar Sync Option */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5 dark:border-blue-900/40 dark:bg-blue-950/30">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <svg className="size-4 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                    <div>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Sync to Google Calendar
                      </span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isGoogleCalConnected
                          ? 'Event will automatically be saved to your Google Calendar.'
                          : 'Connect Google account to push this event to your Google Calendar.'}
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={syncToGoogleOnSave}
                      onChange={(e) => {
                        if (e.target.checked && !isGoogleCalConnected) {
                          startGoogleCalendarAuth()
                        } else {
                          setSyncToGoogleOnSave(e.target.checked)
                        }
                      }}
                      className="peer sr-only"
                    />
                    <div className="peer h-6 w-11 rounded-full bg-slate-200 peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] dark:border-slate-600 dark:bg-slate-700"></div>
                  </label>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="mt-6 flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700/60">
                <button
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                  type="submit"
                  disabled={
                    isSubmitting ||
                    !title.trim() ||
                    !startDate ||
                    (isMultipleDays && !endDate) ||
                    (!isAllDay && (!startTime || !endTime))
                  }
                >
                  {isSubmitting
                    ? editingCountdownId
                      ? 'Updating…'
                      : 'Creating Event…'
                    : editingCountdownId
                      ? 'Save Changes'
                      : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}


      <footer>
        <div className="brand brand--footer">
          <Logo className="text-[18px] text-white" />
        </div>
        <p>Built with <span>⌨</span> and kopi. Ship steady, score steady.</p>
        <code>daysmatter · Singapore</code>
      </footer>

      <TelegramConnectModal isOpen={isTelegramOpen} onClose={() => setIsTelegramOpen(false)} />
    </div>
  )
}

export function CountdownsView() {
  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <CountdownsViewContent />
    </GoogleOAuthProvider>
  )
}
