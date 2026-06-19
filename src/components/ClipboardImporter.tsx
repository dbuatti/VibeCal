"use client";

import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ClipboardPaste, Sparkles, RefreshCw, CheckCircle2, X, Plus, Trash2,
  CalendarPlus, AlertCircle, Clock, MapPin, StickyNote,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { cn } from '@/lib/utils';
import { format, parseISO, isValid } from 'date-fns';

interface ParsedEvent {
  title: string;
  startDateTime: string;
  endDateTime: string;
  location: string | null;
  notes: string | null;
  status: 'confirmed' | 'tentative';
}

interface ClipboardImporterProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const ClipboardImporter = ({ isOpen, onClose, onCreated }: ClipboardImporterProps) => {
  const [step, setStep] = useState<'paste' | 'preview' | 'creating'>('paste');
  const [rawText, setRawText] = useState('');
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [createResults, setCreateResults] = useState<Array<{ title: string; success: boolean; error?: string }>>([]);
  const [quickAddTitle, setQuickAddTitle] = useState('');

  const handleQuickAdd = async () => {
    const title = quickAddTitle.trim();
    if (!title) return;
    const now = new Date();
    const later = new Date(now.getTime() + 30 * 60000);
    const quickEvent = {
      title,
      startDateTime: now.toISOString(),
      endDateTime: later.toISOString(),
      location: null,
      notes: null,
      status: 'confirmed' as const,
    };
    setEvents([quickEvent]);
    setQuickAddTitle('');
    setStep('creating');
    try {
      const { data, error } = await supabase.functions.invoke('create-appointment', {
        body: { events: [quickEvent] },
      });
      if (error) throw error;
      if (data.successCount > 0) {
        showSuccess(`"${title}" added now — 30 min`);
        onCreated();
        setTimeout(() => handleClose(), 1000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      showError(msg);
      setStep('paste');
    }
  };

  const handleParse = async () => {
    if (rawText.trim().length < 5) {
      showError('Paste some text first');
      return;
    }

    setIsParsing(true);
    setParseError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', user.id)
        .single();
      const timezone = profile?.timezone || 'Australia/Melbourne';

      const { data, error } = await supabase.functions.invoke('parse-clipboard-events', {
        body: { text: rawText, timezone },
      });

      if (error) throw error;

      if (data.error) {
        setParseError(data.error);
        setEvents([]);
      } else if (data.events && data.events.length > 0) {
        setEvents(data.events);
        setStep('preview');
      } else {
        setParseError('No events found in that text. Try pasting the full conversation.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse';
      setParseError(msg);
    } finally {
      setIsParsing(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setRawText(text);
        showSuccess('Pasted from clipboard');
      } else {
        showError('Clipboard is empty');
      }
    } catch {
      showError('Clipboard access denied — paste manually');
    }
  };

  const updateEvent = (idx: number, field: keyof ParsedEvent, value: string) => {
    setEvents((prev) => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const removeEvent = (idx: number) => {
    setEvents((prev) => prev.filter((_, i) => i !== idx));
  };

  const addEvent = () => {
    const now = new Date();
    const later = new Date(now.getTime() + 3600000);
    setEvents((prev) => [...prev, {
      title: '',
      startDateTime: now.toISOString(),
      endDateTime: later.toISOString(),
      location: null,
      notes: null,
      status: 'tentative',
    }]);
  };

  const handleCreate = async () => {
    setStep('creating');
    setCreateResults([]);

    try {
      const { data, error } = await supabase.functions.invoke('create-appointment', {
        body: { events },
      });

      if (error) throw error;

      if (data.error && data.created?.length === 0) {
        showError(data.error);
        setStep('preview');
        return;
      }

      setCreateResults(data.created || []);

      if (data.successCount > 0) {
        showSuccess(`${data.successCount} event${data.successCount > 1 ? 's' : ''} added to Apple Calendar`);
        onCreated();
      }

      if (data.successCount === data.total) {
        setTimeout(() => handleClose(), 1500);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create events';
      showError(msg);
      setStep('preview');
    }
  };

  const handleClose = () => {
    setStep('paste');
    setRawText('');
    setEvents([]);
    setParseError(null);
    setCreateResults([]);
    onClose();
  };

  const fmtDate = (iso: string) => {
    try {
      const d = parseISO(iso);
      return isValid(d) ? format(d, 'EEE, MMM d · h:mm a') : iso;
    } catch {
      return iso;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto rounded-[2rem] border-none shadow-2xl p-8">
        <DialogHeader>
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white mb-4 shadow-lg shadow-indigo-100">
            <ClipboardPaste size={24} />
          </div>
          <DialogTitle className="text-2xl font-black tracking-tight">Import from clipboard</DialogTitle>
          <DialogDescription className="text-gray-500 font-medium">
            Paste a conversation or message about gigs, appointments, or sessions. AI will extract the events for you to review before adding to Apple Calendar.
          </DialogDescription>
        </DialogHeader>

        {step === 'paste' && (
          <div className="space-y-4 py-4">
            {/* Quick Add — instant event creation for ADHD timeblindness */}
            <div className="bg-indigo-50/50 rounded-2xl border border-indigo-100 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-indigo-500" />
                <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">Quick Add — starts now, 30 min</span>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Warm up vocal exercises..."
                  value={quickAddTitle}
                  onChange={(e) => setQuickAddTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleQuickAdd()}
                  className="bg-white border-indigo-200 rounded-xl h-10 font-medium text-sm"
                />
                <Button
                  onClick={handleQuickAdd}
                  disabled={quickAddTitle.trim().length === 0}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-5 h-10 font-black text-[9px] uppercase tracking-widest shrink-0 shadow-sm"
                >
                  <Plus size={14} className="mr-1" /> Add Now
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Paste your text</Label>
              <Button
                onClick={handlePasteFromClipboard}
                variant="outline"
                size="sm"
                className="rounded-xl h-8 px-3 text-[9px] font-black uppercase tracking-widest"
              >
                <ClipboardPaste size={12} className="mr-1.5" /> From clipboard
              </Button>
            </div>
            <Textarea
              placeholder="Paste a conversation about gigs, rehearsals, appointments…"
              className="min-h-[200px] rounded-2xl border-gray-100 focus:ring-indigo-500 p-4 text-sm font-medium leading-relaxed"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
            {parseError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100">
                <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 font-medium leading-relaxed">{parseError}</p>
              </div>
            )}
            <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
              <Sparkles size={12} className="text-indigo-400" />
              AI reads the conversation and figures out dates, times, locations, and whether it's confirmed or tentative.
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                {events.length} event{events.length !== 1 ? 's' : ''} found — review & edit
              </Label>
              <Button onClick={addEvent} variant="outline" size="sm" className="rounded-xl h-8 px-3 text-[9px] font-black uppercase tracking-widest">
                <Plus size={12} className="mr-1.5" /> Add manually
              </Button>
            </div>

            {events.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <p className="text-xs font-black uppercase tracking-widest">No events — add one or go back</p>
              </div>
            )}

            {events.map((event, idx) => (
              <div key={idx} className="rounded-2xl border border-gray-100 p-4 space-y-3 bg-gray-50/50">
                <div className="flex items-start justify-between gap-2">
                  <Input
                    value={event.title}
                    onChange={(e) => updateEvent(idx, 'title', e.target.value)}
                    placeholder="Event title"
                    className="font-black text-sm border-none bg-white rounded-xl h-9"
                  />
                  <button onClick={() => removeEvent(idx)} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all">
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[8px] font-black uppercase tracking-widest text-gray-400">Start</Label>
                    <Input
                      type="datetime-local"
                      value={event.startDateTime ? event.startDateTime.slice(0, 16) : ''}
                      onChange={(e) => updateEvent(idx, 'startDateTime', new Date(e.target.value).toISOString())}
                      className="text-xs border-none bg-white rounded-lg h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-[8px] font-black uppercase tracking-widest text-gray-400">End</Label>
                    <Input
                      type="datetime-local"
                      value={event.endDateTime ? event.endDateTime.slice(0, 16) : ''}
                      onChange={(e) => updateEvent(idx, 'endDateTime', new Date(e.target.value).toISOString())}
                      className="text-xs border-none bg-white rounded-lg h-8"
                    />
                  </div>
                </div>

                <Input
                  value={event.location || ''}
                  onChange={(e) => updateEvent(idx, 'location', e.target.value)}
                  placeholder="Location (optional)"
                  className="text-xs border-none bg-white rounded-lg h-8"
                />

                <Input
                  value={event.notes || ''}
                  onChange={(e) => updateEvent(idx, 'notes', e.target.value)}
                  placeholder="Notes (optional)"
                  className="text-xs border-none bg-white rounded-lg h-8"
                />

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateEvent(idx, 'status', 'confirmed')}
                    className={cn(
                      'px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all',
                      event.status === 'confirmed' ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-white text-gray-400 border border-gray-100'
                    )}
                  >
                    Confirmed
                  </button>
                  <button
                    onClick={() => updateEvent(idx, 'status', 'tentative')}
                    className={cn(
                      'px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all',
                      event.status === 'tentative' ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-white text-gray-400 border border-gray-100'
                    )}
                  >
                    Tentative
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 'creating' && (
          <div className="py-8 space-y-4">
            {createResults.length === 0 ? (
              <div className="flex flex-col items-center gap-4">
                <RefreshCw className="animate-spin text-indigo-600" size={32} />
                <p className="text-sm font-black text-gray-400 uppercase tracking-widest">Creating events in Apple Calendar…</p>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center gap-3 mb-4">
                  <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center">
                    <CheckCircle2 className="text-green-600" size={28} />
                  </div>
                  <p className="text-sm font-black text-gray-700 uppercase tracking-widest">
                    {createResults.filter(r => r.success).length} of {createResults.length} created
                  </p>
                </div>
                <div className="space-y-2">
                  {createResults.map((r, i) => (
                    <div key={i} className={cn(
                      'flex items-center gap-3 p-3 rounded-xl',
                      r.success ? 'bg-green-50/50' : 'bg-red-50/50'
                    )}>
                      {r.success
                        ? <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                        : <X size={16} className="text-red-500 shrink-0" />}
                      <span className="text-xs font-bold text-gray-700 truncate flex-1">{r.title}</span>
                      {!r.success && <span className="text-[10px] text-red-500 font-medium">{r.error}</span>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-3">
          {step === 'paste' && (
            <>
              <Button variant="ghost" onClick={handleClose} className="rounded-xl font-black text-[10px] uppercase tracking-widest">
                Cancel
              </Button>
              <Button
                onClick={handleParse}
                disabled={isParsing || rawText.trim().length < 5}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-6 font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-100"
              >
                {isParsing ? <><RefreshCw size={14} className="mr-2 animate-spin" /> Parsing…</> : <><Sparkles size={14} className="mr-2" /> Extract events</>}
              </Button>
            </>
          )}

          {step === 'preview' && (
            <>
              <Button variant="ghost" onClick={() => setStep('paste')} className="rounded-xl font-black text-[10px] uppercase tracking-widest">
                Back
              </Button>
              <Button
                onClick={handleCreate}
                disabled={events.length === 0}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-6 font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-100"
              >
                <CalendarPlus size={14} className="mr-2" /> Add {events.length} to Apple Calendar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ClipboardImporter;
