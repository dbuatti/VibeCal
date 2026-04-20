"use client";

import React, { useEffect, useState } from 'react';
import { Brain, Sparkles, Zap, Search, Database, Cpu } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface NeuralScannerProps {
  progress: number;
  status: string;
}

const NeuralScanner = ({ progress, status }: NeuralScannerProps) => {
  const [logs, setLogs] = useState<string[]>([]);
  
  const statusIcons: Record<string, any> = {
    'Authenticating...': <Zap size={14} className="text-yellow-400" />,
    'Syncing calendars...': <Database size={14} className="text-blue-400" />,
    'AI is vetting...': <Brain size={14} className="text-indigo-400" />,
    'Updating local view...': <Search size={14} className="text-green-400" />,
    'Calculating optimal alignment...': <Cpu size={14} className="text-purple-400" />,
  };

  useEffect(() => {
    if (status && !logs.includes(status)) {
      setLogs(prev => [status, ...prev].slice(0, 3));
    }
  }, [status]);

  return (
    <div className="w-full max-w-md mx-auto space-y-8 py-12 animate-in fade-in zoom-in-95 duration-500">
      <div className="relative flex justify-center">
        <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full animate-pulse" />
        <div className="relative w-24 h-24 bg-white rounded-[2rem] shadow-2xl flex items-center justify-center border border-indigo-50">
          <Brain size={48} className="text-indigo-600 animate-pulse" />
          <div className="absolute -top-2 -right-2">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-400 blur-md animate-ping opacity-50" />
              <div className="relative bg-indigo-600 p-2 rounded-xl text-white shadow-lg">
                <Sparkles size={16} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 text-center">
        <div className="space-y-1">
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">AI Intelligence Scanner</h2>
          <p className="text-gray-400 font-bold text-[10px] uppercase tracking-[0.2em]">Neural Processing Engine v2.0</p>
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between items-end px-1">
            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-2">
              {statusIcons[status] || <Sparkles size={14} className="text-indigo-400" />}
              {status}
            </span>
            <span className="text-lg font-black text-gray-900">{Math.round(progress)}%</span>
          </div>
          <div className="relative h-3 w-full bg-gray-100 rounded-full overflow-hidden border border-gray-50 shadow-inner">
            <div 
              className="h-full bg-gradient-to-r from-indigo-600 via-purple-500 to-indigo-400 transition-all duration-500 ease-out relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.2)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.2)_50%,rgba(255,255,255,0.2)_75%,transparent_75%,transparent)] bg-[length:20px_20px] animate-[shimmer_1s_linear_infinite]" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-900/5 rounded-2xl p-4 border border-black/5 space-y-2">
        {logs.map((log, i) => (
          <div 
            key={i} 
            className={cn(
              "flex items-center gap-3 text-[10px] font-bold transition-all duration-300",
              i === 0 ? "text-indigo-600 opacity-100 translate-x-0" : "text-gray-400 opacity-50 -translate-x-1"
            )}
          >
            <div className={cn("w-1 h-1 rounded-full", i === 0 ? "bg-indigo-600 animate-ping" : "bg-gray-300")} />
            {log}
          </div>
        ))}
      </div>
    </div>
  );
};

export default NeuralScanner;