"use client";

import React, { useState, useMemo } from 'react';
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
  LayoutDashboard
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
    return Array.from(dates).sort();
  }, [changes, events]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  
  const currentDateStr = allDates[currentIndex];
  const currentDate = currentDateStr ? parseISO(currentDateStr) : new Date();

  const dayChanges = useMemo(() => 
    changes.filter(c => format(parseISO(c.new_start), 'yyyy-MM-dd') === currentDateStr),
    [changes, currentDateStr]
  );

  const dayLockedEvents = useMemo(() => 
    events.filter(e => e.is_locked && format(parseISO(e.start_time), 'yyyy-MM-dd') === currentDateStr),
    [events, currentDateStr]
  );

  const stats = useMemo(() => {
    const totalTasks = dayChanges.length + dayLockedEvents.filter(e => !e.title.toLowerCase().includes('break')).length;
    const totalMinutes = [...dayChanges, ...dayLockedEvents].reduce((acc, e) => acc + (e.duration || e.duration_minutes || 0), 0);
    const totalHours = totalMinutes / 60;
    
    return {
      tasks: totalTasks,
      hours: totalHours,
      isOverTasks: totalTasks > maxTasks,
      isOverHours: totalHours > maxHours,
      isFull: totalTasks >= maxTasks || totalHours >= maxHours
    };
  }, [dayChanges, dayLockedEvents, maxTasks, maxHours]);

  const handleSyncDay = async () => {
    setIsSyncing(true);
    try {
      await onApplyDay(dayChanges);
      if (currentIndex === allDates.length - 1) {
        setTimeout(() => setIsFinished(true), 800);
      } else {
        setTimeout(() => setCurrentIndex(prev => prev + 1), 600);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const isDayVetted = dayChanges.length === 0 || dayChanges.every(c => appliedChanges.includes(c.event_id));
  const sessionProgress = ((currentIndex + 1) / allDates.length) * 100;

  if (isFinished) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12 animate-in zoom-in-95 duration-500">
        <div className="w-24 h-24 bg-green-100 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-xl shadow-green-50">
          <Trophy className="text-green-600" size={48} />
        </div>
        <h2 className="text-4xl font-black text-gray-900 mb-4 tracking-tight">Session Complete!</h2>
        <p className="text-gray-500 text-lg mb-10 font-medium">
          You've successfully vetted your schedule for the next {allDates.length} days. Your calendar is now perfectly aligned.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Link to="/">
            <Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl py-8 text-lg font-black shadow-xl shadow-indigo-100">
              <LayoutDashboard className="mr-2" /> Dashboard
            </Button>
          </Link>
          <Button variant="outline" onClick={() => setIsFinished(false)} className="rounded-2xl py-8 text-lg font-black border-gray-200 text-gray-500">
            Review Plan
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="space-y-2">
        <div className="flex justify-between items-end px-2">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600">Session Progress</span>
          <span className="text-[10px] font-black text-gray-400">{currentIndex + 1} of {allDates.length} Days</span>
        </div>
        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
          <div 
            className="h-full bg-indigo-600 transition-all duration-1000 ease-out" 
            style={{ width: `${sessionProgress}%` }} 
          />
        </div>
      </div>

      <div className="flex items-center justify-between bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
          disabled={currentIndex === 0}
          className="rounded-2xl h-12 w-12 hover:bg-gray-50"
        >
          <ChevronLeft size={28} className="text-gray-400" />
        </Button>
        
        <div className="text-center">
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">
            {format(currentDate, 'EEEE, MMMM do')}
          </h2>
          <div className="flex items-center justify-center gap-2 mt-1">
            <CalendarIcon size={14} className="text-indigo-400" />
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Vetting Phase
            </p>
          </div>
        </div>

        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setCurrentIndex(prev => Math.min(allDates.length - 1, prev + 1))}
          disabled={currentIndex === allDates.length - 1}
          className="rounded-2xl h-12 w-12 hover:bg-gray-50"
        >
          <ChevronRight size={28} className="text-gray-400" />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="space-y-6">
          <Card className="border-none shadow-sm rounded-[2rem] bg-white overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Day Capacity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between text-sm font-bold">
                  <span className="flex items-center gap-2 text-gray-600"><Clock size={16} className="text-indigo-500" /> Work Hours</span>
                  <span className={cn(stats.isOverHours ? "text-red-500" : "text-gray-900")}>
                    {stats.hours.toFixed(1)} / {maxHours}h
                  </span>
                </div>
                <div className="h-2.5 w-full bg-gray-50 rounded-full overflow-hidden">
                  <div 
                    className={cn("h-full transition-all duration-1000", stats.isOverHours ? "bg-red-500" : "bg-indigo-500")} 
                    style={{ width: `${Math.min((stats.hours / maxHours) * 100, 100)}%` }} 
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm font-bold">
                  <span className="flex items-center gap-2 text-gray-600"><ListOrdered size={16} className="text-indigo-500" /> Task Count</span>
                  <span className={cn(stats.isOverTasks ? "text-red-500" : "text-gray-900")}>
                    {stats.tasks} / {maxTasks}
                  </span>
                </div>
                <div className="h-2.5 w-full bg-gray-50 rounded-full overflow-hidden">
                  <div 
                    className={cn("h-full transition-all duration-1000", stats.isOverTasks ? "bg-red-500" : "bg-indigo-500")} 
                    style={{ width: `${Math.min((stats.tasks / maxTasks) * 100, 100)}%` }} 
                  />
                </div>
              </div>

              {stats.isFull ? (
                <div className="p-5 bg-amber-50 rounded-[1.5rem] border border-amber-100 flex gap-4">
                  <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                    <AlertCircle className="text-amber-600" size={20} />
                  </div>
                  <p className="text-xs text-amber-800 font-bold leading-relaxed">
                    This day is at maximum capacity. The AI suggests focusing on existing commitments.
                  </p>
                </div>
              ) : (
                <div className="p-5 bg-green-50 rounded-[1.5rem] border border-green-100 flex gap-4">
                  <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
                    <CheckCircle2 className="text-green-600" size={20} />
                  </div>
                  <p className="text-xs text-green-800 font-bold leading-relaxed">
                    You have space today! The AI has suggested {dayChanges.length} tasks to fill your gaps.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm rounded-[2rem] bg-white">
            <CardHeader>
              <CardTitle className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Proposed for Today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {dayChanges.length > 0 ? (
                dayChanges.map((change, i) => (
                  <div key={i} className={cn(
                    "p-5 rounded-2xl border flex items-center justify-between group transition-all duration-300",
                    appliedChanges.includes(change.event_id) 
                      ? "bg-green-50 border-green-100 opacity-60" 
                      : "bg-gray-50 border-gray-100 hover:border-indigo-200 hover:bg-white hover:shadow-md"
                  )}>
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                        appliedChanges.includes(change.event_id) ? "bg-green-500 text-white" : "bg-white text-indigo-600 shadow-sm"
                      )}>
                        {appliedChanges.includes(change.event_id) ? <CheckCircle2 size={20} /> : <Sparkles size={20} />}
                      </div>
                      <div>
                        <p className="text-sm font-black text-gray-900">{change.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Clock size={12} className="text-gray-400" />
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            {format(parseISO(change.new_start), 'HH:mm')}
                          </p>
                        </div>
                      </div>
                    </div>
                    {change.is_surplus && (
                      <Badge variant="secondary" className="bg-amber-50 text-amber-600 border-amber-100 text-[10px] font-black">
                        SURPLUS
                      </Badge>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-12 bg-gray-50/50 rounded-[1.5rem] border border-dashed border-gray-200">
                  <Inbox className="mx-auto text-gray-200 mb-3" size={40} />
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest">No new tasks</p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-3">
            <Button 
              onClick={handleSyncDay} 
              disabled={isSyncing || (dayChanges.length > 0 && isDayVetted)}
              className={cn(
                "w-full rounded-[2rem] py-10 text-xl font-black shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]",
                isDayVetted 
                  ? "bg-green-500 hover:bg-green-600 text-white shadow-green-100" 
                  : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100"
              )}
            >
              {isSyncing ? (
                <RefreshCw className="animate-spin mr-3" size={24} />
              ) : isDayVetted ? (
                <><CheckCircle2 className="mr-3" size={24} /> Day Vetted</>
              ) : (
                <><Zap className="mr-3" size={24} /> Confirm & Sync Day</>
              )}
            </Button>
            
            {isDayVetted && currentIndex < allDates.length - 1 && (
              <Button 
                variant="outline" 
                onClick={() => setCurrentIndex(prev => prev + 1)}
                className="w-full rounded-[1.5rem] py-6 border-gray-200 text-gray-600 font-black uppercase tracking-widest text-xs hover:bg-gray-50"
              >
                Next Day <ArrowRight size={18} className="ml-2" />
              </Button>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <Card className="border-none shadow-sm rounded-[2.5rem] bg-white overflow-hidden h-full flex flex-col">
            <CardHeader className="border-b border-gray-50 flex flex-row items-center justify-between p-8">
              <CardTitle className="flex items-center gap-3 text-xl font-black">
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                  <CalendarIcon className="text-indigo-600" size={20} />
                </div>
                Visual Map
              </CardTitle>
              <div className="flex gap-3">
                <Badge variant="outline" className="rounded-xl border-gray-100 text-gray-400 font-black px-4 py-1.5">
                  {dayLockedEvents.length} FIXED
                </Badge>
                <Badge variant="outline" className="rounded-xl border-indigo-100 text-indigo-600 font-black px-4 py-1.5">
                  {dayChanges.length} PROPOSED
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              <div className="max-h-[700px] overflow-y-auto scrollbar-hide">
                <VisualSchedule 
                  events={events.filter(e => format(parseISO(e.start_time), 'yyyy-MM-dd') === currentDateStr)} 
                  changes={dayChanges} 
                  appliedChanges={appliedChanges} 
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default DayByDayPlanner;