import React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sparkles, Info } from 'lucide-react';

interface RuleManagerProps {
  rules: string;
  onChange: (rules: string) => void;
}

const RuleManager: React.FC<RuleManagerProps> = ({ rules, onChange }) => {
  return (
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
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
        <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
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