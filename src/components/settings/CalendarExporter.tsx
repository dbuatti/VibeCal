"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, FileText, Check, Apple, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { format, addMonths, parseISO } from 'date-fns';
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

      const endDate = addMonths(new Date(), parseInt(months)).toISOString();
      
      const { data: events, error } = await supabase
        .from('calendar_events_cache')
        .select('title, start_time, description')
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
        const dateStr = format(parseISO(e.start_time), 'yyyy-MM-dd');
        const notes = e.description ? ` - ${e.description.replace(/\n/g, ' ')}` : '';
        return `${dateStr} - ${e.title}${notes}`;
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

        <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 flex gap-3">
          <FileText className="text-indigo-600 shrink-0" size={18} />
          <p className="text-xs text-indigo-700 font-medium leading-relaxed">
            Format: <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-100 font-bold">Date - Title - Notes</code>
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default CalendarExporter;