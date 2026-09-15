import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Module } from '@kiasucode/shared'

import { ActivityCalendar } from '../components/ActivityCalendar'
import { Logo } from '../components/Logo'
import { Navbar } from '../components/Navbar'
import { PomodoroTimer } from '../components/PomodoroTimer'
import { SpotifyPlayer } from '../components/SpotifyPlayer'
import { TelegramConnectModal } from '../components/TelegramConnectModal'
import { useToast } from '../context/ToastContext'
import { apiRequest, formatApiError, isAbortError } from '../utils/api'

interface ModulesResponse {
  modules: Module[]
}

const moduleTargetPrefix = 'module:'
const customTargetPrefix = 'custom:'
const customTargetValue = 'custom'
const STORAGE_KEY_CUSTOM_CATEGORIES = 'kiasu_custom_categories'

const DEV_LINGUA_MESSAGES = [
  'Git push and chiong!',
  'LGTM, steady pom pi pi!',
  'Compile your focus, do not slack hor!',
  'Commit to this sprint lah!',
  'No merge conflicts today, just pure focus.',
]

function loadSavedCustomCategories(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_CUSTOM_CATEGORIES)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        return parsed.filter((c): c is string => typeof c === 'string' && Boolean(c.trim()))
      }
    }
  } catch {
    // fallback
  }
  return []
}

export function TimerView() {
  const [isTelegramOpen, setIsTelegramOpen] = useState(false)
  const [modules, setModules] = useState<Module[]>([])
  const [customCategories, setCustomCategories] = useState<string[]>(loadSavedCustomCategories)
  const [selectedTarget, setSelectedTarget] = useState<string>('')
  const [encouragingMessage, setEncouragingMessage] = useState('Select a target above to lock in your focus branch.')
  const [isCreatingCustom, setIsCreatingCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const [heatmapRefreshKey, setHeatmapRefreshKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { showToast } = useToast()

  useEffect(() => {
    if (selectedTarget) {
      const randomMsg = DEV_LINGUA_MESSAGES[Math.floor(Math.random() * DEV_LINGUA_MESSAGES.length)]
      setEncouragingMessage(randomMsg)
    } else {
      setEncouragingMessage('Select a target above to lock in your focus branch.')
    }
  }, [selectedTarget])

  useEffect(() => {
    const controller = new AbortController()

    void apiRequest<ModulesResponse>('/api/modules', { signal: controller.signal })
      .then(({ data }) => {
        setModules(data.modules)
        const savedCats = loadSavedCustomCategories()
        setCustomCategories(savedCats)
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          setError(formatApiError(err))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      })

    return () => controller.abort()
  }, [])

  const selectedModuleId = selectedTarget.startsWith(moduleTargetPrefix)
    ? selectedTarget.slice(moduleTargetPrefix.length)
    : null
  const selectedCustomCategory = selectedTarget.startsWith(customTargetPrefix)
    ? selectedTarget.slice(customTargetPrefix.length)
    : null
  const selectedModule = modules.find((module) => module.id === selectedModuleId)
  const selectedTargetLabel = selectedModule?.moduleCode ?? selectedCustomCategory

  const isCustomCategorySelected = selectedTarget.startsWith(customTargetPrefix)

  const handleTargetChange = (value: string) => {
    setSelectedTarget(value)
    if (value === customTargetValue) {
      setIsCreatingCustom(true)
      setCustomName('')
    } else {
      setIsCreatingCustom(false)
      setCustomName('')
    }
  }

  const handleConfirmCustomCategory = () => {
    const trimmed = customName.trim()
    if (!trimmed) return

    const nextList = customCategories.includes(trimmed)
      ? customCategories
      : [...customCategories, trimmed]

    setCustomCategories(nextList)
    try {
      localStorage.setItem(STORAGE_KEY_CUSTOM_CATEGORIES, JSON.stringify(nextList))
    } catch {
      // ignore
    }

    setSelectedTarget(`${customTargetPrefix}${trimmed}`)
    setIsCreatingCustom(false)
    setCustomName('')
    showToast(`🎯 Locked target: "${trimmed}"`)
  }

  const handleDeleteCustomCategory = () => {
    if (!selectedTarget.startsWith(customTargetPrefix)) return
    const categoryToDelete = selectedTarget.slice(customTargetPrefix.length)
    const nextList = customCategories.filter((cat) => cat !== categoryToDelete)

    setCustomCategories(nextList)
    try {
      localStorage.setItem(STORAGE_KEY_CUSTOM_CATEGORIES, JSON.stringify(nextList))
    } catch {
      // ignore
    }

    // Reset active target to first module, or first remaining custom category, or empty
    if (modules.length > 0) {
      setSelectedTarget(`${moduleTargetPrefix}${modules[0].id}`)
      setIsCreatingCustom(false)
    } else if (nextList.length > 0) {
      setSelectedTarget(`${customTargetPrefix}${nextList[0]}`)
      setIsCreatingCustom(false)
    } else {
      setSelectedTarget('')
      setIsCreatingCustom(false)
    }
    showToast(`Deleted category "${categoryToDelete}".`)
  }

  return (
    <div className="app-shell bg-slate-50 text-slate-900 transition-colors duration-300 dark:bg-slate-900 dark:text-slate-100 min-h-screen flex flex-col justify-between">
      <Navbar onConnectTelegram={() => setIsTelegramOpen(true)} />

      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8 flex-1">
        {/* HEADER */}
        <div>
          <span className="eyebrow">focus/pomodoro.standalone</span>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Solo Pomodoro Focus Sprint
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Time to chiong this sprint. Start the Pomodoro, lock in your focus branch, and earn one study coin for every completed minute lah!
          </p>
        </div>

        {/* 2-COLUMN RESPONSIVE GRID */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-stretch">
          {/* LEFT COLUMN: POMODORO TIMER & SPOTIFY PLAYER */}
          <div className="h-full w-full flex flex-col gap-6">
            <PomodoroTimer
              key={selectedTarget || 'no-target'}
              moduleId={selectedModule?.id ?? null}
              customCategory={selectedCustomCategory}
              targetLabel={selectedTargetLabel || ''}
              onSessionCompleted={(coinsEarned, coinsBalance) => {
                showToast(`Session completed! +${coinsEarned} coins (Balance: ${coinsBalance}).`)
                setHeatmapRefreshKey((current) => current + 1)
              }}
            />
            <SpotifyPlayer />
          </div>

          {/* RIGHT COLUMN: ACTIVE STUDY TARGET PANEL */}
          <section
            className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-8 w-full"
            aria-labelledby="module-select-title"
          >
            <span className="eyebrow">academic.target/select</span>
            <h2 className="mt-1 text-xl font-bold text-gray-900 dark:text-white" id="module-select-title">
              Active Study Target
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Select an academic module or custom category for this focus block. Don't slack hor!
            </p>

            <div className="mt-6">
              {isLoading ? (
                <div className="h-12 w-full animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700/50" />
              ) : (
                <div className="space-y-4">
                  {/* TOP BOX: CLEAN DROPDOWN WITH DELETE BUTTON */}
                  <div>
                    <label htmlFor="module-picker" className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      TARGET MODULE OR CATEGORY
                    </label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="relative flex-1">
                        <select
                          id="module-picker"
                          value={selectedTarget}
                          onChange={(e) => handleTargetChange(e.target.value)}
                          className="h-12 w-full appearance-none truncate rounded-xl border border-slate-200 bg-slate-50 pl-4 pr-12 text-sm font-bold text-gray-900 shadow-sm transition-colors focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:bg-slate-900"
                        >
                          <option value="" disabled>Choose Module / Category</option>
                          {modules.length > 0 && (
                            <optgroup label="Academic Modules">
                              {modules.map((module) => (
                                <option
                                  key={module.id}
                                  value={`${moduleTargetPrefix}${module.id}`}
                                >
                                  {module.moduleCode} · {module.moduleName}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {customCategories.length > 0 && (
                            <optgroup label="Custom Categories">
                              {customCategories.map((category) => (
                                <option
                                  key={category}
                                  value={`${customTargetPrefix}${category}`}
                                >
                                  {category}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="New Custom Category">
                            <option value={customTargetValue}>
                              + Create Custom Category
                            </option>
                          </optgroup>
                        </select>
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          fill="none"
                          className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500 dark:text-slate-300"
                        >
                          <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>

                      {/* Delete Custom Category Button */}
                      {isCustomCategorySelected && (
                        <button
                          type="button"
                          onClick={handleDeleteCustomCategory}
                          className="grid size-12 place-items-center rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-300 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/60 transition-colors shrink-0 shadow-xs"
                          title={`Delete category "${selectedCustomCategory}"`}
                          aria-label="Delete custom category"
                        >
                          <span className="text-base" role="img" aria-label="Delete">🗑️</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* BOTTOM BOX: CLEAN CUSTOM CATEGORY INPUT (ONLY RENDERS WHEN CREATING) */}
                  {isCreatingCustom && (
                    <div className="animate-in fade-in duration-150">
                      <label
                        htmlFor="custom-category-name"
                        className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                      >
                        CUSTOM CATEGORY NAME
                      </label>
                      <div className="mt-1.5 flex items-center gap-2">
                        <input
                          id="custom-category-name"
                          type="text"
                          autoFocus
                          value={customName}
                          onChange={(event) => setCustomName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              handleConfirmCustomCategory()
                            }
                          }}
                          maxLength={255}
                          placeholder="e.g., Side Hustle or Life Admin"
                          className="h-12 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900 shadow-sm transition-colors placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500 dark:focus:bg-slate-800 dark:focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleConfirmCustomCategory}
                          disabled={!customName.trim()}
                          className="grid size-12 place-items-center rounded-xl bg-blue-600 font-black text-white shadow-sm transition-all hover:bg-blue-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 shrink-0"
                          title="Confirm and lock category as active target"
                          aria-label="Confirm custom category"
                        >
                          <span className="text-lg">✓</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* MODULE OR CUSTOM CATEGORY PREVIEW CARD (PERSISTENT BOXED DESIGN) */}
                  {selectedModule ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                          {selectedModule.moduleCode}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {selectedModule.creditUnits} MCs / Units
                        </span>
                      </div>
                      <strong className="mt-1 block text-sm font-bold text-slate-900 dark:text-white">
                        {selectedModule.moduleName}
                      </strong>
                      <p className="mt-2 text-xs font-medium italic text-blue-600 dark:text-blue-400">
                        {encouragingMessage}
                      </p>
                    </div>
                  ) : selectedCustomCategory ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-purple-600 dark:text-purple-400">
                          CUSTOM CATEGORY
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Personal Target
                        </span>
                      </div>
                      <strong className="mt-1 block text-sm font-bold text-slate-900 dark:text-white">
                        {selectedCustomCategory}
                      </strong>
                      <p className="mt-2 text-xs font-medium italic text-purple-600 dark:text-purple-400">
                        {encouragingMessage}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-4 dark:border-slate-700 dark:bg-slate-800/30">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-slate-400 dark:text-slate-500">
                          --
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          -- MCs / Units
                        </span>
                      </div>
                      <strong className="mt-1 block text-sm font-bold text-slate-400 dark:text-slate-500">
                        --
                      </strong>
                      <p className="mt-2 text-xs italic text-slate-400 dark:text-slate-500">
                        Select a target above to lock in your focus branch.
                      </p>
                    </div>
                  )}

                  {modules.length === 0 && (
                    <p className="text-[11px] text-slate-400">
                      Want academic tracking also?{' '}
                      <Link to="/campus" className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
                        Add a module in Campus Repo lah.
                      </Link>
                    </p>
                  )}
                </div>
              )}
            </div>

            {error && (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}

            <div className="mt-8 rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700/60 dark:bg-slate-900/40">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                <span>🪙</span> Focus Sprint Reward
              </div>
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                Completing your Pomodoro focus block grants one coin per minute to feed your Tamagotchi pet. Steady pom pi pi!
              </p>
            </div>
            <ActivityCalendar refreshKey={heatmapRefreshKey} />
          </section>
        </div>
      </main>

      <footer>
        <div className="brand brand--footer">
          <Logo className="text-[18px] text-white" />
        </div>
        <p>Built with <span>⌨</span> and kopi. Ship steady, score steady.</p>
        <code>focus · Singapore</code>
      </footer>

      <TelegramConnectModal isOpen={isTelegramOpen} onClose={() => setIsTelegramOpen(false)} />
    </div>
  )
}
