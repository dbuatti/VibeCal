"use client";

import React from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Wand2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PlannerHeaderProps {
  currentIndex: number;
  totalDays: number;
  currentDate: Date;
  isDayVetted: boolean;
  hasChanges: boolean;
  isResuggesting: boolean;
  showXP: boolean;
  onPrev: () => void;
  onNext: () => void;
  onResuggest?: () => void;
  onToggleVetted?: () => void;
}

const PlannerHeader = ({
  currentIndex,
  totalDays,
  currentDate,
  isDayVetted,
  hasChanges,
  isResuggesting,
  showXP,
  onPrev,
  onNext,
  onResuggest,
  onToggleVetted
}: PlannerHeaderProps) => {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex justify-between items-end px-2">
          <span className="text-[8px] font-black uppercase tracking-[0.2em] text-indigo-600">Progress</span>
          <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">
            {currentIndex + 1} / {totalDays}
          </span>
        </div>
        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
          <div 
            className="h-full bg-indigo-600 transition-all duration-700" 
            style={{ width: `${((currentIndex + 1) / totalDays) * 100}%` }} 
          />
        </div>
      </div>

      <div className={cn(
        "flex items-center justify-between p-6 rounded-[2rem] border transition-all shadow-lg", 
        isDayVetted ? "bg-green-50/50 border-green-100" : "bg-white border-gray-100"
      )}>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={onPrev} 
          disabled={currentIndex === 0} 
          className="rounded-xl h-12 w-12"
        >
          <ChevronLeft size={24} />
        </Button>
        
        <div className="text-center relative flex flex-col items-center">
          {showXP && (
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 animate-bounce">
              <Badge className="bg-yellow-400 text-yellow-900 px-4 py-1 rounded-full font-black text-[9px]">
                +50 XP
              </Badge>
            </div>
          )}
          <h2 className="text-xl font-black text-gray-900 tracking-tight">
            {format(currentDate, 'EEEE, MMM do')}
          </h2>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-2">
              <button
                onClick={onToggleVetted}
                className={cn(
                  "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                  isDayVetted 
                    ? "bg-green-500 border-green-500 text-white" 
                    : "bg-white border-gray-200 hover:border-indigo-300"
                )}
              >
                {isDayVetted && <Check size={12} strokeWidth={4} />}
              </button>
              <Badge className={cn(
                "border-none px-3 py-0.5 rounded-full font-black text-[8px] uppercase tracking-widest", 
                !hasChanges && isDayVetted ? "bg-gray-100 text-gray-400" : isDayVetted ? "bg-green-500 text-white" : "bg-indigo-100 text-indigo-600"
              )}>
                {!hasChanges && isDayVetted ? "No Changes" : isDayVetted ? "Vetted" : "Vetting"}
              </Badge>
            </div>
            {!isDayVetted && onResuggest && (
              <button 
                onClick={onResuggest}
                disabled={isResuggesting}
                className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-indigo-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
              >
                <Wand2 size={10} className={cn(isResuggesting && "animate-spin")} />
                Resuggest
              </button>
            )}
          </div>
        </div>

        <Button 
          variant="ghost" 
          size="icon" 
          onClick={onNext} 
          disabled={currentIndex === totalDays - 1} 
          className="rounded-xl h-12 w-12"
        >
          <ChevronRight size={24} />
        </Button>
      </div>
    </div>
  );
};

export default PlannerHeader;