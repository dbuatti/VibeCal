"use client";

import React, { useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { 
  Lock, 
  Sparkles, 
  Clock, 
  Utensils, 
  Music, 
  Laptop, 
  Coffee, 
  Inbox, 
  Briefcase, 
  ChevronRight, 
  MapPin, 
  AlignLeft, 
  ChevronDown, 
  ChevronUp, 
  Link as LinkIcon,
  Zap
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface VisualEventProps {
  event: any;
  isApplied: boolean;
  isVetted: boolean;
  isWork: boolean;
  timezone?: string;
}

const VisualEvent = ({ event, isApplied, isVetted, isWork, timezone = 'Australia/Melbourne' }: VisualEventProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getEventIcon = (title: string = '') => {
    const t = title.toLowerCase();
    if (t.includes('lunch') || t.includes('dinner')) return <Utensils size={16} />;
    if (t.includes('piano') || t.includes('music')) return <Music size={16} />;
    if (t.includes('laptop') || t.includes('code') || t.includes('dev')) return <Laptop size={16} />;
    if (t.includes('coffee') || t.includes('break')) return <Coffee size={16} />;
    if (t.includes('gym') || t.includes('workout') || t.includes('run')) return <Zap size={16} />;
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

  const formatTime = (isoStr: string) => {
    if (!isoStr) return '--:--';
    try {
      const date = parseISO(isoStr);
      if (!isValid(date)) return '--:--';
      return formatInTimeZone(date, timezone, 'HH:mm');
    } catch (e) {
      return '--:--';
    }
  };

  return (
    <div 
      onClick={() => hasDetails && setIsExpanded(!isExpanded)}
      className={cn(
        "p-6 rounded-[2rem] border transition-all duration-500 group relative overflow-hidden cursor-pointer", 
        styles, 
        (isApplied || isVetted) && "opacity-40 grayscale-[0.5] scale-[0.98]",
        !isApplied && !isVetted && "hover:scale-[1.02] hover:shadow-2xl hover:shadow-indigo-100 active:scale-[0.99]"
      )}
    >
      {/* Work Watermark */}
      {isWork && (
        <div className="absolute -right-4 -bottom-4 opacity-[0.05] pointer-events-none rotate-12 group-hover:rotate-0 transition-transform duration-700">
          <Briefcase size={80} />
        </div>
      )}
      
      <div className="flex items-center justify-between gap-4 relative z-10">
        <div className="flex items-center gap-5 flex-1 min-w-0">
          <div className={cn(
            "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-700 group-hover:rotate-6 group-hover:scale-110", 
            event.type === 'locked' ? "bg-gray-50/50" : "bg-white/90 shadow-md"
          )}>
            {event.is_surplus ? (
              <Inbox size={20} className="text-amber-500" />
            ) : (
              icon || (event.type === 'locked' ? <Lock size={18} className="opacity-30" /> : <Sparkles size={20} className="text-indigo-500" />)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className={cn("font-black leading-tight tracking-tight truncate text-lg", event.is_surplus ? "text-sm" : "text-xl")}>
                {event.title}
              </h4>
              {isWork && (
                <Badge variant="secondary" className="bg-slate-200/50 text-slate-600 text-[9px] font-black px-2 py-0.5 h-5 uppercase tracking-widest border-none">
                  Work
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest opacity-50">
                <Clock size={12} className="text-indigo-400" />
                {formatTime(event.start_time)} – {formatTime(event.end_time)}
              </div>
              {event.location && (
                <div className="flex items-center gap-1 text-[10px] font-bold text-indigo-500/70 truncate max-w-[150px]">
                  <MapPin size={12} />
                  {event.location}
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {event.is_surplus && (
            <Badge variant="outline" className="text-[9px] font-black border-amber-200 text-amber-600 bg-white px-3 py-1 rounded-full">
              BACKLOG
            </Badge>
          )}
          {hasDetails && (
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300",
              isExpanded ? "bg-indigo-600 text-white rotate-180" : "bg-indigo-50 text-indigo-600"
            )}>
              <ChevronDown size={16} />
            </div>
          )}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && hasDetails && (
        <div className="mt-6 pt-6 border-t border-black/5 space-y-4 animate-in slide-in-from-top-4 duration-500 relative z-10">
          {event.location && (
            <div className="flex items-start gap-4 bg-white/50 p-4 rounded-2xl border border-black/5">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-500 shrink-0">
                <MapPin size={16} />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Location</p>
                <p className="text-sm font-bold text-gray-700 leading-tight">{event.location}</p>
              </div>
            </div>
          )}
          {event.description && (
            <div className="flex items-start gap-4 bg-white/50 p-4 rounded-2xl border border-black/5">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-500 shrink-0">
                <AlignLeft size={16} />
              </div>
              <div className="space-y-1 w-full">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Notes & Details</p>
                <div className="text-xs font-medium text-gray-600 leading-relaxed whitespace-pre-wrap break-words">
                  {event.description}
                </div>
              </div>
            </div>
          )}
          {event.description?.includes('http') && (
            <div className="flex items-center gap-2 text-[10px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50/50 w-fit px-4 py-2 rounded-full">
              <LinkIcon size={14} />
              Links detected in notes
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VisualEvent;