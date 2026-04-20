"use client";

import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Lock, Sparkles, Clock, Utensils, Music, Laptop, Coffee, Inbox, Briefcase, ChevronRight, MapPin, AlignLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface VisualEventProps {
  event: any;
  isApplied: boolean;
  isVetted: boolean;
  isWork: boolean;
}

const VisualEvent = ({ event, isApplied, isVetted, isWork }: VisualEventProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

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

  const styles = getEventStyles(event);
  const icon = getEventIcon(event.title);
  const hasDetails = event.location || event.description;

  return (
    <div className={cn(
      "p-5 rounded-[1.5rem] border transition-all duration-300 group relative overflow-hidden hover:scale-[1.01] active:scale-[0.99]", 
      styles, 
      (isApplied || isVetted) && "opacity-40 grayscale"
    )}>
      {/* Work Watermark */}
      {isWork && (
        <div className="absolute -right-2 -bottom-2 opacity-[0.07] pointer-events-none rotate-12 group-hover:rotate-0 transition-transform duration-500">
          <Briefcase size={64} />
        </div>
      )}
      
      <div className="flex items-center justify-between gap-4 relative z-10">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className={cn(
            "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-500 group-hover:rotate-6", 
            event.type === 'locked' ? "bg-gray-50/50" : "bg-white/80 shadow-sm"
          )}>
            {event.is_surplus ? (
              <Inbox size={18} className="text-amber-500" />
            ) : (
              icon || (event.type === 'locked' ? <Lock size={16} className="opacity-30" /> : <Sparkles size={18} className="text-indigo-500" />)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className={cn("font-black leading-tight tracking-tight truncate", event.is_surplus ? "text-xs" : "text-base")}>
                {event.title}
              </h4>
              {isWork && (
                <Badge variant="secondary" className="bg-slate-200/50 text-slate-600 text-[8px] font-black px-1.5 py-0 h-4 uppercase tracking-tighter border-none">
                  Work
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest opacity-50">
                <Clock size={10} />
                {format(parseISO(event.start_time), 'HH:mm')} – {format(parseISO(event.end_time), 'HH:mm')}
              </div>
              {hasDetails && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                  className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-700 transition-colors"
                >
                  {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  Details
                </button>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {event.is_surplus && (
            <Badge variant="outline" className="text-[8px] font-black border-amber-200 text-amber-600 bg-white px-2 py-0.5">
              BACKLOG
            </Badge>
          )}
          {event.type === 'proposed' && !isApplied && (
            <div className="w-8 h-8 rounded-full bg-indigo-600/10 flex items-center justify-center text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronRight size={16} />
            </div>
          )}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && hasDetails && (
        <div className="mt-4 pt-4 border-t border-black/5 space-y-3 animate-in slide-in-from-top-2 duration-300 relative z-10">
          {event.location && (
            <div className="flex items-start gap-2">
              <MapPin size={12} className="text-gray-400 mt-0.5 shrink-0" />
              <p className="text-[10px] font-bold text-gray-600 leading-tight">{event.location}</p>
            </div>
          )}
          {event.description && (
            <div className="flex items-start gap-2">
              <AlignLeft size={12} className="text-gray-400 mt-0.5 shrink-0" />
              <p className="text-[10px] font-medium text-gray-500 leading-relaxed whitespace-pre-wrap">
                {event.description}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VisualEvent;