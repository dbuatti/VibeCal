"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, FileText, Check, Apple, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { addMonths, parseISO, addMinutes, isValid } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { showSuccess, showError } from '@/utils/toast';

const CalendarExporter = () => {
  const [months, setMonths] = useState("3");
  const [isExporting, setIsExporting] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    setHasCopied(false);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Fetch user timezone for accurate time formatting
      const { data: profile } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', user.id)
        .single();
      
      const timezone = profile?.timezone || 'Australia/Melbourne';
      const endDate = addMonths(new Date(), parseInt(months)).toISOString();
      
      const { data: events, error } = await supabase
        .from('calendar_events_cache')
        .select('title, start_time, end_time, description, duration_minutes')
        .eq('user_id', user.id)
        .eq('provider', 'apple')
        .gte('start_time', new Date().toISOString())
        .lte('start_time', endDate)
        .order('start_time', { ascending: true });

      if (error) throw error;

      if (!events || events.length === 0) {
        showError("No Apple Calendar events found for this period.");
        return;
      }

      const text = events.map(e => {
        const start = parseISO(e.start_time);
        let end = e.end_time ? parseISO(e.end_time) : null;
        
        // Fallback: if end_time is missing but duration exists, calculate it
        if ((!end || !isValid(end)) && e.duration_minutes) {
          end = addMinutes(start, e.duration_minutes);
        }

        const dateStr = formatInTimeZone(start, timezone, 'yyyy-MM-dd');
        const startTimeStr = formatInTimeZone(start, timezone, 'HH:mm');
        const endTimeStr = (end && isValid(end)) ? formatInTimeZone(end, timezone, 'HH:mm') : '??:??';
        
        const notes = e.description ? ` - ${e.description.replace(/\n/g, ' ')}` : '';
        
        // Format: Date Start-End - Title - Notes
        return `${dateStr} ${startTimeStr} to ${endTimeStr} - ${e.title}${notes}`;
      }).join('\n');

      await navigator.clipboard.writeText(text);
      setHasCopied(true);
      showSuccess(`Copied ${events.length} events to clipboard!`);
      
      setTimeout(() => setHasCopied(false), 3000);
    } catch (err: any) {
      showError("Export failed: " + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card className="border-none shadow-sm rounded-2xl bg-white">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Apple className="text-gray-900" size={20} />
          Apple Calendar Export
        </CardTitle>
        <CardDescription>
          Copy your upcoming schedule as simple text for AI training or documentation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="space-y-2 flex-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Timeframe</label>
            <Select value={months} onValueChange={setMonths}>
              <SelectTrigger className="rounded-xl h-12 bg-gray-50/50 border-gray-100">
                <SelectValue placeholder="Select duration" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="3">Next 3 Months</SelectItem>
                <SelectItem value="6">Next 6 Months</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <Button 
            onClick={handleExport} 
            disabled={isExporting}
            className="h-12 rounded-xl px-8 bg-gray-900 hover:bg-black text-white font-black text-[10px] uppercase tracking-widest shadow-lg transition-all active:scale-95"
          >
            {isExporting ? (
              <Loader2 className="mr-2 animate-spin" size={16} />
            ) : hasCopied ? (
              <Check className="mr-2" size={16} />
            ) : (
              <Copy className="mr-2" size={16} />
            )}
            {isExporting ? "Processing..." : hasCopied ? "Copied!" : "Copy to Clipboard"}
          </Button>
        </div>

        <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-indigo-600">
            <FileText size={16} />
            <span className="text-[10px] font-black uppercase tracking-widest">Format</span>
          </div>
          <p className="text-xs text-indigo-700 font-medium leading-relaxed">
            <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-100 font-bold">Date Start to End - Title - Notes</code>
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default CalendarExporter;