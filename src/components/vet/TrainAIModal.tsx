"use client";

import React, { useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Brain, Sparkles, Lock, Unlock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { cn } from '@/lib/utils';

interface TrainAIModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: any;
  onSuccess: () => void;
}

const TrainAIModal = ({ isOpen, onClose, task, onSuccess }: TrainAIModalProps) => {
  const [isMovable, setIsMovable] = useState(!task?.is_locked);
  const [rule, setRule] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!rule.trim()) {
      showError("Please provide a rule or explanation for the AI.");
      return;
    }

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Save specific feedback for this task name
      await supabase
        .from('task_classification_feedback')
        .upsert({
          user_id: user.id,
          task_name: task.title,
          is_movable: isMovable
        }, { onConflict: 'user_id, task_name' });

      // 2. Append to natural language rules in user_settings
      const { data: settings } = await supabase
        .from('user_settings')
        .select('natural_language_rules')
        .eq('user_id', user.id)
        .single();

      const currentRules = settings?.natural_language_rules || '';
      const newRuleEntry = `\n- ${rule} (Classification: ${isMovable ? 'Movable' : 'Fixed'})`;
      const updatedRules = currentRules + newRuleEntry;

      await supabase
        .from('user_settings')
        .update({ natural_language_rules: updatedRules.trim() })
        .eq('user_id', user.id);

      showSuccess("AI trained successfully!");
      onSuccess();
      onClose();
    } catch (err: any) {
      showError("Failed to train AI: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] rounded-[2.5rem] border-none shadow-2xl p-8">
        <DialogHeader>
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white mb-4 shadow-lg shadow-indigo-100">
            <Brain size={24} />
          </div>
          <DialogTitle className="text-2xl font-black tracking-tight">Train AI Assistant</DialogTitle>
          <DialogDescription className="text-gray-500 font-medium">
            Teach the AI how to handle tasks like <span className="text-indigo-600 font-bold">"{task?.title}"</span> in the future.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-8 py-6">
          <div className="space-y-3">
            <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Future Classification</Label>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setIsMovable(false)}
                className={cn(
                  "flex items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all font-black text-xs uppercase tracking-widest",
                  !isMovable ? "bg-red-50 border-red-500 text-red-600 shadow-sm" : "bg-white border-gray-100 text-gray-400 hover:border-red-100"
                )}
              >
                <Lock size={16} /> Always Fixed
              </button>
              <button
                onClick={() => setIsMovable(true)}
                className={cn(
                  "flex items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all font-black text-xs uppercase tracking-widest",
                  isMovable ? "bg-indigo-50 border-indigo-500 text-indigo-600 shadow-sm" : "bg-white border-gray-100 text-gray-400 hover:border-indigo-100"
                )}
              >
                <Unlock size={16} /> Always Movable
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Natural Language Rule</Label>
              <Sparkles size={14} className="text-indigo-400 animate-pulse" />
            </div>
            <Textarea
              placeholder="e.g., 'These are auditions for a musical. I do them frequently and they shouldn't move'..."
              className="min-h-[120px] rounded-2xl border-gray-100 focus:ring-indigo-500 p-4 text-sm font-medium leading-relaxed"
              value={rule}
              onChange={(e) => setRule(e.target.value)}
            />
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-tight">
              This rule will be added to your Intelligence Center.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-3">
          <Button variant="ghost" onClick={onClose} className="rounded-xl font-black text-[10px] uppercase tracking-widest">
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={isSaving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-100"
          >
            {isSaving ? "Saving..." : "Save Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TrainAIModal;