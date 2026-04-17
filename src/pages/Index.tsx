import React from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, ArrowRight, Calendar as CalendarIcon, Clock, CheckCircle2 } from 'lucide-react';

const Dashboard = () => {
  return (
    <Layout>
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Welcome back, User</h1>
          <p className="text-gray-500 mt-1">Here's how your schedule is looking today.</p>
        </div>
        <Button className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-6 py-6 h-auto flex gap-2 shadow-lg shadow-indigo-200 transition-all hover:scale-[1.02]">
          <Sparkles size={20} />
          Optimise Schedule
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="border-none shadow-sm bg-white rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wider">Workload</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">5.5 hrs</div>
            <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
              <CheckCircle2 size={12} /> Within daily limit
            </p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm bg-white rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wider">Themed Alignment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">92%</div>
            <p className="text-xs text-indigo-600 mt-1">Music Day (Monday)</p>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm bg-white rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wider">Context Switches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">3</div>
            <p className="text-xs text-gray-500 mt-1">Optimised grouping active</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Clock size={20} className="text-indigo-600" />
            Upcoming Tasks
          </h2>
          <div className="space-y-3">
            {[
              { title: 'Piano Practice', time: '10:00 - 10:30', category: 'Music', status: 'Locked' },
              { title: 'Arranging Session', time: '10:30 - 11:30', category: 'Music', status: 'Movable' },
              { title: 'Kinesiology Study', time: '13:00 - 14:00', category: 'Kinesiology', status: 'Locked' },
            ].map((task, i) => (
              <div key={i} className="bg-white p-4 rounded-2xl border border-gray-100 flex items-center justify-between group hover:border-indigo-200 transition-colors">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-2 h-12 rounded-full",
                    task.category === 'Music' ? "bg-purple-400" : "bg-blue-400"
                  )} />
                  <div>
                    <h3 className="font-semibold text-gray-900">{task.title}</h3>
                    <p className="text-sm text-gray-500">{task.time} • {task.category}</p>
                  </div>
                </div>
                <span className={cn(
                  "text-xs font-medium px-3 py-1 rounded-full",
                  task.status === 'Locked' ? "bg-gray-100 text-gray-600" : "bg-indigo-50 text-indigo-600"
                )}>
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarIcon size={20} className="text-indigo-600" />
            Day Themes
          </h2>
          <div className="bg-white p-6 rounded-2xl border border-gray-100">
            <div className="space-y-4">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, i) => (
                <div key={day} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500 w-12">{day}</span>
                  <div className="flex-1 mx-4 h-2 bg-gray-50 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500 rounded-full" 
                      style={{ width: i === 0 ? '100%' : i === 2 ? '80%' : '40%' }} 
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {i === 0 ? 'Music' : i === 2 ? 'Kinesiology' : 'General'}
                  </span>
                </div>
              ))}
            </div>
            <Button variant="ghost" className="w-full mt-6 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-xl">
              Edit Themes <ArrowRight size={16} className="ml-2" />
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;