"use client";

import React from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface PlanInitialViewProps {
  hasEvents: boolean;
  onSyncFresh: () => void;
  onUseCache: () => void;
}

const PlanInitialView = ({ hasEvents, onSyncFresh, onUseCache }: PlanInitialViewProps) => {
  return (
    <Card className="border-none shadow-xl rounded-[2rem] overflow-hidden bg-white">
      <div className="bg-gradient-to-br from-indigo-600 to-purple-800 p-12 text-white text-center">
        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-6 backdrop-blur-xl border border-white/30">
          <Calendar size={32} />
        </div>
        <h2 className="text-3xl font-black mb-4 tracking-tight">Ready to Optimise?</h2>
        <p className="text-indigo-100 mb-8 text-base font-medium max-w-md mx-auto">Align your schedule with your life.</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button onClick={onSyncFresh} className="bg-white text-indigo-600 hover:bg-indigo-50 rounded-2xl px-10 py-6 text-lg font-black shadow-xl">
            Sync Fresh
          </Button>
          {hasEvents && (
            <Button onClick={onUseCache} variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20 rounded-2xl px-10 py-6 text-lg font-black">
              Use Cache
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};

export default PlanInitialView;