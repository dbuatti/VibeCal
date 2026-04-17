"use client";

import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowRight, Calendar as CalendarIcon, Clock, CheckCircle2, Zap, Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfWeek, addDays } from 'date-fns';

const Dashboard = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [themes, setThemes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [eventsRes, profileRes, themesRes] = await Promise.all([
        supabase.from('calendar_events_cache').select('*').order('start_time', { ascending: true }).limit(5),
        supabase.from('profiles').select('vibe_score, vibe_score_trend').eq('id', user.id).single(),
        supabase.from('day_themes').select('*').eq('user_id', user.id).order('day_of_week', { ascending: true })
      ]);

      if (eventsRes.data) setEvents(eventsRes.data);
      if (profileRes.data) setProfile(profileRes.data);
      
      // Prepare weekly themes display
      const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const today = new Date().getDay();
      
      const preparedThemes = dayLabels.map((label, index) => {
        const dbTheme = themesRes.data?.find((t: any) => t.day_of_week === index);
        return {
          day: label,
          theme: dbTheme?.theme || 'General',
          active: index === today,
          progress: index === today ? 100 : (index < today ? 100 : 0)
        };
      });
      
      setThemes(preparedThemes);
      setLoading(false);
    };

    fetchData();
  }, []);

  const vibeScore = profile?.vibe_score ?? 0;

  return (
    <Layout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-10">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Good morning</h1>
          <p className="text-gray-500 mt-2 text-lg">Your schedule is being <span className="text-indigo-600 font-semibold">aligned</span> with your themes.</p>
        </div>
        <Link to="/optimise">
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl px-8 py-7 h-auto flex gap-3 shadow-xl shadow-indigo-100 transition-all hover:scale-[1.02] active:scale-[0.98]">
            <Sparkles size={22} />
            <span className="text-lg font-bold">Optimise Now</span>
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <Card className="border-none shadow-sm bg-white rounded-[2rem] p-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em]">Daily Workload</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-black text-gray-900">{events.length}</div>
              <div className="text-gray-400 font-medium">events</div>
            </div>
            <div className="mt-4 h-2 bg-gray-50 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full w-[40%]" />
            </div>
            <p className="text-xs text-green-600 mt-3 flex items-center gap-1 font-semibold">
              <CheckCircle2 size={14} /> Synced & Ready
            </p>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white rounded-[2rem] p-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em]">Vibe Alignment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-black text-indigo-600">{vibeScore}%</div>
            </div>
            <div className="mt-4 flex gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                <div key={i} className={cn("h-2 flex-1 rounded-full", i <= (vibeScore / 10) ? "bg-indigo-500" : "bg-gray-100")} />
              ))}
            </div>
            <p className="text-xs text-indigo-600 mt-3 font-semibold">
              {vibeScore < 80 ? 'Optimisation Recommended' : 'Schedule is Aligned'}
            </p>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white rounded-[2rem] p-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em]">Focus Blocks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-4xl font-black text-gray-900">--</div>
              <div className="text-gray-400 font-medium">sessions</div>
            </div>
            <div className="mt-4 flex -space-x-2">
              {[1, 2].map((i) => (
                <div key={i} className="w-8 h-8 rounded-full bg-indigo-100 border-2 border-white flex items-center justify-center">
                  <Zap size={14} className="text-indigo-600" />
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3 font-semibold">Run optimiser to group tasks</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
        <div className="lg:col-span-3 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                <Clock size={20} className="text-indigo-600" />
              </div>
              Upcoming Events
            </h2>
          </div>
          
          <div className="space-y-4">
            {loading ? (
              <div className="text-center py-10 text-gray-400">Loading your schedule...</div>
            ) : events.length > 0 ? (
              events.map((event, i) => (
                <div key={i} className="bg-white p-5 rounded-[1.5rem] border border-gray-100 flex items-center justify-between group hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-50/50 transition-all duration-300 cursor-pointer">
                  <div className="flex items-center gap-5">
                    <div className="w-1.5 h-12 rounded-full bg-indigo-400" />
                    <div>
                      <h3 className="font-bold text-gray-900 text-lg">{event.title}</h3>
                      <div className="flex items-center gap-2 text-gray-500 mt-0.5">
                        <span className="text-sm font-medium">
                          {format(new Date(event.start_time), 'HH:mm')} - {format(new Date(event.end_time), 'HH:mm')}
                        </span>
                        <span className="w-1 h-1 bg-gray-300 rounded-full" />
                        <span className="text-sm font-medium">{format(new Date(event.start_time), 'MMM d')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-gray-50 text-gray-400">
                    {event.is_locked ? <Lock size={14} /> : <Unlock size={14} />}
                    {event.is_locked ? 'Locked' : 'Movable'}
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-white p-10 rounded-[2rem] border border-dashed border-gray-200 text-center">
                <p className="text-gray-500 mb-4">No events found in your cache.</p>
                <Link to="/optimise">
                  <Button variant="outline" className="rounded-xl">Sync Calendar Now</Button>
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-8">
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                <CalendarIcon size={20} className="text-indigo-600" />
              </div>
              Weekly Themes
            </h2>
            <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
              <div className="space-y-6">
                {themes.map((item) => (
                  <div key={item.day} className={cn(
                    "flex items-center justify-between p-2 rounded-2xl transition-colors",
                    item.active && "bg-indigo-50/50"
                  )}>
                    <span className={cn(
                      "text-sm font-bold w-12",
                      item.active ? "text-indigo-600" : "text-gray-400"
                    )}>{item.day}</span>
                    <div className="flex-1 mx-4 h-2.5 bg-gray-50 rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all duration-1000",
                          item.active ? "bg-indigo-600" : "bg-gray-200"
                        )} 
                        style={{ width: `${item.progress}%` }} 
                      />
                    </div>
                    <span className={cn(
                      "text-sm font-bold min-w-[80px] text-right",
                      item.active ? "text-indigo-900" : "text-gray-500"
                    )}>
                      {item.theme}
                    </span>
                  </div>
                ))}
              </div>
              <Link to="/settings">
                <Button variant="outline" className="w-full mt-8 border-gray-100 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-2xl py-6 font-bold">
                  Customise Themes <ArrowRight size={18} className="ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;