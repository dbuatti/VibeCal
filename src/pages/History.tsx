"use client";

import React from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { History as HistoryIcon, TrendingUp, Calendar, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';

const data = [
  { day: 'Mon', score: 65 },
  { day: 'Tue', score: 72 },
  { day: 'Wed', score: 68 },
  { day: 'Thu', score: 84 },
  { day: 'Fri', score: 78 },
  { day: 'Sat', score: 90 },
  { day: 'Sun', score: 84 },
];

const History = () => {
  return (
    <Layout>
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Vibe History</h1>
          <p className="text-gray-500 mt-1">Track your alignment and productivity trends.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="rounded-xl border-gray-200">
            <Filter size={18} className="mr-2" /> Filter
          </Button>
          <Button variant="outline" className="rounded-xl border-gray-200">
            <Calendar size={18} className="mr-2" /> Last 30 Days
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        <Card className="border-none shadow-sm rounded-3xl overflow-hidden">
          <CardHeader className="bg-white border-b border-gray-50 p-8">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-bold">Alignment Score Trend</CardTitle>
                <CardDescription>Your weekly average is up by 8% compared to last month.</CardDescription>
              </div>
              <div className="bg-green-50 text-green-600 px-4 py-2 rounded-full flex items-center gap-2 font-semibold">
                <TrendingUp size={18} />
                +8.2%
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-8">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
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
                    tick={{ fill: '#9CA3AF', fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#9CA3AF', fontSize: 12 }}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="score" 
                    stroke="#4F46E5" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorScore)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <HistoryIcon size={20} className="text-indigo-600" />
            Recent Optimisations
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { date: 'Today, 09:42 AM', changes: 12, score: 84, type: 'Full Sync' },
              { date: 'Yesterday, 08:15 PM', changes: 4, score: 78, type: 'Quick Fix' },
              { date: 'Oct 24, 11:20 AM', changes: 18, score: 92, type: 'Weekly Reset' },
              { date: 'Oct 23, 09:00 AM', changes: 7, score: 71, type: 'Manual' },
            ].map((log, i) => (
              <div key={i} className="bg-white p-6 rounded-2xl border border-gray-100 flex items-center justify-between hover:border-indigo-100 transition-all group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                    <HistoryIcon className="text-gray-400 group-hover:text-indigo-600" size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">{log.type}</h3>
                    <p className="text-sm text-gray-500">{log.date} • {log.changes} changes</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-indigo-600">{log.score}</div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Score</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default History;