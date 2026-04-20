import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lightbulb, Plus, Check, RefreshCw, Sparkles } from 'lucide-react';
import { showSuccess, showError } from '@/utils/toast';
import { cn } from '@/lib/utils';

interface SmartSuggestionsProps {
  movableKeywords: string[];
  lockedKeywords: string[];
}

interface Suggestion {
  keyword: string;
  type: 'movable' | 'locked';
  reason: string;
  confidence: number;
}

const SmartSuggestions: React.FC<SmartSuggestionsProps> = ({
  movableKeywords,
  lockedKeywords
}) => {
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const fetchSuggestions = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch feedback to analyze
      const { data: feedback } = await supabase
        .from('task_classification_feedback')
        .select('task_name, is_movable')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!feedback || feedback.length === 0) {
        setSuggestions([]);
        return;
      }

      // Simple analysis: find common words in corrected tasks
      // In a real app, we might use AI for this, but let's do a smart heuristic first
      const wordCounts: Record<string, { movable: number, fixed: number }> = {};
      
      feedback.forEach(f => {
        const words = f.task_name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        words.forEach(w => {
          if (!wordCounts[w]) wordCounts[w] = { movable: 0, fixed: 0 };
          if (f.is_movable) wordCounts[w].movable++;
          else wordCounts[w].fixed++;
        });
      });

      const newSuggestions: Suggestion[] = [];
      Object.entries(wordCounts).forEach(([word, counts]) => {
        const total = counts.movable + counts.fixed;
        if (total < 2) return; // Need at least 2 occurrences

        if (counts.movable / total > 0.8 && !movableKeywords.includes(word)) {
          newSuggestions.push({
            keyword: word,
            type: 'movable',
            reason: `You've marked tasks with "${word}" as movable ${counts.movable} times.`,
            confidence: counts.movable / total
          });
        } else if (counts.fixed / total > 0.8 && !lockedKeywords.includes(word)) {
          newSuggestions.push({
            keyword: word,
            type: 'locked',
            reason: `You've marked tasks with "${word}" as fixed ${counts.fixed} times.`,
            confidence: counts.fixed / total
          });
        }
      });

      setSuggestions(newSuggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5));
    } catch (err) {
      console.error("Error fetching suggestions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuggestions();
  }, [movableKeywords, lockedKeywords]);

  const handleApprove = async (suggestion: Suggestion) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const field = suggestion.type === 'movable' ? 'movable_keywords' : 'locked_keywords';
      const currentKeywords = suggestion.type === 'movable' ? movableKeywords : lockedKeywords;
      
      const newKeywords = [...currentKeywords, suggestion.keyword];

      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, [field]: newKeywords }, { onConflict: 'user_id' });

      if (error) throw error;

      setSuggestions(prev => prev.filter(s => s.keyword !== suggestion.keyword));
      showSuccess(`Added "${suggestion.keyword}" to ${suggestion.type} keywords`);
    } catch (err: any) {
      showError("Failed to approve suggestion");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <RefreshCw className="animate-spin mb-4 text-indigo-600" />
        <p className="text-sm font-medium">Analyzing your feedback patterns...</p>
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
        <Sparkles className="mx-auto mb-3 text-indigo-300" size={32} />
        <p className="text-gray-600 font-medium">No suggestions yet.</p>
        <p className="text-sm text-gray-400 mt-1">Keep correcting the AI in Training Mode to see patterns here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Smart Keyword Suggestions</h3>
        <Button variant="ghost" size="sm" onClick={fetchSuggestions} className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50">
          <RefreshCw size={14} className="mr-2" /> Refresh
        </Button>
      </div>

      <div className="space-y-3">
        {suggestions.map((suggestion, idx) => (
          <div key={idx} className="p-4 rounded-xl border border-gray-100 bg-white hover:border-indigo-100 transition-all flex items-center justify-between">
            <div className="flex items-start gap-3">
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                suggestion.type === 'movable' ? "bg-indigo-50 text-indigo-600" : "bg-red-50 text-red-600"
              )}>
                <Lightbulb size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-gray-900">Add "{suggestion.keyword}"</span>
                  <Badge variant="outline" className={cn(
                    "text-[10px] uppercase tracking-wider font-bold px-2 py-0",
                    suggestion.type === 'movable' ? "bg-indigo-50 text-indigo-600 border-indigo-100" : "bg-red-50 text-red-600 border-red-100"
                  )}>
                    {suggestion.type}
                  </Badge>
                </div>
                <p className="text-xs text-gray-500">{suggestion.reason}</p>
              </div>
            </div>
            <Button 
              size="sm" 
              onClick={() => handleApprove(suggestion)}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white h-8 px-3 text-xs font-bold"
            >
              <Plus size={14} className="mr-1" /> Approve
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SmartSuggestions;