"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import PageHeader from '@/components/PageHeader';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { useSyncCalendars } from '@/hooks/useSyncCalendars';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import type { LucideIcon } from 'lucide-react';
import {
  Activity, RefreshCw, AlertTriangle, TrendingUp, Gauge, Sparkles,
  CalendarClock, Lightbulb, ShieldCheck, CalendarOff, Layers, Target,
  CalendarHeart, Plus, Clock, ArrowRight, Brain, CheckSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import ClipboardImporter from '@/components/ClipboardImporter';
import DayOffSuggester from '@/components/DayOffSuggester';
import WeekCalendarView from '@/components/WeekCalendarView';
import { format, parseISO, isValid, startOfWeek, addWeeks, differenceInCalendarWeeks, isWithinInterval, endOfWeek, isToday, isFuture, isPast } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  classifyEventTypes,
  CATEGORY_META,
  CATEGORY_ORDER,
  type AppointmentCategory,
} from '@/lib/eventClassifier';

type ViewMode = 'overview' | 'calendar' | 'dayoff';
type WeekRangeOption = 1 | 4 | 6 | 8 | 12;
const WEEK_RANGE_OPTIONS: WeekRangeOption[] = [1, 4, 6, 8, 12];

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

const DEFAULT_THRESHOLD = 30; // hrs/week — weekly goal

const durationHours = (e: CachedEvent): number => {
  if (e.duration_minutes && e.duration_minutes > 0) return e.duration_minutes / 60;
  if (e.start_time && e.end_time) {
    const s = parseISO(e.start_time);
    const en = parseISO(e.end_time);
    if (isValid(s) && isValid(en)) return Math.max(0, (en.getTime() - s.getTime()) / 3600000);
  }
  return 0;
};

// Merge overlapping [start, end] intervals and return net covered hours.
// Prevents double-counting when events overlap (e.g. a show + dinner at the same time).
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

const eventInterval = (e: CachedEvent): Interval | null => {
  if (!e.start_time || !e.end_time) return null;
  const s = parseISO(e.start_time);
  const en = parseISO(e.end_time);
  if (!isValid(s) || !isValid(en)) return null;
  return { start: s.getTime(), end: en.getTime() };
};

const Energy = () => {
  const navigate = useNavigate();
  const { syncCalendars } = useSyncCalendars();
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [events, setEvents] = useState<CachedEvent[]>([]);
  const [categoriesByEvent, setCategoriesByEvent] = useState<Record<string, AppointmentCategory>>({});
  const [usedAI, setUsedAI] = useState(false);
  const [includeBuffers, setIncludeBuffers] = useState(false);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [blockedWeeks, setBlockedWeeks] = useState<Set<string>>(new Set());
  const [blockedDays, setBlockedDays] = useState<Set<string>>(new Set());
  const thresholdSaveRef = useRef<NodeJS.Timeout | null>(null);
  const [hasSyncedEver, setHasSyncedEver] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [weekRange, setWeekRange] = useState<WeekRangeOption>(6);
  const [showImporter, setShowImporter] = useState(false);
  const [now, setNow] = useState(new Date());
  const [celebrationStreak, setCelebrationStreak] = useState(() => {
    const saved = localStorage.getItem('vibecal_streak');
    return saved ? JSON.parse(saved) : { count: 0, lastWeek: '' };
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('calendar_events_cache')
        .select('event_id, title, start_time, end_time, duration_minutes, provider, source_calendar, is_locked')
        .eq('user_id', user.id)
        .order('start_time', { ascending: true });
      if (error) throw error;

      const fetched = (data || []) as CachedEvent[];
      setEvents(fetched);
      setHasSyncedEver(fetched.length > 0);

      if (fetched.length > 0) {
        const { byEventId, usedAI: ai } = await classifyEventTypes(
          fetched.map((e) => ({ event_id: e.event_id, title: e.title }))
        );
        setCategoriesByEvent(byEventId);
        setUsedAI(ai);
      }

      // Load saved weekly goal from user_settings
      const { data: settingsData } = await supabase
        .from('user_settings')
        .select('weekly_goal_hours')
        .eq('user_id', user.id)
        .maybeSingle();
      if (settingsData?.weekly_goal_hours) {
        setThreshold(settingsData.weekly_goal_hours);
      }

      // Load blocked weeks from week_calendar_status
      const { data: blockedData } = await supabase
        .from('week_calendar_status')
        .select('week_start_date')
        .eq('user_id', user.id)
        .eq('is_blocked', true);
      if (blockedData) {
        const blocked = new Set(blockedData.map((row: { week_start_date: string }) => row.week_start_date));
        setBlockedWeeks(blocked);
      }

      // Load blocked days from day_status
      const { data: dayData } = await supabase
        .from('day_status')
        .select('date')
        .eq('user_id', user.id)
        .eq('is_blocked', true);
      if (dayData) {
        const blocked = new Set(dayData.map((row: { date: string }) => row.date));
        setBlockedDays(blocked);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load calendar data';
      showError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSync = async () => {
    setIsProcessing(true);
    setStatusText('Syncing calendars...');
    const result = await syncCalendars();
    if (result.success) {
      setStatusText('Classifying events...');
      await loadData();
      showSuccess('Calendar synced and analysed');
    }
    setIsProcessing(false);
    setStatusText('');
  };

  // Save threshold to backend with debounce
  useEffect(() => {
    const userPromise = supabase.auth.getUser();
    userPromise.then(({ data: { user } }) => {
      if (!user) return;
      if (thresholdSaveRef.current) clearTimeout(thresholdSaveRef.current);
      thresholdSaveRef.current = setTimeout(async () => {
        await supabase
          .from('user_settings')
          .upsert({ user_id: user.id, weekly_goal_hours: threshold }, { onConflict: 'user_id' });
      }, 800);
    });
  }, [threshold]);

  const handleToggleBlocked = useCallback(async (weekStart: Date) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const weekKey = format(weekStart, 'yyyy-MM-dd');
    const currentlyBlocked = blockedWeeks.has(weekKey);
    setBlockedWeeks((prev) => {
      const next = new Set(prev);
      if (currentlyBlocked) next.delete(weekKey);
      else next.add(weekKey);
      return next;
    });
    if (currentlyBlocked) {
      await supabase
        .from('week_calendar_status')
        .delete()
        .eq('user_id', user.id)
        .eq('week_start_date', weekKey);
    } else {
      await supabase
        .from('week_calendar_status')
        .upsert({ user_id: user.id, week_start_date: weekKey, is_blocked: true }, { onConflict: 'user_id,week_start_date' });
    }
  }, [blockedWeeks]);

  const handleToggleBlockedDay = useCallback(async (date: Date) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const dateKey = format(date, 'yyyy-MM-dd');
    const currentlyBlocked = blockedDays.has(dateKey);
    setBlockedDays((prev) => {
      const next = new Set(prev);
      if (currentlyBlocked) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
    try {
      const { error } = await supabase.functions.invoke('block-day', {
        body: { date: dateKey, blocked: !currentlyBlocked },
      });
      if (error) console.error('block-day error:', error);
    } catch (err) {
      console.error('Failed to block day:', err);
    }
  }, [blockedDays]);

  // Group events into contiguous Monday-Sunday weeks.
  const weeks: WeekBucket[] = useMemo(() => {
    if (events.length === 0) return [];
    const valid = events.filter((e) => e.start_time && isValid(parseISO(e.start_time)));
    if (valid.length === 0) return [];

    const firstStart = startOfWeek(parseISO(valid[0].start_time), { weekStartsOn: 1 });
    const lastStart = startOfWeek(parseISO(valid[valid.length - 1].start_time), { weekStartsOn: 1 });
    const weekSpan = differenceInCalendarWeeks(lastStart, firstStart, { weekStartsOn: 1 });
    const weekStarts: Date[] = [];
    for (let i = 0; i <= weekSpan; i++) weekStarts.push(addWeeks(firstStart, i));

    return weekStarts.map((ws) => {
      const we = endOfWeek(ws, { weekStartsOn: 1 });
      const byCategory = {} as Record<AppointmentCategory, number>;
      CATEGORY_ORDER.forEach((c) => (byCategory[c] = 0));
      let eventCount = 0;
      let hasDayOff = false;
      const present = new Set<AppointmentCategory>();

      // Collect intervals per category for merge-dedup, plus all work intervals for net total.
      const intervalsByCategory = {} as Record<AppointmentCategory, Interval[]>;
      CATEGORY_ORDER.forEach((c) => (intervalsByCategory[c] = []));
      const allWorkIntervals: Interval[] = [];

      valid.forEach((e) => {
        const start = parseISO(e.start_time);
        if (!isWithinInterval(start, { start: ws, end: we })) return;
        const cat = categoriesByEvent[e.event_id] || 'other';
        const iv = eventInterval(e);
        if (iv) {
          intervalsByCategory[cat].push(iv);
          if (CATEGORY_META[cat].countsAsWork) allWorkIntervals.push(iv);
        }
        eventCount += 1;
        present.add(cat);
        if (cat === 'buffer' || cat === 'personal') {
          if (/day off|rest|recovery|🌿/i.test(e.title)) hasDayOff = true;
        }
      });

      // Per-category hours = merged intervals (no double-count within a category)
      CATEGORY_ORDER.forEach((c) => {
        byCategory[c] = Math.round(mergeIntervalsHours(intervalsByCategory[c]) * 100) / 100;
      });

      // Total work hours = merged intervals across ALL work categories (no double-count across categories)
      const totalWorkHours = Math.round(mergeIntervalsHours(allWorkIntervals) * 100) / 100;
      const rounded = totalWorkHours;

      return {
        weekStart: ws,
        weekEnd: we,
        label: format(ws, 'MMM d'),
        rangeLabel: `${format(ws, 'MMM d')} – ${format(we, 'MMM d')}`,
        totalWorkHours: rounded,
        byCategory,
        eventCount,
        hasDayOff,
        categoriesPresent: Array.from(present),
        pctOfGoal: threshold > 0 ? Math.min(100, Math.round((rounded / threshold) * 100)) : 0,
      };
    });
  }, [events, categoriesByEvent, threshold]);

  // Visible weeks: from the current week forward, limited to the selected range.
  const visibleWeeks: WeekBucket[] = useMemo(() => {
    if (weeks.length === 0) return [];
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const upcoming = weeks.filter((w) => !isPast(endOfWeek(w.weekStart, { weekStartsOn: 1 })) || isWithinInterval(new Date(), { start: w.weekStart, end: endOfWeek(w.weekStart, { weekStartsOn: 1 }) }));
    // Start from current week
    const currentIdx = upcoming.findIndex((w) => w.weekStart.getTime() >= currentWeekStart.getTime());
    const startIdx = currentIdx === -1 ? 0 : currentIdx;
    return upcoming.slice(startIdx, startIdx + weekRange);
  }, [weeks, weekRange]);

  // Lookup: events for a given week + category (for hover lists).
  const eventsByWeekCategory = useMemo(() => {
    const map = new Map<string, Array<{ title: string; timeLabel: string; durationLabel: string }>>();
    if (events.length === 0) return map;
    weeks.forEach((w) => {
      const we = endOfWeek(w.weekStart, { weekStartsOn: 1 });
      CATEGORY_ORDER.forEach((cat) => {
        const key = `${w.label}-${cat}`;
        const matched = events
          .filter((e) => {
            if (!e.start_time) return false;
            const s = parseISO(e.start_time);
            if (!isValid(s) || !isWithinInterval(s, { start: w.weekStart, end: we })) return false;
            return (categoriesByEvent[e.event_id] || 'other') === cat;
          })
          .sort((a, b) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime())
          .map((e) => {
            const s = parseISO(e.start_time);
            const hrs = durationHours(e);
            return {
              title: e.title,
              timeLabel: isValid(s) ? format(s, 'EEE h:mm a') : '',
              durationLabel: hrs >= 1 ? `${Math.round(hrs * 10) / 10}h` : `${Math.round(hrs * 60)}m`,
            };
          });
        map.set(key, matched);
      });
    });
    return map;
  }, [events, categoriesByEvent, weeks]);

  const getEventsForCategory = (weekLabel: string, category: AppointmentCategory) => {
    return eventsByWeekCategory.get(`${weekLabel}-${category}`) || [];
  };

  const chartData = useMemo(
    () => visibleWeeks.map((w) => {
      const row: Record<string, number | string | boolean> = { label: w.label, total: w.totalWorkHours, hasDayOff: w.hasDayOff };
      CATEGORY_ORDER.forEach((c) => {
        const hours = Math.round(w.byCategory[c] * 100) / 100;
        row[c] = includeBuffers || CATEGORY_META[c].countsAsWork ? hours : 0;
      });
      return row;
    }),
    [visibleWeeks, includeBuffers]
  );

  // Total hours per category across the whole range.
  const typeTotals = useMemo(() => {
    const totals = {} as Record<AppointmentCategory, number>;
    CATEGORY_ORDER.forEach((c) => (totals[c] = 0));
    const scope = visibleWeeks.length > 0 ? visibleWeeks : weeks;
    scope.forEach((w) => CATEGORY_ORDER.forEach((c) => (totals[c] += w.byCategory[c])));
    return CATEGORY_ORDER.map((c) => ({
      category: c,
      label: CATEGORY_META[c].label,
      hours: Math.round(totals[c] * 100) / 100,
      color: CATEGORY_META[c].color,
      countsAsWork: CATEGORY_META[c].countsAsWork,
    })).filter((t) => t.hours > 0 && t.countsAsWork)
      .sort((a, b) => b.hours - a.hours);
  }, [visibleWeeks, weeks]);

  const summary = useMemo(() => {
    const scope = visibleWeeks.length > 0 ? visibleWeeks : weeks;
    if (scope.length === 0) return null;
    const workWeeks = scope.filter((w) => w.totalWorkHours > 0);
    const totalHours = scope.reduce((a, w) => a + w.totalWorkHours, 0);
    const avg = workWeeks.length > 0 ? totalHours / workWeeks.length : 0;
    const heaviest = scope.reduce((max, w) => (w.totalWorkHours > max.totalWorkHours ? w : max), scope[0]);
    const overThreshold = scope.filter((w) => w.totalWorkHours > threshold);
    const weeksWithoutDayOff = scope.filter((w) => w.totalWorkHours > 0 && !w.hasDayOff);
    return {
      totalHours: Math.round(totalHours * 100) / 100,
      avg: Math.round(avg * 100) / 100,
      heaviest,
      overThreshold,
      weeksWithoutDayOff,
      weekCount: scope.length,
      workWeekCount: workWeeks.length,
    };
  }, [visibleWeeks, weeks, threshold]);

  // Pattern-based recommendations (mirrors the analysis approach from the Claude chat).
  const recommendations = useMemo(() => {
    if (!summary) return [];
    const recs: Array<{ icon: LucideIcon; tone: 'warn' | 'info' | 'good'; title: string; body: string }> = [];

    if (summary.heaviest.totalWorkHours > threshold) {
      recs.push({
        icon: AlertTriangle,
        tone: 'warn',
        title: `Week of ${summary.heaviest.label} is overloaded (${summary.heaviest.totalWorkHours} hrs)`,
        body: `This is your heaviest week at ${summary.heaviest.totalWorkHours} hrs — above your ${threshold} hr limit. It includes ${summary.heaviest.categoriesPresent
          .filter((c) => CATEGORY_META[c].countsAsWork)
          .map((c) => CATEGORY_META[c].label)
          .join(', ')}. Consider dropping one item (e.g. a workshop or one half-day) rather than reducing hours generally.`,
      });
    }

    // Code-switching: weeks with 3+ work categories present
    const switchyWeeks = visibleWeeks.filter(
      (w) => w.categoriesPresent.filter((c) => CATEGORY_META[c].countsAsWork).length >= 3
    );
    if (switchyWeeks.length > 0) {
      const labels = switchyWeeks.slice(0, 3).map((w) => w.label).join(', ');
      recs.push({
        icon: Layers,
        tone: 'info',
        title: `${switchyWeeks.length} week(s) mix 3+ modes on the same days`,
        body: `Weeks like ${labels} stack MTT, clinical, coaching and performance against each other. Cal.com can't buffer across event types, so set generous 60-min before/after buffers on each event type and keep voice coaching to a single recurring day.`,
      });
    }

    // No day off in working weeks
    if (summary.weeksWithoutDayOff.length > 0) {
      recs.push({
        icon: CalendarOff,
        tone: 'warn',
        title: `${summary.weeksWithoutDayOff.length} working week(s) have no protected day off`,
        body: 'A zero-buffer week is the most disruptive pattern for low-energy code-switching. Block at least one full day off in each of these weeks before they fill up.',
      });
    }

    // Trough: heavy week immediately followed by a near-empty week
    for (let i = 0; i < visibleWeeks.length - 1; i++) {
      const cur = visibleWeeks[i];
      const nxt = visibleWeeks[i + 1];
      if (cur.totalWorkHours > threshold && nxt.totalWorkHours > 0 && nxt.totalWorkHours < cur.totalWorkHours * 0.25) {
        recs.push({
          icon: TrendingUp,
          tone: 'info',
          title: `Cliff drop after week of ${cur.label}`,
          body: `${cur.totalWorkHours} hrs collapses to ${nxt.totalWorkHours} hrs the next week. A sudden drop isn't restful — taper down instead so the nervous system isn't left understimulated and adrift.`,
        });
        break;
      }
    }

    // Cal.com-style booking limits advice tied to the heaviest categories
    const coachingTotal = typeTotals.find((t) => t.category === 'coaching')?.hours ?? 0;
    if (coachingTotal > 0) {
      recs.push({
        icon: ShieldCheck,
        tone: 'good',
        title: 'Voice / Piano Coaching — turn on "first slot per day"',
        body: 'Enable "Show only the first available slot each day" and cap total coaching at ~2 hrs/week so scattered bookings can\'t fragment your week. Set 30-min before/after buffers.',
      });
    }
    const fnhTotal = typeTotals.find((t) => t.category === 'fnh')?.hours ?? 0;
    if (fnhTotal > 0) {
      recs.push({
        icon: ShieldCheck,
        tone: 'good',
        title: 'FNH Assessments — 60-min buffers, max 2/day',
        body: 'Vestibular / cranial-nerve work is taxing to switch into and out of. Use 60-min (not 30) before/after buffers, cap at 2 bookings/day and 4/week, and lock FNH to Wed–Fri only.',
      });
    }

    if (recs.length === 0) {
      recs.push({
        icon: Sparkles,
        tone: 'good',
        title: 'Your load looks balanced',
        body: `Average ${summary.avg} hrs/week across ${summary.workWeekCount} working weeks, nothing above your ${threshold} hr limit. Keep protecting your day-off blocks.`,
      });
    }

    return recs;
  }, [summary, visibleWeeks, typeTotals, threshold]);

  const overworkVerdict = useMemo(() => {
    if (!summary) return null;
    const over = summary.overThreshold.length;
    if (over === 0) {
      return {
        tone: 'good' as const,
        headline: 'No, the raw hours are fine',
        detail: `Your heaviest week is ${summary.heaviest.totalWorkHours} hrs and your average is ${summary.avg} hrs. That's not excessive by most standards — the shape of it matters more than the total.`,
      };
    }
    if (over <= 1 && summary.avg <= threshold) {
      return {
        tone: 'info' as const,
        headline: 'Mostly fine, but one week spikes',
        detail: `Average is ${summary.avg} hrs, but the week of ${summary.heaviest.label} hits ${summary.heaviest.totalWorkHours} hrs. Target that specific week rather than reducing everything.`,
      };
    }
    return {
      tone: 'warn' as const,
      headline: 'Yes — consistently over your limit',
      detail: `${over} of ${summary.workWeekCount} working weeks exceed ${threshold} hrs. Look at the recommendations to consolidate modes and protect day-off blocks.`,
    };
  }, [summary, threshold]);

  // --- ADHD timeblindness assists ---

  // Today's events for the "Right Now" banner and "Today's Load" card
  const todayInfo = useMemo(() => {
    const todayEvents = events.filter((e) => {
      if (!e.start_time) return false;
      const s = parseISO(e.start_time);
      return isValid(s) && isToday(s);
    });

    const currentEvent = todayEvents.find((e) => {
      if (!e.start_time || !e.end_time) return false;
      const s = parseISO(e.start_time);
      const en = parseISO(e.end_time);
      return isValid(s) && isValid(en) && now >= s && now <= en;
    });

    const nextEvent = !currentEvent
      ? todayEvents
          .filter((e) => {
            if (!e.start_time) return false;
            return parseISO(e.start_time) > now;
          })
          .sort(
            (a, b) =>
              parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime()
          )[0] || null
      : null;

    const todayTotalHours = todayEvents.reduce((sum, e) => {
      const cat = categoriesByEvent[e.event_id] || 'other';
      if (!CATEGORY_META[cat].countsAsWork) return sum;
      return sum + durationHours(e);
    }, 0);

    return { currentEvent, nextEvent, todayTotalHours };
  }, [events, categoriesByEvent, now]);

  // Streak tracking for under-goal weeks
  useEffect(() => {
    if (weeks.length === 0) return;
    const lastCompletedWeek = [...weeks]
      .filter((w) => isPast(endOfWeek(w.weekStart, { weekStartsOn: 1 })))
      .pop();
    if (!lastCompletedWeek) return;
    const weekId = lastCompletedWeek.label;
    if (weekId === celebrationStreak.lastWeek) return;
    const underGoal = lastCompletedWeek.totalWorkHours <= threshold;
    const newStreak = underGoal
      ? { count: celebrationStreak.count + 1, lastWeek: weekId }
      : { count: 0, lastWeek: '' };
    setCelebrationStreak(newStreak);
    localStorage.setItem('vibecal_streak', JSON.stringify(newStreak));
  }, [weeks, threshold, celebrationStreak.lastWeek]);

  if (loading) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="w-16 h-16 bg-indigo-50 rounded-3xl flex items-center justify-center">
            <Activity className="text-indigo-600 animate-pulse" size={32} />
          </div>
          <p className="text-gray-400 font-black uppercase tracking-widest text-xs">Loading your energy data...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageHeader
        title="Energy & Load"
        subtitle="See how your time is split, week by week, and whether you're carrying too much."
        icon={Activity}
        actions={
          <div className="flex items-center gap-2 w-full md:w-auto justify-end">
            {/* Import from clipboard */}
            <Button
              onClick={() => setShowImporter(true)}
              variant="outline"
              className="bg-white border-gray-100 text-gray-500 hover:text-indigo-600 hover:border-indigo-100 rounded-xl h-10 px-4 font-black text-[9px] uppercase tracking-widest shadow-sm shrink-0"
            >
              <Plus size={14} className="mr-1.5" /> Import
            </Button>
            {/* View toggle */}
            <div className="flex items-center bg-white rounded-xl border border-gray-100 shadow-sm p-0.5">
              <button
                onClick={() => setViewMode('overview')}
                className={cn(
                  'px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all',
                  viewMode === 'overview' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
                )}
              >
                Overview
              </button>
              <button
                onClick={() => setViewMode('calendar')}
                className={cn(
                  'px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all',
                  viewMode === 'calendar' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
                )}
              >
                Calendar
              </button>
              <button
                onClick={() => setViewMode('dayoff')}
                className={cn(
                  'px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all',
                  viewMode === 'dayoff' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
                )}
              >
                Day Off
              </button>
            </div>
            <Button
              onClick={handleSync}
              disabled={isProcessing}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-10 px-5 font-black text-[9px] uppercase tracking-widest shadow-lg shadow-indigo-100 shrink-0"
            >
              <RefreshCw size={14} className={cn('mr-1.5', isProcessing && 'animate-spin')} />
              {isProcessing ? 'Syncing...' : 'Sync'}
            </Button>
          </div>
        }
      />

      {events.length === 0 ? (
        <Card className="border-none shadow-xl rounded-[3rem] bg-white">
          <div className="p-16 text-center space-y-6">
            <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto">
              <CalendarClock className="text-indigo-500" size={40} />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">No calendar events yet</h2>
              <p className="text-gray-500 font-medium max-w-md mx-auto">
                {hasSyncedEver
                  ? 'Sync again to pull in your latest events and analyse your weekly load.'
                  : 'Sync your Google and Apple calendars to start analysing your weekly load.'}
              </p>
            </div>
            <Button onClick={handleSync} disabled={isProcessing} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl px-8 h-12 font-black text-xs uppercase tracking-widest">
              <RefreshCw size={16} className={cn('mr-2', isProcessing && 'animate-spin')} /> Sync Calendars
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-6 pb-24">
          {/* "Right Now" banner — live awareness for ADHD timeblindness */}
          {(todayInfo.currentEvent || todayInfo.nextEvent) && (
            <div className="bg-white rounded-2xl border border-indigo-100 shadow-sm overflow-hidden">
              <div className="p-4 flex items-center gap-4">
                <div className={cn(
                  'w-12 h-12 rounded-xl flex items-center justify-center shrink-0',
                  todayInfo.currentEvent ? 'bg-green-100 text-green-600' : 'bg-indigo-50 text-indigo-500'
                )}>
                  {todayInfo.currentEvent ? (
                    <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                  ) : (
                    <Clock size={20} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {todayInfo.currentEvent ? (
                    <div>
                      <p className="text-[9px] font-black text-green-600 uppercase tracking-widest mb-0.5">Happening now</p>
                      <p className="font-black text-gray-900 text-sm truncate">{todayInfo.currentEvent.title}</p>
                      <p className="text-xs font-medium text-gray-500">
                        Ends {format(parseISO(todayInfo.currentEvent.end_time), 'h:mm a')}
                        {' · '}
                        {Math.max(0, Math.round((parseISO(todayInfo.currentEvent.end_time).getTime() - now.getTime()) / 60000))}m left
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-0.5">Up next today</p>
                      <p className="font-black text-gray-900 text-sm truncate">{todayInfo.nextEvent.title}</p>
                      <p className="text-xs font-medium text-gray-500">
                        {format(parseISO(todayInfo.nextEvent.start_time), 'h:mm a')}
                        {' · starts in '}
                        {Math.max(0, Math.round((parseISO(todayInfo.nextEvent.start_time).getTime() - now.getTime()) / 60000))}m
                      </p>
                    </div>
                  )}
                </div>
                {celebrationStreak.count > 2 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 rounded-full shrink-0">
                    <Sparkles size={12} className="text-amber-500" />
                    <span className="text-[9px] font-black text-amber-600 uppercase tracking-widest">
                      {celebrationStreak.count}w streak
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Summary stat cards + Today's Load */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Gauge} label="Avg hrs / week" value={summary ? `${summary.avg}` : '0'} accent="indigo" />
            {/* "Today's Load" — live progress for ADHD timeblindness */}
            <StatCard
              icon={Clock}
              label="Today's load"
              value={`${Math.round(todayInfo.todayTotalHours * 10) / 10}h`}
              sub={threshold > 0 ? `of ${Math.round(threshold / 7)}h daily` : ''}
              accent={todayInfo.todayTotalHours > threshold / 7 ? 'amber' : 'green'}
            />
            <StatCard icon={AlertTriangle} label="Weeks over limit" value={summary ? `${summary.overThreshold.length}` : '0'} sub={`limit ${threshold}h`} accent={summary && summary.overThreshold.length > 0 ? 'red' : 'green'} />
            <StatCard icon={CalendarClock} label="Working weeks" value={summary ? `${summary.workWeekCount}` : '0'} sub={summary ? `of ${summary.weekCount}` : ''} accent="purple" />
          </div>

          {/* Overwork verdict */}
          {overworkVerdict && (
            <Card className={cn(
              'border-none shadow-sm rounded-2xl overflow-hidden',
              overworkVerdict.tone === 'warn' ? 'bg-red-50' : overworkVerdict.tone === 'info' ? 'bg-amber-50' : 'bg-green-50'
            )}>
              <CardContent className="p-5 flex items-center gap-4">
                <div className={cn(
                  'w-11 h-11 rounded-xl flex items-center justify-center shrink-0',
                  overworkVerdict.tone === 'warn' ? 'bg-red-100 text-red-600' : overworkVerdict.tone === 'info' ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'
                )}>
                  {overworkVerdict.tone === 'warn' ? <AlertTriangle size={22} /> : overworkVerdict.tone === 'info' ? <Gauge size={22} /> : <ShieldCheck size={22} />}
                </div>
                <div className="space-y-0.5">
                  <h3 className="text-lg font-black text-gray-900 tracking-tight">{overworkVerdict.headline}</h3>
                  <p className="text-gray-600 font-medium leading-snug text-sm">{overworkVerdict.detail}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {viewMode === 'calendar' ? (
            /* Calendar view — week cards with day columns showing slotted appointments */
            <Card className="border-none shadow-sm rounded-[2.5rem] bg-white overflow-hidden">
              <CardHeader className="flex flex-row items-start justify-between gap-4 p-8 pb-4">
                <div>
                  <CardTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                    <CalendarClock size={20} className="text-indigo-600" /> Calendar
                  </CardTitle>
                  <CardDescription className="font-medium">
                    {visibleWeeks.length > 0
                      ? `${visibleWeeks[0].rangeLabel} – ${visibleWeeks[visibleWeeks.length - 1].rangeLabel}`
                      : 'Observation view — appointments at a glance.'}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                  <div className="flex items-center bg-gray-50 rounded-full p-1 gap-0.5">
                    {WEEK_RANGE_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setWeekRange(opt)}
                        className={cn(
                          'px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all',
                          weekRange === opt ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
                        )}
                      >
                        {opt === 1 ? 'This Wk' : `${opt}w`}
                      </button>
                    ))}
                  </div>
                  {summary && (
                    <div className={cn(
                      'px-4 py-2 rounded-full font-black text-xs uppercase tracking-widest shrink-0',
                      summary.avg >= threshold ? 'bg-green-50 text-green-600' : 'bg-indigo-50 text-indigo-600'
                    )}>
                      Avg {summary.avg}h / {threshold}h
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-8 pt-2">
                <WeekCalendarView
                  weeks={visibleWeeks}
                  events={events}
                  categoriesByEvent={categoriesByEvent}
                  threshold={threshold}
                  blockedWeeks={blockedWeeks}
                  onToggleBlocked={handleToggleBlocked}
                />
              </CardContent>
            </Card>
          ) : viewMode === 'dayoff' ? (
            /* Day Off Suggester — analyses each week and suggests the best day to protect */
            <Card className="border-none shadow-sm rounded-[2.5rem] bg-white overflow-hidden">
              <CardHeader className="flex flex-row items-start justify-between gap-4 p-8 pb-4">
                <div>
                  <CardTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                    <CalendarHeart size={20} className="text-indigo-600" /> Day Off Suggester
                  </CardTitle>
                  <CardDescription className="font-medium">
                    {visibleWeeks.length > 0
                      ? `${visibleWeeks[0].rangeLabel} – ${visibleWeeks[visibleWeeks.length - 1].rangeLabel}`
                      : 'Find the best day to protect each week.'}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                  <div className="flex items-center bg-gray-50 rounded-full p-1 gap-0.5">
                    {WEEK_RANGE_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setWeekRange(opt)}
                        className={cn(
                          'px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all',
                          weekRange === opt ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
                        )}
                      >
                        {opt === 1 ? 'This Wk' : `${opt}w`}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-8 pt-2">
                <DayOffSuggester
                  weeks={visibleWeeks}
                  events={events}
                  categoriesByEvent={categoriesByEvent}
                  threshold={threshold}
                  onDayOffCreated={() => loadData()}
                />
              </CardContent>
            </Card>
          ) : (
            <>
          {/* Weekly stacked chart */}
          <Card className="border-none shadow-sm rounded-[2rem] bg-white overflow-hidden">
            <CardHeader className="flex flex-row items-start justify-between gap-4 p-6 pb-4">
              <div>
                <CardTitle className="text-lg font-black tracking-tight flex items-center gap-2">
                  <Layers size={18} className="text-indigo-600" /> Weekly hours by type
                </CardTitle>
                <CardDescription className="font-medium text-xs">Stacked by category, Monday–Sunday weeks.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-gray-50 rounded-full p-0.5 gap-0.5">
                  {WEEK_RANGE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setWeekRange(opt)}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest transition-all',
                        weekRange === opt ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
                      )}
                    >
                      {opt === 1 ? '1wk' : `${opt}w`}
                    </button>
                  ))}
                </div>
                <Switch id="buffers" checked={includeBuffers} onCheckedChange={setIncludeBuffers} className="h-4 w-8" />
                <Label htmlFor="buffers" className="text-[8px] font-black text-gray-400 uppercase tracking-widest cursor-pointer">Buffers</Label>
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-2">
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 800 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 800 }} unit="h" />
                    <ReferenceLine
                      x={chartData.find((d) => {
                        const ws = startOfWeek(new Date(), { weekStartsOn: 1 });
                        return d.label === format(ws, 'MMM d');
                      })?.label || ''}
                      stroke="#6366F1"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      label={{ value: 'Now', position: 'top', fill: '#6366F1', fontSize: 10, fontWeight: 800 }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(79,70,229,0.05)' }}
                      contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '12px' }}
                      formatter={(value: unknown, name: unknown) => [`${value}h`, CATEGORY_META[name as AppointmentCategory]?.label || String(name)]}
                    />
                    <Legend formatter={(value) => <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{CATEGORY_META[value as AppointmentCategory]?.label || value}</span>} />
                    {CATEGORY_ORDER.filter((c) => includeBuffers || CATEGORY_META[c].countsAsWork).map((c, idx, arr) => (
                      <Bar key={c} dataKey={c} stackId="hours" fill={CATEGORY_META[c].color} radius={idx === arr.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {summary && summary.overThreshold.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {summary.overThreshold.map((w) => (
                    <Badge key={w.label} className="bg-red-50 text-red-600 border border-red-100 rounded-full text-[10px] font-black uppercase tracking-widest">
                      {w.label}: {w.totalWorkHours}h
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Week-by-week progress cards */}
          <Card className="border-none shadow-sm rounded-[2rem] bg-white overflow-hidden">
            <CardHeader className="flex flex-row items-start justify-between gap-4 p-6 pb-4">
              <div>
                <CardTitle className="text-lg font-black tracking-tight flex items-center gap-2">
                  <Target size={18} className="text-indigo-600" /> Weekly progress
                </CardTitle>
                <CardDescription className="font-medium text-xs">
                  {visibleWeeks.length > 0
                    ? `${visibleWeeks[0].rangeLabel} – ${visibleWeeks[visibleWeeks.length - 1].rangeLabel}`
                    : 'Aiming for your weekly goal.'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-3 flex-wrap justify-end">
                <div className="flex items-center bg-gray-50 rounded-full p-1 gap-0.5">
                  {WEEK_RANGE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setWeekRange(opt)}
                      className={cn(
                        'px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all',
                        weekRange === opt ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'
                      )}
                    >
                      {opt === 1 ? 'This Wk' : `${opt}w`}
                    </button>
                  ))}
                </div>
                {summary && (
                  <div className={cn(
                    'px-4 py-2 rounded-full font-black text-xs uppercase tracking-widest shrink-0',
                    summary.avg >= threshold ? 'bg-green-50 text-green-600' : 'bg-indigo-50 text-indigo-600'
                  )}>
                    Avg {summary.avg}h / {threshold}h
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-2 space-y-3">
              {visibleWeeks.length === 0 ? (
                <p className="text-gray-400 font-black uppercase tracking-widest text-xs text-center py-12">No weeks to show</p>
              ) : (
                visibleWeeks.map((w) => {
                  const over = w.totalWorkHours > threshold;
                  const near = !over && w.pctOfGoal >= 75;
                  const workCats = w.categoriesPresent.filter((c) => CATEGORY_META[c].countsAsWork);
                  const isCurrentWeek = isWithinInterval(new Date(), { start: w.weekStart, end: w.weekEnd });
                  return (
                    <div
                      key={w.label}
                      className={cn(
                        'rounded-2xl border-2 p-5 transition-all hover:shadow-md',
                        isCurrentWeek
                          ? 'border-indigo-500 bg-indigo-50/40 shadow-sm shadow-indigo-100'
                          : over
                            ? 'bg-red-50/40 border-red-100'
                            : near
                              ? 'bg-amber-50/40 border-amber-100'
                              : 'bg-gray-50/40 border-gray-100'
                      )}
                    >
                      {/* Week header row */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          {isCurrentWeek && <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />}
                          <h4 className="font-black text-gray-900 tracking-tight text-sm">{w.rangeLabel}</h4>
                          {isCurrentWeek && (
                            <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[8px] font-black uppercase tracking-widest">
                              This Week
                            </span>
                          )}
                          {!isCurrentWeek && w.totalWorkHours > 0 && w.totalWorkHours <= threshold && (
                            <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[8px] font-black uppercase tracking-widest flex items-center gap-1">
                              <Sparkles size={10} /> Under goal
                            </span>
                          )}
                          {w.hasDayOff && (
                            <span className="text-[9px] font-black text-green-600 bg-green-50 px-2 py-0.5 rounded-full uppercase tracking-widest">Day off</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest">
                          <span className="text-gray-400">{w.eventCount} appts</span>
                          <span className={cn(over ? 'text-red-600' : near ? 'text-amber-600' : 'text-gray-700')}>
                            {w.totalWorkHours}h load
                          </span>
                        </div>
                      </div>

                      {/* Workload bar */}
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest w-16 shrink-0">Workload</span>
                        <div className="flex-1 h-6 rounded-lg bg-gray-100 overflow-hidden relative">
                          {/* Stacked category segments */}
                          <div className="flex h-full">
                            {CATEGORY_ORDER.filter((c) => CATEGORY_META[c].countsAsWork).map((c) => {
                              const hrs = w.byCategory[c];
                              if (hrs <= 0) return null;
                              const segPct = (hrs / threshold) * 100;
                              return (
                                <div
                                  key={c}
                                  className="h-full transition-all"
                                  style={{ width: `${Math.min(segPct, 100)}%`, backgroundColor: CATEGORY_META[c].color }}
                                  title={`${CATEGORY_META[c].label}: ${Math.round(hrs * 10) / 10}h`}
                                />
                              );
                            })}
                          </div>
                          {/* Goal marker line */}
                          <div className="absolute top-0 bottom-0 w-0.5 bg-gray-900/30" style={{ left: '100%', transform: 'translateX(-1px)' }} />
                        </div>
                        <span className={cn('text-xs font-black w-20 text-right shrink-0', over ? 'text-red-600' : 'text-gray-900')}>
                          {w.totalWorkHours}h / {threshold}h
                        </span>
                      </div>

                      {/* Category chips — hover to see appointments */}
                      {workCats.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {workCats.map((c) => {
                            const hrs = w.byCategory[c];
                            if (hrs <= 0) return null;
                            const eventList = getEventsForCategory(w.label, c);
                            return (
                              <Popover key={c}>
                                <PopoverTrigger asChild>
                                  <span
                                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest cursor-help transition-all hover:scale-105"
                                    style={{ backgroundColor: `${CATEGORY_META[c].color}15`, color: CATEGORY_META[c].color }}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CATEGORY_META[c].color }} />
                                    {CATEGORY_META[c].label} {Math.round(hrs * 10) / 10}h
                                  </span>
                                </PopoverTrigger>
                                <PopoverContent className="w-72 rounded-2xl border-none shadow-2xl p-4" side="top">
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_META[c].color }} />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-700">
                                      {CATEGORY_META[c].label} — {eventList.length} appt{eventList.length !== 1 ? 's' : ''}
                                    </p>
                                  </div>
                                  {eventList.length === 0 ? (
                                    <p className="text-xs text-gray-400">No events</p>
                                  ) : (
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                      {eventList.map((ev, i) => (
                                        <div key={i} className="text-xs">
                                          <p className="font-bold text-gray-800 truncate">{ev.title}</p>
                                          <p className="text-gray-400 font-medium">{ev.timeLabel} · {ev.durationLabel}</p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </PopoverContent>
                              </Popover>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* By type — horizontal bars */}
            <Card className="border-none shadow-sm rounded-[2.5rem] bg-white overflow-hidden">
              <CardHeader className="p-8 pb-4">
                <CardTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                  <TrendingUp size={20} className="text-indigo-600" /> Total hours by type
                </CardTitle>
                <CardDescription className="font-medium">Across all synced weeks.</CardDescription>
              </CardHeader>
              <CardContent className="p-8 pt-2">
                {typeTotals.length === 0 ? (
                  <p className="text-gray-400 font-black uppercase tracking-widest text-xs text-center py-12">No work hours recorded</p>
                ) : (
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={typeTotals} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F3F4F6" />
                        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 800 }} unit="h" />
                        <YAxis type="category" dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#4B5563', fontSize: 10, fontWeight: 800 }} width={150} />
                        <Tooltip
                          cursor={{ fill: 'rgba(79,70,229,0.05)' }}
                          contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '12px' }}
                          formatter={(value: unknown) => [`${value}h`, 'Hours']}
                        />
                        <Bar dataKey="hours" radius={[0, 8, 8, 0]}>
                          {typeTotals.map((t) => (
                            <Cell key={t.category} fill={t.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Weekly goal control */}
            <Card className="border-none shadow-sm rounded-[2.5rem] bg-white overflow-hidden">
              <CardHeader className="p-8 pb-4">
                <CardTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                  <Target size={20} className="text-indigo-600" /> Weekly goal
                </CardTitle>
                <CardDescription className="font-medium">Adjust to match your energy capacity.</CardDescription>
              </CardHeader>
              <CardContent className="p-8 pt-2 space-y-6">
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-5xl font-black text-indigo-600">{threshold}</span>
                    <span className="text-sm font-black text-gray-400 uppercase tracking-widest ml-2">hrs / week</span>
                  </div>
                  {summary && (
                    <div className="text-right">
                      <p className={cn('text-2xl font-black', summary.avg >= threshold ? 'text-green-600' : 'text-gray-300')}>
                        {Math.round(summary.avg / threshold * 100)}%
                      </p>
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">of goal</p>
                    </div>
                  )}
                </div>
                <Slider value={[threshold]} onValueChange={(v) => setThreshold(v[0])} min={5} max={40} step={1} className="py-2" />
                <div className="flex justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  <span>5h</span><span>20h</span><span>40h</span>
                </div>
                <div className="flex gap-2">
                  {[20, 25, 30, 35].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setThreshold(preset)}
                      className={cn(
                        'flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all',
                        threshold === preset ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                      )}
                    >
                      {preset}h
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recommendations */}
          <Card className="border-none shadow-sm rounded-[2.5rem] bg-white overflow-hidden">
            <CardHeader className="p-8 pb-4">
              <CardTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                <Lightbulb size={20} className="text-indigo-600" /> Recommendations
              </CardTitle>
              <CardDescription className="font-medium">Buffers, booking limits and day-template suggestions to reduce code-switching.</CardDescription>
            </CardHeader>
            <CardContent className="p-8 pt-2 space-y-4">
              {recommendations.map((r, i) => (
                <div key={i} className={cn(
                  'flex items-start gap-4 p-5 rounded-2xl border',
                  r.tone === 'warn' ? 'bg-red-50/60 border-red-100' : r.tone === 'info' ? 'bg-amber-50/60 border-amber-100' : 'bg-green-50/60 border-green-100'
                )}>
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                    r.tone === 'warn' ? 'bg-red-100 text-red-600' : r.tone === 'info' ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'
                  )}>
                    <r.icon size={20} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-black text-gray-900 tracking-tight">{r.title}</h4>
                    <p className="text-sm text-gray-600 font-medium leading-relaxed">{r.body}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Navigation CTAs — page-to-page links */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => navigate('/plan')}
              className="p-6 rounded-[2rem] bg-gradient-to-br from-indigo-600 to-indigo-800 text-white text-left space-y-3 shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all group"
            >
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md">
                <Brain size={20} />
              </div>
              <div>
                <p className="font-black text-sm tracking-tight">Daily Plan</p>
                <p className="text-indigo-100 font-medium text-xs opacity-80">Vet tasks and generate your daily schedule.</p>
              </div>
              <ArrowRight size={16} className="opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
            </button>

            <button
              onClick={() => navigate('/vet')}
              className="p-6 rounded-[2rem] bg-white border border-gray-100 text-left space-y-3 shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all group"
            >
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                <CheckSquare size={20} />
              </div>
              <div>
                <p className="font-black text-sm text-gray-900 tracking-tight">Vet Tasks</p>
                <p className="text-gray-500 font-medium text-xs">Lock your essential appointments.</p>
              </div>
              <ArrowRight size={16} className="text-indigo-400 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
            </button>

            <button
              onClick={() => navigate('/optimise')}
              className="p-6 rounded-[2rem] bg-white border border-gray-100 text-left space-y-3 shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all group"
            >
              <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center text-purple-600">
                <Sparkles size={20} />
              </div>
              <div>
                <p className="font-black text-sm text-gray-900 tracking-tight">Optimiser</p>
                <p className="text-gray-500 font-medium text-xs">Let AI reshuffle your day for peak focus.</p>
              </div>
              <ArrowRight size={16} className="text-purple-400 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
            </button>
          </div>
            </>
          )}
        </div>
      )}

      <ClipboardImporter
        isOpen={showImporter}
        onClose={() => setShowImporter(false)}
        onCreated={() => loadData()}
      />
    </Layout>
  );
};

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  accent: 'indigo' | 'amber' | 'red' | 'green' | 'purple';
}

const StatCard = ({ icon: Icon, label, value, sub, accent }: StatCardProps) => {
  const accents: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', accents[accent])}>
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest leading-tight">{label}</p>
          <div className="flex items-baseline gap-1">
            <h3 className="text-xl font-black text-gray-900 leading-none">{value}</h3>
            {sub && <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{sub}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default Energy;
