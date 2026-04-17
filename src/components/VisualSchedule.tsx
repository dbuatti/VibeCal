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
      <div className="p-12 text-center bg-white/50 rounded-[2rem] border border-dashed border-gray-200">
        <p className="text-gray-500 font-bold">No events to display in the visual timeline.</p>
      </div>
    );
  }

  const getEventIcon = (title: string = '') => {
    const t = title.toLowerCase();
    if (t.includes('lunch')) return <Utensils size={14} />;
    if (t.includes('dinner')) return <Utensils size={14} />;
    if (t.includes('piano') || t.includes('music') || t.includes('sheet')) return <Music size={14} />;
    if (t.includes('laptop') || t.includes('code') || t.includes('debug')) return <Laptop size={14} />;
    if (t.includes('coffee') || t.includes('break')) return <Coffee size={14} />;
    return null;
  };

  const getEventStyles = (event: any) => {
    const t = (event.title || '').toLowerCase();
    
    if (event.is_surplus) {
      return "bg-amber-50/40 border-amber-200 border-dashed text-amber-800 py-2 px-3";
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
      "w-full overflow-x-auto pb-8 scrollbar-hide transition-all duration-500",
      isVetted && "grayscale-[0.5] opacity-80"
    )}>
      <div className="inline-grid grid-flow-col auto-cols-[320px] gap-4">
        {sortedDayKeys.map(dayKey => {
          const isDayToday = isToday(parseISO(dayKey));
          const dayEvents = days[dayKey].sort((a: any, b: any) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime());
          
          return (
            <div key={`col-${dayKey}`} className="flex flex-col min-h-full">
              <div className="p-4 space-y-2 relative flex-1">
                <div className="relative z-10 space-y-2">
                  {dayEvents.map((event: any, idx: number) => {
                    const isApplied = appliedChanges.includes(event.event_id);
                    const styles = getEventStyles(event);
                    const icon = getEventIcon(event.title);

                    return (
                      <div 
                        key={`${dayKey}-${idx}`}
                        className={cn(
                          "p-3 rounded-2xl border transition-all duration-300 group relative",
                          styles,
                          (isApplied || isVetted) && "opacity-40 grayscale",
                          event.is_surplus && "scale-[0.98] hover:scale-100"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              {event.is_surplus ? (
                                <Inbox size={12} className="text-amber-500 shrink-0" />
                              ) : (
                                icon && <span className="opacity-70 shrink-0">{icon}</span>
                              )}
                              <h4 className={cn(
                                "font-black leading-tight",
                                event.is_surplus ? "text-[10px]" : "text-xs"
                              )}>
                                {event.title}
                              </h4>
                            </div>
                            
                            <div className="flex items-center gap-1.5 text-[9px] font-bold opacity-60">
                              <Clock size={10} />
                              {format(parseISO(event.start_time), 'HH:mm')} – {format(parseISO(event.end_time), 'HH:mm')}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            {event.is_surplus ? (
                              <Badge variant="outline" className="text-[7px] font-black border-amber-200 text-amber-600 bg-white px-1 py-0">BACKLOG</Badge>
                            ) : event.type === 'proposed' ? (
                              <Sparkles size={12} className="text-indigo-500" />
                            ) : (
                              <Lock size={10} className="opacity-30" />
                            )}
                          </div>
                        </div>

                        {event.type === 'proposed' && !isApplied && !isVetted && !event.is_surplus && (
                          <div className="absolute -right-1 -top-1">
                            <div className="w-2 h-2 bg-indigo-500 rounded-full border-2 border-white shadow-sm animate-pulse" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VisualSchedule;