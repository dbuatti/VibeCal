export interface CachedEvent {
  event_id: string;
  title: string;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
  provider: string;
  source_calendar: string | null;
  is_locked: boolean | null;
}

export interface Interval {
  start: number;
  end: number;
}

export interface WeekBucket {
  weekStart: Date;
  weekEnd: Date;
  label: string;
  rangeLabel: string;
  totalWorkHours: number;
  byCategory: Record<string, number>;
  eventCount: number;
  hasDayOff: boolean;
  categoriesPresent: string[];
  pctOfGoal: number;
}
