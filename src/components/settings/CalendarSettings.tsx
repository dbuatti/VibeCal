"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar, RefreshCw, CheckSquare, Square, Pencil, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import ProviderIcon from '@/components/ProviderIcon';

interface CalendarSettingsProps {
  calendars: any[];
  isTesting: boolean;
  onDiscover: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onUpdateLabel: (id: string, label: string) => void;
  onBulkToggle?: (provider: string, enabled: boolean) => void;
}

const CalendarSettings = ({ calendars, isTesting, onDiscover, onToggle, onUpdateLabel, onBulkToggle }: CalendarSettingsProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startEdit = (cal: any) => {
    setEditingId(cal.id);
    setEditValue(cal.custom_label || cal.calendar_name);
  };

  const saveEdit = () => {
    if (editingId) {
      onUpdateLabel(editingId, editValue.trim());
      setEditingId(null);
      setEditValue('');
    }
  };

  const clearLabel = () => {
    if (editingId) {
      onUpdateLabel(editingId, '');
      setEditingId(null);
      setEditValue('');
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };
  const grouped = calendars.reduce((acc: any, cal) => {
    const provider = cal.provider || 'other';
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(cal);
    return acc;
  }, {});

  const providers = Object.keys(grouped).sort();

  const handleBulkToggle = (provider: string, enabled: boolean) => {
    if (onBulkToggle) {
      onBulkToggle(provider, enabled);
    } else {
      const providerCals = grouped[provider];
      providerCals.forEach((cal: any) => {
        if (cal.is_enabled !== enabled) {
          onToggle(cal.id, enabled);
        }
      });
    }
  };

  return (
    <TooltipProvider>
      <Card className="border-none shadow-sm rounded-2xl border-l-4 border-l-indigo-600 h-full flex flex-col overflow-hidden min-w-0">
        <CardHeader className="pb-4 shrink-0 px-6">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-lg truncate">
              <Calendar className="text-indigo-600 shrink-0" size={20} />
              <span className="truncate">Calendars</span>
            </CardTitle>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onDiscover}
              disabled={isTesting}
              className="h-8 rounded-lg text-indigo-600 hover:bg-indigo-50 font-black text-[10px] uppercase tracking-widest shrink-0"
            >
              <RefreshCw size={12} className={cn("mr-2", isTesting && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-0 flex flex-col min-w-0">
          <ScrollArea className="flex-1 w-full">
            <div className="px-6 pb-6 space-y-8 min-w-0">
              {providers.length > 0 ? providers.map((provider) => (
                <div key={provider} className="space-y-4 min-w-0">
                  <div className="flex items-center justify-between sticky top-0 bg-white py-2 z-10 border-b border-gray-100 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ProviderIcon provider={provider} />
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 truncate">
                        {provider === 'google' ? 'Google Account' : provider === 'apple' ? 'iCloud Account' : 'Other'}
                      </h3>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button 
                        onClick={() => handleBulkToggle(provider, true)}
                        className="text-[8px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-700 flex items-center gap-1"
                      >
                        <CheckSquare size={10} /> All
                      </button>
                      <button 
                        onClick={() => handleBulkToggle(provider, false)}
                        className="text-[8px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 flex items-center gap-1"
                      >
                        <Square size={10} /> None
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 min-w-0">
                    {grouped[provider].map((cal: any) => (
                      <div key={cal.id} className="flex items-center justify-between p-3 bg-gray-50/50 rounded-xl border border-gray-100 hover:border-indigo-100 transition-colors gap-3 min-w-0">
                          <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: cal.color || '#6366f1' }} />
                          {editingId === cal.id ? (
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                              <input
                                ref={inputRef}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                                className="flex-1 min-w-0 text-xs font-bold text-gray-700 bg-white border border-indigo-300 rounded-md px-2 py-1 outline-none focus:ring-2 focus:ring-indigo-400"
                                placeholder="Label this calendar..."
                              />
                              <button onClick={saveEdit} className="text-indigo-600 hover:text-indigo-800 p-0.5 shrink-0" title="Save">
                                <Check size={14} />
                              </button>
                              <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 p-0.5 shrink-0" title="Cancel">
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className={cn(
                                    "text-xs font-bold truncate cursor-default",
                                    cal.custom_label ? "text-indigo-700" : "text-gray-700"
                                  )}>
                                    {cal.custom_label || cal.calendar_name}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="rounded-lg font-bold text-[10px] max-w-[200px]">
                                  {cal.calendar_name}{cal.custom_label ? ` (custom: ${cal.custom_label})` : ''}
                                </TooltipContent>
                              </Tooltip>
                              <button
                                onClick={() => startEdit(cal)}
                                className="text-gray-300 hover:text-indigo-500 transition-colors p-0.5 shrink-0"
                                title="Rename this calendar"
                              >
                                <Pencil size={12} />
                              </button>
                            </>
                          )}
                        </div>
                        <Switch 
                          checked={cal.is_enabled} 
                          onCheckedChange={(val) => onToggle(cal.id, val)}
                          className="data-[state=checked]:bg-indigo-600 shrink-0"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )) : (
                <div className="py-10 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200 mx-6 mt-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">No calendars found</p>
                  <Button variant="link" onClick={onDiscover} className="text-indigo-600 text-[10px] font-black uppercase tracking-widest mt-2">
                    Find Calendars
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};

export default CalendarSettings;