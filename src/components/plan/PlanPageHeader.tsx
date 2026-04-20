"use client";

import React from 'react';
import { Brain, Eye, EyeOff, CheckSquare, Settings2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface PlanPageHeaderProps {
  currentStep: string;
  isProcessing: boolean;
  deepFocus: boolean;
  setDeepFocus: (val: boolean) => void;
  onVetTasks: () => void;
  onFullSync: () => void;
  onReset: () => void;
  renderRequirementsForm: () => React.ReactNode;
}

const PlanPageHeader = ({
  currentStep,
  isProcessing,
  deepFocus,
  setDeepFocus,
  onVetTasks,
  onFullSync,
  onReset,
  renderRequirementsForm
}: PlanPageHeaderProps) => {
  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Badge className="bg-indigo-50 text-indigo-600 border-none px-3 py-1 rounded-full font-black flex gap-2 text-[9px] uppercase tracking-widest">
            <Brain size={12} /> ADHD Focus
          </Badge>
          {currentStep === 'active_plan' && (
            <div className="flex items-center gap-2 px-3 py-1 bg-white rounded-full border border-gray-100 shadow-sm">
              <Switch id="deep-focus" checked={deepFocus} onCheckedChange={setDeepFocus} className="h-4 w-8" />
              <Label htmlFor="deep-focus" className="text-[9px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 cursor-pointer">
                {deepFocus ? <EyeOff size={12} /> : <Eye size={12} />}
                Compact
              </Label>
            </div>
          )}
        </div>
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Daily Plan</h1>
      </div>
      <div className="flex items-center gap-3">
        {(currentStep === 'active_plan' || currentStep === 'vetting_tasks') && (
          <Button 
            variant="outline" 
            onClick={onVetTasks}
            className="bg-white border-gray-100 text-gray-500 rounded-xl font-black text-[9px] uppercase tracking-widest h-10 px-4 shadow-sm"
          >
            <CheckSquare size={14} className="mr-2" /> Vet Tasks
          </Button>
        )}
        
        {currentStep === 'active_plan' ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="bg-white border-gray-100 text-gray-500 rounded-xl font-black text-[9px] uppercase tracking-widest h-10 px-4 shadow-sm">
                <Settings2 size={14} className="mr-2" /> Requirements
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 rounded-[2rem] shadow-2xl border-none p-6" align="end">
              <h3 className="text-sm font-black text-gray-900 mb-4 uppercase tracking-widest">Plan Requirements</h3>
              {renderRequirementsForm()}
            </PopoverContent>
          </Popover>
        ) : currentStep === 'requirements' && (
          <Button variant="outline" className="bg-white border-gray-100 text-gray-500 rounded-xl font-black text-[9px] uppercase tracking-widest h-10 px-4 shadow-sm">
            <Settings2 size={14} className="mr-2" /> Requirements
          </Button>
        )}
        
        {/* Rainbow Full Sync Button */}
        <button
          onClick={onFullSync}
          disabled={isProcessing}
          title="Full Sync"
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-lg hover:scale-110 active:scale-95 disabled:opacity-50 disabled:grayscale",
            "bg-gradient-to-tr from-red-500 via-yellow-400 via-green-400 via-blue-500 to-purple-600 text-white"
          )}
        >
          <RefreshCw size={18} className={cn(isProcessing && "animate-spin")} />
        </button>

        {currentStep === 'active_plan' && (
          <Button variant="outline" onClick={onReset} className="bg-white border-gray-100 text-gray-400 hover:text-red-500 rounded-xl font-black text-[9px] uppercase tracking-widest h-10 px-4 shadow-sm">
            <Trash2 size={14} className="mr-2" /> Clear Plan
          </Button>
        )}
      </div>
    </div>
  );
};

export default PlanPageHeader;