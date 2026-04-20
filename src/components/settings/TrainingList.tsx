import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle2, XCircle, HelpCircle, RefreshCw, Info } from 'lucide-react';
import { showSuccess, showError } from '@/utils/toast';
import { cn } from '@/lib/utils';

interface TrainingListProps {
  naturalLanguageRules: string;
  movableKeywords: string[];
  lockedKeywords: string[];
}

interface ClassifiedTask {
  id: string;
  task_name: string;
  is_movable: boolean;
  explanation?: string;
  is_corrected?: boolean;
}

const TrainingList: React.FC<TrainingListProps> = ({
  naturalLanguageRules,
  movableKeywords,
  lockedKeywords
}) => {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<ClassifiedTask[]>([]);
  const isRequesting = useRef(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchRecentTasks = async () => {
    if (isRequesting.current) return;
    
    setLoading(true);
    isRequesting.current = true;
    
    try {
      const { data: recentEvents, error } = await supabase
        .from('calendar_events_cache')
        .select('id, title')
        .order('start_time', { ascending: false })
        .limit(10);

      if (error) throw error;

      if (recentEvents && recentEvents.length > 0) {
        const titles = recentEvents.map(e => e.title);
        
        const { data, error: classifyError } = await supabase.functions.invoke('classify-tasks', {
          body: {
            tasks: titles,
            movableKeywords,
            lockedKeywords,
            naturalLanguageRules
          }
        });

        if (classifyError) throw classifyError;

        const classified = recentEvents.map((e, i) => ({
          id: e.id,
          task_name: e.title,
          is_movable: data.classifications[i]?.isMovable ?? false,
          explanation: data.classifications[i]?.explanation ?? "No explanation provided"
        }));

        setTasks(classified);
      }
    } catch (err: any) {
      console.error("Error fetching training tasks:", err);
      // Don't show toast for background updates to avoid annoyance
    } finally {
      setLoading(false);
      isRequesting.current = false;
    }
  };

  useEffect(() => {
    // Debounce the fetch to prevent spamming when user is typing keywords
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    
    debounceTimer.current = setTimeout(() => {
      fetchRecentTasks();
    }, 1000);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [movableKeywords.length, lockedKeywords.length]); // Only trigger on count changes to reduce frequency

  const handleCorrection = async (task: ClassifiedTask, correctedMovable: boolean) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('task_classification_feedback')
        .upsert({
          user_id: user.id,
          task_name: task.task_name,
          is_movable: correctedMovable
        }, { onConflict: 'user_id, task_name' });

      if (error) throw error;

      setTasks(prev => prev.map(t => 
        t.id === task.id ? { ...t, is_movable: correctedMovable, is_corrected: true } : t
      ));

      showSuccess(`AI trained: "${task.task_name}" is now ${correctedMovable ? 'Movable' : 'Fixed'}`);
    } catch (err: any) {
      showError("Failed to save correction");
    }
  };

  if (loading && tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <RefreshCw className="animate-spin mb-4 text-indigo-600" />
        <p className="text-sm font-medium">AI is analyzing recent tasks...</p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
        <HelpCircle className="mx-auto mb-3 text-gray-400" size={32} />
        <p className="text-gray-600 font-medium">No recent tasks found to train on.</p>
        <p className="text-sm text-gray-400 mt-1">Add some events to your calendar first!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Recent Classifications</h3>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={fetchRecentTasks} 
          disabled={loading}
          className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
        >
          <RefreshCw size={14} className={cn("mr-2", loading && "animate-spin")} /> 
          {loading ? "Analyzing..." : "Refresh"}
        </Button>
      </div>
      
      <div className="space-y-3">
        {tasks.map((task) => (
          <div key={task.id} className={cn(
            "flex items-center justify-between p-4 rounded-xl border transition-all",
            task.is_corrected ? "bg-green-50 border-green-100" : "bg-white border-gray-100 hover:border-indigo-100"
          )}>
            <div className="flex-1 min-w-0 mr-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-gray-900 truncate">{task.task_name}</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info size={14} className="text-gray-400 hover:text-indigo-600 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="bg-gray-900 text-white border-none rounded-lg p-2 text-xs max-w-xs">
                      {task.explanation || "AI classification based on your rules."}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn(
                  "text-[10px] uppercase tracking-wider font-bold px-2 py-0",
                  task.is_movable ? "bg-indigo-50 text-indigo-600 border-indigo-100" : "bg-red-50 text-red-600 border-red-100"
                )}>
                  {task.is_movable ? 'Movable' : 'Fixed'}
                </Badge>
                {task.is_corrected && (
                  <span className="text-[10px] text-green-600 font-bold flex items-center gap-1">
                    <CheckCircle2 size={10} /> Corrected
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCorrection(task, true)}
                className={cn(
                  "rounded-lg h-8 px-3 text-xs font-bold",
                  task.is_movable && !task.is_corrected ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700" : "hover:bg-indigo-50 text-indigo-600 border-indigo-100"
                )}
              >
                Movable
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCorrection(task, false)}
                className={cn(
                  "rounded-lg h-8 px-3 text-xs font-bold",
                  !task.is_movable && !task.is_corrected ? "bg-red-600 text-white border-red-600 hover:bg-red-700" : "hover:bg-red-50 text-red-600 border-red-100"
                )}
              >
                Fixed
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TrainingList;