"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Calendar, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CalendarSettingsProps {
  calendars: any[];
  isTesting: boolean;
  onDiscover: () => void;
  onToggle: (id: string, enabled: boolean) => void;
}

const CalendarSettings = ({ calendars, isTesting, onDiscover, onToggle }: CalendarSettingsProps) => {
  return (
    <Card className="border-none shadow-sm rounded-2xl border-l-4 border-l-gray-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="text-gray-900" size={20} />
          Calendars
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onDiscover}
          disabled={isTesting}
          className="w-full rounded-xl border-gray-200"
        >
          <RefreshCw size={14} className={cn("mr-2", isTesting && "animate-spin")} />
          Refresh List
        </Button>
        
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
          {calendars.map((cal) => (
            <div key={cal.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cal.color || '#6366f1' }} />
                <span className="text-xs font-bold text-gray-700 truncate">{cal.calendar_name}</span>
              </div>
              <Switch 
                checked={cal.is_enabled} 
                onCheckedChange={(val) => onToggle(cal.id, val)}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default CalendarSettings;