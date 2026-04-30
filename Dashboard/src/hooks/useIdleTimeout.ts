/**
 * useIdleTimeout — monitors user activity and triggers warning + logout.
 *
 * Behavior:
 * - Listens to mousemove, keydown, touchstart, click on document
 * - Activity resets the idle timer
 * - At IDLE_WARNING_MS (25 min): sets showWarning = true
 * - At IDLE_LOGOUT_MS (30 min): calls onLogout()
 * - Cleanup on unmount removes all listeners
 *
 * Design decision (D-06): setTimeout chains, not setInterval, to avoid drift.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { IDLE_WARNING_MS, IDLE_LOGOUT_MS } from '@/utils/constants'
import { logger } from '@/utils/logger'

interface UseIdleTimeoutOptions {
  onLogout: () => Promise<void>
  /** Override warning threshold (ms). Defaults to IDLE_WARNING_MS. */
  warningMs?: number
  /** Override logout threshold (ms). Defaults to IDLE_LOGOUT_MS. */
  logoutMs?: number
}

interface UseIdleTimeoutResult {
  showWarning: boolean
  minutesRemaining: number
  resetTimer: () => void
}

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'touchstart', 'click'] as const

export function useIdleTimeout({
  onLogout,
  warningMs = IDLE_WARNING_MS,
  logoutMs = IDLE_LOGOUT_MS,
}: UseIdleTimeoutOptions): UseIdleTimeoutResult {
  const [showWarning, setShowWarning] = useState(false)
  const [minutesRemaining, setMinutesRemaining] = useState(5)

  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onLogoutRef = useRef(onLogout)

  // Keep onLogout ref stable
  useEffect(() => {
    onLogoutRef.current = onLogout
  }, [onLogout])

  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    warningTimerRef.current = null
    logoutTimerRef.current = null
    countdownRef.current = null
  }, [])

  const startCountdown = useCallback((remainingMs: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    const endTime = Date.now() + remainingMs
    setMinutesRemaining(Math.ceil(remainingMs / 60_000))

    countdownRef.current = setInterval(() => {
      const remaining = endTime - Date.now()
      if (remaining <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current)
        return
      }
      setMinutesRemaining(Math.ceil(remaining / 60_000))
    }, 30_000) // update every 30 seconds
  }, [])

  const startTimers = useCallback(() => {
    clearAllTimers()

    // Warning timer
    warningTimerRef.current = setTimeout(() => {
      logger.debug('useIdleTimeout: showing warning modal')
      setShowWarning(true)
      startCountdown(logoutMs - warningMs)

      // Logout timer (from warning to actual logout)
      logoutTimerRef.current = setTimeout(() => {
        logger.warn('useIdleTimeout: forced logout due to inactivity')
        setShowWarning(false)
        void onLogoutRef.current()
      }, logoutMs - warningMs)
    }, warningMs)
  }, [clearAllTimers, startCountdown, warningMs, logoutMs])

  const resetTimer = useCallback(() => {
    setShowWarning(false)
    setMinutesRemaining(5)
    startTimers()
  }, [startTimers])

  useEffect(() => {
    // Debounced activity handler — ignore events more frequent than 2s
    let debounceId: ReturnType<typeof setTimeout> | null = null

    function handleActivity() {
      if (debounceId) return
      debounceId = setTimeout(() => {
        debounceId = null
      }, 2_000)
      resetTimer()
    }

    // Start timers and add listeners
    startTimers()
    ACTIVITY_EVENTS.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true })
    })

    return () => {
      clearAllTimers()
      ACTIVITY_EVENTS.forEach((event) => {
        document.removeEventListener(event, handleActivity)
      })
      if (debounceId) clearTimeout(debounceId)
    }
  }, [startTimers, resetTimer, clearAllTimers])

  return { showWarning, minutesRemaining, resetTimer }
}
