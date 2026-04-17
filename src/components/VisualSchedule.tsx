"use client";

import React from 'react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import VisualEvent from './VisualEvent';

interface VisualScheduleProps {
  events: any[];
  changes: any[];
  appliedChanges: string[];
  isVetted?: boolean;
  workKeywords?: string[];
}

const VisualSchedule = ({ 
  events = [], 
  changes = [], 
  appliedChanges = [], 
  isVetted = false,
  workKeywords = ['work', 'session', 'meeting', 'call', 'rehearsal', 'lesson', 'audition', 'coaching', 'appt']
}: VisualScheduleProps) => {
  
  const isWorkEvent = (event: any) => {
    if (event.is_work === true) return true;
    const title = (event.title || '').toLowerCase();
    return workKeywords.some(kw => title.includes(kw.toLowerCase()));
  };

  const allVisualEvents = [
    ...events.filter(e => e && e.is_locked).map(e => ({ ...e, type: 'locked' })),
    ...changes.map(c => ({
      ...c,
      start_time: c.new_start,
      end_time: c.new_end,
      duration_minutes: c.duration,
      type: 'proposed',
      is_applied: appliedChanges.includes(c.event_id)
    }))
  ];

  const days = allVisualEvents.reduce((acc: any, event) => {
    if (!event.start_time) return acc;
    try {
      const dayKey = format(parseISO(event.start_time), 'yyyy-MM-dd');
      if (!acc[dayKey]) acc[dayKey] = [];
      acc[dayKey].push(event);
    } catch (e) {
      console.error("[VisualSchedule] Error parsing date:", event.start_time);
    }
    return acc;
  }, {});

  const sortedDayKeys = Object.keys(days).sort();

  if (sortedDayKeys.length === 0) {
    return (
      <div className="p-12 text-center bg-gray-50/30 rounded-3xl border border-dashed border-gray-200">
        <p className="text-gray-400 font-black uppercase tracking-widest text-[9px]">No events</p>
      </div>
    );
  }

  return (
    <div className={cn("w-full transition-all duration-500", isVetted && "grayscale-[0.8] opacity-60")}>
      <div className="space-y-3">
        {sortedDayKeys.map(dayKey => {
          const dayEvents = days[dayKey].sort((a: any, b: any) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime());
          return (
            <div key={`col-${dayKey}`} className="space-y-3">
              {dayEvents.map((event: any, idx: number) => (
                <VisualEvent 
                  key={`${dayKey}-${idx}`}
                  event={event}
                  isApplied={appliedChanges.includes(event.event_id)}
                  isVetted={isVetted}
                  isWork={isWorkEvent(event)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VisualSchedule;