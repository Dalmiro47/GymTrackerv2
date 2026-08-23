"use client";

import { useEffect, useState } from 'react';
import { format, startOfTomorrow } from 'date-fns';

/**
 * "Today" as a stable Date that only changes identity when the local calendar
 * day changes — on window focus / visibility change (PWA left open overnight)
 * and on a timer that fires just after local midnight. Effects keyed on the
 * returned value won't refire on mere focus if the day is unchanged.
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => {
      setToday((prev) => {
        const now = new Date();
        return format(prev, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd') ? prev : now;
      });
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);

    // Fire shortly after the next local midnight (rescheduled each time `today` changes)
    const msUntilMidnight = startOfTomorrow().getTime() - Date.now() + 1000;
    const timer = window.setTimeout(refresh, Math.max(msUntilMidnight, 1000));

    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(timer);
    };
  }, [today]);

  return today;
}
