"use client";

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, ListOrdered } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlannerStatsProps {
  hours: number;
  maxHours: number;
  tasks: number;
  maxTasks: number;
  isOverHours: boolean;
  isOverTasks: boolean;
}

const PlannerStats = ({ 
  hours, 
  maxHours, 
  tasks, 
  maxTasks, 
  isOverHours, 
  isOverTasks 
}: PlannerStatsProps) => {
  return (
    <Card className="border-none shadow-md rounded-2xl overflow-hidden bg-white">
      <CardContent className="p-6 space-y-6">
        <div className="space-y-3">
          <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
            <span className="flex items-center gap-1.5 text-gray-500">
              <Clock size={14} className="text-indigo-500" /> Hours
            </span>
            <span className={cn(isOverHours ? "text-red-500" : "text-gray-900")}>
              {hours.toFixed(1)} / {maxHours}h
            </span>
          </div>
          <div className="h-1.5 w-full bg-gray-50 rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all duration-700", isOverHours ? "bg-red-400" : "bg-indigo-500")} 
              style={{ width: `${Math.min((hours / maxHours) * 100, 100)}%` }} 
            />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between text-[9px] font-black uppercase tracking-widest">
            <span className="flex items-center gap-1.5 text-gray-500">
              <ListOrdered size={14} className="text-indigo-500" /> Tasks
            </span>
            <span className={cn(isOverTasks ? "text-red-500" : "text-gray-900")}>
              {tasks} / {maxTasks}
            </span>
          </div>
          <div className="h-1.5 w-full bg-gray-50 rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all duration-700", isOverTasks ? "bg-red-400" : "bg-indigo-500")} 
              style={{ width: `${Math.min((tasks / maxTasks) * 100, 100)}%` }} 
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PlannerStats;