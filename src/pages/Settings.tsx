"use client";

import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import WorkWindowSettings from '../components/settings/WorkWindowSettings';
import KeywordManager from '../components/settings/KeywordManager';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { cn } from '@/lib/utils';
import { Save, Shield, Target, Calendar, RefreshCw, Sparkles, Ban, Briefcase } from 'lucide-react';

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [calendars, setCalendars] = useState<any[]>([]);
  
  const [settings, setSettings] = useState<any>({
    day_start_time: '09:00',
    day_end_time: '17:00',
    max_hours_per_day: 6,
    max_tasks_per_day: 5,
    optimisation_aggressiveness: 'balanced',
    preview_mode_enabled: true,
    group_similar_tasks: true,
    movable_keywords: [],
    locked_keywords: [],
    work_keywords: []
  });

  const [profile, setProfile] = useState<any>({
    apple_id: '',
    apple_app_password: ''
  });

  const [themes, setThemes] = useState<any[]>([
    { day_of_week: 0, label: 'Sunday', theme: '' },
    { day_of_week: 1, label: 'Monday', theme: '' },
    { day_of_week: 2, label: 'Tuesday', theme: '' },
    { day_of_week: 3, label: 'Wednesday', theme: '' },
    { day_of_week: 4, label: 'Thursday', theme: '' },
    { day_of_week: 5, label: 'Friday', theme: '' },
    { day_of_week: 6, label: 'Saturday', theme: '' },
  ]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [settingsRes, profileRes, calendarsRes, themesRes] = await Promise.all([
          supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
          supabase.from('profiles').select('apple_id, apple_app_password').eq('id', user.id).maybeSingle(),
          supabase.from('user_calendars').select('*').eq('user_id', user.id).order('provider', { ascending: true }),
          supabase.from('day_themes').select('*').eq('user_id', user.id)
        ]);

        if (settingsRes.data) {
          setSettings({
            ...settingsRes.data,
            movable_keywords: settingsRes.data.movable_keywords || [],
            locked_keywords: settingsRes.data.locked_keywords || [],
            work_keywords: settingsRes.data.work_keywords || []
          });
        }
        if (profileRes.data) setProfile(profileRes.data);
        if (calendarsRes.data) setCalendars(calendarsRes.data);
        
        if (themesRes.data && themesRes.data.length > 0) {
          const updatedThemes = themes.map(t => {
            const dbTheme = themesRes.data.find((dt: any) => dt.day_of_week === t.day_of_week);
            return dbTheme ? { ...t, theme: dbTheme.theme } : t;
          });
          setThemes(updatedThemes);
        }
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

      const { id, created_at, ...settingsToSave } = settings;

      const { error: settingsError } = await supabase
        .from('user_settings')
        .upsert({ 
          user_id: user.id, 
          ...settingsToSave 
        }, { onConflict: 'user_id' });

      if (settingsError) throw settingsError;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ 
          apple_id: profile.apple_id, 
          apple_app_password: profile.apple_app_password 
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      const themePayload = themes.map(t => ({
        user_id: user.id,
        day_of_week: t.day_of_week,
        theme: t.theme || 'General'
      }));

      const { error: themesError } = await supabase
        .from('day_themes')
        .upsert(themePayload, { onConflict: 'user_id, day_of_week' });

      if (themesError) throw themesError;

      showSuccess('Settings saved successfully');
    } catch (err: any) {
      showError(err.message);
    }
  };

  const handleAddKeyword = async (keyword: string, type: 'movable' | 'locked' | 'work') => {
    const field = type === 'movable' ? 'movable_keywords' : type === 'locked' ? 'locked_keywords' : 'work_keywords';
    const trimmed = keyword.toLowerCase();
    
    if (settings[field].includes(trimmed)) return;
    
    const newKeywords = [...settings[field], trimmed];
    setSettings(prev => ({ ...prev, [field]: newKeywords }));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('user_settings').upsert({ user_id: user.id, [field]: newKeywords }, { onConflict: 'user_id' });
      showSuccess(`Added "${trimmed}"`);
    } catch (err) {
      showError("Failed to save keyword");
    }
  };

  const handleRemoveKeyword = async (kw: string, type: 'movable' | 'locked' | 'work') => {
    const field = type === 'movable' ? 'movable_keywords' : type === 'locked' ? 'locked_keywords' : 'work_keywords';
    const newKeywords = settings[field].filter((k: string) => k !== kw);
    
    setSettings(prev => ({ ...prev, [field]: newKeywords }));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('user_settings').upsert({ user_id: user.id, [field]: newKeywords }, { onConflict: 'user_id' });
      showSuccess(`Removed "${kw}"`);
    } catch (err) {
      showError("Failed to remove keyword");
    }
  };

  const toggleCalendar = async (id: string, enabled: boolean) => {
    try {
      const { error } = await supabase.from('user_calendars').update({ is_enabled: enabled }).eq('id', id);
      if (error) throw error;
      setCalendars(calendars.map(c => c.id === id ? { ...c, is_enabled: enabled } : c));
      showSuccess(`Calendar ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err: any) {
      showError(err.message);
    }
  };

  const discoverCalendars = async () => {
    setIsTesting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.provider_token) {
        await supabase.functions.invoke('sync-calendar', { body: { googleAccessToken: session.provider_token } });
      }
      if (profile.apple_id && profile.apple_app_password) {
        await supabase.functions.invoke('sync-apple-calendar');
      }
      
      const { data: newCals } = await supabase.from('user_calendars').select('*').eq('user_id', user.id).order('provider', { ascending: true });
      if (newCals) setCalendars(newCals);
      showSuccess('Calendar list refreshed!');
    } catch (err: any) {
      showError(`Discovery failed: ${err.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  if (loading) return <Layout><div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-indigo-600" /></div></Layout>;

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
          <WorkWindowSettings settings={settings} setSettings={setSettings} />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <KeywordManager 
              title="Movable" 
              icon={Sparkles} 
              iconColor="text-indigo-600" 
              keywords={settings.movable_keywords}
              onAdd={(kw) => handleAddKeyword(kw, 'movable')}
              onRemove={(kw) => handleRemoveKeyword(kw, 'movable')}
              badgeVariant="indigo"
            />
            <KeywordManager 
              title="Locked" 
              icon={Ban} 
              iconColor="text-red-500" 
              keywords={settings.locked_keywords}
              onAdd={(kw) => handleAddKeyword(kw, 'locked')}
              onRemove={(kw) => handleRemoveKeyword(kw, 'locked')}
              badgeVariant="red"
            />
            <KeywordManager 
              title="Work Detection" 
              icon={Briefcase} 
              iconColor="text-amber-500" 
              keywords={settings.work_keywords}
              onAdd={(kw) => handleAddKeyword(kw, 'work')}
              onRemove={(kw) => handleRemoveKeyword(kw, 'work')}
              badgeVariant="amber"
            />
          </div>

          <Card className="border-none shadow-sm rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="text-indigo-600" size={20} />
                Day Themes
              </CardTitle>
              <CardDescription>Assign focus areas to specific days. The AI will try to match tasks to these themes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {themes.map((t, i) => (
                <div key={i} className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl">
                  <span className="w-24 font-bold text-gray-500">{t.label}</span>
                  <Input 
                    placeholder="e.g. Music, Admin, Deep Work" 
                    className="bg-white border-gray-200 rounded-xl"
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
                  <SelectTrigger className="rounded-xl">
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

          <Card className="border-none shadow-sm rounded-2xl border-l-4 border-l-gray-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="text-gray-900" size={20} />
                Calendars
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={discoverCalendars}
                disabled={isTesting}
                className="w-full rounded-xl border-gray-200"
              >
                <RefreshCw size={14} className={cn("mr-2", isTesting && "animate-spin")} />
                Refresh List
              </Button>
              
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                {calendars.map((cal) => (
                  <div key={cal.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cal.color || '#6366f1' }} />
                      <span className="text-xs font-bold text-gray-700 truncate">{cal.calendar_name}</span>
                    </div>
                    <Switch 
                      checked={cal.is_enabled} 
                      onCheckedChange={(val) => toggleCalendar(cal.id, val)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
};

export default Settings;