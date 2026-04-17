import React from 'react';
import { format, parseISO, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { Lock, Sparkles, Clock } from 'lucide-react';

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

  return (
    <div className="space-y-10 pb-10">
      {sortedDayKeys.map(dayKey => (
        <div key={dayKey} className="space-y-4">
          <div className="flex items-center gap-4">
            <h3 className="text-xl font-black text-gray-900">
              {format(parseISO(dayKey), 'EEEE, MMM d')}
            </h3>
            <div className="h-px flex-1 bg-gray-100" />
          </div>

          <div className="relative pl-8 border-l-2 border-gray-50 space-y-3">
            {days[dayKey]
              .sort((a: any, b: any) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime())
              .map((event: any, idx: number) => (
                <div 
                  key={idx}
                  className={cn(
                    "relative p-4 rounded-2xl transition-all duration-300",
                    event.type === 'locked' 
                      ? "bg-gray-50/50 border border-gray-100 opacity-60" 
                      : "bg-white border border-indigo-100 shadow-sm ring-1 ring-indigo-50",
                    event.is_applied && "opacity-40 grayscale"
                  )}
                >
                  {/* Time Indicator Dot */}
                  <div className={cn(
                    "absolute -left-[37px] top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-4 border-[#F8F9FC]",
                    event.type === 'locked' ? "bg-gray-200" : "bg-indigo-500"
                  )} />

                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                        event.type === 'locked' ? "bg-gray-100 text-gray-400" : "bg-indigo-50 text-indigo-600"
                      )}>
                        {event.type === 'locked' ? <Lock size={18} /> : <Sparkles size={18} />}
                      </div>
                      <div>
                        <h4 className={cn(
                          "font-bold text-base",
                          event.type === 'locked' ? "text-gray-500" : "text-gray-900"
                        )}>
                          {event.title}
                        </h4>
                        <div className="flex items-center gap-2 text-xs font-medium text-gray-400 mt-0.5">
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {format(parseISO(event.start_time), 'HH:mm')} - {format(parseISO(event.end_time), 'HH:mm')}
                          </span>
                          <span>•</span>
                          <span>{event.duration_minutes}m</span>
                          {event.theme_matched && (
                            <>
                              <span>•</span>
                              <span className="text-indigo-500 font-bold uppercase tracking-wider text-[10px]">
                                {event.theme_matched}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {event.type === 'proposed' && !event.is_applied && (
                      <div className="px-3 py-1 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-lg shadow-indigo-100">
                        New Slot
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default VisualSchedule;