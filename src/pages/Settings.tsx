"use client";

import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import WorkWindowSettings from '@/components/settings/WorkWindowSettings';
import KeywordManager from '@/components/settings/KeywordManager';
import DayThemesSettings from '@/components/settings/DayThemesSettings';
import OptimisationLogicSettings from '@/components/settings/OptimisationLogicSettings';
import CalendarSettings from '@/components/settings/CalendarSettings';
import IntelligenceCenter from '@/components/settings/IntelligenceCenter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { cn } from '@/lib/utils';
import { Save, Sparkles, Ban, Briefcase, RefreshCw, Link2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Settings = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [calendars, setCalendars] = useState<any[]>([]);
  const [googleStatus, setGoogleStatus] = useState<'connected' | 'expired' | 'disconnected'>('disconnected');
  
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
    work_keywords: [],
    natural_language_rules: ''
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

  const checkGoogleConnection = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.provider_token) {
        setGoogleStatus('connected');
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase.from('profiles').select('google_access_token').eq('id', user.id).single();
      
      if (profile?.google_access_token) {
        const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', {
          headers: { Authorization: `Bearer ${profile.google_access_token}` }
        });
        setGoogleStatus(res.ok ? 'connected' : 'expired');
      } else {
        setGoogleStatus('disconnected');
      }
    } catch (err) {
      setGoogleStatus('expired');
    }
  };

  const fetchCalendars = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('user_calendars').select('*').eq('user_id', user.id).order('provider', { ascending: true });
    if (data) setCalendars(data);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [settingsRes, profileRes, themesRes] = await Promise.all([
          supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
          supabase.from('profiles').select('apple_id, apple_app_password').eq('id', user.id).maybeSingle(),
          supabase.from('day_themes').select('*').eq('user_id', user.id)
        ]);

        if (settingsRes.data) {
          setSettings({
            ...settingsRes.data,
            movable_keywords: settingsRes.data.movable_keywords || [],
            locked_keywords: settingsRes.data.locked_keywords || [],
            work_keywords: settingsRes.data.work_keywords || [],
            natural_language_rules: settingsRes.data.natural_language_rules || ''
          });
        }
        if (profileRes.data) setProfile(profileRes.data);
        
        if (themesRes.data && themesRes.data.length > 0) {
          const updatedThemes = themes.map(t => {
            const dbTheme = themesRes.data.find((dt: any) => dt.day_of_week === t.day_of_week);
            return dbTheme ? { ...t, theme: dbTheme.theme } : t;
          });
          setThemes(updatedThemes);
        }

        await fetchCalendars();
        await checkGoogleConnection();
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

  const handleReconnect = async () => {
    await supabase.auth.signOut();
    navigate('/login');
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('user_calendars').update({ is_enabled: enabled }).eq('id', id);
      if (error) throw error;

      // Immediate cleanup of cache if disabled
      if (!enabled) {
        const cal = calendars.find(c => c.id === id);
        if (cal) {
          await supabase.from('calendar_events_cache')
            .delete()
            .eq('user_id', user.id)
            .eq('source_calendar_id', cal.calendar_id);
        }
      }

      setCalendars(calendars.map(c => c.id === id ? { ...c, is_enabled: enabled } : c));
      showSuccess(`Calendar ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err: any) {
      showError(err.message);
    }
  };

  const handleBulkToggleCalendars = async (provider: string, enabled: boolean) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('user_calendars')
        .update({ is_enabled: enabled })
        .eq('user_id', user.id)
        .eq('provider', provider);

      if (error) throw error;

      // Immediate cleanup of cache for all disabled calendars in this provider
      if (!enabled) {
        await supabase.from('calendar_events_cache')
          .delete()
          .eq('user_id', user.id)
          .eq('provider', provider);
      }

      setCalendars(prev => prev.map(c => 
        c.provider === provider ? { ...c, is_enabled: enabled } : c
      ));
      
      showSuccess(`${provider === 'google' ? 'Google' : 'iCloud'} calendars ${enabled ? 'enabled' : 'disabled'}`);
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
        await supabase.from('profiles').update({ google_access_token: session.provider_token }).eq('id', user.id);
        await supabase.functions.invoke('sync-calendar', { body: { googleAccessToken: session.provider_token } });
      } else {
        await supabase.functions.invoke('sync-calendar', { body: {} });
      }

      if (profile.apple_id && profile.apple_app_password) {
        await supabase.functions.invoke('sync-apple-calendar');
      }
      
      await fetchCalendars();
      showSuccess('Calendar list refreshed!');
      await checkGoogleConnection();
    } catch (err: any) {
      showError(`Discovery failed: ${err.message}`);
      if (err.message.includes('401') || err.message.includes('Unauthorized')) {
        setGoogleStatus('expired');
      }
    } finally {
      setIsTesting(false);
    }
  };

  const handleThemeChange = (index: number, value: string) => {
    const newThemes = [...themes];
    newThemes[index].theme = value;
    setThemes(newThemes);
  };

  if (loading) return <Layout><div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-indigo-600" /></div></Layout>;

  return (
    <Layout>
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Control Layer</h1>
          <p className="text-gray-500 mt-1">Configure your scheduling rules and AI preferences.</p>
        </div>
        <div className="flex items-center gap-3">
          <a 
            href="https://gemini.google.com/app/7f2a6f927c67ca43" 
            target="_blank" 
            rel="noopener noreferrer"
            className="w-10 h-10 rounded-full bg-white border border-gray-100 shadow-sm flex items-center justify-center text-indigo-600 hover:bg-indigo-50 transition-all hover:scale-110"
            title="Open Gemini"
          >
            <Sparkles size={20} />
          </a>
          <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-6">
            <Save size={18} className="mr-2" /> Save Changes
          </Button>
        </div>
      </div>

      <div className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            {/* Google Connection Status Card */}
            <Card className={cn(
              "border-none shadow-sm rounded-2xl transition-all",
              googleStatus === 'expired' ? "bg-amber-50 border border-amber-100" : "bg-white"
            )}>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Link2 className="text-indigo-600" size={20} />
                  Google Connection
                </CardTitle>
                <CardDescription>Manage your Google Calendar integration status.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 rounded-xl bg-white/50 border border-gray-100">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center",
                      googleStatus === 'connected' ? "bg-green-100 text-green-600" : 
                      googleStatus === 'expired' ? "bg-amber-100 text-amber-600" : "bg-gray-100 text-gray-400"
                    )}>
                      {googleStatus === 'connected' ? <CheckCircle2 size={20} /> : 
                       googleStatus === 'expired' ? <AlertCircle size={20} /> : <Link2 size={20} />}
                    </div>
                    <div>
                      <p className="font-bold text-sm capitalize">{googleStatus}</p>
                      <p className="text-xs text-gray-500">
                        {googleStatus === 'connected' ? 'Your calendar is syncing correctly.' : 
                         googleStatus === 'expired' ? 'Your session has expired. Please reconnect.' : 
                         'No Google account connected.'}
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant={googleStatus === 'expired' ? "default" : "outline"}
                    onClick={handleReconnect}
                    className={cn(
                      "rounded-xl font-bold text-xs",
                      googleStatus === 'expired' && "bg-indigo-600 hover:bg-indigo-700"
                    )}
                  >
                    {googleStatus === 'connected' ? 'Switch Account' : 'Reconnect Google'}
                  </Button>
                </div>
              </CardContent>
            </Card>

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

            <IntelligenceCenter
              naturalLanguageRules={settings.natural_language_rules}
              onRulesChange={(rules) => setSettings(prev => ({ ...prev, natural_language_rules: rules }))}
              movableKeywords={settings.movable_keywords}
              lockedKeywords={settings.locked_keywords}
            />

            <DayThemesSettings themes={themes} onThemeChange={handleThemeChange} />
          </div>

          <div className="space-y-8">
            <OptimisationLogicSettings settings={settings} setSettings={setSettings} />
          </div>
        </div>

        {/* Full Width Calendar Settings */}
        <div className="w-full">
          <CalendarSettings 
            calendars={calendars} 
            isTesting={isTesting} 
            onDiscover={discoverCalendars} 
            onToggle={toggleCalendar} 
            onBulkToggle={handleBulkToggleCalendars}
          />
        </div>
      </div>
    </Layout>
  );
};

export default Settings;