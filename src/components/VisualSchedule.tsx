import React from 'react';
import { format, parseISO, isToday } from 'date-fns';
import { cn } from '@/lib/utils';
import { Lock, Sparkles, Clock, MapPin, RefreshCw, Utensils, Music, Laptop, Coffee, Inbox } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface VisualScheduleProps {
  events: any[];
  changes: any[];
  appliedChanges: string[];
  isVetted?: boolean;
}

const VisualSchedule = ({ events = [], changes = [], appliedChanges = [], isVetted = false }: VisualScheduleProps) => {
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
      <div className="p-20 text-center bg-gray-50/30 rounded-[3rem] border border-dashed border-gray-200">
        <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
          <CalendarIcon className="text-gray-200" size={40} />
        </div>
        <p className="text-gray-400 font-black uppercase tracking-[0.2em] text-xs">No events to display</p>
      </div>
    );
  }

  const getEventIcon = (title: string = '') => {
    const t = title.toLowerCase();
    if (t.includes('lunch')) return <Utensils size={16} />;
    if (t.includes('dinner')) return <Utensils size={16} />;
    if (t.includes('piano') || t.includes('music') || t.includes('sheet')) return <Music size={16} />;
    if (t.includes('laptop') || t.includes('code') || t.includes('debug')) return <Laptop size={16} />;
    if (t.includes('coffee') || t.includes('break')) return <Coffee size={16} />;
    return null;
  };

  const getEventStyles = (event: any) => {
    const t = (event.title || '').toLowerCase();
    
    if (event.is_surplus) {
      return "bg-amber-50/40 border-amber-200 border-dashed text-amber-800";
    }

    if (event.type === 'locked') {
      if (t.includes('lunch') || t.includes('dinner')) return "bg-blue-50/50 border-blue-100 text-blue-700";
      return "bg-white border-gray-100 text-gray-500 shadow-sm";
    }
    
    if (t.includes('piano') || t.includes('music') || t.includes('assessment')) {
      return "bg-orange-50 border-orange-100 text-orange-800 shadow-sm";
    }
    
    return "bg-indigo-50 border-indigo-100 text-indigo-800 shadow-sm";
  };

  return (
    <div className={cn(
      "w-full transition-all duration-700",
      isVetted && "grayscale-[0.8] opacity-60"
    )}>
      <div className="space-y-4">
        {sortedDayKeys.map(dayKey => {
          const dayEvents = days[dayKey].sort((a: any, b: any) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime());
          
          return (
            <div key={`col-${dayKey}`} className="space-y-4">
              {dayEvents.map((event: any, idx: number) => {
                const isApplied = appliedChanges.includes(event.event_id);
                const styles = getEventStyles(event);
                const icon = getEventIcon(event.title);

                return (
                  <div 
                    key={`${dayKey}-${idx}`}
                    className={cn(
                      "p-6 rounded-[2rem] border transition-all duration-500 group relative",
                      styles,
                      (isApplied || isVetted) && "opacity-40 grayscale",
                      event.is_surplus && "scale-[0.98] hover:scale-100"
                    )}
                  >
                    <div className="flex items-center justify-between gap-6">
                      <div className="flex items-center gap-5 flex-1">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-500",
                          event.type === 'locked' ? "bg-gray-50/50" : "bg-white/80 shadow-sm"
                        )}>
                          {event.is_surplus ? (
                            <Inbox size={20} className="text-amber-500" />
                          ) : (
                            icon || (event.type === 'locked' ? <Lock size={18} className="opacity-30" /> : <Sparkles size={20} className="text-indigo-500" />)
                          )}
                        </div>
                        
                        <div>
                          <h4 className={cn(
                            "font-black leading-tight tracking-tight",
                            event.is_surplus ? "text-sm" : "text-lg"
                          )}>
                            {event.title}
                          </h4>
                          <div className="flex items-center gap-2 mt-1.5 text-[10px] font-black uppercase tracking-widest opacity-50">
                            <Clock size={12} />
                            {format(parseISO(event.start_time), 'HH:mm')} – {format(parseISO(event.end_time), 'HH:mm')}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        {event.is_surplus ? (
                          <Badge variant="outline" className="text-[8px] font-black border-amber-200 text-amber-600 bg-white px-2 py-0.5">BACKLOG</Badge>
                        ) : event.type === 'proposed' && !isApplied && !isVetted && (
                          <div className="w-3 h-3 bg-indigo-500 rounded-full border-2 border-white shadow-xl animate-pulse" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CalendarIcon = ({ className, size }: { className?: string, size?: number }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width={size || 24} 
    height={size || 24} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>
  </svg>
);

export default VisualSchedule;