import { parseISO, isValid } from 'date-fns';
import type { CachedEvent, Interval } from '@/types/events';

export const durationHours = (e: CachedEvent): number => {
  if (e.duration_minutes && e.duration_minutes > 0) return e.duration_minutes / 60;
  if (e.start_time && e.end_time) {
    const s = parseISO(e.start_time);
    const en = parseISO(e.end_time);
    if (isValid(s) && isValid(en)) return Math.max(0, (en.getTime() - s.getTime()) / 3600000);
  }
  return 0;
};

export const eventInterval = (e: CachedEvent): Interval | null => {
  if (!e.start_time || !e.end_time) return null;
  const s = parseISO(e.start_time);
  const en = parseISO(e.end_time);
  if (!isValid(s) || !isValid(en)) return null;
  return { start: s.getTime(), end: en.getTime() };
};

export const mergeIntervalsHours = (intervals: Interval[]): number => {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = sorted[0].start;
  let curEnd = sorted[0].end;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= curEnd) {
      curEnd = Math.max(curEnd, sorted[i].end);
    } else {
      total += (curEnd - curStart) / 3600000;
      curStart = sorted[i].start;
      curEnd = sorted[i].end;
    }
  }
  total += (curEnd - curStart) / 3600000;
  return Math.max(0, total);
};
