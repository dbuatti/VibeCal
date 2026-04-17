import React from 'react';
import { format, parseISO, startOfDay, addHours, differenceInMinutes } from 'date-fns';
import { cn } from '@/lib/utils';
import { Lock, Sparkles, Clock, MapPin, RefreshCw, Utensils, Music, Laptop, Coffee, CheckCircle2 } from 'lucide-react';

interface VisualScheduleProps {
  events: any[];
  changes: any[];
  appliedChanges: string[];
}

const VisualSchedule = ({ events, changes, appliedChanges }: VisualScheduleProps) => {
  // Combine locked events with proposed changes
  const allVisualEvents = [
    ...events.filter(e => e.is_locked).map(e => ({ ...e, type: 'locked' })),
    ...changes.map(c => ({
      ...c,
      start_time: c.new_start,
      end_time: c.new_end,
      duration_minutes: c.duration,
      type: 'proposed',
      is_applied: appliedChanges.includes(c.event_id)
    }))
  ];

  // Group by day
  const days = allVisualEvents.reduce((acc: any, event) => {
    const dayKey = format(parseISO(event.start_time), 'yyyy-MM-dd');
    if (!acc[dayKey]) acc[dayKey] = [];
    acc[dayKey].push(event);
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

  // Helper to get icon based on title
  const getEventIcon = (title: string) => {
    const t = title.toLowerCase();
    if (t.includes('lunch')) return <Utensils size={14} />;
    if (t.includes('dinner')) return <Utensils size={14} />;
    if (t.includes('piano') || t.includes('music') || t.includes('sheet')) return <Music size={14} />;
    if (t.includes('laptop') || t.includes('code') || t.includes('debug')) return <Laptop size={14} />;
    if (t.includes('coffee') || t.includes('break')) return <Coffee size={14} />;
    return null;
  };

  // Helper to get color based on title or type
  const getEventStyles = (event: any) => {
    const t = event.title.toLowerCase();
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
    <div className="w-full overflow-x-auto pb-8">
      <div className="min-w-[1000px] grid grid-cols-5 gap-px bg-gray-100 border border-gray-100 rounded-3xl overflow-hidden shadow-sm">
        {/* Day Headers */}
        {sortedDayKeys.slice(0, 5).map(dayKey => (
          <div key={`header-${dayKey}`} className="bg-white p-6 text-center border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">
              {format(parseISO(dayKey), 'EEE d')}
            </h3>
          </div>
        ))}

        {/* Day Columns */}
        {sortedDayKeys.slice(0, 5).map(dayKey => (
          <div key={`col-${dayKey}`} className="bg-[#F8F9FC] min-h-[800px] p-3 space-y-3 relative">
            {/* Grid Lines (Visual only) */}
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="h-20 border-b border-gray-50/50 w-full" />
              ))}
            </div>

            {/* Events */}
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
                            {icon && <span className="opacity-70">{icon}</span>}
                            <h4 className="font-bold text-sm leading-tight">
                              {event.title}
                            </h4>
                          </div>
                          
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold opacity-60">
                              <Clock size={10} />
                              {format(parseISO(event.start_time), 'HH:mm')} – {format(parseISO(event.end_time), 'HH:mm')}
                            </div>
                            
                            {event.location && (
                              <div className="flex items-center gap-1.5 text-[10px] font-bold opacity-60">
                                <MapPin size={10} />
                                {event.location}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          {event.type === 'proposed' ? (
                            <Sparkles size={14} className="text-indigo-500" />
                          ) : (
                            <RefreshCw size={12} className="opacity-30" />
                          )}
                        </div>
                      </div>

                      {event.type === 'proposed' && !isApplied && (
                        <div className="absolute -right-1 -top-1">
                          <div className="w-3 h-3 bg-indigo-500 rounded-full border-2 border-white shadow-sm animate-pulse" />
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VisualSchedule;