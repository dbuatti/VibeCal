"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { parseISO, isBefore, isAfter } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Button } from '@/components/ui/button';
import { 
  RefreshCw, 
  Zap, 
  Trophy, 
  LayoutDashboard, 
  RotateCcw, 
  Calendar as CalendarIcon,
  Wand2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import VisualSchedule from './VisualSchedule';
import PlannerStats from './PlannerStats';
import PlannerChanges from './PlannerChanges';
import PlannerHeader from '@/components/PlannerHeader';
import { Link } from 'react-router-dom';
import { DateRange } from "react-day-picker";

interface DayByDayPlannerProps {
  events: any[];
  changes: any[];
  appliedChanges: string[];
  onApplyDay: (dateChanges: any[]) => Promise<any>;
  onUndoApplyDay: (dateChanges: any[]) => Promise<any>;
  onUndoAndResuggestDay?: (dateChanges: any[]) => Promise<any>;
  onResuggestDay?: () => Promise<void>;
  onReinsertTask?: (eventId: string, targetDateStr: string) => Promise<void>;
  maxHours: number;
  maxTasks: number;
  workKeywords?: string[];
  selectedDays?: number[];
  dateRange?: DateRange;
}

const DayByDayPlanner = ({
  events,
  changes,
  appliedChanges,
  onApplyDay,
  onUndoApplyDay,
  onUndoAndResuggestDay,
  onResuggestDay,
  onReinsertTask,
  maxHours,
  maxTasks,
  workKeywords = ['work', 'session', 'meeting', 'call', 'rehearsal', 'lesson', 'audition', 'coaching', 'appt', 'program', 'ceremony', 'gig', 'meetup', 'planning', 'workshop', 'presentation'],
  selectedDays = [1, 2, 3, 4, 5],
  dateRange
}: DayByDayPlannerProps) => {
  const timezone = 'Australia/Melbourne';

  const allDates = useMemo(() => {
    const dates = new Set<string>();
    const todayStr = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');

    changes.forEach(c => {
      if (c.new_start) {
        const newDate = formatInTimeZone(parseISO(c.new_start), timezone, 'yyyy-MM-dd');
        if (newDate >= todayStr) dates.add(newDate);
      }
      
      if (c.old_start) {
        const oldDate = formatInTimeZone(parseISO(c.old_start), timezone, 'yyyy-MM-dd');
        if (oldDate >= todayStr) dates.add(oldDate);
      }
    });

    events.filter(e => e.is_locked && e.start_time).forEach(e => {
      const date = formatInTimeZone(parseISO(e.start_time), timezone, 'yyyy-MM-dd');
      if (date >= todayStr) dates.add(date);
    });

    return Array.from(dates).sort();
  }, [changes, events]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isResuggesting, setIsResuggesting] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [showXP, setShowXP] = useState(false);
  const [hasAutoDefaulted, setHasAutoDefaulted] = useState(false);
  
  const currentDateStr = allDates[currentIndex];
  const currentDate = currentDateStr ? parseISO(currentDateStr) : new Date();

  const dayChanges = useMemo(() => {
    return changes.filter(c =>
      (c.new_start && formatInTimeZone(parseISO(c.new_start), timezone, 'yyyy-MM-dd') === currentDateStr) ||
      (c.old_start && formatInTimeZone(parseISO(c.old_start), timezone, 'yyyy-MM-dd') === currentDateStr)
    );
  }, [changes, currentDateStr]);

  const dayLockedEvents = useMemo(() => {
    return events.filter(e => e.is_locked && e.start_time && formatInTimeZone(parseISO(e.start_time), timezone, 'yyyy-MM-dd') === currentDateStr);
  }, [events, currentDateStr]);

  const isDayVetted = useMemo(() => {
    if (dayChanges.length > 0) {
      return dayChanges.every(c => appliedChanges.includes(c.event_id));
    }
    
    const dayOfWeek = parseInt(formatInTimeZone(currentDate, timezone, 'e')) - 1;
    if (!selectedDays.includes(dayOfWeek)) return true;
    
    return false;
  }, [dayChanges, appliedChanges, currentDate, selectedDays]);

  const isLoadEvent = (event: any) => {
    const title = (event.title || '').toLowerCase();
    return !title.includes('lunch') && !title.includes('dinner') && !title.includes('break');
  };

  useEffect(() => {
    if (!hasAutoDefaulted && allDates.length > 0) {
      const todayStr = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
      const firstUnvettedIndex = allDates.findIndex(dateStr => {
        if (dateStr < todayStr) return false;
        const dayChangesForDate = changes.filter(c =>
          (c.new_start && formatInTimeZone(parseISO(c.new_start), timezone, 'yyyy-MM-dd') === dateStr) ||
          (c.old_start && formatInTimeZone(parseISO(c.old_start), timezone, 'yyyy-MM-dd') === dateStr)
        );
        return dayChangesForDate.length > 0 && !dayChangesForDate.every(c => appliedChanges.includes(c.event_id));
      });
      
      if (firstUnvettedIndex !== -1) {
        setCurrentIndex(firstUnvettedIndex);
      } else {
        const todayIndex = allDates.findIndex(d => d >= todayStr);
        if (todayIndex !== -1) setCurrentIndex(todayIndex);
      }
      setHasAutoDefaulted(true);
    }
  }, [allDates, changes, appliedChanges, hasAutoDefaulted]);

  useEffect(() => {
    if (dateRange?.from && allDates.length > 0) {
      const rangeStartStr = formatInTimeZone(dateRange.from, timezone, 'yyyy-MM-dd');
      const rangeStartIndex = allDates.findIndex(d => d >= rangeStartStr);
      if (rangeStartIndex !== -1) {
        setCurrentIndex(rangeStartIndex);
      }
    }
  }, [dateRange, allDates]);

  const stats = useMemo(() => {
    const changedIds = new Set(changes.map(c => c.event_id));
    
    const eventsOnThisDay = [
      ...dayLockedEvents.filter(e => !changedIds.has(e.event_id)),
      ...changes.filter(c => c.new_start && formatInTimeZone(parseISO(c.new_start), timezone, 'yyyy-MM-dd') === currentDateStr && !c.is_surplus)
    ];

    const fixedLoadEvents = dayLockedEvents
      .filter(e => !changedIds.has(e.event_id) && isLoadEvent(e))
      .sort((a, b) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime());

    const shuffledLoadEvents = changes
      .filter(c => c.new_start && formatInTimeZone(parseISO(c.new_start), timezone, 'yyyy-MM-dd') === currentDateStr && !c.is_surplus && isLoadEvent(c))
      .sort((a, b) => parseISO(a.new_start).getTime() - parseISO(b.new_start).getTime());

    const calculateTotalMinutes = (loadEvents: any[]) => {
      let totalMinutes = 0;
      let lastEnd = new Date(0);
      loadEvents.forEach(e => {
        const startStr = e.start_time || e.new_start;
        const endStr = e.end_time || e.new_end;
        if (!startStr || !endStr) return;

        const start = parseISO(startStr);
        const end = parseISO(endStr);
        if (isAfter(end, lastEnd)) {
          const effectiveStart = isBefore(start, lastEnd) ? lastEnd : start;
          totalMinutes += (end.getTime() - effectiveStart.getTime()) / 60000;
          lastEnd = end;
        }
      });
      return totalMinutes;
    };

    const fixedLoadMinutes = calculateTotalMinutes(fixedLoadEvents);
    const shuffledLoadMinutes = calculateTotalMinutes(shuffledLoadEvents);
    const totalLoadMinutes = fixedLoadMinutes + shuffledLoadMinutes;

    const taskEvents = eventsOnThisDay.filter(isLoadEvent);

    return {
      tasks: taskEvents.length,
      fixedHours: fixedLoadMinutes / 60,
      shuffledHours: shuffledLoadMinutes / 60,
      hours: totalLoadMinutes / 60,
      isOverTasks: taskEvents.length > maxTasks,
      isOverHours: (totalLoadMinutes / 60) > maxHours
    };
  }, [dayLockedEvents, changes, currentDateStr, maxTasks, maxHours]);

  const handleSyncDay = async () => {
    setIsSyncing(true);
    try {
      await onApplyDay(dayChanges);
      setShowXP(true);
      setTimeout(() => setShowXP(false), 2000);
      if (currentIndex === allDates.length - 1) setTimeout(() => setIsFinished(true), 800);
      else setTimeout(() => setCurrentIndex(prev => prev + 1), 600);
    } finally { setIsSyncing(false); }
  };

  const handleUndoDay = async () => {
    setIsSyncing(true);
    try { await onUndoApplyDay(dayChanges); }
    finally { setIsSyncing(false); }
  };

  const handleResuggest = async () => {
    if (!onResuggestDay) return;
    setIsResuggesting(true);
    try { await onResuggestDay(); } 
    finally { setIsResuggesting(false); }
  };

  const handleUndoAndResuggest = async () => {
    if (!onUndoAndResuggestDay) return;
    setIsSyncing(true);
    try {
      await onUndoAndResuggestDay(dayChanges);
    } finally { setIsSyncing(false); }
  };

  const handleReinsert = async (eventId: string) => {
    if (onReinsertTask && currentDateStr) {
      await onReinsertTask(eventId, currentDateStr);
    }
  };

  if (isFinished) {
    return (
      <div className="max-w-md mx-auto text-center py-16 animate-in zoom-in-95 duration-500">
        <Trophy className="text-green-600 mx-auto mb-6" size={48} />
        <h2 className="text-3xl font-black text-gray-900 mb-4 tracking-tight">Complete!</h2>
        <div className="grid grid-cols-2 gap-4">
          <Link to="/"><Button className="w-full bg-indigo-600 py-6 font-black rounded-xl"><LayoutDashboard className="mr-2" size={18} /> Dashboard</Button></Link>
          <Button variant="outline" onClick={() => setIsFinished(false)} className="rounded-xl py-6 font-black">Review</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <PlannerHeader 
        currentIndex={currentIndex}
        totalDays={allDates.length}
        currentDate={currentDate}
        isDayVetted={isDayVetted}
        hasChanges={dayChanges.length > 0}
        isResuggesting={isResuggesting}
        showXP={showXP}
        onPrev={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
        onNext={() => setCurrentIndex(prev => Math.min(allDates.length - 1, prev + 1))}
        onResuggest={handleResuggest}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="space-y-6">
          <PlannerStats
            fixedHours={stats.fixedHours}
            shuffledHours={stats.shuffledHours}
            maxHours={maxHours}
            tasks={stats.tasks}
            maxTasks={maxTasks}
            isOverHours={stats.isOverHours}
            isOverTasks={stats.isOverTasks}
          />

          <PlannerChanges 
            dayChanges={dayChanges} 
            appliedChanges={appliedChanges} 
            currentDateStr={currentDateStr} 
            isOverCapacity={stats.isOverTasks || stats.isOverHours} 
            onReinsert={handleReinsert}
          />

          <div className="space-y-3">
            {dayChanges.length === 0 ? (
              <div className="space-y-3">
                <Button disabled className="w-full bg-gray-100 text-gray-400 rounded-2xl py-8 text-lg font-black cursor-not-allowed">
                  No Sync Required
                </Button>
                {onResuggestDay && selectedDays.includes(parseInt(formatInTimeZone(currentDate, timezone, 'e')) - 1) && (
                  <Button onClick={handleResuggest} disabled={isResuggesting} variant="ghost" className="w-full rounded-2xl py-4 text-xs font-black uppercase tracking-widest text-indigo-600 hover:bg-indigo-50">
                    {isResuggesting ? <RefreshCw className="animate-spin mr-2" size={14} /> : <><Wand2 className="mr-2" size={14} /> Resuggest Tasks</>}
                  </Button>
                )}
              </div>
            ) : isDayVetted ? (
              <div className="space-y-3">
                <Button onClick={handleUndoDay} disabled={isSyncing} variant="outline" className="w-full rounded-2xl py-8 text-lg font-black border-gray-100 text-gray-400">
                  {isSyncing ? <RefreshCw className="animate-spin mr-2" size={20} /> : <><RotateCcw className="mr-2" size={20} /> Undo</>}
                </Button>
                {onUndoAndResuggestDay && (
                  <Button onClick={handleUndoAndResuggest} disabled={isSyncing} variant="ghost" className="w-full rounded-2xl py-4 text-xs font-black uppercase tracking-widest text-indigo-600 hover:bg-indigo-50">
                    {isSyncing ? <RefreshCw className="animate-spin mr-2" size={14} /> : <><Wand2 className="mr-2" size={14} /> Undo & Resuggest</>}
                  </Button>
                )}
              </div>
            ) : (
              <Button onClick={handleSyncDay} disabled={isSyncing} className="w-full bg-indigo-600 text-white rounded-2xl py-8 text-lg font-black shadow-xl">
                {isSyncing ? <RefreshCw className="animate-spin mr-2" size={20} /> : <><Zap className="mr-2" size={20} /> Sync Day</>}
              </Button>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="flex items-center gap-3 mb-4 px-2">
            <CalendarIcon className="text-indigo-600" size={20} />
            <h3 className="text-lg font-black text-gray-900 tracking-tight">Visual Map</h3>
          </div>
          <VisualSchedule
            events={events.filter(e => e.start_time && formatInTimeZone(parseISO(e.start_time), timezone, 'yyyy-MM-dd') === currentDateStr)}
            changes={dayChanges.filter(c => c.new_start && formatInTimeZone(parseISO(c.new_start), timezone, 'yyyy-MM-dd') === currentDateStr)}
            appliedChanges={appliedChanges}
            isVetted={isDayVetted}
            workKeywords={workKeywords}
            timezone={timezone}
          />
        </div>
      </div>
    </div>
  );
};

export default DayByDayPlanner;