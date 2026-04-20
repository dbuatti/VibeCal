"use client";

import React from 'react';
import NeuralScanner from './NeuralScanner';

interface PlanLoadingViewProps {
  statusText: string;
  progress?: number;
}

const PlanLoadingView = ({ statusText, progress = 0 }: PlanLoadingViewProps) => {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <NeuralScanner progress={progress} status={statusText} />
    </div>
  );
};

export default PlanLoadingView;