import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { Save, Clock, Shield, Target } from 'lucide-react';

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<any>({
    day_start_time: '09:00',
    day_end_time: '17:00',
    max_hours_per_day: 6,
    optimisation_aggressiveness: 'balanced',
    preview_mode_enabled: true,
    group_similar_tasks: true
  });

  const [themes, setThemes] = useState<any[]>([
    { day: 0, label: 'Sunday', theme: 'Rest' },
    { day: 1, label: 'Monday', theme: 'Music' },
    { day: 2, label: 'Tuesday', theme: 'Admin' },
    { day: 3, label: 'Wednesday', theme: 'Kinesiology' },
    { day: 4, label: 'Thursday', theme: 'Deep Work' },
    { day: 5, label: 'Friday', theme: 'Creative' },
    { day: 6, label: 'Saturday', theme: 'Social' },
  ]);

  const handleSave = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, ...settings });

      if (error) throw error;
      showSuccess('Settings saved successfully');
    } catch (err: any) {
      showError(err.message);
    }
  };

  return (
    <Layout>
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Control Layer</h1>
          <p className="text-gray-500 mt-1">Configure your scheduling rules and AI preferences.</p>
        </div>
        <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-6">
          <Save size={18} className="mr-2" /> Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
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
                <Input 
                  type="time" 
                  value={settings.day_start_time} 
                  onChange={(e) => setSettings({...settings, day_start_time: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>Day End</Label>
                <Input 
                  type="time" 
                  value={settings.day_end_time} 
                  onChange={(e) => setSettings({...settings, day_end_time: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Workload (Hours/Day)</Label>
                <Input 
                  type="number" 
                  value={settings.max_hours_per_day} 
                  onChange={(e) => setSettings({...settings, max_hours_per_day: parseInt(e.target.value)})}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="text-indigo-600" size={20} />
                Day Themes
              </CardTitle>
              <CardDescription>Assign focus areas to specific days of the week.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {themes.map((t, i) => (
                <div key={i} className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl">
                  <span className="w-24 font-medium text-gray-600">{t.label}</span>
                  <Input 
                    placeholder="e.g. Music, Study, Admin" 
                    className="bg-white"
                    value={t.theme}
                    onChange={(e) => {
                      const newThemes = [...themes];
                      newThemes[i].theme = e.target.value;
                      setThemes(newThemes);
                    }}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="border-none shadow-sm rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="text-indigo-600" size={20} />
                Optimisation Logic
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Aggressiveness</Label>
                <Select 
                  value={settings.optimisation_aggressiveness}
                  onValueChange={(val) => setSettings({...settings, optimisation_aggressiveness: val})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relaxed">Relaxed (Keep most)</SelectItem>
                    <SelectItem value="balanced">Balanced</SelectItem>
                    <SelectItem value="strict">Strict (Aggressive moves)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Preview Mode</Label>
                  <p className="text-xs text-gray-500">Review changes before syncing</p>
                </div>
                <Switch 
                  checked={settings.preview_mode_enabled}
                  onCheckedChange={(val) => setSettings({...settings, preview_mode_enabled: val})}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Group Similar Tasks</Label>
                  <p className="text-xs text-gray-500">Minimise context switching</p>
                </div>
                <Switch 
                  checked={settings.group_similar_tasks}
                  onCheckedChange={(val) => setSettings({...settings, group_similar_tasks: val})}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
};

export default Settings;