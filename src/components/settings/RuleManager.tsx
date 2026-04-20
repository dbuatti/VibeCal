import React, { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sparkles, Info, Play, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface RuleManagerProps {
  rules: string;
  onChange: (rules: string) => void;
}

const RuleManager: React.FC<RuleManagerProps> = ({ rules, onChange }) => {
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<{ isMovable: boolean, explanation: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const handleTest = async () => {
    if (!testInput.trim()) return;
    setIsTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('classify-tasks', {
        body: {
          tasks: [testInput],
          naturalLanguageRules: rules,
          movableKeywords: [],
          lockedKeywords: []
        }
      });

      if (error) throw error;
      if (data.classifications && data.classifications[0]) {
        setTestResult(data.classifications[0]);
      }
    } catch (err) {
      console.error("Test failed:", err);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100 flex gap-3">
          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-indigo-600 shadow-sm shrink-0">
            <Sparkles size={18} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-indigo-900">Natural Language Rules</h4>
            <p className="text-xs text-indigo-700 mt-1">
              Write rules in plain English. The AI will use these to classify your tasks more accurately.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="rules" className="text-sm font-bold text-gray-700">Your Rules</Label>
            <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1">
              <Info size={10} /> AI processes these rules in real-time
            </span>
          </div>
          <Textarea
            id="rules"
            placeholder="e.g., 'Always keep my gym sessions fixed' or 'Solo coding is always movable'..."
            className="min-h-[200px] rounded-xl border-gray-200 focus:ring-indigo-500 focus:border-indigo-500 resize-none p-4 text-sm leading-relaxed"
            value={rules}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>

      {/* Rule Tester Section */}
      <div className="p-6 rounded-2xl bg-gray-50 border border-gray-100 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 flex items-center gap-2">
            <Play size={12} className="text-indigo-600" /> Test Your Rules
          </h4>
          {testResult && (
            <button onClick={() => setTestResult(null)} className="text-[10px] font-bold text-gray-400 hover:text-gray-600">
              Clear
            </button>
          )}
        </div>
        
        <div className="flex gap-2">
          <Input 
            placeholder="Enter a task name to test..." 
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleTest()}
            className="rounded-xl bg-white border-gray-200 h-11 text-sm"
          />
          <Button 
            onClick={handleTest} 
            disabled={isTesting || !testInput.trim()}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 h-11 px-6"
          >
            {isTesting ? <RefreshCw size={18} className="animate-spin" /> : "Test"}
          </Button>
        </div>

        {testResult && (
          <div className={cn(
            "p-4 rounded-xl border animate-in fade-in slide-in-from-top-2 duration-300",
            testResult.isMovable ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"
          )}>
            <div className="flex items-center gap-3 mb-2">
              {testResult.isMovable ? (
                <CheckCircle2 size={18} className="text-green-600" />
              ) : (
                <XCircle size={18} className="text-red-600" />
              )}
              <span className={cn("font-bold text-sm", testResult.isMovable ? "text-green-700" : "text-red-700")}>
                Result: {testResult.isMovable ? "Movable" : "Fixed"}
              </span>
            </div>
            <p className="text-xs text-gray-600 font-medium leading-relaxed">
              <span className="font-bold">Reasoning:</span> {testResult.explanation}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-white border border-gray-100">
          <h5 className="text-xs font-bold text-gray-900 mb-2 uppercase tracking-wider">Examples of Fixed Rules</h5>
          <ul className="text-xs text-gray-600 space-y-2">
            <li className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-red-400 mt-1.5 shrink-0" />
              "Anything with 'Client' in the title is fixed."
            </li>
            <li className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-red-400 mt-1.5 shrink-0" />
              "Doctor appointments are never movable."
            </li>
          </ul>
        </div>
        <div className="p-4 rounded-xl bg-white border border-gray-100">
          <h5 className="text-xs font-bold text-gray-900 mb-2 uppercase tracking-wider">Examples of Movable Rules</h5>
          <ul className="text-xs text-gray-600 space-y-2">
            <li className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
              "Reading time can always be moved."
            </li>
            <li className="flex items-start gap-2">
              <div className="w-1 h-1 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
              "Housework is always flexible."
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default RuleManager;