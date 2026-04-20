"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar, RefreshCw, Globe, CheckSquare, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface CalendarSettingsProps {
  calendars: any[];
  isTesting: boolean;
  onDiscover: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onBulkToggle?: (provider: string, enabled: boolean) => void;
}

const ProviderIcon = ({ provider }: { provider: string }) => {
  if (provider === 'google') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z" fill="#EA4335"/>
      </svg>
    );
  }
  if (provider === 'apple') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-900" fill="currentColor">
        <path d="M17.05 20.28c-.98.95-2.05 1.61-3.22 1.61-1.14 0-1.55-.67-2.85-.67-1.32 0-1.77.65-2.85.67-1.15.02-2.19-.62-3.22-1.61C2.79 18.21 1.35 14.15 1.35 10.83c0-3.32 2.12-5.07 4.16-5.07 1.08 0 1.88.43 2.54.43.64 0 1.52-.47 2.75-.47 1.05 0 2.02.35 2.72.95 2.02 1.73 1.85 4.45 1.85 4.45s-2.35.85-2.35 3.5c0 2.65 2.35 3.5 2.35 3.5-.05.15-.32.65-.72 1.14zM12.03 4.95c-.02-1.3.5-2.55 1.35-3.45.85-.9 2.1-1.5 3.35-1.5.05 1.3-.45 2.55-1.35 3.45-.9.9-2.1 1.5-3.35 1.5z"/>
      </svg>
    );
  }
  return <Globe size={16} />;
};

const CalendarSettings = ({ calendars, isTesting, onDiscover, onToggle }: CalendarSettingsProps) => {
  const grouped = calendars.reduce((acc: any, cal) => {
    const provider = cal.provider || 'other';
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(cal);
    return acc;
  }, {});

  const providers = Object.keys(grouped).sort();

  const handleBulkToggle = (provider: string, enabled: boolean) => {
    const providerCals = grouped[provider];
    providerCals.forEach((cal: any) => {
      if (cal.is_enabled !== enabled) {
        onToggle(cal.id, enabled);
      }
    });
  };

  return (
    <TooltipProvider>
      <Card className="border-none shadow-sm rounded-2xl border-l-4 border-l-indigo-600 h-full flex flex-col overflow-hidden">
        <CardHeader className="pb-4 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calendar className="text-indigo-600" size={20} />
              Calendars
            </CardTitle>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onDiscover}
              disabled={isTesting}
              className="h-8 rounded-lg text-indigo-600 hover:bg-indigo-50 font-black text-[10px] uppercase tracking-widest"
            >
              <RefreshCw size={12} className={cn("mr-2", isTesting && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-0 flex flex-col">
          <ScrollArea className="flex-1 w-full">
            <div className="px-6 pb-6 space-y-8">
              {providers.length > 0 ? providers.map((provider) => (
                <div key={provider} className="space-y-4">
                  <div className="flex items-center justify-between sticky top-0 bg-white py-2 z-10 border-b border-gray-50">
                    <div className="flex items-center gap-2">
                      <ProviderIcon provider={provider} />
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                        {provider === 'google' ? 'Google Account' : provider === 'apple' ? 'iCloud Account' : 'Other'}
                      </h3>
                    </div>
                    <div className="flex gap-2">
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
                  <div className="space-y-2">
                    {grouped[provider].map((cal: any) => (
                      <div key={cal.id} className="flex items-center justify-between p-3 bg-gray-50/50 rounded-xl border border-gray-100 hover:border-indigo-100 transition-colors gap-3">
                        <div className="flex items-center gap-3 overflow-hidden flex-1">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: cal.color || '#6366f1' }} />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs font-bold text-gray-700 truncate cursor-default">
                                {cal.calendar_name}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="rounded-lg font-bold text-[10px]">
                              {cal.calendar_name}
                            </TooltipContent>
                          </Tooltip>
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
                    Discover Now
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