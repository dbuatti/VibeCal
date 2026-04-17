"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, ArrowUpRight, AlertCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

interface PlannerChangesProps {
  dayChanges: any[];
  appliedChanges: string[];
  currentDateStr: string;
  isOverCapacity: boolean;
}

const PlannerChanges = ({ 
  dayChanges, 
  appliedChanges, 
  currentDateStr,
  isOverCapacity
}: PlannerChangesProps) => {
  return (
    <Card className="border-none shadow-md rounded-2xl overflow-hidden bg-white">
      <CardHeader className="px-6 pt-6 pb-2">
        <CardTitle className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
          Changes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-6 pb-6 max-h-[300px] overflow-y-auto">
        {dayChanges.length > 0 ? dayChanges.map((change, i) => {
          const isMovingAway = format(parseISO(change.old_start), 'yyyy-MM-dd') === currentDateStr && 
                               format(parseISO(change.new_start), 'yyyy-MM-dd') !== currentDateStr;
          return (
            <div 
              key={i} 
              className={cn(
                "p-4 rounded-xl border flex items-center justify-between transition-all", 
                appliedChanges.includes(change.event_id) ? "bg-green-50 border-green-100 opacity-60" : 
                isMovingAway ? "bg-red-50/30 border-red-100" : "bg-gray-50/50 border-gray-100"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center", 
                  isMovingAway ? "bg-red-100 text-red-600" : "bg-white text-indigo-600 shadow-sm"
                )}>
                  {isMovingAway ? <ArrowUpRight size={16} /> : <Sparkles size={16} />}
                </div>
                <div>
                  <p className="text-xs font-black text-gray-900 tracking-tight truncate max-w-[120px]">
                    {change.title}
                  </p>
                  <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">
                    {isMovingAway ? `To ${format(parseISO(change.new_start), 'EEE')}` : `To ${format(parseISO(change.new_start), 'HH:mm')}`}
                  </p>
                </div>
              </div>
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