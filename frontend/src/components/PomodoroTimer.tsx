import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { apiRequest, formatApiError } from '../utils/api'

interface StudySessionResponse {
  session: {
    id: string
    moduleId: string | null
    customCategory: string | null
    durationMinutes: number
    coinsEarned: number
    createdAt: string
  }
  wallet: {
    coinsBalance: number
  }
}

interface PomodoroTimerProps {
  targetLabel: string
  moduleId: string | null
  customCategory: string | null
  onSessionCompleted?: (coinsEarned: number, coinsBalance: number) => void
}

type TimerStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'saving'
  | 'completed'
  | 'error'

type TimerMode = 'focus' | 'shortBreak' | 'longBreak'

const defaultDurationMinutes = 25
const minimumFocusMinutes = 5
const maximumFocusMinutes = 120
const focusDurationStepMinutes = 5
const timerRingRadius = 118
const timerRingCircumference = 2 * Math.PI * timerRingRadius
const breakDurationMinutes: Record<Exclude<TimerMode, 'focus'>, number> = {
  shortBreak: 5,
  longBreak: 15,
}
const timerModes: Array<{ label: string; value: TimerMode }> = [
  { label: 'Focus', value: 'focus' },
  { label: 'Short Break', value: 'shortBreak' },
  { label: 'Long Break', value: 'longBreak' },
]

const ALARM_SOUNDS = [
  '/alarm1.mp3',
  '/alarm2.mp3',
  '/alarm3.mp3',
  '/alarm4.mp3',
  '/alarm5.mp3',
  '/alarm6.wav',
]

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`
}

export function PomodoroTimer({
  targetLabel,
  moduleId,
  customCategory,
  onSessionCompleted,
}: PomodoroTimerProps) {
  const { showToast } = useToast()
  const hasTarget = Boolean(targetLabel.trim() && (moduleId || customCategory))
  const [mode, setMode] = useState<TimerMode>('focus')
  const [selectedDurationMinutes, setSelectedDurationMinutes] = useState(
    defaultDurationMinutes,
  )
  const activeDurationMinutes = mode === 'focus'
    ? selectedDurationMinutes
    : breakDurationMinutes[mode]
  const activeDurationSeconds = activeDurationMinutes * 60
  const [remainingSeconds, setRemainingSeconds] = useState(
    defaultDurationMinutes * 60,
  )
  const [status, setStatus] = useState<TimerStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [coinsBalance, setCoinsBalance] = useState<number | null>(null)
  const endAtRef = useRef<number | null>(null)
  const completionSentRef = useRef(false)
  const isRunning = status === 'running'

  useEffect(() => {
    if (isRunning) {
      localStorage.setItem('kiasucode_timer_active', 'true')
    } else {
      localStorage.removeItem('kiasucode_timer_active')
    }

    return () => {
      localStorage.removeItem('kiasucode_timer_active')
    }
  }, [isRunning])

  const resetTimer = useCallback(() => {
    endAtRef.current = null
    completionSentRef.current = false
    setRemainingSeconds(activeDurationSeconds)
    setStatus('idle')
    setMessage(null)
  }, [activeDurationSeconds])

  useEffect(() => {
    if ('Notification' in window) {
      void Notification.requestPermission()
    }
  }, [])

  useEffect(() => {
    if (status !== 'running') return

    const updateRemainingTime = () => {
      if (endAtRef.current === null) return

      setRemainingSeconds(
        Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000)),
      )
    }

    updateRemainingTime()
    const intervalId = window.setInterval(updateRemainingTime, 250)

    return () => window.clearInterval(intervalId)
  }, [status])

  const recordCompletedSession = useCallback(async () => {
    if (mode !== 'focus') return

    setStatus('saving')
    setMessage('Focus sprint completed! Committing your coins to the ledger…')

    try {
      const { data, status: responseStatus } =
        await apiRequest<StudySessionResponse>('/api/study/session', {
          method: 'POST',
          body: JSON.stringify({
            module_id: moduleId,
            custom_category: customCategory,
            duration_minutes: selectedDurationMinutes,
          }),
        })

      if (responseStatus !== 201) {
        throw new Error(`Unexpected study session status (${responseStatus}).`)
      }

      setCoinsBalance(data.wallet.coinsBalance)
      setMessage(`Build passed! Session logged, you earned ${data.session.coinsEarned} coins. Steady lah!`)
      setStatus('completed')
      onSessionCompleted?.(
        data.session.coinsEarned,
        data.wallet.coinsBalance,
      )
    } catch (error) {
      setMessage(`Alamak! ${formatApiError(error)} Don't panic, retry submitting your reward.`)
      setStatus('error')
    }
  }, [customCategory, mode, moduleId, onSessionCompleted, selectedDurationMinutes])

  useEffect(() => {
    if (
      status !== 'running'
      || remainingSeconds !== 0
      || completionSentRef.current
    ) {
      return
    }

    completionSentRef.current = true
    endAtRef.current = null

    const randomSound = ALARM_SOUNDS[Math.floor(Math.random() * ALARM_SOUNDS.length)]
    const alarm = new Audio(randomSound)
    alarm.play().catch((err) => console.log('Audio play blocked:', err))

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Sprint Complete! 🚀', {
        body: 'Time to switch gears. Return to KiasuCode.',
      })
    }

    const completionTimeoutId = window.setTimeout(() => {
      if (mode === 'focus') {
        void recordCompletedSession()
        return
      }

      setStatus('completed')
      setMessage(
        mode === 'shortBreak'
          ? 'Short break over liao! Ready to checkout to focus branch and chiong again?'
          : 'Long break done. Kopi recharged, time to deploy high productivity lah!',
      )
    }, 0)

    return () => window.clearTimeout(completionTimeoutId)
  }, [mode, recordCompletedSession, remainingSeconds, status])

  const startTimer = () => {
    if (mode === 'focus' && !hasTarget) {
      showToast('Please select a module or category first!')
      setMessage('Please select a module or category first!')
      return
    }

    if (remainingSeconds <= 0) return

    endAtRef.current = Date.now() + remainingSeconds * 1000
    setMessage(null)
    setStatus('running')
  }

  const pauseTimer = () => {
    if (status !== 'running' || endAtRef.current === null) return

    setRemainingSeconds(
      Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000)),
    )
    endAtRef.current = null
    setStatus('paused')
  }

  const retryReward = () => {
    completionSentRef.current = true
    void recordCompletedSession()
  }

  const adjustFocusDuration = (adjustmentMinutes: number) => {
    if (mode !== 'focus' || status !== 'idle') return

    const durationMinutes = Math.min(
      maximumFocusMinutes,
      Math.max(
        minimumFocusMinutes,
        selectedDurationMinutes + adjustmentMinutes,
      ),
    )

    if (durationMinutes === selectedDurationMinutes) return

    setSelectedDurationMinutes(durationMinutes)
    setRemainingSeconds(durationMinutes * 60)
    setMessage(null)
  }

  const selectMode = (nextMode: TimerMode) => {
    if (nextMode === mode || status === 'saving') return

    endAtRef.current = null
    completionSentRef.current = false
    setMode(nextMode)
    setRemainingSeconds(
      (nextMode === 'focus'
        ? selectedDurationMinutes
        : breakDurationMinutes[nextMode]) * 60,
    )
    setStatus('idle')
    setMessage(null)
  }

  const remainingProgress = Math.min(
    100,
    Math.max(0, (remainingSeconds / activeDurationSeconds) * 100),
  )
  const timerRingOffset = timerRingCircumference
    * (1 - remainingProgress / 100)
  const timerRingColor = mode === 'focus'
    ? 'text-blue-500'
    : mode === 'shortBreak'
      ? 'text-emerald-500'
      : 'text-violet-500'

  return (
    <section
      className="flex h-full w-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-8"
      aria-labelledby="pomodoro-title"
    >
      {/* TOP SECTION: HEADER & MODE SWITCHER */}
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="eyebrow">focus/session</span>
            <h2
              className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white"
              id="pomodoro-title"
            >
              {targetLabel ? `${targetLabel} Pomodoro` : 'Solo Pomodoro'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Ready to commit? Deploy a focus sprint and earn coins.
            </p>
          </div>
          {coinsBalance !== null ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              🪙 {coinsBalance} coins
            </span>
          ) : null}
        </div>

        <div
          className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-1 rounded-full bg-slate-950 p-1.5 shadow-inner"
          aria-label="Timer mode"
          role="group"
        >
          {timerModes.map((timerMode) => {
            const isSelected = timerMode.value === mode

            return (
              <button
                className={`rounded-full px-3 py-2 text-xs font-bold transition sm:text-sm ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:bg-white/10 hover:text-white'
                }`}
                type="button"
                key={timerMode.value}
                onClick={() => selectMode(timerMode.value)}
                aria-pressed={isSelected}
                disabled={status === 'saving'}
              >
                {timerMode.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* MIDDLE SECTION: CIRCULAR TIMER & DURATION CONTROLS */}
      <div className="my-auto py-6 text-center">
        <div
          className="relative mx-auto size-64 sm:size-72"
          role="progressbar"
          aria-label="Pomodoro progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(remainingProgress)}
        >
          <svg
            className="size-full -rotate-90 drop-shadow-sm"
            viewBox="0 0 280 280"
            aria-hidden="true"
          >
            <circle
              cx="140"
              cy="140"
              r={timerRingRadius}
              fill="none"
              stroke="currentColor"
              strokeWidth="12"
              className="text-slate-100 dark:text-slate-700"
            />
            <circle
              cx="140"
              cy="140"
              r={timerRingRadius}
              fill="none"
              stroke="currentColor"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={timerRingCircumference}
              strokeDashoffset={timerRingOffset}
              className={`${timerRingColor} transition-[stroke-dashoffset] duration-300`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
              {mode === 'focus'
                ? 'Focus time'
                : mode === 'shortBreak'
                  ? 'Short break'
                  : 'Long break'}
            </span>
            <output
              className="mt-2 font-mono text-5xl font-black tabular-nums tracking-tight text-slate-900 dark:text-white sm:text-6xl"
              aria-live="off"
            >
              {formatTime(remainingSeconds)}
            </output>
            <span className="mt-2 text-xs font-medium text-slate-400 dark:text-slate-500">
              {activeDurationMinutes} minute target
            </span>
          </div>
        </div>

        {mode === 'focus' ? (
          <div
            className="mx-auto mt-4 flex w-fit items-center gap-4 rounded-full border border-slate-200 bg-slate-50 px-2 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/70"
            aria-label="Focus duration"
            role="group"
          >
            <button
              className="grid size-9 place-items-center rounded-full bg-white text-xl font-medium text-slate-600 shadow-sm transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
              type="button"
              onClick={() => adjustFocusDuration(-focusDurationStepMinutes)}
              disabled={status !== 'idle' || selectedDurationMinutes <= minimumFocusMinutes}
              aria-label="Decrease focus duration by 5 minutes"
            >
              −
            </button>
            <div className="min-w-20 text-center">
              <strong className="font-mono text-lg font-black tabular-nums text-slate-900 dark:text-white">
                {selectedDurationMinutes}
              </strong>
              <span className="ml-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                min
              </span>
            </div>
            <button
              className="grid size-9 place-items-center rounded-full bg-white text-xl font-medium text-slate-600 shadow-sm transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
              type="button"
              onClick={() => adjustFocusDuration(focusDurationStepMinutes)}
              disabled={status !== 'idle' || selectedDurationMinutes >= maximumFocusMinutes}
              aria-label="Increase focus duration by 5 minutes"
            >
              +
            </button>
          </div>
        ) : null}
      </div>

      {/* BOTTOM SECTION: CONTROLS & STATUS MESSAGE */}
      <div>
        <div className="flex flex-wrap justify-center gap-3">
          {status === 'running' ? (
            <button
              className="button button--primary px-6"
              type="button"
              onClick={pauseTimer}
            >
              Pause
            </button>
          ) : status === 'error' ? (
            <button
              className="button button--primary px-6"
              type="button"
              onClick={retryReward}
            >
              Retry reward
            </button>
          ) : (
            <button
              className={`button button--primary px-6 ${
                mode === 'focus' && !hasTarget && status === 'idle'
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
              }`}
              type="button"
              onClick={startTimer}
              disabled={
                status === 'saving'
                || status === 'completed'
                || (mode === 'focus' && !hasTarget && status === 'idle')
              }
            >
              {status === 'paused'
                ? 'Resume'
                : mode === 'focus'
                  ? 'Start Focus'
                  : 'Start Break'}
            </button>
          )}
          <button
            className="button button--ghost"
            type="button"
            onClick={resetTimer}
            disabled={status === 'saving'}
          >
            Stop
          </button>
        </div>

        {message ? (
          <p
            className={`mt-4 text-center text-xs font-semibold ${
              status === 'error'
                ? 'text-red-600 dark:text-red-300'
                : 'text-slate-600 dark:text-slate-300'
            }`}
            role={status === 'error' ? 'alert' : 'status'}
          >
            {message}
          </p>
        ) : null}
      </div>
    </section>
  )
}
