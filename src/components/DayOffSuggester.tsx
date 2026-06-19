"use client";

import React, { useMemo, useState } from 'react';
import {
  format, parseISO, isValid, isSameDay, isToday, addDays, isWithinInterval,
} from 'date-fns';
import { cn } from '@/lib/utils';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  type AppointmentCategory,
} from '@/lib/eventClassifier';
import {
  CalendarHeart, Sun, Coffee, Clock, AlertCircle, CheckCircle2,
  TrendingDown, ArrowRight, Settings2, CalendarPlus, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';

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

interface DayOffSuggesterProps {
  weeks: WeekBucket[];
  events: CachedEvent[];
  categoriesByEvent: Record<string, AppointmentCategory>;
  threshold: number;
}

interface DayLoad {
  date: Date;
  dayLabel: string;
  dayNumber: string;
  isToday: boolean;
  workHours: number;
  eventCount: number;
  categories: AppointmentCategory[];
  hasExistingDayOff: boolean;
  isWeekend: boolean;
}

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

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DayOffSuggester: React.FC<DayOffSuggesterProps> = ({
  weeks,
  events,
  categoriesByEvent,
  threshold,
}) => {
  const [daysOffPerWeek, setDaysOffPerWeek] = useState(1);

  // Build day-level load for each week
  const weekDays: Array<{ week: WeekBucket; days: DayLoad[] }> = useMemo(() => {
    return weeks.map((week) => {
      const days: DayLoad[] = [];
      for (let i = 0; i < 7; i++) {
        const date = addDays(week.weekStart, i);
        const dayEvents = events.filter((e) => {
          if (!e.start_time) return false;
          const s = parseISO(e.start_time);
          return isValid(s) && isSameDay(s, date);
        });

        const workIntervals: Interval[] = dayEvents
          .map((e) => {
            const cat = categoriesByEvent[e.event_id] || 'other';
            if (!CATEGORY_META[cat].countsAsWork) return null;
            const s = parseISO(e.start_time);
            const en = parseISO(e.end_time);
            return isValid(s) && isValid(en) ? { start: s.getTime(), end: en.getTime() } : null;
          })
          .filter((iv): iv is Interval => iv !== null);

        const workHours = Math.round(mergeIntervalsHours(workIntervals) * 100) / 100;
        const cats = new Set<AppointmentCategory>();
        dayEvents.forEach((e) => {
          const cat = categoriesByEvent[e.event_id] || 'other';
          if (CATEGORY_META[cat].countsAsWork) cats.add(cat);
        });
        const hasExistingDayOff = dayEvents.some((e) => {
          const cat = categoriesByEvent[e.event_id] || 'other';
          return (cat === 'buffer' || cat === 'personal') && /day off|rest|recovery|🌿/i.test(e.title);
        });

        days.push({
          date,
          dayLabel: format(date, 'EEE'),
          dayNumber: format(date, 'd'),
          isToday: isToday(date),
          workHours,
          eventCount: dayEvents.length,
          categories: Array.from(cats),
          hasExistingDayOff,
          isWeekend: i >= 5,
        });
      }
      return { week, days };
    });
  }, [weeks, events, categoriesByEvent]);

  // Score each day for day-off suitability (lower = better candidate)
  const scoreDay = (d: DayLoad): number => {
    if (d.hasExistingDayOff) return Infinity;
    let score = d.workHours * 10 + d.eventCount;
    if (d.isWeekend) score -= 5;
    if (d.workHours === 0 && d.eventCount === 0) score -= 20;
    return score;
  };

  // Per-week suggestions — pick N best days
  const weekSuggestions = useMemo(() => {
    return weekDays.map(({ week, days }) => {
      const scored = days.map((d) => ({ day: d, score: scoreDay(d) }));
      const existingDayOffCount = days.filter((d) => d.hasExistingDayOff).length;
      const remaining = Math.max(0, daysOffPerWeek - existingDayOffCount);
      const alreadyHasDayOff = existingDayOffCount > 0;
      const best = scored
        .filter((s) => s.score < Infinity)
        .sort((a, b) => a.score - b.score)
        .slice(0, remaining)
        .map((s) => s.day);
      const overload = week.totalWorkHours > threshold;
      const overloadRatio = week.totalWorkHours / threshold;

      let urgency: 'critical' | 'high' | 'moderate' | 'low' = 'low';
      if (overloadRatio > 1.3) urgency = 'critical';
      else if (overloadRatio > 1.0) urgency = 'high';
      else if (overloadRatio > 0.7) urgency = 'moderate';

      return { week, days, best, alreadyHasDayOff, overload, urgency, overloadRatio };
    });
  }, [weekDays, daysOffPerWeek, threshold]);

  // Cross-week "in lieu" analysis — overloaded weeks that should carry rest into lighter weeks
  const inLieuSuggestions = useMemo(() => {
    const recs: Array<{ fromWeek: WeekBucket; toWeek: WeekBucket; reason: string }> = [];
    for (let i = 0; i < weekSuggestions.length - 1; i++) {
      const cur = weekSuggestions[i];
      if (!cur.overload) continue;
      // Find the next lightest week
      let lightest = null as null | typeof weekSuggestions[0];
      let lightestHours = Infinity;
      for (let j = i + 1; j < weekSuggestions.length; j++) {
        if (weekSuggestions[j].week.totalWorkHours < lightestHours) {
          lightestHours = weekSuggestions[j].week.totalWorkHours;
          lightest = weekSuggestions[j];
        }
      }
      if (lightest && lightest.week.totalWorkHours < threshold * 0.5) {
        const surplus = Math.round((cur.week.totalWorkHours - threshold) * 10) / 10;
        recs.push({
          fromWeek: cur.week,
          toWeek: lightest.week,
          reason: `Week of ${cur.week.label} is ${surplus}h over your goal. The week of ${lightest.week.label} is only ${lightest.week.totalWorkHours}h — take an extra day off then to recover in lieu.`,
        });
      }
    }
    return recs;
  }, [weekSuggestions, threshold]);

  // Big picture summary
  const bigPicture = useMemo(() => {
    if (weekSuggestions.length === 0) return null;
    const overloaded = weekSuggestions.filter((w) => w.overload);
    const protectedWeeks = weekSuggestions.filter((w) => w.alreadyHasDayOff);
    const lightWeeks = weekSuggestions.filter((w) => w.week.totalWorkHours < threshold * 0.4);
    const totalHours = weekSuggestions.reduce((a, w) => a + w.week.totalWorkHours, 0);
    const avg = totalHours / weekSuggestions.length;

    const issues: string[] = [];
    if (overloaded.length > 0) {
      issues.push(`${overloaded.length} week${overloaded.length > 1 ? 's' : ''} over your ${threshold}h goal`);
    }
    if (protectedWeeks.length < weekSuggestions.length) {
      const unprotected = weekSuggestions.length - protectedWeeks.length;
      issues.push(`${unprotected} week${unprotected > 1 ? 's' : ''} without a protected day off`);
    }
    if (inLieuSuggestions.length > 0) {
      issues.push(`${inLieuSuggestions.length} week${inLieuSuggestions.length > 1 ? 's' : ''} need compensatory rest`);
    }

    return {
      avg: Math.round(avg * 10) / 10,
      overloaded: overloaded.length,
      protectedWeeks: protectedWeeks.length,
      lightWeeks: lightWeeks.length,
      totalWeeks: weekSuggestions.length,
      issues,
      tone: overloaded.length > 1 ? 'warn' : overloaded.length === 1 ? 'info' : 'good',
    };
  }, [weekSuggestions, inLieuSuggestions, threshold]);

  if (weeks.length === 0) {
    return (
      <div className="text-center py-16">
        <CalendarHeart className="mx-auto text-gray-300 mb-3" size={40} />
        <p className="text-gray-400 font-black uppercase tracking-widest text-xs">No weeks to analyse</p>
      </div>
    );
  }

  const urgencyConfig = {
    critical: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-600', label: 'Critical' },
    high: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', label: 'High' },
    moderate: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-600', label: 'Moderate' },
    low: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-600', label: 'Low' },
  };

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Settings2 size={14} className="text-gray-400" />
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Days off per week:</span>
          <div className="flex items-center bg-gray-50 rounded-full p-0.5 gap-0.5">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() => setDaysOffPerWeek(n)}
                aria-pressed={daysOffPerWeek === n}
                className={cn(
                  'w-7 h-7 rounded-full text-[10px] font-black transition-all',
                  daysOffPerWeek === n ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Big picture summary */}
      {bigPicture && (
        <div className={cn(
          'rounded-2xl border p-5 flex items-start gap-4',
          bigPicture.tone === 'warn' ? 'bg-red-50/50 border-red-100' :
          bigPicture.tone === 'info' ? 'bg-amber-50/50 border-amber-100' :
          'bg-green-50/50 border-green-100'
        )}>
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
            bigPicture.tone === 'warn' ? 'bg-red-100 text-red-600' :
            bigPicture.tone === 'info' ? 'bg-amber-100 text-amber-600' :
            'bg-green-100 text-green-600'
          )}>
            <CalendarHeart size={20} />
          </div>
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm font-black text-gray-900">Big picture</p>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                Avg {bigPicture.avg}h · {bigPicture.totalWeeks} weeks
              </span>
            </div>
            {bigPicture.issues.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {bigPicture.issues.map((issue, i) => (
                  <span key={i} className={cn(
                    'px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest',
                    bigPicture.tone === 'warn' ? 'bg-red-100 text-red-600' :
                    bigPicture.tone === 'info' ? 'bg-amber-100 text-amber-600' :
                    'bg-green-100 text-green-600'
                  )}>
                    {issue}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-green-600 font-medium">All weeks are balanced and protected. Nice work.</p>
            )}
          </div>
        </div>
      )}

      {/* In-lieu suggestions */}
      {inLieuSuggestions.length > 0 && (
        <div className="space-y-2">
          {inLieuSuggestions.map((rec, i) => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-2xl bg-indigo-50/50 border border-indigo-100">
              <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                <TrendingDown size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-indigo-900 uppercase tracking-widest mb-0.5">Day off in lieu</p>
                <p className="text-xs text-gray-600 font-medium leading-relaxed">{rec.reason}</p>
              </div>
              <div className="flex items-center gap-1 text-gray-300 shrink-0">
                <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{rec.fromWeek.label}</span>
                <ArrowRight size={12} className="text-indigo-400" />
                <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{rec.toWeek.label}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Per-week suggestions */}
      {weekSuggestions.map(({ week, days, best, alreadyHasDayOff, overload, urgency, overloadRatio }) => {
        const cfg = urgencyConfig[urgency];
        const isCurrentWeek = isWithinInterval(new Date(), { start: week.weekStart, end: week.weekEnd });
        return (
          <div
            key={week.label}
            className={cn(
              'rounded-2xl border-2 p-5 transition-all',
              isCurrentWeek ? 'border-indigo-500 bg-indigo-50/30 shadow-md shadow-indigo-100' : 'border-gray-100 bg-white'
            )}
          >
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                {isCurrentWeek && <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />}
                <h4 className="font-black text-gray-900 tracking-tight text-sm">{week.rangeLabel}</h4>
                {isCurrentWeek && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[8px] font-black uppercase tracking-widest">This Week</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border', cfg.bg, cfg.text, cfg.border)}>
                  {cfg.label}
                </span>
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{week.totalWorkHours}h / {threshold}h</span>
              </div>
            </div>

            {/* Suggestion summary */}
            <div className={cn(
              'flex items-start gap-3 p-3 rounded-xl mb-3',
              alreadyHasDayOff && best.length === 0 ? 'bg-green-50/50 border border-green-100' : `${cfg.bg} border ${cfg.border}`
            )}>
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                alreadyHasDayOff && best.length === 0 ? 'bg-green-100 text-green-600' : `${cfg.bg} ${cfg.text}`
              )}>
                {alreadyHasDayOff && best.length === 0 ? <CheckCircle2 size={16} /> : <Sun size={16} />}
              </div>
              <div className="flex-1">
                <p className="text-xs font-black text-gray-800 uppercase tracking-widest mb-0.5">
                  {alreadyHasDayOff && best.length === 0
                    ? 'Already protected'
                    : alreadyHasDayOff && best.length > 0
                      ? `Add: ${best.map((d) => DAY_NAMES[days.indexOf(d)]).join(' + ')}`
                      : best.length > 0
                        ? `Suggest${best.length > 1 ? '' : 'ed'}: ${best.map((d) => DAY_NAMES[days.indexOf(d)]).join(' + ')}`
                        : 'No clear day available'}
                </p>
                <p className="text-[11px] text-gray-500 font-medium leading-snug">
                  {alreadyHasDayOff && best.length === 0
                    ? 'You already have enough day offs blocked this week.'
                    : alreadyHasDayOff && best.length > 0
                      ? `You have ${existingDayOffCount} day off${existingDayOffCount > 1 ? 's' : ''} — ${best.map((d) => {
                          if (d.workHours === 0 && d.eventCount === 0) return `${DAY_NAMES[days.indexOf(d)]} is completely free`;
                          return `${DAY_NAMES[days.indexOf(d)]} is the next lightest (${d.workHours}h)`;
                        }).join('; ')}`
                      : best.length > 0
                        ? best.map((d) => {
                            if (d.workHours === 0 && d.eventCount === 0) return `${DAY_NAMES[days.indexOf(d)]} is completely free`;
                            if (d.isWeekend) return `${DAY_NAMES[days.indexOf(d)]} is the lightest weekend day (${d.workHours}h)`;
                            return `${DAY_NAMES[days.indexOf(d)]} has the least load (${d.workHours}h)`;
                          }).join('; ')
                        : 'Every day has events — consider dropping something.'}
                </p>
              </div>
            </div>

            {/* Day-by-day load strip */}
            <div className="grid grid-cols-7 gap-1.5">
              {days.map((day, i) => {
                const isSuggested = best.includes(day);
                const loadPct = threshold > 0 ? Math.min(100, (day.workHours / threshold) * 100) : 0;
                return (
                  <div
                    key={i}
                    className={cn(
                      'rounded-lg p-2 text-center border transition-all relative',
                      isSuggested && 'border-2',
                      day.hasExistingDayOff
                        ? 'bg-green-50 border-green-200'
                        : isSuggested
                          ? `${cfg.border} ${cfg.bg} border-2`
                          : day.isToday
                            ? 'bg-indigo-50 border-indigo-200'
                            : 'bg-gray-50/50 border-gray-100'
                    )}
                  >
                    {isSuggested && (
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[7px] font-black uppercase tracking-widest whitespace-nowrap z-10">
                        Day off
                      </div>
                    )}
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{day.dayLabel}</span>
                      <span className={cn(
                        'text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center',
                        day.isToday ? 'bg-indigo-600 text-white' : 'text-gray-300'
                      )}>
                        {day.dayNumber}
                      </span>
                    </div>
                    {day.hasExistingDayOff ? (
                      <div className="py-1">
                        <CheckCircle2 size={14} className="mx-auto text-green-500" />
                        <p className="text-[7px] font-black text-green-600 uppercase tracking-widest mt-0.5">Off</p>
                      </div>
                    ) : day.workHours > 0 ? (
                      <>
                        <p className={cn('text-xs font-black', isSuggested ? cfg.text : 'text-gray-700')}>{day.workHours}h</p>
                        <div className="h-1 rounded-full bg-gray-100 overflow-hidden mt-1">
                          <div className="h-full rounded-full" style={{
                            width: `${loadPct}%`,
                            backgroundColor: day.categories.length > 0 ? CATEGORY_META[day.categories[0]].color : '#64748B',
                          }} />
                        </div>
                        <p className="text-[7px] font-black text-gray-300 uppercase tracking-widest mt-0.5">{day.eventCount} appts</p>
                      </>
                    ) : (
                      <div className="py-1">
                        <Coffee size={14} className="mx-auto text-gray-300" />
                        <p className="text-[7px] font-black text-gray-300 uppercase tracking-widest mt-0.5">Free</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DayOffSuggester;
