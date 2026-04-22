"use client";

import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { History as HistoryIcon, TrendingUp, Calendar, Filter, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { format, parseISO, subDays, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';

const History = () => {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await supabase
          .from('optimisation_history')
          .select('*')
          .eq('user_id', user.id)
          .order('run_at', { ascending: false })
          .limit(20);

        if (data) {
          setHistory(data);
          
          // Generate dummy chart data based on real history count for now
          const last7Days = Array.from({ length: 7 }).map((_, i) => {
            const date = subDays(new Date(), 6 - i);
            const dayStr = format(date, 'EEE');
            const dayHistory = data.filter(h => format(parseISO(h.run_at), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'));
            return {
              day: dayStr,
              score: dayHistory.length > 0 ? 70 + (dayHistory.length * 5) : 65
            };
          });
          setChartData(last7Days);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, []);

  if (loading) return <Layout><div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-indigo-600" /></div></Layout>;

  return (
    <Layout>
      <PageHeader 
        title="Vibe History"
        subtitle="Track your alignment and productivity trends."
        icon={HistoryIcon}
        actions={
          <div className="flex gap-3">
            <Button variant="outline" className="rounded-xl border-gray-200 font-bold text-xs uppercase tracking-widest h-12 px-6">
              <Filter size={14} className="mr-2" /> Filter
            </Button>
            <Button variant="outline" className="rounded-xl border-gray-200 font-bold text-xs uppercase tracking-widest h-12 px-6">
              <Calendar size={14} className="mr-2" /> Last 30 Days
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-8">
        <Card className="border-none shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
          <CardHeader className="bg-white border-b border-gray-50 p-8">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-black tracking-tight">Alignment Score Trend</CardTitle>
                <CardDescription className="font-medium">Your weekly average is based on optimisation frequency.</CardDescription>
              </div>
              <div className="bg-green-50 text-green-600 px-4 py-2 rounded-full flex items-center gap-2 font-black text-xs uppercase tracking-widest">
                <TrendingUp size={14} />
                +8.2%
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-8">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#4F46E5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                  <XAxis 
                    dataKey="day" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 800 }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#9CA3AF', fontSize: 10, fontWeight: 800 }}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '12px' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="score" 
                    stroke="#4F46E5" 
                    strokeWidth={4}
                    fillOpacity={1} 
                    fill="url(#colorScore)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-3 px-2">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
              <HistoryIcon size={20} className="text-indigo-600" />
            </div>
            Recent Optimisations
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {history.length > 0 ? history.map((log, i) => (
              <div key={i} className="bg-white p-6 rounded-[2rem] border border-gray-100 flex items-center justify-between hover:border-indigo-100 transition-all group shadow-sm">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
                    log.status === 'proposed' ? "bg-indigo-50 text-indigo-600" : 
                    log.status === 'cancelled' ? "bg-red-50 text-red-400" : "bg-gray-50 text-gray-400"
                  )}>
                    {log.status === 'proposed' ? <CheckCircle2 size={20} /> : 
                     log.status === 'cancelled' ? <XCircle size={20} /> : <HistoryIcon size={20} />}
                  </div>
                  <div>
                    <h3 className="font-black text-gray-900 tracking-tight capitalize">{log.status} Plan</h3>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                      {format(parseISO(log.run_at), 'MMM do, HH:mm')} • {log.proposed_changes?.length || 0} changes
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-black text-indigo-600">{log.vibe_score_after || 80}</div>
                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Score</p>
                </div>
              </div>
            )) : (
              <div className="col-span-full py-20 text-center bg-gray-50/50 rounded-[2rem] border border-dashed border-gray-200">
                <p className="text-gray-400 font-black uppercase tracking-widest text-xs">No history yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default History;