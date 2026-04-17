"use client";

import React, { useState, useMemo } from 'react';
import { format, parseISO, addDays, isSameDay } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import VisualSchedule from './VisualSchedule';

interface DayByDayPlannerProps {
  events: any[];
  changes: any[];
  appliedChanges: string[];
  onApplyDay: (dateChanges: any[]) => Promise<void>;
  maxHours: number;
  maxTasks: number;
  selectedDays: number[];
}

const DayByDayPlanner = ({ 
  events, 
  changes, 
  appliedChanges, 
  onApplyDay, 
  maxHours, 
  maxTasks,
  selectedDays 
}: DayByDayPlannerProps) => {
  // Get all unique dates from changes and locked events
  const allDates = useMemo(() => {
    const dates = new Set<string>();
    changes.forEach(c => dates.add(format(parseISO(c.new_start), 'yyyy-MM-dd')));
    events.filter(e => e.is_locked).forEach(e => dates.add(format(parseISO(e.start_time), 'yyyy-MM-dd')));
    return Array.from(dates).sort();
  }, [changes, events]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const currentDateStr = allDates[currentIndex];
  const currentDate = currentDateStr ? parseISO(currentDateStr) : new Date();

  // Filter data for the current day
  const dayChanges = useMemo(() => 
    changes.filter(c => format(parseISO(c.new_start), 'yyyy-MM-dd') === currentDateStr),
    [changes, currentDateStr]
  );

  const dayLockedEvents = useMemo(() => 
    events.filter(e => e.is_locked && format(parseISO(e.start_time), 'yyyy-MM-dd') === currentDateStr),
    [events, currentDateStr]
  );

  // Calculate stats
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
      if (currentIndex < allDates.length - 1) {
        setCurrentIndex(prev => prev + 1);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const isDayVetted = dayChanges.every(c => appliedChanges.includes(c.event_id));

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Date Navigation */}
      <div className="flex items-center justify-between bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
          disabled={currentIndex === 0}
          className="rounded-xl"
        >
          <ChevronLeft size={24} />
        </Button>
        
        <div className="text-center">
          <h2 className="text-2xl font-black text-gray-900">
            {format(currentDate, 'EEEE, MMMM do')}
          </h2>
          <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mt-1">
            Day {currentIndex + 1} of {allDates.length}
          </p>
        </div>

        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setCurrentIndex(prev => Math.min(allDates.length - 1, prev + 1))}
          disabled={currentIndex === allDates.length - 1}
          className="rounded-xl"
        >
          <ChevronRight size={24} />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Day Status & Suggestions */}
        <div className="space-y-6">
          <Card className="border-none shadow-sm rounded-[2rem] bg-white overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-gray-400 uppercase tracking-wider">Day Capacity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-bold">
                  <span className="flex items-center gap-2"><Clock size={14} /> Work Hours</span>
                  <span className={cn(stats.isOverHours ? "text-red-500" : "text-gray-900")}>
                    {stats.hours.toFixed(1)} / {maxHours}h
                  </span>
                </div>
                <Progress value={(stats.hours / maxHours) * 100} className={cn("h-2", stats.isOverHours ? "bg-red-100" : "bg-gray-100")} />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm font-bold">
                  <span className="flex items-center gap-2"><ListOrdered size={14} /> Task Count</span>
                  <span className={cn(stats.isOverTasks ? "text-red-500" : "text-gray-900")}>
                    {stats.tasks} / {maxTasks}
                  </span>
                </div>
                <Progress value={(stats.tasks / maxTasks) * 100} className={cn("h-2", stats.isOverTasks ? "bg-red-100" : "bg-gray-100")} />
              </div>

              {stats.isFull ? (
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
                  <AlertCircle className="text-amber-600 shrink-0" size={20} />
                  <p className="text-xs text-amber-800 font-medium leading-relaxed">
                    This day is at maximum capacity. The AI suggests focusing on existing commitments rather than adding more tasks.
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-green-50 rounded-2xl border border-green-100 flex gap-3">
                  <CheckCircle2 className="text-green-600 shrink-0" size={20} />
                  <p className="text-xs text-green-800 font-medium leading-relaxed">
                    You have space today! The AI has suggested {dayChanges.length} tasks to fill your gaps.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm rounded-[2rem] bg-white">
            <CardHeader>
              <CardTitle className="text-sm font-bold text-gray-400 uppercase tracking-wider">Proposed for Today</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {dayChanges.length > 0 ? (
                dayChanges.map((change, i) => (
                  <div key={i} className={cn(
                    "p-4 rounded-xl border flex items-center justify-between group transition-all",
                    appliedChanges.includes(change.event_id) ? "bg-green-50 border-green-100" : "bg-gray-50 border-gray-100"
                  )}>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center",
                        appliedChanges.includes(change.event_id) ? "bg-green-500 text-white" : "bg-white text-indigo-600"
                      )}>
                        {appliedChanges.includes(change.event_id) ? <CheckCircle2 size={16} /> : <Sparkles size={16} />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{change.title}</p>
                        <p className="text-[10px] font-bold text-gray-400">{format(parseISO(change.new_start), 'HH:mm')}</p>
                      </div>
                    </div>
                    {change.is_surplus && <Badge variant="secondary" className="bg-amber-50 text-amber-600 border-amber-100 text-[10px]">Surplus</Badge>}
                  </div>
                ))
              ) : (
                <div className="text-center py-8">
                  <Inbox className="mx-auto text-gray-200 mb-2" size={32} />
                  <p className="text-xs font-bold text-gray-400">No new tasks proposed for today.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Button 
            onClick={handleSyncDay} 
            disabled={isSyncing || (dayChanges.length > 0 && isDayVetted)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl py-8 text-xl font-black shadow-xl shadow-indigo-100 transition-all hover:scale-[1.02]"
          >
            {isSyncing ? (
              <RefreshCw className="animate-spin mr-2" />
            ) : isDayVetted ? (
              <><CheckCircle2 className="mr-2" /> Day Vetted</>
            ) : (
              <><Sparkles className="mr-2" /> Confirm & Sync Day</>
            )}
          </Button>
          
          {isDayVetted && currentIndex < allDates.length - 1 && (
            <Button 
              variant="outline" 
              onClick={() => setCurrentIndex(prev => prev + 1)}
              className="w-full rounded-2xl py-6 border-gray-200 text-gray-600 font-bold"
            >
              Move to Next Day <ArrowRight size={18} className="ml-2" />
            </Button>
          )}
        </div>

        {/* Right: Visual Timeline */}
        <div className="lg:col-span-2">
          <Card className="border-none shadow-sm rounded-[2rem] bg-white overflow-hidden h-full">
            <CardHeader className="border-b border-gray-50 flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="text-indigo-600" size={20} />
                Visual Map
              </CardTitle>
              <div className="flex gap-2">
                <Badge variant="outline" className="rounded-lg border-gray-100 text-gray-400 font-bold">
                  {dayLockedEvents.length} Fixed
                </Badge>
                <Badge variant="outline" className="rounded-lg border-indigo-100 text-indigo-600 font-bold">
                  {dayChanges.length} Proposed
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-y-auto">
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