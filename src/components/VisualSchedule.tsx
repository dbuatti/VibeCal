import React from 'react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { Lock, Sparkles, Clock, Utensils, Music, Laptop, Coffee, Inbox, Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

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

  const getEventIcon = (title: string = '') => {
    const t = title.toLowerCase();
    if (t.includes('lunch') || t.includes('dinner')) return <Utensils size={14} />;
    if (t.includes('piano') || t.includes('music')) return <Music size={14} />;
    if (t.includes('laptop') || t.includes('code')) return <Laptop size={14} />;
    if (t.includes('coffee') || t.includes('break')) return <Coffee size={14} />;
    return null;
  };

  const getEventStyles = (event: any) => {
    const t = (event.title || '').toLowerCase();
    const isWork = isWorkEvent(event);
    
    if (event.is_surplus) return "bg-amber-50/40 border-amber-200 border-dashed text-amber-800";
    if (event.type === 'locked') {
      if (t.includes('lunch') || t.includes('dinner')) return "bg-blue-50/50 border-blue-100 text-blue-700";
      if (isWork) return "bg-slate-50 border-slate-200 text-slate-700 shadow-sm";
      return "bg-white border-gray-100 text-gray-500 shadow-sm";
    }
    if (t.includes('piano') || t.includes('music')) return "bg-orange-50 border-orange-100 text-orange-800 shadow-sm";
    if (isWork) return "bg-indigo-50/80 border-indigo-200 text-indigo-900 shadow-sm";
    return "bg-indigo-50 border-indigo-100 text-indigo-800 shadow-sm";
  };

  return (
    <div className={cn("w-full transition-all duration-500", isVetted && "grayscale-[0.8] opacity-60")}>
      <div className="space-y-3">
        {sortedDayKeys.map(dayKey => {
          const dayEvents = days[dayKey].sort((a: any, b: any) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime());
          return (
            <div key={`col-${dayKey}`} className="space-y-3">
              {dayEvents.map((event: any, idx: number) => {
                const isApplied = appliedChanges.includes(event.event_id);
                const styles = getEventStyles(event);
                const icon = getEventIcon(event.title);
                const isWork = isWorkEvent(event);

                return (
                  <div key={`${dayKey}-${idx}`} className={cn("p-4 rounded-2xl border transition-all duration-300 group relative overflow-hidden", styles, (isApplied || isVetted) && "opacity-40 grayscale")}>
                    {/* Work Watermark */}
                    {isWork && (
                      <div className="absolute -right-2 -bottom-2 opacity-[0.07] pointer-events-none rotate-12">
                        <Briefcase size={64} />
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between gap-4 relative z-10">
                      <div className="flex items-center gap-4 flex-1">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all", event.type === 'locked' ? "bg-gray-50/50" : "bg-white/80 shadow-sm")}>
                          {event.is_surplus ? <Inbox size={16} className="text-amber-500" /> : (icon || (event.type === 'locked' ? <Lock size={14} className="opacity-30" /> : <Sparkles size={16} className="text-indigo-500" />))}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className={cn("font-black leading-tight tracking-tight", event.is_surplus ? "text-xs" : "text-sm")}>{event.title}</h4>
                            {isWork && (
                              <Badge variant="secondary" className="bg-slate-200/50 text-slate-600 text-[7px] font-black px-1 py-0 h-3 uppercase tracking-tighter border-none">
                                Work
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 text-[8px] font-black uppercase tracking-widest opacity-50">
                            <Clock size={10} />
                            {format(parseISO(event.start_time), 'HH:mm')} – {format(parseISO(event.end_time), 'HH:mm')}
                          </div>
                        </div>
                      </div>
                      {event.is_surplus && <Badge variant="outline" className="text-[7px] font-black border-amber-200 text-amber-600 bg-white px-1.5 py-0">BACKLOG</Badge>}
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

export default VisualSchedule;