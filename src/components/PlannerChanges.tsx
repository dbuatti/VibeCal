"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, ArrowUpRight, AlertCircle, PlusCircle } from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface PlannerChangesProps {
  dayChanges: any[];
  appliedChanges: string[];
  currentDateStr: string;
  isOverCapacity: boolean;
  onReinsert?: (eventId: string) => void;
}

const PlannerChanges = ({ 
  dayChanges, 
  appliedChanges, 
  currentDateStr,
  isOverCapacity,
  onReinsert
}: PlannerChangesProps) => {
  return (
    <Card className="border-none shadow-md rounded-2xl overflow-hidden bg-white">
      <CardHeader className="px-6 pt-6 pb-2">
        <CardTitle className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
          Changes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-6 pb-6 max-h-[400px] overflow-y-auto">
        {dayChanges.length > 0 ? dayChanges.map((change, i) => {
          // Safety checks for parseISO to prevent crashes on null/invalid dates (surplus tasks)
          const oldStartDate = change.old_start ? parseISO(change.old_start) : null;
          const newStartDate = change.new_start ? parseISO(change.new_start) : null;
          
          const isOldValid = oldStartDate && isValid(oldStartDate);
          const isNewValid = newStartDate && isValid(newStartDate);

          const isMovingAway = isOldValid && isNewValid && 
                               format(oldStartDate, 'yyyy-MM-dd') === currentDateStr && 
                               format(newStartDate, 'yyyy-MM-dd') !== currentDateStr;
          
          const isApplied = appliedChanges.includes(change.event_id);

          return (
            <div 
              key={i} 
              className={cn(
                "p-4 rounded-xl border flex items-center justify-between transition-all group", 
                isApplied ? "bg-green-50 border-green-100 opacity-60" : 
                isMovingAway || change.is_surplus ? "bg-red-50/30 border-red-100" : "bg-gray-50/50 border-gray-100"
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center shrink-0", 
                  (isMovingAway || change.is_surplus) ? "bg-red-100 text-red-600" : "bg-white text-indigo-600 shadow-sm"
                )}>
                  {(isMovingAway || change.is_surplus) ? <ArrowUpRight size={16} /> : <Sparkles size={16} />}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-gray-900 tracking-tight truncate">
                    {change.title}
                  </p>
                  <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">
                    {change.is_surplus ? "Moved to Backlog" : 
                     isMovingAway && isNewValid ? `To ${format(newStartDate, 'EEE')}` : 
                     isNewValid ? `To ${format(newStartDate, 'HH:mm')}` : "Time TBD"}
                  </p>
                </div>
              </div>

              {(isMovingAway || change.is_surplus) && !isApplied && onReinsert && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onReinsert(change.event_id)}
                  className="h-8 w-8 rounded-lg text-indigo-600 hover:bg-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="Reinsert into today"
                >
                  <PlusCircle size={16} />
                </Button>
              )}
            </div>
          );
        }) : (
          <div className="space-y-4 py-4">
            <div className="text-center text-gray-300 font-black uppercase tracking-widest text-[9px]">
              No changes
            </div>
            {isOverCapacity && (
              <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 flex gap-3">
                <AlertCircle className="text-amber-500 shrink-0" size={16} />
                <p className="text-[10px] font-bold text-amber-800 leading-tight">
                  This day is over capacity, but all tasks are **Locked**. Click "Vet Tasks" to unlock some so the AI can move them.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PlannerChanges;