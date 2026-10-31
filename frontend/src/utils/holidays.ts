import type { AcademicCountdown } from '@kiasucode/shared'

export interface SingaporePublicHoliday {
  date: string
  localName: string
  name: string
  countryCode: string
  fixed: boolean
  global: boolean
  counties: string[] | null
  launchYear: number | null
  types: string[]
}

const FALLBACK_SG_HOLIDAYS_2026: Array<{ date: string; name: string }> = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-02-17', name: 'Chinese New Year' },
  { date: '2026-02-18', name: 'Chinese New Year (Day 2)' },
  { date: '2026-03-21', name: 'Hari Raya Puasa' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-05-31', name: 'Vesak Day' },
  { date: '2026-05-27', name: 'Hari Raya Haji' },
  { date: '2026-08-09', name: 'National Day' },
  { date: '2026-08-10', name: 'National Day (Observed)' },
  { date: '2026-11-08', name: 'Deepavali' },
  { date: '2026-12-25', name: 'Christmas Day' },
]

export async function fetchSingaporePublicHolidays(
  year: number = new Date().getFullYear(),
  signal?: AbortSignal,
): Promise<AcademicCountdown[]> {
  try {
    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/SG`, {
      signal,
    })

    if (!response.ok) {
      return getFallbackHolidays(year)
    }

    const data = (await response.json()) as SingaporePublicHoliday[]
    if (!Array.isArray(data) || data.length === 0) return getFallbackHolidays(year)

    return data.map((holiday) => ({
      id: `ph-${holiday.date}-${holiday.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`,
      moduleId: null,
      title: holiday.localName || holiday.name,
      targetDate: `${holiday.date}T00:00:00.000Z`,
      category: 'PH',
      color: '#ef4444',
      isAnnual: false,
      isReadOnly: true,
      createdAt: new Date().toISOString(),
    }))
  } catch {
    // Graceful fallback on network/CORS error without polluting console
    return getFallbackHolidays(year)
  }
}

function getFallbackHolidays(year: number): AcademicCountdown[] {
  if (year !== 2026) return []
  return FALLBACK_SG_HOLIDAYS_2026.map((holiday) => ({
    id: `ph-${holiday.date}-${holiday.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`,
    moduleId: null,
    title: holiday.name,
    targetDate: `${holiday.date}T00:00:00.000Z`,
    category: 'PH',
    color: '#ef4444',
    isAnnual: false,
    isReadOnly: true,
    createdAt: new Date().toISOString(),
  }))
}
