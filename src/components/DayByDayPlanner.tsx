"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { format, parseISO, isBefore, isAfter } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  ListOrdered, 
  Sparkles, 
  RefreshCw, 
  Zap, 
  Trophy, 
  LayoutDashboard, 
  RotateCcw, 
  ArrowUpRight,
  Calendar as CalendarIcon,
  Wand2,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import VisualSchedule from './VisualSchedule';
import { Link } from 'react-router-dom';

interface DayByDayPlannerProps {
  events: any[];
  changes: any[];
  appliedChanges: string[];
  onApplyDay: (dateChanges: any[]) => Promise<void>;
  onUndoApplyDay: (dateChanges: any[]) => Promise<void>;
  onResuggestDay?: () => Promise<void>;
  maxHours: number;
  maxTasks: number;
  workKeywords?: string[];
}

const DayByDayPlanner = ({ 
  events, 
  changes, 
  appliedChanges, 
  onApplyDay, 
  onUndoApplyDay,
  onResuggestDay,
  maxHours, 
  maxTasks,
  workKeywords = ['work', 'session', 'meeting', 'call', 'rehearsal', 'lesson', 'audition', 'coaching', 'appt', 'program', 'ceremony']
}: DayByDayPlannerProps) => {
  const allDates = useMemo(() => {
    const dates = new Set<string>();
    changes.forEach(c => {
      dates.add(format(parseISO(c.new_start), 'yyyy-MM-dd'));
      dates.add(format(parseISO(c.old_start), 'yyyy-MM-dd'));
    });
    events.filter(e => e.is_locked).forEach(e => dates.add(format(parseISO(e.start_time), 'yyyy-MM-dd')));
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
      format(parseISO(c.new_start), 'yyyy-MM-dd') === currentDateStr ||
      format(parseISO(c.old_start), 'yyyy-MM-dd') === currentDateStr
    );
  }, [changes, currentDateStr]);

  const dayLockedEvents = useMemo(() => {
    return events.filter(e => e.is_locked && format(parseISO(e.start_time), 'yyyy-MM-dd') === currentDateStr);
  }, [events, currentDateStr]);

  const isDayVetted = useMemo(() => {
    if (dayChanges.length === 0) return true;
    return dayChanges.every(c => appliedChanges.includes(c.event_id));
  }, [dayChanges, appliedChanges]);

  const isWorkEvent = (event: any) => {
    if (event.is_work === true) return true;
    const title = (event.title || '').toLowerCase();
    return workKeywords.some(kw => title.includes(kw.toLowerCase()));
  };

  useEffect(() => {
    if (!hasAutoDefaulted && allDates.length > 0) {
      const firstUnvettedIndex = allDates.findIndex(dateStr => {
        const dayChangesForDate = changes.filter(c => 
          format(parseISO(c.new_start), 'yyyy-MM-dd') === dateStr ||
          format(parseISO(c.old_start), 'yyyy-MM-dd') === dateStr
        );
        return dayChangesForDate.length > 0 && !dayChangesForDate.every(c => appliedChanges.includes(c.event_id));
      });
      if (firstUnvettedIndex !== -1) setCurrentIndex(firstUnvettedIndex);
      setHasAutoDefaulted(true);
    }
  }, [allDates, changes, appliedChanges, hasAutoDefaulted]);

  const stats = useMemo(() => {
    const eventsOnThisDay = [
      ...dayLockedEvents,
      ...changes.filter(c => format(parseISO(c.new_start), 'yyyy-MM-dd') === currentDateStr && !c.is_surplus)
    ];

    const workEvents = eventsOnThisDay
      .filter(e => isWorkEvent(e))
      .sort((a, b) => parseISO(a.start_time || a.new_start).getTime() - parseISO(b.start_time || b.new_start).getTime());

    let totalWorkMinutes = 0;
    let lastEnd = new Date(0);
    workEvents.forEach(e => {
      const start = parseISO(e.start_time || e.new_start);
      const end = parseISO(e.end_time || e.new_end);
      if (isAfter(end, lastEnd)) {
        const effectiveStart = isBefore(start, lastEnd) ? lastEnd : start;
        totalWorkMinutes += (end.getTime() - effectiveStart.getTime()) / 60000;
        lastEnd = end;
      }
    });

    const taskEvents = eventsOnThisDay.filter(e => !e.title?.toLowerCase().includes('lunch') && !e.title?.toLowerCase().includes('break'));

    return {
      tasks: taskEvents.length,
      hours: totalWorkMinutes / 60,
      isOverTasks: taskEvents.length > maxTasks,
      isOverHours: (totalWorkMinutes / 60) > maxHours
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
    try {
      await onResuggestDay();
    } finally {
      setIsResuggesting(false);
    }
  };

  const handleUndoAndResuggest = async () => {
    setIsSyncing(true);
    try {
      await onUndoApplyDay(dayChanges);
      if (onResuggestDay) {
        await onResuggestDay();
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const getDayStatus = () => {
    if (dayChanges.length === 0) return "No Changes";
    if (isDayVetted) return "Vetted";
    return "Vetting";
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
      <div className="space-y-2">
        <div className="flex justify-between items-end px-2">
          <span className="text-[8px] font-black uppercase tracking-[0.2em] text-indigo-600">Progress</span>
          <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{currentIndex + 1} / {allDates.length}</span>
        </div>
        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-600 transition-all duration-700" style={{ width: `${((currentIndex + 1) / allDates.length) * 100}%` }} />
        </div>
      </div>

      <div className={cn("flex items-center justify-between p-6 rounded-[2rem] border transition-all shadow-lg", isDayVetted ? "bg-green-50/50 border-green-100" : "bg-white border-gray-100")}>
        <Button variant="ghost" size="icon" onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))} disabled={currentIndex === 0} className="rounded-xl h-12 w-12"><ChevronLeft size={24} /></Button>
        <div className="text-center relative flex flex-col items-center">
          {showXP && <div className="absolute -top-10 left-1/2 -translate-x-1/2 animate-bounce"><Badge className="bg-yellow-400 text-yellow-900 px-4 py-1 rounded-full font-black text-[9px]">+50 XP</Badge></div>}
          <h2 className="text-xl font-black text-gray-900 tracking-tight">{format(currentDate, 'EEEE, MMM do')}</h2>
          <div className="flex items-center gap-2 mt-1">
            <Badge className={cn(
              "border-none px-3 py-0.5 rounded-full font-black text-[8px] uppercase tracking-widest", 
              dayChanges.length === 0 ? "bg-gray-100 text-gray-400" : isDayVetted ? "bg-green-500 text-white" : "bg-indigo-100 text-indigo-600"
            )}>
              {getDayStatus()}
            </Badge>
            {dayChanges.length > 0 && !isDayVetted && onResuggestDay && (
              <button 
                onClick={handleResuggest}
                disabled={isResuggesting}
                className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-indigo-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
              >
                <Wand2 size={10} className={cn(isResuggesting && "animate-spin")} />
                Resuggest
              </button>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setCurrentIndex(prev => Math.min(allDates.length - 1, prev + 1))} disabled={currentIndex === allDates.length - 1} className="rounded-xl h-12 w-12"><ChevronRight size={24} /></Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="space-y-6">
          <Card className="border-none shadow-md rounded-2xl overflow-hidden bg-white">
            <CardContent className="p-6 space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
                  <span className="flex items-center gap-1.5 text-gray-500"><Clock size={14} className="text-indigo-500" /> Hours</span>
                  <span className={cn(stats.isOverHours ? "text-red-500" : "text-gray-900")}>{stats.hours.toFixed(1)} / {maxHours}h</span>
                </div>
                <div className="h-1.5 w-full bg-gray-50 rounded-full overflow-hidden"><div className={cn("h-full transition-all duration-700", stats.isOverHours ? "bg-red-400" : "bg-indigo-500")} style={{ width: `${Math.min((stats.hours / maxHours) * 100, 100)}%` }} /></div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
                  <span className="flex items-center gap-1.5 text-gray-500"><ListOrdered size={14} className="text-indigo-500" /> Tasks</span>
                  <span className={cn(stats.isOverTasks ? "text-red-500" : "text-gray-900")}>{stats.tasks} / {maxTasks}</span>
                </div>
                <div className="h-1.5 w-full bg-gray-50 rounded-full overflow-hidden"><div className={cn("h-full transition-all duration-700", stats.isOverTasks ? "bg-red-400" : "bg-indigo-500")} style={{ width: `${Math.min((stats.tasks / maxTasks) * 100, 100)}%` }} /></div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-md rounded-2xl overflow-hidden bg-white">
            <CardHeader className="px-6 pt-6 pb-2"><CardTitle className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Changes</CardTitle></CardHeader>
            <CardContent className="space-y-3 px-6 pb-6 max-h-[300px] overflow-y-auto">
              {dayChanges.length > 0 ? dayChanges.map((change, i) => {
                const isMovingAway = format(parseISO(change.old_start), 'yyyy-MM-dd') === currentDateStr && format(parseISO(change.new_start), 'yyyy-MM-dd') !== currentDateStr;
                return (
                  <div key={i} className={cn("p-4 rounded-xl border flex items-center justify-between transition-all", appliedChanges.includes(change.event_id) ? "bg-green-50 border-green-100 opacity-60" : isMovingAway ? "bg-red-50/30 border-red-100" : "bg-gray-50/50 border-gray-100")}>
                    <div className="flex items-center gap-3">
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", isMovingAway ? "bg-red-100 text-red-600" : "bg-white text-indigo-600 shadow-sm")}>
                        {isMovingAway ? <ArrowUpRight size={16} /> : <Sparkles size={16} />}
                      </div>
                      <div>
                        <p className="text-xs font-black text-gray-900 tracking-tight truncate max-w-[120px]">{change.title}</p>
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{isMovingAway ? `To ${format(parseISO(change.new_start), 'EEE')}` : `To ${format(parseISO(change.new_start), 'HH:mm')}`}</p>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="space-y-4 py-4">
                  <div className="text-center text-gray-300 font-black uppercase tracking-widest text-[9px]">No changes</div>
                  {(stats.isOverTasks || stats.isOverHours) && (
                    <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 flex gap-3">
                      <AlertCircle className="text-amber-500 shrink-0" size={16} />
                      <p className="text-[10px] font-bold text-amber-800 leading-tight">
                        This day is over capacity, but all tasks are **Locked**. Click "Vet Tasks" to unlock some so the AI can move them.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-3">
            {dayChanges.length === 0 ? (
              <Button disabled className="w-full bg-gray-100 text-gray-400 rounded-2xl py-8 text-lg font-black cursor-not-allowed">
                No Sync Required
              </Button>
            ) : isDayVetted ? (
              <div className="space-y-3">
                <Button onClick={handleUndoDay} disabled={isSyncing} variant="outline" className="w-full rounded-2xl py-8 text-lg font-black border-gray-100 text-gray-400">
                  {isSyncing ? <RefreshCw className="animate-spin mr-2" size={20} /> : <><RotateCcw className="mr-2" size={20} /> Undo</>}
                </Button>
                {onResuggestDay && (
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
            events={events.filter(e => format(parseISO(e.start_time), 'yyyy-MM-dd') === currentDateStr)} 
            changes={dayChanges.filter(c => format(parseISO(c.new_start), 'yyyy-MM-dd') === currentDateStr)} 
            appliedChanges={appliedChanges} 
            isVetted={isDayVetted}
            workKeywords={workKeywords}
          />
        </div>
      </div>
    </div>
  );
};

export default DayByDayPlanner;