import React from 'react';
import { format, parseISO, isToday } from 'date-fns';
import { cn } from '@/lib/utils';
import { Lock, Sparkles, Clock, MapPin, RefreshCw, Utensils, Music, Laptop, Coffee, Inbox } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface VisualScheduleProps {
  events: any[];
  changes: any[];
  appliedChanges: string[];
}

const VisualSchedule = ({ events = [], changes = [], appliedChanges = [] }: VisualScheduleProps) => {
  console.log("[VisualSchedule] Rendering with:", { events: events.length, changes: changes.length });

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
      <div className="p-12 text-center bg-white rounded-[2rem] border border-dashed border-gray-200">
        <p className="text-gray-500">No events to display in the visual timeline.</p>
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
      return "bg-amber-50/30 border-amber-200 border-dashed text-amber-800";
    }

    if (event.type === 'locked') {
      if (t.includes('lunch') || t.includes('dinner')) return "bg-blue-50/50 border-blue-100 text-blue-700";
      return "bg-gray-50/50 border-gray-100 text-gray-500";
    }
    
    if (t.includes('piano') || t.includes('music') || t.includes('assessment')) {
      return "bg-orange-50 border-orange-100 text-orange-800";
    }
    
    return "bg-indigo-50 border-indigo-100 text-indigo-800";
  };

  return (
    <div className="w-full overflow-x-auto pb-8 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
      <div className="inline-grid grid-flow-col auto-cols-[280px] gap-px bg-gray-100 border border-gray-100 rounded-3xl overflow-hidden shadow-sm">
        {sortedDayKeys.map(dayKey => {
          const isDayToday = isToday(parseISO(dayKey));
          return (
            <div key={`col-${dayKey}`} className={cn(
              "flex flex-col min-h-full transition-colors",
              isDayToday ? "bg-indigo-50/30" : "bg-[#F8F9FC]"
            )}>
              <div className={cn(
                "p-6 text-center border-b border-gray-100 sticky top-0 z-20 transition-colors",
                isDayToday ? "bg-indigo-600 text-white" : "bg-white text-gray-900"
              )}>
                <h3 className="text-lg font-bold">
                  {format(parseISO(dayKey), 'EEE d')}
                </h3>
                <p className={cn(
                  "text-[10px] font-bold uppercase tracking-wider mt-1",
                  isDayToday ? "text-indigo-100" : "text-gray-400"
                )}>
                  {isDayToday ? 'TODAY' : format(parseISO(dayKey), 'MMMM')}
                </p>
              </div>

              <div className="p-3 space-y-3 relative flex-1 min-h-[600px]">
                <div className="absolute inset-0 pointer-events-none">
                  {[...Array(12)].map((_, i) => (
                    <div key={i} className="h-20 border-b border-gray-50/50 w-full" />
                  ))}
                </div>

                <div className="relative z-10 space-y-3">
                  {days[dayKey]
                    .sort((a: any, b: any) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime())
                    .map((event: any, idx: number) => {
                      const isApplied = appliedChanges.includes(event.event_id);
                      const styles = getEventStyles(event);
                      const icon = getEventIcon(event.title);

                      return (
                        <div 
                          key={`${dayKey}-${idx}`}
                          className={cn(
                            "p-4 rounded-xl border transition-all duration-300 group relative",
                            styles,
                            isApplied && "opacity-40 grayscale"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                {event.is_surplus ? <Inbox size={14} className="text-amber-500" /> : icon && <span className="opacity-70">{icon}</span>}
                                <h4 className="font-bold text-sm leading-tight">
                                  {event.title}
                                </h4>
                              </div>
                              
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-[10px] font-bold opacity-60">
                                  <Clock size={10} />
                                  {format(parseISO(event.start_time), 'HH:mm')} – {format(parseISO(event.end_time), 'HH:mm')}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-2">
                              {event.is_surplus ? (
                                <Badge variant="outline" className="text-[8px] font-black border-amber-200 text-amber-600 bg-white">BACKLOG</Badge>
                              ) : event.type === 'proposed' ? (
                                <Sparkles size={14} className="text-indigo-500" />
                              ) : (
                                <Lock size={12} className="opacity-30" />
                              )}
                            </div>
                          </div>

                          {event.type === 'proposed' && !isApplied && !event.is_surplus && (
                            <div className="absolute -right-1 -top-1">
                              <div className="w-3 h-3 bg-indigo-500 rounded-full border-2 border-white shadow-sm animate-pulse" />
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