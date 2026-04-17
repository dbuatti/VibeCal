"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { format, parseISO, isBefore, isAfter } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  ListOrdered, 
  Sparkles, 
  ArrowRight,
  Inbox,
  Calendar as CalendarIcon,
  RefreshCw,
  Zap,
  Trophy,
  LayoutDashboard,
  Star,
  RotateCcw,
  ArrowUpRight
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
  maxHours, 
  maxTasks,
  workKeywords = ['work', 'session', 'meeting', 'call', 'rehearsal', 'lesson', 'audition', 'coaching', 'appt']
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
  const [isFinished, setIsFinished] = useState(false);
  const [showXP, setShowXP] = useState(false);
  const [hasAutoDefaulted, setHasAutoDefaulted] = useState(false);
  
  const currentDateStr = allDates[currentIndex];
  const currentDate = currentDateStr ? parseISO(currentDateStr) : new Date();

  // Changes that either move TO this day or move AWAY from this day
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

  const isRoutineEvent = (title: string) => {
    const t = title.toLowerCase();
    return t.includes('lunch') || t.includes('dinner') || t.includes('breakfast') || 
           t.includes('affirmation') || t.includes('break') || t.includes('coffee');
  };

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
    // Only count events that will actually be on this day after changes
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

    const taskEvents = eventsOnThisDay.filter(e => !isRoutineEvent(e.title || ''));
    const surplusCount = changes.filter(c => format(parseISO(c.new_start), 'yyyy-MM-dd') === currentDateStr && c.is_surplus).length;

    return {
      tasks: taskEvents.length,
      hours: totalWorkMinutes / 60,
      surplusCount,
      isOverTasks: taskEvents.length > maxTasks,
      isOverHours: (totalWorkMinutes / 60) > maxHours
    };
  }, [dayLockedEvents, changes, currentDateStr, maxTasks, maxHours, workKeywords]);

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

  if (isFinished) {
    return (
      <div className="max-w-2xl mx-auto text-center py-24 animate-in zoom-in-95 duration-700">
        <div className="w-32 h-32 bg-green-50 rounded-[3rem] flex items-center justify-center mx-auto mb-10 shadow-2xl shadow-green-100/50 border border-green-100">
          <Trophy className="text-green-600" size={64} />
        </div>
        <h2 className="text-5xl font-black text-gray-900 mb-6 tracking-tight">Session Complete!</h2>
        <p className="text-gray-400 text-xl mb-12 font-medium leading-relaxed">Your calendar is now perfectly aligned.</p>
        <div className="grid grid-cols-2 gap-6">
          <Link to="/"><Button className="w-full bg-indigo-600 py-10 text-xl font-black rounded-[2rem]"><LayoutDashboard className="mr-3" /> Dashboard</Button></Link>
          <Button variant="outline" onClick={() => setIsFinished(false)} className="rounded-[2rem] py-10 text-xl font-black">Review Plan</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
      <div className="space-y-3">
        <div className="flex justify-between items-end px-4">
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-600">Session Progress</span>
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{currentIndex + 1} of {allDates.length} Days</span>
        </div>
        <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden shadow-inner">
          <div className="h-full bg-indigo-600 transition-all duration-1000" style={{ width: `${((currentIndex + 1) / allDates.length) * 100}%` }} />
        </div>
      </div>

      <div className={cn("flex items-center justify-between p-10 rounded-[3.5rem] border transition-all duration-700 shadow-xl", isDayVetted ? "bg-green-50/50 border-green-100" : "bg-white border-gray-100")}>
        <Button variant="ghost" size="icon" onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))} disabled={currentIndex === 0} className="rounded-3xl h-16 w-16"><ChevronLeft size={32} /></Button>
        <div className="text-center relative">
          {showXP && <div className="absolute -top-16 left-1/2 -translate-x-1/2 animate-bounce"><Badge className="bg-yellow-400 text-yellow-900 px-6 py-2.5 rounded-full font-black">+50 XP</Badge></div>}
          <h2 className="text-4xl font-black text-gray-900 tracking-tight mb-2">{format(currentDate, 'EEEE, MMMM do')}</h2>
          <Badge className={cn("border-none px-4 py-1 rounded-full font-black text-[10px] uppercase tracking-[0.2em]", isDayVetted ? "bg-green-500 text-white" : "bg-indigo-100 text-indigo-600")}>{isDayVetted ? 'Vetted' : 'Vetting Phase'}</Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setCurrentIndex(prev => Math.min(allDates.length - 1, prev + 1))} disabled={currentIndex === allDates.length - 1} className="rounded-3xl h-16 w-16"><ChevronRight size={32} /></Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="space-y-8">
          <Card className="border-none shadow-xl rounded-[3rem] overflow-hidden bg-white">
            <CardHeader className="pb-4 px-10 pt-10"><CardTitle className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Day Capacity</CardTitle></CardHeader>
            <CardContent className="space-y-8 px-10 pb-10">
              <div className="space-y-4">
                <div className="flex justify-between text-xs font-black uppercase tracking-widest">
                  <span className="flex items-center gap-2 text-gray-500"><Clock size={16} className="text-indigo-500" /> Work Hours</span>
                  <span className={cn(stats.isOverHours ? "text-red-500" : "text-gray-900")}>{stats.hours.toFixed(1)} / {maxHours}h</span>
                </div>
                <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden"><div className={cn("h-full transition-all duration-1000", stats.isOverHours ? "bg-red-400" : "bg-indigo-500")} style={{ width: `${Math.min((stats.hours / maxHours) * 100, 100)}%` }} /></div>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between text-xs font-black uppercase tracking-widest">
                  <span className="flex items-center gap-2 text-gray-500"><ListOrdered size={16} className="text-indigo-500" /> Task Count</span>
                  <span className={cn(stats.isOverTasks ? "text-red-500" : "text-gray-900")}>{stats.tasks} / {maxTasks}</span>
                </div>
                <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden"><div className={cn("h-full transition-all duration-1000", stats.isOverTasks ? "bg-red-400" : "bg-indigo-500")} style={{ width: `${Math.min((stats.tasks / maxTasks) * 100, 100)}%` }} /></div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-xl rounded-[3rem] overflow-hidden bg-white">
            <CardHeader className="px-10 pt-10 pb-4"><CardTitle className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Proposed Changes</CardTitle></CardHeader>
            <CardContent className="space-y-4 px-10 pb-10 max-h-[450px] overflow-y-auto">
              {dayChanges.length > 0 ? dayChanges.map((change, i) => {
                const isMovingAway = format(parseISO(change.old_start), 'yyyy-MM-dd') === currentDateStr && format(parseISO(change.new_start), 'yyyy-MM-dd') !== currentDateStr;
                return (
                  <div key={i} className={cn("p-6 rounded-[2rem] border flex items-center justify-between transition-all duration-500", appliedChanges.includes(change.event_id) ? "bg-green-50 border-green-100 opacity-60" : isMovingAway ? "bg-red-50/30 border-red-100" : "bg-gray-50/50 border-gray-100")}>
                    <div className="flex items-center gap-5">
                      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", isMovingAway ? "bg-red-100 text-red-600" : "bg-white text-indigo-600 shadow-sm")}>
                        {isMovingAway ? <ArrowUpRight size={24} /> : <Sparkles size={24} />}
                      </div>
                      <div>
                        <p className="text-base font-black text-gray-900 tracking-tight">{change.title}</p>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{isMovingAway ? `Moving to ${format(parseISO(change.new_start), 'EEE')}` : `Moving to ${format(parseISO(change.new_start), 'HH:mm')}`}</p>
                      </div>
                    </div>
                  </div>
                );
              }) : <div className="text-center py-16 text-gray-300 font-black uppercase tracking-[0.3em]">No changes</div>}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {isDayVetted ? (
              <Button onClick={handleUndoDay} disabled={isSyncing} variant="outline" className="w-full rounded-[2.5rem] py-12 text-2xl font-black border-gray-100 text-gray-400 hover:text-indigo-600 transition-all">
                {isSyncing ? <RefreshCw className="animate-spin mr-4" size={28} /> : <><RotateCcw className="mr-4" size={28} /> Undo Vetting</>}
              </Button>
            ) : (
              <Button onClick={handleSyncDay} disabled={isSyncing} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2.5rem] py-12 text-2xl font-black shadow-2xl transition-all">
                {isSyncing ? <RefreshCw className="animate-spin mr-4" size={28} /> : <><Zap className="mr-4" size={28} /> Confirm & Sync Day</>}
              </Button>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="flex flex-row items-center justify-between px-4 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-white rounded-[1.5rem] flex items-center justify-center shadow-xl border border-gray-50"><CalendarIcon className="text-indigo-600" size={28} /></div>
              <div><h3 className="text-2xl font-black text-gray-900 tracking-tight">Visual Map</h3><p className="text-xs font-medium text-gray-400">Your day at a glance</p></div>
            </div>
          </div>
          <VisualSchedule 
            events={events.filter(e => format(parseISO(e.start_time), 'yyyy-MM-dd') === currentDateStr)} 
            changes={dayChanges.filter(c => format(parseISO(c.new_start), 'yyyy-MM-dd') === currentDateStr)} 
            appliedChanges={appliedChanges} 
            isVetted={isDayVetted}
          />
        </div>
      </div>
    </div>
  );
};

export default DayByDayPlanner;