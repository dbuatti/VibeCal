"use client";

import React, { useMemo, useState, useEffect } from 'react';
import {
  format, parseISO, isValid, isSameDay, isToday, addDays,
  startOfWeek, endOfWeek, isWithinInterval,
} from 'date-fns';
import { ChevronDown, ChevronUp, Maximize2, Minimize2, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  type AppointmentCategory,
} from '@/lib/eventClassifier';

interface CachedEvent {
  event_id: string;
  title: string;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
  provider: string;
  source_calendar: string | null;
  is_locked: boolean | null;
}

interface WeekBucket {
  weekStart: Date;
  weekEnd: Date;
  label: string;
  rangeLabel: string;
  totalWorkHours: number;
  byCategory: Record<AppointmentCategory, number>;
  eventCount: number;
  hasDayOff: boolean;
  categoriesPresent: AppointmentCategory[];
  pctOfGoal: number;
}

interface WeekCalendarViewProps {
  weeks: WeekBucket[];
  events: CachedEvent[];
  categoriesByEvent: Record<string, AppointmentCategory>;
  threshold: number;
  blockedWeeks?: Set<string>;
  onToggleBlocked?: (weekStart: Date) => void;
}

interface DayColumn {
  date: Date;
  dayLabel: string;
  dayNumber: string;
  isToday: boolean;
  events: Array<{
    event: CachedEvent;
    category: AppointmentCategory;
    timeLabel: string;
    durationLabel: string;
    hours: number;
  }>;
  workHours: number;
  isFreeDay: boolean;
}

const durationHours = (e: CachedEvent): number => {
  if (e.duration_minutes && e.duration_minutes > 0) return e.duration_minutes / 60;
  if (e.start_time && e.end_time) {
    const s = parseISO(e.start_time);
    const en = parseISO(e.end_time);
    if (isValid(s) && isValid(en)) return Math.max(0, (en.getTime() - s.getTime()) / 3600000);
  }
  return 0;
};

interface Interval { start: number; end: number }

const mergeIntervalsHours = (intervals: Interval[]): number => {
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

const LS_PREFIX = 'vibecal_calcom_blocked_';

const WeekCalendarView: React.FC<WeekCalendarViewProps> = ({
  weeks,
  events,
  categoriesByEvent,
  threshold,
  blockedWeeks: externalBlocked,
  onToggleBlocked,
}) => {
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [hideBuffers, setHideBuffers] = useState(true);
  const [localBlocked, setLocalBlocked] = useState<Set<string>>(() => {
    if (externalBlocked) return externalBlocked;
    const saved: Set<string> = new Set();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LS_PREFIX) && localStorage.getItem(key) === 'true') {
        saved.add(key.replace(LS_PREFIX, ''));
      }
    }
    return saved;
  });
  const blockedWeeks = externalBlocked ?? localBlocked;

  const keyForWeek = (weekStart: Date) => format(weekStart, 'yyyy-MM-dd');

  const toggleBlocked = (weekStart: Date) => {
    if (onToggleBlocked) {
      onToggleBlocked(weekStart);
      return;
    }
    const key = keyForWeek(weekStart);
    setLocalBlocked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        localStorage.setItem(LS_PREFIX + key, 'false');
      } else {
        next.add(key);
        localStorage.setItem(LS_PREFIX + key, 'true');
      }
      return next;
    });
  };

  const toggleWeek = (label: string) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const weekColumns: Array<{ week: WeekBucket; days: DayColumn[]; keyEvents: DayColumn['events'] }> = useMemo(() => {
    return weeks.map((week) => {
      const days: DayColumn[] = [];
      const allWorkEvents: DayColumn['events'] = [];
      for (let i = 0; i < 7; i++) {
        const date = addDays(week.weekStart, i);
        const dayEvents = events
          .filter((e) => {
            if (!e.start_time) return false;
            const s = parseISO(e.start_time);
            if (!isValid(s) || !isSameDay(s, date)) return false;
            if (hideBuffers) {
              const cat = categoriesByEvent[e.event_id] || 'other';
              if (cat === 'buffer' || cat === 'personal') return false;
            }
            return true;
          })
          .map((e) => {
            const cat = categoriesByEvent[e.event_id] || 'other';
            const s = parseISO(e.start_time);
            const timeLabel = isValid(s) ? format(s, 'h:mm a') : '';
            const hrs = durationHours(e);
            const durationLabel = hrs >= 1 ? `${Math.round(hrs * 10) / 10}h` : `${Math.round(hrs * 60)}m`;
            return { event: e, category: cat, timeLabel, durationLabel, hours: hrs };
          })
          .sort((a, b) => parseISO(a.event.start_time).getTime() - parseISO(b.event.start_time).getTime());

        const workIntervals: Interval[] = dayEvents
          .filter((d) => CATEGORY_META[d.category].countsAsWork)
          .map((d) => {
            const s = parseISO(d.event.start_time);
            const en = parseISO(d.event.end_time);
            return isValid(s) && isValid(en) ? { start: s.getTime(), end: en.getTime() } : null;
          })
          .filter((iv): iv is Interval => iv !== null);
        const workHours = mergeIntervalsHours(workIntervals);

        dayEvents.forEach((de) => {
          if (CATEGORY_META[de.category].countsAsWork) allWorkEvents.push(de);
        });

        const freeDayStart = new Date(date);
        freeDayStart.setHours(9, 0, 0, 0);
        const freeDayEnd = new Date(date);
        freeDayEnd.setHours(18, 0, 0, 0);
        const hasEventInWindow = events.some(e => {
          if (!e.start_time) return false;
          const s = parseISO(e.start_time);
          if (!isValid(s) || !isSameDay(s, date)) return false;
          const en = e.end_time ? parseISO(e.end_time) : new Date(s.getTime() + 30 * 60 * 1000);
          return s < freeDayEnd && en > freeDayStart;
        });

        days.push({
          date,
          dayLabel: format(date, 'EEE'),
          dayNumber: format(date, 'd'),
          isToday: isToday(date),
          events: dayEvents,
          workHours: Math.round(workHours * 100) / 100,
          isFreeDay: !hasEventInWindow,
        });
      }
      // Key events = top 4 work events by duration
      const keyEvents = [...allWorkEvents]
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 4);
      return { week, days, keyEvents };
    });
  }, [weeks, events, categoriesByEvent, hideBuffers]);

  const allLabels = weekColumns.map((wc) => wc.week.label);
  const allExpanded = allLabels.length > 0 && allLabels.every((l) => expandedWeeks.has(l));

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedWeeks(new Set());
    } else {
      setExpandedWeeks(new Set(allLabels));
    }
  };

  if (weeks.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400 font-black uppercase tracking-widest text-xs">No calendar data</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Legend + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Categories:</span>
          {CATEGORY_ORDER.filter((c) => CATEGORY_META[c].countsAsWork).map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_META[c].color }} />
              <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">{CATEGORY_META[c].label}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setHideBuffers(!hideBuffers)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all text-[9px] font-black uppercase tracking-widest",
              hideBuffers
                ? "bg-indigo-50 text-indigo-600"
                : "bg-gray-50 text-gray-400 hover:text-gray-600"
            )}
          >
            {hideBuffers ? <EyeOff size={12} /> : <Eye size={12} />}
            Hide buffers & personal
          </button>
          <button
            onClick={toggleAll}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-50 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all text-[9px] font-black uppercase tracking-widest"
          >
            {allExpanded ? <><Minimize2 size={12} /> Collapse all</> : <><Maximize2 size={12} /> Expand all</>}
          </button>
        </div>
      </div>

      {weekColumns.map(({ week, days, keyEvents }) => {
        const over = week.totalWorkHours > threshold;
        const isCurrentWeek = isWithinInterval(new Date(), { start: week.weekStart, end: week.weekEnd });
        const isExpanded = expandedWeeks.has(week.label);
        const workCats = week.categoriesPresent.filter((c) => CATEGORY_META[c].countsAsWork);
        return (
          <div
            key={week.label}
            className={cn(
              'rounded-2xl border-2 p-5 transition-all',
              isCurrentWeek ? 'border-indigo-500 bg-indigo-50/40 shadow-md shadow-indigo-100' : 'border-gray-100 bg-white',
              isExpanded && 'shadow-lg',
              blockedWeeks.has(keyForWeek(week.weekStart)) && !isCurrentWeek && 'border-green-300 bg-green-50/20'
            )}
          >
            {/* Week header — always visible, clickable to toggle */}
            <button
              onClick={() => toggleWeek(week.label)}
              className="flex items-center justify-between w-full mb-4 flex-wrap gap-2 text-left"
            >
              <div className="flex items-center gap-2.5">
                {isCurrentWeek && <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />}
                <h4 className="font-black text-gray-900 tracking-tight text-sm">
                  Week of {week.label}
                </h4>
                {isCurrentWeek && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[8px] font-black uppercase tracking-widest">
                    This Week
                  </span>
                )}
                <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest">
                  {isExpanded ? 'Collapse' : 'Expand'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest">
                <span className="text-gray-400">{week.eventCount} booked</span>
                <span className="text-gray-300">·</span>
                <span className={cn(over ? 'text-red-600' : 'text-gray-600')}>
                  {week.totalWorkHours}h load
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleBlocked(week.weekStart); }}
                    className={cn(
                      'text-[8px] font-black uppercase tracking-widest rounded-md px-2 py-1 transition-all flex items-center gap-1',
                      blockedWeeks.has(keyForWeek(week.weekStart))
                        ? 'bg-green-100 text-green-700 border border-green-300'
                        : 'bg-gray-50 text-gray-400 hover:text-gray-600 border border-transparent hover:border-gray-200'
                    )}
                    aria-label={blockedWeeks.has(keyForWeek(week.weekStart)) ? 'Marked blocked in cal.com' : 'Mark as blocked in cal.com'}
                  >
                    <ExternalLink size={10} />
                    {blockedWeeks.has(keyForWeek(week.weekStart)) ? 'cal.com blocked' : 'cal.com'}
                  </button>
                </div>
                {isExpanded
                  ? <ChevronUp size={14} className="text-gray-400" />
                  : <ChevronDown size={14} className="text-gray-400" />}
              </div>
            </button>

            {/* Capacity bar — always visible */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest w-16 shrink-0">Workload</span>
              <div className="flex-1 h-5 rounded-md bg-gray-100 overflow-hidden relative">
                <div className="flex h-full">
                  {CATEGORY_ORDER.filter((c) => CATEGORY_META[c].countsAsWork).map((c) => {
                    const hrs = week.byCategory[c];
                    if (hrs <= 0) return null;
                    const segPct = (hrs / threshold) * 100;
                    return (
                      <div
                        key={c}
                        className="h-full transition-all"
                        style={{ width: `${Math.min(segPct, 100)}%`, backgroundColor: CATEGORY_META[c].color }}
                      />
                    );
                  })}
                </div>
                <div className="absolute top-0 bottom-0 w-0.5 bg-gray-900/30" style={{ left: '100%', transform: 'translateX(-1px)' }} />
              </div>
              <span className={cn('text-xs font-black w-20 text-right shrink-0', over ? 'text-red-600' : 'text-gray-700')}>
                {week.totalWorkHours}h / {threshold}h
              </span>
            </div>

            {/* Stats row — always visible */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 mb-4 text-[10px] font-black uppercase tracking-widest text-gray-400">
              <span>Appts: <span className="text-gray-700">{week.totalWorkHours}h</span></span>
              {!hideBuffers && (
                <span>Buffer: <span className="text-gray-700">{Math.round(week.byCategory.buffer * 10) / 10}h</span></span>
              )}
              {workCats.map((c) => (
                <span key={c} style={{ color: CATEGORY_META[c].color }}>
                  {CATEGORY_META[c].label}: {Math.round(week.byCategory[c] * 10) / 10}h
                </span>
              ))}
            </div>

            {isExpanded ? (
              /* EXPANDED — full day columns with all appointments */
              <div className="grid grid-cols-7 gap-2">
                {days.map((day) => (
                  <div
                    key={day.dayLabel + day.dayNumber}
                    className={cn(
                      'rounded-xl border min-h-[120px] p-2 transition-all',
                      day.isToday ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-100 bg-gray-50/30'
                    )}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{day.dayLabel}</span>
                      <span className={cn(
                        'text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center',
                        day.isToday ? 'bg-indigo-600 text-white' : 'text-gray-400'
                      )}>
                        {day.dayNumber}
                      </span>
                    </div>
                    {day.events.length === 0 && day.isFreeDay ? (
                      <div className="border-2 border-dashed border-green-200 rounded-lg p-3 text-center">
                        <p className="text-[9px] font-black text-green-500 uppercase tracking-widest">FREE DAY</p>
                        <p className="text-[7px] font-black text-gray-300 uppercase tracking-widest mt-0.5">9am–6pm available</p>
                      </div>
                    ) : day.events.length === 0 ? (
                      <p className="text-[8px] font-black text-gray-300 uppercase tracking-widest text-center py-4">No slots</p>
                    ) : (
                      <div className="space-y-1.5">
                        {day.events.map(({ event, category, timeLabel, durationLabel }) => {
                          const meta = CATEGORY_META[category];
                          const isBuffer = category === 'buffer' || category === 'personal';
                          return (
                            <div
                              key={event.event_id}
                              className={cn(
                                'rounded-lg p-1.5 text-[10px] leading-tight transition-all hover:scale-[1.02] cursor-default',
                                isBuffer ? 'bg-gray-100 border border-gray-200' : 'border'
                              )}
                              style={!isBuffer ? {
                                backgroundColor: `${meta.color}12`,
                                borderColor: `${meta.color}30`,
                              } : undefined}
                              title={event.title}
                            >
                              <div className="flex items-center gap-1 mb-0.5">
                                {!isBuffer && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />}
                                <span className={cn('font-bold truncate', isBuffer ? 'text-gray-400' : 'text-gray-700')}>
                                  {isBuffer ? '🚫' : ''} {event.title.length > 16 ? event.title.slice(0, 14) + '…' : event.title}
                                </span>
                              </div>
                              {timeLabel && (
                                <p className={cn('font-black text-[9px]', isBuffer ? 'text-gray-400' : 'text-gray-500')}>
                                  {timeLabel}{durationLabel && ` · ${durationLabel}`}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              /* COLLAPSED — summary: daily hour totals + key events */
              <div className="space-y-3">
                {/* Daily hour totals — compact strip */}
                <div className="grid grid-cols-7 gap-1.5">
                  {days.map((day) => (
                    <div
                      key={day.dayLabel + day.dayNumber}
                      className={cn(
                        'rounded-lg p-1.5 text-center transition-all',
                        day.isToday ? 'bg-indigo-50 border border-indigo-200' : 'bg-gray-50/50 border border-gray-100'
                      )}
                    >
                      <div className="flex items-center justify-center gap-1 mb-0.5">
                        <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{day.dayLabel}</span>
                        <span className={cn(
                          'text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center',
                          day.isToday ? 'bg-indigo-600 text-white' : 'text-gray-300'
                        )}>
                          {day.dayNumber}
                        </span>
                      </div>
                      {day.workHours > 0 ? (
                        <>
                          <p className={cn('text-xs font-black', day.isToday ? 'text-indigo-600' : 'text-gray-700')}>
                            {day.workHours}h
                          </p>
                          <p className="text-[7px] font-black text-gray-300 uppercase tracking-widest">{day.events.length} appts</p>
                        </>
                      ) : day.isFreeDay ? (
                        <p className="text-[8px] font-black text-green-400 uppercase tracking-widest py-1">FREE</p>
                      ) : (
                        <p className="text-[7px] font-black text-gray-300 uppercase tracking-widest py-1">—</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Key events — top work events for the week */}
                {keyEvents.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Key events</p>
                    {keyEvents.map(({ event, category, timeLabel, durationLabel }) => {
                      const meta = CATEGORY_META[category];
                      return (
                        <div key={event.event_id} className="flex items-center gap-2 text-[10px]">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                          <span className="font-bold text-gray-700 truncate flex-1">{event.title}</span>
                          {timeLabel && <span className="font-black text-gray-400 shrink-0">{timeLabel}</span>}
                          <span className="font-black text-gray-400 shrink-0">{durationLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default WeekCalendarView;
