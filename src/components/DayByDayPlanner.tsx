"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
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
  Star
} from 'lucide-react';
import { cn } from '@/lib/utils';
import VisualSchedule from './VisualSchedule';
import { Link } from 'react-router-dom';

interface DayByDayPlannerProps {
  events: any[];
  changes: any[];
  appliedChanges: string[];
  onApplyDay: (dateChanges: any[]) => Promise<void>;
  maxHours: number;
  maxTasks: number;
}

const DayByDayPlanner = ({ 
  events, 
  changes, 
  appliedChanges, 
  onApplyDay, 
  maxHours, 
  maxTasks
}: DayByDayPlannerProps) => {
  const allDates = useMemo(() => {
    const dates = new Set<string>();
    changes.forEach(c => dates.add(format(parseISO(c.new_start), 'yyyy-MM-dd')));
    events.filter(e => e.is_locked).forEach(e => dates.add(format(parseISO(e.start_time), 'yyyy-MM-dd')));
    const sorted = Array.from(dates).sort();
    return sorted;
  }, [changes, events]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [showXP, setShowXP] = useState(false);
  const [hasAutoDefaulted, setHasAutoDefaulted] = useState(false);
  
  const currentDateStr = allDates[currentIndex];
  const currentDate = currentDateStr ? parseISO(currentDateStr) : new Date();

  const dayChanges = useMemo(() => {
    return changes.filter(c => format(parseISO(c.new_start), 'yyyy-MM-dd') === currentDateStr);
  }, [changes, currentDateStr]);

  const dayLockedEvents = useMemo(() => {
    return events.filter(e => e.is_locked && format(parseISO(e.start_time), 'yyyy-MM-dd') === currentDateStr);
  }, [events, currentDateStr]);

  const isDayVetted = useMemo(() => {
    return dayChanges.length === 0 || dayChanges.every(c => appliedChanges.includes(c.event_id));
  }, [dayChanges, appliedChanges]);

  useEffect(() => {
    if (!hasAutoDefaulted && allDates.length > 0) {
      const firstUnvettedIndex = allDates.findIndex(dateStr => {
        const dayChangesForDate = changes.filter(c => format(parseISO(c.new_start), 'yyyy-MM-dd') === dateStr);
        return dayChangesForDate.length > 0 && !dayChangesForDate.every(c => appliedChanges.includes(c.event_id));
      });

      if (firstUnvettedIndex !== -1) {
        setCurrentIndex(firstUnvettedIndex);
      }
      setHasAutoDefaulted(true);
    }
  }, [allDates, changes, appliedChanges, hasAutoDefaulted]);

  const stats = useMemo(() => {
    const activeChanges = dayChanges.filter(c => !c.is_surplus);
    const surplusCount = dayChanges.filter(c => c.is_surplus).length;
    
    const totalTasks = activeChanges.length + dayLockedEvents.filter(e => !e.title.toLowerCase().includes('break')).length;
    const totalMinutes = [...activeChanges, ...dayLockedEvents].reduce((acc, e) => acc + (e.duration || e.duration_minutes || 0), 0);
    const totalHours = totalMinutes / 60;
    
    return {
      tasks: totalTasks,
      hours: totalHours,
      surplusCount,
      isOverTasks: totalTasks > maxTasks,
      isOverHours: totalHours > maxHours,
      isFull: totalTasks >= maxTasks || totalHours >= maxHours
    };
  }, [dayChanges, dayLockedEvents, maxTasks, maxHours, currentDateStr]);

  const handleSyncDay = async () => {
    setIsSyncing(true);
    try {
      await onApplyDay(dayChanges);
      setShowXP(true);
      setTimeout(() => setShowXP(false), 2000);
      
      if (currentIndex === allDates.length - 1) {
        setTimeout(() => setIsFinished(true), 800);
      } else {
        setTimeout(() => setCurrentIndex(prev => prev + 1), 600);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncAll = async () => {
    if (!confirm("This will sync all remaining proposed changes to your calendar. Continue?")) return;
    setIsSyncing(true);
    try {
      const remainingChanges = changes.filter(c => !appliedChanges.includes(c.event_id));
      await onApplyDay(remainingChanges);
      setIsFinished(true);
    } finally {
      setIsSyncing(false);
    }
  };

  const sessionProgress = ((currentIndex + 1) / allDates.length) * 100;

  if (isFinished) {
    return (
      <div className="max-w-2xl mx-auto text-center py-24 animate-in zoom-in-95 duration-700">
        <div className="w-32 h-32 bg-green-50 rounded-[3rem] flex items-center justify-center mx-auto mb-10 shadow-2xl shadow-green-100/50 border border-green-100">
          <Trophy className="text-green-600" size={64} />
        </div>
        <h2 className="text-5xl font-black text-gray-900 mb-6 tracking-tight">Session Complete!</h2>
        <p className="text-gray-400 text-xl mb-12 font-medium leading-relaxed">
          You've successfully vetted your schedule for the next {allDates.length} days. Your calendar is now perfectly aligned.
        </p>
        <div className="grid grid-cols-2 gap-6">
          <Link to="/">
            <Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] py-10 text-xl font-black shadow-2xl shadow-indigo-100 transition-all hover:scale-[1.02]">
              <LayoutDashboard className="mr-3" /> Dashboard
            </Button>
          </Link>
          <Button variant="outline" onClick={() => setIsFinished(false)} className="rounded-[2rem] py-10 text-xl font-black border-gray-100 text-gray-400 hover:bg-gray-50 transition-all">
            Review Plan
          </Button>
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
          <div 
            className="h-full bg-indigo-600 transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(79,70,229,0.4)]" 
            style={{ width: `${sessionProgress}%` }} 
          />
        </div>
      </div>

      <div className={cn(
        "flex items-center justify-between p-10 rounded-[3.5rem] border transition-all duration-700 shadow-xl",
        isDayVetted ? "bg-green-50/50 border-green-100 shadow-green-100/20" : "bg-white border-gray-100 shadow-gray-100/50"
      )}>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
          disabled={currentIndex === 0}
          className="rounded-3xl h-16 w-16 hover:bg-gray-50 transition-all"
        >
          <ChevronLeft size={32} className="text-gray-300" />
        </Button>
        
        <div className="text-center relative">
          {showXP && (
            <div className="absolute -top-16 left-1/2 -translate-x-1/2 animate-bounce">
              <Badge className="bg-yellow-400 text-yellow-900 border-none px-6 py-2.5 rounded-full font-black flex gap-2 shadow-2xl">
                <Star size={18} fill="currentColor" /> +50 XP
              </Badge>
            </div>
          )}
          <h2 className="text-4xl font-black text-gray-900 tracking-tight mb-2">
            {format(currentDate, 'EEEE, MMMM do')}
          </h2>
          <div className="flex items-center justify-center gap-3">
            {isDayVetted ? (
              <Badge className="bg-green-500 text-white border-none px-4 py-1 rounded-full font-black text-[10px] uppercase tracking-[0.2em]">
                Vetted
              </Badge>
            ) : (
              <div className="flex items-center gap-2">
                <CalendarIcon size={16} className="text-indigo-400" />
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Vetting Phase
                </p>
              </div>
            )}
          </div>
        </div>

        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setCurrentIndex(prev => Math.min(allDates.length - 1, prev + 1))}
          disabled={currentIndex === allDates.length - 1}
          className="rounded-3xl h-16 w-16 hover:bg-gray-50 transition-all"
        >
          <ChevronRight size={32} className="text-gray-300" />
        </Button>
      </div>

      <div className={cn(
        "grid grid-cols-1 lg:grid-cols-3 gap-12 transition-all duration-700",
        isDayVetted && "opacity-90"
      )}>
        <div className="space-y-8">
          <Card className={cn(
            "border-none shadow-xl shadow-gray-100/50 rounded-[3rem] overflow-hidden transition-all duration-700",
            isDayVetted ? "bg-green-50/30" : "bg-white"
          )}>
            <CardHeader className="pb-4 px-10 pt-10">
              <CardTitle className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Day Capacity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-8 px-10 pb-10">
              <div className="space-y-4">
                <div className="flex justify-between text-xs font-black uppercase tracking-widest">
                  <span className="flex items-center gap-2 text-gray-500"><Clock size={16} className="text-indigo-500" /> Work Hours</span>
                  <span className={cn(stats.isOverHours ? "text-red-500" : "text-gray-900")}>
                    {stats.hours.toFixed(1)} / {maxHours}h
                  </span>
                </div>
                <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden shadow-inner">
                  <div 
                    className={cn("h-full transition-all duration-1000", stats.isOverHours ? "bg-red-400" : "bg-indigo-500")} 
                    style={{ width: `${Math.min((stats.hours / maxHours) * 100, 100)}%` }} 
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between text-xs font-black uppercase tracking-widest">
                  <span className="flex items-center gap-2 text-gray-500"><ListOrdered size={16} className="text-indigo-500" /> Task Count</span>
                  <span className={cn(stats.isOverTasks ? "text-red-500" : "text-gray-900")}>
                    {stats.tasks} / {maxTasks}
                  </span>
                </div>
                <div className="h-2 w-full bg-gray-50 rounded-full overflow-hidden shadow-inner">
                  <div 
                    className={cn("h-full transition-all duration-1000", stats.isOverTasks ? "bg-red-400" : "bg-indigo-500")} 
                    style={{ width: `${Math.min((stats.tasks / maxTasks) * 100, 100)}%` }} 
                  />
                </div>
              </div>

              {stats.surplusCount > 0 && (
                <div className="p-6 bg-indigo-50/50 rounded-[2rem] border border-indigo-100/50 flex gap-5">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shrink-0 shadow-sm">
                    <Inbox className="text-indigo-600" size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-indigo-900 uppercase tracking-[0.2em] mb-1.5">Backlog Alert</p>
                    <p className="text-xs text-indigo-700 font-bold leading-relaxed">
                      {stats.surplusCount} tasks are parked in your backlog for this day.
                    </p>
                  </div>
                </div>
              )}

              {isDayVetted ? (
                <div className="p-6 bg-green-500 rounded-[2rem] border border-green-600 flex gap-5 shadow-2xl shadow-green-100">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
                    <CheckCircle2 className="text-white" size={24} />
                  </div>
                  <p className="text-[10px] text-white font-black uppercase tracking-[0.2em] leading-relaxed flex items-center">
                    Day Fully Vetted
                  </p>
                </div>
              ) : stats.isFull ? (
                <div className="p-6 bg-amber-50 rounded-[2rem] border border-amber-100 flex gap-5">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shrink-0 shadow-sm">
                    <AlertCircle className="text-amber-600" size={24} />
                  </div>
                  <p className="text-xs text-amber-800 font-bold leading-relaxed">
                    This day is at maximum capacity. The AI suggests focusing on existing commitments.
                  </p>
                </div>
              ) : (
                <div className="p-6 bg-green-50 rounded-[2rem] border border-green-100 flex gap-5">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shrink-0 shadow-sm">
                    <CheckCircle2 className="text-green-600" size={24} />
                  </div>
                  <p className="text-xs text-green-800 font-bold leading-relaxed">
                    You have space today! The AI has suggested {dayChanges.filter(c => !c.is_surplus).length} tasks to fill your gaps.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className={cn(
            "border-none shadow-xl shadow-gray-100/50 rounded-[3rem] overflow-hidden transition-all duration-700",
            isDayVetted ? "bg-green-50/30" : "bg-white"
          )}>
            <CardHeader className="px-10 pt-10 pb-4">
              <CardTitle className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Proposed for Today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-10 pb-10 max-h-[450px] overflow-y-auto pr-4 scrollbar-hide">
              {dayChanges.length > 0 ? (
                dayChanges.map((change, i) => (
                  <div key={i} className={cn(
                    "p-6 rounded-[2rem] border flex items-center justify-between group transition-all duration-500",
                    appliedChanges.includes(change.event_id) 
                      ? "bg-green-50 border-green-100 opacity-60" 
                      : "bg-gray-50/50 border-gray-100 hover:border-indigo-200 hover:bg-white hover:shadow-xl hover:shadow-indigo-100/20"
                  )}>
                    <div className="flex items-center gap-5">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500",
                        appliedChanges.includes(change.event_id) ? "bg-green-500 text-white" : "bg-white text-indigo-600 shadow-sm border border-gray-50"
                      )}>
                        {appliedChanges.includes(change.event_id) ? <CheckCircle2 size={24} /> : <Sparkles size={24} />}
                      </div>
                      <div>
                        <p className="text-base font-black text-gray-900 tracking-tight">{change.title}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Clock size={14} className="text-gray-300" />
                          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                            {format(parseISO(change.new_start), 'HH:mm')}
                          </p>
                        </div>
                      </div>
                    </div>
                    {change.is_surplus && (
                      <Badge variant="secondary" className="bg-amber-50 text-amber-600 border-amber-100 text-[8px] font-black px-2 py-0.5">
                        SURPLUS
                      </Badge>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-16 bg-gray-50/30 rounded-[2.5rem] border border-dashed border-gray-200">
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                    <Inbox className="text-gray-200" size={32} />
                  </div>
                  <p className="text-[10px] font-black text-gray-300 uppercase tracking-[0.3em]">No new tasks</p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Button 
              onClick={handleSyncDay} 
              disabled={isSyncing || (dayChanges.length > 0 && isDayVetted)}
              className={cn(
                "w-full rounded-[2.5rem] py-12 text-2xl font-black shadow-2xl transition-all hover:scale-[1.02] active:scale-[0.98]",
                isDayVetted 
                  ? "bg-green-500 hover:bg-green-600 text-white shadow-green-100" 
                  : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100"
              )}
            >
              {isSyncing ? (
                <RefreshCw className="animate-spin mr-4" size={28} />
              ) : isDayVetted ? (
                <><CheckCircle2 className="mr-4" size={28} /> Day Vetted</>
              ) : (
                <><Zap className="mr-4" size={28} /> Confirm & Sync Day</>
              )}
            </Button>
            
            <div className="flex gap-4">
              {isDayVetted && currentIndex < allDates.length - 1 && (
                <Button 
                  variant="outline" 
                  onClick={() => setCurrentIndex(prev => prev + 1)}
                  className="flex-1 rounded-[2rem] py-8 border-gray-100 text-gray-500 font-black uppercase tracking-[0.2em] text-[10px] hover:bg-gray-50 transition-all"
                >
                  Next Day <ArrowRight size={20} className="ml-3" />
                </Button>
              )}
              <Button 
                variant="ghost" 
                onClick={handleSyncAll}
                disabled={isSyncing}
                className="rounded-[2rem] py-8 text-gray-300 hover:text-indigo-600 font-black uppercase tracking-[0.2em] text-[10px] transition-all"
              >
                Sync All Remaining
              </Button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="h-full flex flex-col">
            <div className="flex flex-row items-center justify-between px-4 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-white rounded-[1.5rem] flex items-center justify-center shadow-xl shadow-gray-100/50 border border-gray-50">
                  <CalendarIcon className="text-indigo-600" size={28} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-gray-900 tracking-tight">Visual Map</h3>
                  <p className="text-xs font-medium text-gray-400">Your day at a glance</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Badge variant="outline" className="rounded-xl border-gray-100 text-gray-400 font-black px-5 py-2 text-[10px] uppercase tracking-widest bg-white">
                  {dayLockedEvents.length} FIXED
                </Badge>
                <Badge variant="outline" className="rounded-xl border-indigo-100 text-indigo-600 font-black px-5 py-2 text-[10px] uppercase tracking-widest bg-indigo-50/30">
                  {dayChanges.length} PROPOSED
                </Badge>
              </div>
            </div>
            <div className="flex-1">
              <VisualSchedule 
                events={events.filter(e => format(parseISO(e.start_time), 'yyyy-MM-dd') === currentDateStr)} 
                changes={dayChanges} 
                appliedChanges={appliedChanges} 
                isVetted={isDayVetted}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DayByDayPlanner;