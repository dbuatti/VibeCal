import React, { useState } from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Sparkles, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { showSuccess, showError } from '@/utils/toast';

const Optimise = () => {
  const [isOptimising, setIsOptimising] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');

  const runOptimisation = async () => {
    setIsOptimising(true);
    setProgress(0);
    
    try {
      console.log("Starting optimisation process...");
      
      // Step 1: Sync Calendar
      setStep('Syncing Google Calendar...');
      setProgress(20);
      
      console.log("Invoking sync-calendar edge function...");
      const { data, error } = await supabase.functions.invoke('sync-calendar');
      
      if (error) {
        console.error("Edge function error:", error);
        throw error;
      }

      if (data?.error) {
        console.error("Sync error returned from function:", data.error);
        throw new Error(data.error);
      }

      console.log("Sync successful:", data);

      // Step 2: AI Processing (Simulated for now)
      setStep('Classifying tasks via Gemini...');
      setProgress(45);
      await new Promise(r => setTimeout(r, 1500));

      setStep('Applying day themes...');
      setProgress(70);
      await new Promise(r => setTimeout(r, 1500));

      setStep('Resolving clashes...');
      setProgress(90);
      await new Promise(r => setTimeout(r, 1000));

      setStep('Finalising schedule...');
      setProgress(100);
      await new Promise(r => setTimeout(r, 500));

      showSuccess(`Successfully synced ${data.count} events!`);
    } catch (err: any) {
      console.error("Optimisation failed:", err);
      showError(err.message || "An unexpected error occurred during sync.");
    } finally {
      setIsOptimising(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <div className="w-20 h-20 bg-indigo-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Sparkles className="text-indigo-600" size={40} />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Schedule Optimiser</h1>
          <p className="text-lg text-gray-500 max-w-xl mx-auto">
            Our AI engine will restructure your calendar to align with your themes and minimise context switching.
          </p>
        </div>

        {!isOptimising ? (
          <div className="space-y-8">
            <Card className="border-none shadow-xl shadow-indigo-100/50 rounded-3xl overflow-hidden">
              <div className="bg-indigo-600 p-8 text-white">
                <h2 className="text-xl font-bold mb-2">Ready to Optimise?</h2>
                <p className="opacity-90 text-sm">We'll process the next 7 days of your calendar.</p>
              </div>
              <CardContent className="p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 bg-green-100 p-1 rounded-full">
                      <CheckCircle2 className="text-green-600" size={16} />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">Themed Alignment</p>
                      <p className="text-sm text-gray-500">Prioritise Music on Mondays and Kinesiology on Wednesdays.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 bg-green-100 p-1 rounded-full">
                      <CheckCircle2 className="text-green-600" size={16} />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">Context Grouping</p>
                      <p className="text-sm text-gray-500">Cluster similar tasks to reduce mental fatigue.</p>
                    </div>
                  </div>
                </div>
                <Button 
                  onClick={runOptimisation}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl py-8 text-lg font-bold shadow-lg shadow-indigo-200 transition-all hover:scale-[1.01]"
                >
                  Start Optimisation Engine
                </Button>
              </CardContent>
            </Card>

            <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex gap-3">
              <AlertCircle className="text-amber-600 shrink-0" size={20} />
              <p className="text-sm text-amber-800">
                <strong>Preview Mode Active:</strong> No changes will be written to your real Google Calendar until you approve the final result.
              </p>
            </div>
          </div>
        ) : (
          <Card className="border-none shadow-sm rounded-3xl p-12 text-center">
            <div className="mb-8">
              <RefreshCw className="text-indigo-600 animate-spin mx-auto mb-4" size={48} />
              <h2 className="text-2xl font-bold text-gray-900">{step}</h2>
            </div>
            <Progress value={progress} className="h-3 bg-gray-100 mb-4" />
            <p className="text-gray-500 font-medium">{progress}% Complete</p>
          </Card>
        )}
      </div>
    </Layout>
  );
};

export default Optimise;