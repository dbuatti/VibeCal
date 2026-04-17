"use client";

import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Inbox, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const DAYS = [
  { label: 'Sun', value: 0 }, { label: 'Mon', value: 1 }, { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 }, { label: 'Thu', value: 4 }, { label: 'Fri', value: 5 }, { label: 'Sat', value: 6 },
];

interface RequirementsFormProps {
  durationOverride: string;
  setDurationOverride: (val: string) => void;
  slotAlignment: string;
  setSlotAlignment: (val: string) => void;
  selectedDays: number[];
  setSelectedDays: (days: number[] | ((prev: number[]) => number[])) => void;
  maxHoursOverride: number;
  setMaxHoursOverride: (val: number) => void;
  maxTasksOverride: number;
  setMaxTasksOverride: (val: number) => void;
  placeholderDate: string;
  setPlaceholderDate: (val: string) => void;
  onOptimise: () => void;
}

const RequirementsForm = ({
  durationOverride,
  setDurationOverride,
  slotAlignment,
  setSlotAlignment,
  selectedDays,
  setSelectedDays,
  maxHoursOverride,
  setMaxHoursOverride,
  maxTasksOverride,
  setMaxTasksOverride,
  placeholderDate,
  setPlaceholderDate,
  onOptimise
}: RequirementsFormProps) => {
  return (
    <div className="space-y-6 p-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Duration</Label>
          <Select value={durationOverride} onValueChange={setDurationOverride}>
            <SelectTrigger className="h-10 rounded-xl border-gray-100 font-bold text-xs px-3 bg-gray-50/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="original">Original</SelectItem>
              <SelectItem value="15">15m</SelectItem>
              <SelectItem value="30">30m</SelectItem>
              <SelectItem value="45">45m</SelectItem>
              <SelectItem value="60">60m</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Alignment</Label>
          <Select value={slotAlignment} onValueChange={setSlotAlignment}>
            <SelectTrigger className="h-10 rounded-xl border-gray-100 font-bold text-xs px-3 bg-gray-50/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="5">5m</SelectItem>
              <SelectItem value="15">15m</SelectItem>
              <SelectItem value="30">30m</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Allowed Days</Label>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((day) => (
            <button 
              key={day.value} 
              onClick={() => setSelectedDays(prev => prev.includes(day.value) ? prev.filter(d => d !== day.value) : [...prev, day.value])} 
              className={cn(
                "px-2.5 py-1.5 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all border",
                selectedDays.includes(day.value) ? "bg-indigo-600 border-indigo-600 text-white shadow-sm" : "bg-white border-gray-100 text-gray-400"
              )}
            >
              {day.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Max Hours</Label>
          <Input type="number" value={maxHoursOverride} onChange={(e) => setMaxHoursOverride(parseInt(e.target.value))} className="h-10 rounded-xl border-gray-100 font-bold text-sm px-3 bg-gray-50/50" />
        </div>
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Max Tasks</Label>
          <Input type="number" value={maxTasksOverride} onChange={(e) => setMaxTasksOverride(parseInt(e.target.value))} className="h-10 rounded-xl border-gray-100 font-bold text-sm px-3 bg-gray-50/50" />
        </div>
      </div>

      <div className="space-y-2 p-4 bg-amber-50/50 rounded-2xl border border-amber-100">
        <Label className="text-[10px] font-black uppercase tracking-widest text-amber-600 flex items-center gap-2">
          <Inbox size={12} /> Surplus Handling
        </Label>
        <div className="space-y-2">
          <p className="text-[9px] text-amber-700 font-bold leading-tight">Overflow tasks will be moved to:</p>
          <Input 
            type="date" 
            value={placeholderDate} 
            onChange={(e) => setPlaceholderDate(e.target.value)}
            className="h-9 rounded-xl border-amber-100 font-bold text-xs px-3 bg-white focus:ring-amber-500"
          />
        </div>
      </div>
      
      <Button onClick={onOptimise} className="w-full bg-indigo-600 text-white rounded-xl py-6 text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-100">
        <Wand2 size={14} className="mr-2" /> Re-Generate Plan
      </Button>
    </div>
  );
};

export default RequirementsForm;