import { useEffect, useRef, useState, useCallback } from 'react';

// A click, keypress, touch, or scroll-wheel tick is enough signal of real
// activity — deliberately skipping mousemove/scroll to avoid excessive
// timer churn from events that fire dozens of times a second.
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'wheel'];

/**
 * Auto-logout after `timeoutMinutes` of no user activity.
 * Shows a warning for the last `warnSeconds` so the user can choose to
 * stay logged in before being signed out automatically.
 *
 * Pass timeoutMinutes as 0/null/undefined to disable entirely.
 */
export function useIdleTimeout(timeoutMinutes, warnSeconds, onTimeout) {
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(warnSeconds);
  const warnTimer = useRef(null);
  const countdownInterval = useRef(null);
  const warningRef = useRef(false);

  const clearAll = useCallback(() => {
    clearTimeout(warnTimer.current);
    clearInterval(countdownInterval.current);
  }, []);

  const startCountdown = useCallback(() => {
    warningRef.current = true;
    setWarning(true);
    setSecondsLeft(warnSeconds);
    countdownInterval.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(countdownInterval.current);
          onTimeout();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, [warnSeconds, onTimeout]);

  const reset = useCallback(() => {
    if (!timeoutMinutes) return;
    clearAll();
    if (warningRef.current) {
      warningRef.current = false;
      setWarning(false);
    }
    const totalMs = timeoutMinutes * 60 * 1000;
    const warnMs = Math.max(totalMs - warnSeconds * 1000, 0);
    warnTimer.current = setTimeout(startCountdown, warnMs);
  }, [timeoutMinutes, warnSeconds, clearAll, startCountdown]);

  useEffect(() => {
    if (!timeoutMinutes) return undefined;
    reset();
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, reset));
      clearAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutMinutes]);

  return { warning, secondsLeft, stayLoggedIn: reset };
}
