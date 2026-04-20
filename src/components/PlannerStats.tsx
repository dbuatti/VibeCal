"use client";

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, ListOrdered, Lock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface PlannerStatsProps {
  fixedHours: number;
  shuffledHours: number;
  maxHours: number;
  tasks: number;
  maxTasks: number;
  isOverHours: boolean;
  isOverTasks: boolean;
}

const PlannerStats = ({ 
  fixedHours = 0,
  shuffledHours = 0,
  maxHours = 6, 
  tasks = 0, 
  maxTasks = 5, 
  isOverHours = false, 
  isOverTasks = false 
}: PlannerStatsProps) => {
  const totalHours = (fixedHours || 0) + (shuffledHours || 0);
  const safeMaxHours = maxHours || 1;
  const fixedWidth = Math.min(((fixedHours || 0) / safeMaxHours) * 100, 100);
  const shuffledWidth = Math.min(((shuffledHours || 0) / safeMaxHours) * 100, 100 - fixedWidth);

  return (
    <TooltipProvider>
      <Card className="border-none shadow-md rounded-2xl overflow-hidden bg-white">
        <CardContent className="p-6 space-y-6">
          {/* Hours Progress */}
          <div className="space-y-3">
            <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
              <span className="flex items-center gap-1.5 text-gray-500">
                <Clock size={14} className="text-indigo-500" /> Work Capacity
              </span>
              <span className={cn(isOverHours ? "text-red-500" : "text-gray-900")}>
                {totalHours.toFixed(1)} / {maxHours}h
              </span>
            </div>
            
            <div className="h-2.5 w-full bg-gray-100 rounded-full overflow-hidden flex shadow-inner">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className={cn("h-full transition-all duration-700 bg-slate-400")} 
                    style={{ width: `${fixedWidth}%` }} 
                  />
                </TooltipTrigger>
                <TooltipContent className="font-bold text-[10px] uppercase tracking-widest">
                  Fixed Work: {(fixedHours || 0).toFixed(1)}h
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className={cn("h-full transition-all duration-700 bg-indigo-500")} 
                    style={{ width: `${shuffledWidth}%` }} 
                  />
                </TooltipTrigger>
                <TooltipContent className="font-bold text-[10px] uppercase tracking-widest">
                  Shuffled Tasks: {(shuffledHours || 0).toFixed(1)}h
                </TooltipContent>
              </Tooltip>

              {isOverHours && (
                <div 
                  className="h-full bg-red-400 animate-pulse" 
                  style={{ width: `${Math.min(((totalHours - safeMaxHours) / safeMaxHours) * 100, 100 - (fixedWidth + shuffledWidth))}%` }} 
                />
              )}
            </div>

            <div className="flex gap-4 mt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter">Fixed Work</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-indigo-500" />
                <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter">Shuffled</span>
              </div>
            </div>
          </div>

          {/* Tasks Progress */}
          <div className="space-y-3">
            <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
              <span className="flex items-center gap-1.5 text-gray-500">
                <ListOrdered size={14} className="text-indigo-500" /> Task Count
              </span>
              <span className={cn(isOverTasks ? "text-red-500" : "text-gray-900")}>
                {tasks} / {maxTasks}
              </span>
            </div>
            <div className="h-1.5 w-full bg-gray-50 rounded-full overflow-hidden">
              <div 
                className={cn("h-full transition-all duration-700", isOverTasks ? "bg-red-400" : "bg-indigo-500")} 
                style={{ width: `${Math.min((tasks / (maxTasks || 1)) * 100, 100)}%` }} 
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};

export default PlannerStats;