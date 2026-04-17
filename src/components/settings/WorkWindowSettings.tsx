"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Clock, ListOrdered } from 'lucide-react';

interface WorkWindowSettingsProps {
  settings: any;
  setSettings: (settings: any) => void;
}

const WorkWindowSettings = ({ settings, setSettings }: WorkWindowSettingsProps) => {
  return (
    <Card className="border-none shadow-sm rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="text-indigo-600" size={20} />
          Work Window
        </CardTitle>
        <CardDescription>Define when the optimiser is allowed to schedule tasks.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label>Day Start</Label>
          <input 
            type="time" 
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={settings.day_start_time} 
            onChange={(e) => setSettings({...settings, day_start_time: e.target.value})}
          />
        </div>
        <div className="space-y-2">
          <Label>Day End</Label>
          <input 
            type="time" 
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={settings.day_end_time} 
            onChange={(e) => setSettings({...settings, day_end_time: e.target.value})}
          />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Clock size={14} className="text-gray-400" />
            Max Workload (Hours/Day)
          </Label>
          <Input 
            type="number" 
            value={settings.max_hours_per_day} 
            onChange={(e) => setSettings({...settings, max_hours_per_day: parseInt(e.target.value)})}
          />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <ListOrdered size={14} className="text-gray-400" />
            Max Tasks Per Day
          </Label>
          <Input 
            type="number" 
            placeholder="e.g. 5"
            value={settings.max_tasks_per_day || ''} 
            onChange={(e) => setSettings({...settings, max_tasks_per_day: parseInt(e.target.value)})}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default WorkWindowSettings;