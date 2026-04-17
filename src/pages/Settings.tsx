"use client";

import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { Save, Clock, Shield, Target, Apple, Mail, Lock, Eye, EyeOff, RefreshCw, CheckCircle2, ListOrdered, Calendar, Globe, Square } from 'lucide-react';

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [calendars, setCalendars] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({
    day_start_time: '09:00',
    day_end_time: '17:00',
    max_hours_per_day: 6,
    max_tasks_per_day: 5,
    optimisation_aggressiveness: 'balanced',
    preview_mode_enabled: true,
    group_similar_tasks: true
  });

  const [profile, setProfile] = useState<any>({
    apple_id: '',
    apple_app_password: ''
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [settingsRes, profileRes, calendarsRes] = await Promise.all([
          supabase.from('user_settings').select('*').eq('user_id', user.id).single(),
          supabase.from('profiles').select('apple_id, apple_app_password').eq('id', user.id).single(),
          supabase.from('user_calendars').select('*').eq('user_id', user.id).order('provider', { ascending: true })
        ]);

        if (settingsRes.data) setSettings(settingsRes.data);
        if (profileRes.data) setProfile(profileRes.data);
        if (calendarsRes.data) setCalendars(calendarsRes.data);
      } catch (err) {
        console.error("Error fetching settings:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSave = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error: settingsError } = await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, ...settings });

      if (settingsError) throw settingsError;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ 
          apple_id: profile.apple_id, 
          apple_app_password: profile.apple_app_password 
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      showSuccess('Settings saved successfully');
    } catch (err: any) {
      showError(err.message);
    }
  };

  const toggleCalendar = async (id: string, enabled: boolean) => {
    try {
      const { error } = await supabase
        .from('user_calendars')
        .update({ is_enabled: enabled })
        .eq('id', id);
      
      if (error) throw error;
      
      setCalendars(calendars.map(c => c.id === id ? { ...c, is_enabled: enabled } : c));
      showSuccess(`Calendar ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err: any) {
      showError(err.message);
    }
  };

  const uncheckAllApple = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('user_calendars')
        .update({ is_enabled: false })
        .eq('user_id', user.id)
        .eq('provider', 'apple');

      if (error) throw error;

      setCalendars(calendars.map(c => c.provider === 'apple' ? { ...c, is_enabled: false } : c));
      showSuccess('All Apple calendars disabled');
    } catch (err: any) {
      showError(err.message);
    }
  };

  const discoverCalendars = async () => {
    setIsTesting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Refresh Apple
      if (profile.apple_id && profile.apple_app_password) {
        await supabase.functions.invoke('sync-apple-calendar');
      }

      // Refresh Google (requires session token)
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.provider_token) {
        await supabase.functions.invoke('sync-calendar', {
          body: { googleAccessToken: session.provider_token }
        });
      }
      
      // Refresh calendar list
      const { data: newCals } = await supabase
        .from('user_calendars')
        .select('*')
        .eq('user_id', user.id)
        .order('provider', { ascending: true });
      
      if (newCals) setCalendars(newCals);
      showSuccess('Calendar list refreshed!');
    } catch (err: any) {
      showError(`Discovery failed: ${err.message}`);
    } finally {
      setIsTesting(false);
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
                <input 
                  type="time" 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={settings.day_start_time} 
                  onChange={(e) => setSettings({...settings, day_start_time: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>Day End</Label>
                <input 
                  type="time" 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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

          <Card className="border-none shadow-sm rounded-2xl border-l-4 border-l-gray-900">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="text-gray-900" size={20} />
                  Calendar Management
                </CardTitle>
                <CardDescription>Toggle which calendars the optimiser should analyze.</CardDescription>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={discoverCalendars}
                disabled={isTesting}
                className="rounded-xl border-gray-200 hover:bg-gray-50"
              >
                {isTesting ? (
                  <RefreshCw size={14} className="mr-2 animate-spin" />
                ) : (
                  <RefreshCw size={14} className="mr-2" />
                )}
                Refresh All Calendars
              </Button>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Mail size={14} className="text-gray-400" />
                    Apple ID Email
                  </Label>
                  <Input 
                    placeholder="your@email.com"
                    value={profile.apple_id || ''}
                    onChange={(e) => setProfile({...profile, apple_id: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Lock size={14} className="text-gray-400" />
                    App-Specific Password
                  </Label>
                  <div className="relative">
                    <Input 
                      type={showPassword ? "text" : "password"}
                      placeholder="xxxx-xxxx-xxxx-xxxx"
                      value={profile.apple_app_password || ''}
                      onChange={(e) => setProfile({...profile, apple_app_password: e.target.value})}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>

              {calendars.length > 0 && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <Globe size={14} /> Google Calendars
                    </Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {calendars.filter(c => c.provider === 'google').map((cal) => (
                        <div key={cal.id} className="flex items-center justify-between p-3 bg-blue-50/30 rounded-xl border border-blue-100/50">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div 
                              className="w-3 h-3 rounded-full shrink-0" 
                              style={{ backgroundColor: cal.color || '#6366f1' }} 
                            />
                            <span className="text-sm font-bold text-gray-700 truncate">{cal.calendar_name}</span>
                          </div>
                          <Switch 
                            checked={cal.is_enabled} 
                            onCheckedChange={(val) => toggleCalendar(cal.id, val)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                        <Apple size={14} /> Apple Calendars
                      </Label>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={uncheckAllApple}
                        className="h-auto py-1 px-2 text-[10px] font-bold text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Square size={10} className="mr-1" /> Deselect All
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {calendars.filter(c => c.provider === 'apple').map((cal) => (
                        <div key={cal.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div 
                              className="w-3 h-3 rounded-full shrink-0" 
                              style={{ backgroundColor: cal.color || '#6366f1' }} 
                            />
                            <span className="text-sm font-bold text-gray-700 truncate">{cal.calendar_name}</span>
                          </div>
                          <Switch 
                            checked={cal.is_enabled} 
                            onCheckedChange={(val) => toggleCalendar(cal.id, val)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
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