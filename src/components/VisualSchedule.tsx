"use client";

import React, { useEffect, useState } from 'react';
import { parseISO, isSameDay } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { cn } from '@/lib/utils';
import VisualEvent from './VisualEvent';

interface VisualScheduleProps {
  events: any[];
  changes: any[];
  appliedChanges: string[];
  isVetted?: boolean;
  workKeywords?: string[];
  timezone?: string;
}

const VisualSchedule = ({ 
  events = [], 
  changes = [], 
  appliedChanges = [], 
  isVetted = false,
  workKeywords = ['work', 'session', 'meeting', 'call', 'rehearsal', 'lesson', 'audition', 'coaching', 'appt', 'program', 'ceremony', 'gig', 'meetup', 'planning', 'workshop', 'presentation'],
  timezone = 'Australia/Melbourne'
}: VisualScheduleProps) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  
  const isWorkEvent = (event: any) => {
    if (event.is_work === true) return true;
    const title = (event.title || '').toLowerCase();
    return workKeywords.some(kw => title.includes(kw.toLowerCase()));
  };

  const changedEventIds = new Set(changes.map(c => c.event_id));

  const allVisualEvents = [
    ...events
      .filter(e => e && e.is_locked && !changedEventIds.has(e.event_id))
      .map(e => ({ ...e, type: 'locked' })),
    
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
      const dayKey = formatInTimeZone(parseISO(event.start_time), timezone, 'yyyy-MM-dd');
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
      <div className="space-y-3 relative">
        {sortedDayKeys.map(dayKey => {
          const dayEvents = days[dayKey].sort((a: any, b: any) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime());
          const isToday = dayKey === formatInTimeZone(now, timezone, 'yyyy-MM-dd');

          return (
            <div key={`col-${dayKey}`} className="space-y-3 relative">
              {isToday && (
                <div className="absolute left-0 right-0 z-20 pointer-events-none flex items-center gap-2" 
                  style={{ 
                    top: `${((now.getHours() * 60 + now.getMinutes()) / (24 * 60)) * 100}%`,
                    display: 'none' // Hidden for now as we use a list view, but ready for timeline view
                  }}
                >
                  <div className="h-px flex-1 bg-red-400/50" />
                  <span className="text-[8px] font-black text-red-500 uppercase bg-white px-2 py-0.5 rounded-full border border-red-100 shadow-sm">Now</span>
                </div>
              )}
              {dayEvents.map((event: any, idx: number) => (
                <VisualEvent 
                  key={`${event.event_id || idx}-${dayKey}`}
                  event={event}
                  isApplied={appliedChanges.includes(event.event_id)}
                  isVetted={isVetted}
                  isWork={isWorkEvent(event)}
                  timezone={timezone}
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