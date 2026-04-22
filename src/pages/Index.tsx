"use client";

import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Layout from '@/components/Layout';
import PageHeader from '@/components/PageHeader';
import { 
  Sparkles, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  Zap, 
  ArrowRight,
  Brain,
  TrendingUp,
  Target
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const Index = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    vibeScore: 82,
    tasksCompleted: 0,
    totalTasks: 0,
    nextEvent: null as any
  });

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const today = new Date().toISOString().split('T')[0];
        const { data: events } = await supabase
          .from('calendar_events_cache')
          .select('*')
          .eq('user_id', user.id)
          .gte('start_time', new Date().toISOString())
          .order('start_time', { ascending: true })
          .limit(5);

        if (events && events.length > 0) {
          setStats(prev => ({
            ...prev,
            totalTasks: events.length,
            nextEvent: events[0]
          }));
        }
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-10 pb-20">
        <PageHeader 
          title="Dashboard"
          subtitle={`Your day is ${stats.vibeScore > 80 ? 'Optimised' : 'Building'}.`}
          icon={Sparkles}
          actions={
            <Link to="/plan">
              <Button className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl px-8 h-14 font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-100 group">
                View Full Plan <ArrowRight size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          }
        />

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-none shadow-xl shadow-indigo-50/50 rounded-[2.5rem] bg-white overflow-hidden group hover:scale-[1.02] transition-all duration-500">
            <CardContent className="p-8 space-y-6">
              <div className="flex justify-between items-start">
                <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                  <Zap size={24} />
                </div>
                <div className="bg-green-50 text-green-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                  <TrendingUp size={12} /> +5%
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Vibe Score</p>
                <h3 className="text-4xl font-black text-gray-900">{stats.vibeScore}%</h3>
              </div>
              <Progress value={stats.vibeScore} className="h-2 bg-gray-50" />
            </CardContent>
          </Card>

          <Card className="border-none shadow-xl shadow-purple-50/50 rounded-[2.5rem] bg-white overflow-hidden group hover:scale-[1.02] transition-all duration-500">
            <CardContent className="p-8 space-y-6">
              <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600">
                <Target size={24} />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Daily Progress</p>
                <h3 className="text-4xl font-black text-gray-900">{stats.tasksCompleted}/{stats.totalTasks || 0}</h3>
              </div>
              <Progress value={stats.totalTasks > 0 ? (stats.tasksCompleted / stats.totalTasks) * 100 : 0} className="h-2 bg-gray-50" />
            </CardContent>
          </Card>

          <Card className="border-none shadow-xl shadow-amber-50/50 rounded-[2.5rem] bg-white overflow-hidden group hover:scale-[1.02] transition-all duration-500">
            <CardContent className="p-8 space-y-6">
              <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600">
                <Brain size={24} />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Focus Mode</p>
                <h3 className="text-4xl font-black text-gray-900">Active</h3>
              </div>
              <div className="flex gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">AI Monitoring</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Next Up Section */}
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
              <Clock className="text-indigo-600" size={22} />
              Next on your schedule
            </h2>
            <Link to="/plan" className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline">
              View Timeline
            </Link>
          </div>

          {stats.nextEvent ? (
            <div className="bg-white p-8 rounded-[3rem] border border-gray-100 shadow-xl shadow-indigo-50/30 flex flex-col md:flex-row items-center justify-between gap-8 group">
              <div className="flex items-center gap-8">
                <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex flex-col items-center justify-center text-white shadow-lg shadow-indigo-200 group-hover:rotate-3 transition-transform">
                  <span className="text-xs font-black uppercase tracking-tighter opacity-80">Starts</span>
                  <span className="text-xl font-black">{format(new Date(stats.nextEvent.start_time), 'HH:mm')}</span>
                </div>
                <div className="space-y-1">
                  <h3 className="text-2xl font-black text-gray-900 tracking-tight">{stats.nextEvent.title}</h3>
                  <p className="text-gray-400 font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                    <Calendar size={14} /> {stats.nextEvent.source_calendar}
                  </p>
                </div>
              </div>
              <Button onClick={() => navigate('/plan')} variant="outline" className="rounded-2xl px-8 h-14 border-gray-100 font-black text-xs uppercase tracking-widest hover:bg-indigo-50 hover:text-indigo-600 transition-all">
                Prepare Session
              </Button>
            </div>
          ) : (
            <div className="bg-gray-50/50 border-2 border-dashed border-gray-200 rounded-[3rem] p-20 text-center">
              <Calendar className="mx-auto text-gray-300 mb-4" size={48} />
              <p className="text-gray-400 font-black uppercase tracking-widest text-sm">No upcoming events synced</p>
              <Button onClick={() => navigate('/plan')} variant="link" className="text-indigo-600 font-black mt-2">
                Sync your calendar
              </Button>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <button 
            onClick={() => navigate('/optimise')}
            className="p-10 rounded-[3rem] bg-gradient-to-br from-indigo-600 to-indigo-800 text-white text-left space-y-4 shadow-2xl shadow-indigo-200 hover:scale-[1.02] active:scale-[0.98] transition-all group"
          >
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md">
              <Sparkles size={28} />
            </div>
            <div>
              <h3 className="text-2xl font-black tracking-tight">Run Optimiser</h3>
              <p className="text-indigo-100 font-medium opacity-80">Let AI reshuffle your day for peak focus.</p>
            </div>
          </button>

          <button 
            onClick={() => navigate('/vet')}
            className="p-10 rounded-[3rem] bg-white border border-gray-100 text-left space-y-4 shadow-xl shadow-gray-100 hover:scale-[1.02] active:scale-[0.98] transition-all group"
          >
            <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
              <CheckCircle2 size={28} />
            </div>
            <div>
              <h3 className="text-2xl font-black text-gray-900 tracking-tight">Vet Tasks</h3>
              <p className="text-gray-500 font-medium">Review and lock your essential appointments.</p>
            </div>
          </button>
        </div>
      </div>
    </Layout>
  );
};

export default Index;