"use client";

import React from 'react';
import { RefreshCw } from 'lucide-react';

interface PlanLoadingViewProps {
  statusText: string;
}

const PlanLoadingView = ({ statusText }: PlanLoadingViewProps) => {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <RefreshCw className="text-indigo-600 animate-spin w-12 h-12 mb-4" />
      <h2 className="text-xl font-black text-gray-900 tracking-tight">{statusText}</h2>
    </div>
  );
};

export default PlanLoadingView;