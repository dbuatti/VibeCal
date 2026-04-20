// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const functionName = "sync-calendar";

  try {
    console.log(`[${functionName}] START - Google Sync Process`);
    const authHeader = req.headers.get('Authorization')
    let { googleAccessToken } = await req.json();

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const supabaseUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } })
    
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) throw new Error("Unauthorized");

    if (!googleAccessToken) {
      const { data: profile } = await supabaseAdmin.from('profiles').select('google_access_token').eq('id', user.id).single();
      googleAccessToken = profile?.google_access_token;
    }

    if (!googleAccessToken) {
      return new Response(JSON.stringify({ error: "Missing Google Access Token" }), { status: 401, headers: corsHeaders });
    }

    // 1. Discover & Update Calendars
    const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { 
      headers: { Authorization: `Bearer ${googleAccessToken}` } 
    });
    const listData = await listRes.json();
    if (listData.items) {
      const discovered = listData.items.filter(cal => !cal.id.includes('@import.calendar.google.com')).map(cal => ({
        user_id: user.id, 
        calendar_id: cal.id, 
        calendar_name: cal.summary, 
        provider: 'google', 
        color: cal.backgroundColor || '#6366f1'
      }));
      if (discovered.length > 0) {
        await supabaseAdmin.from('user_calendars').upsert(discovered, { onConflict: 'user_id, calendar_id' });
      }
    }

    // 2. Get Enabled Calendars
    const { data: enabled } = await supabaseAdmin.from('user_calendars').select('calendar_id, calendar_name, is_enabled').eq('user_id', user.id).eq('provider', 'google');
    const enabledCalendars = (enabled || []).filter(c => c.is_enabled);
    if (enabledCalendars.length === 0) {
      return new Response(JSON.stringify({ count: 0, message: "No calendars enabled" }), { headers: corsHeaders });
    }

    // 3. Sync Window
    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 1);
    const syncEndTime = new Date();
    syncEndTime.setDate(syncEndTime.getDate() + 365);
    
    const syncTimestamp = new Date().toISOString();
    const eventMap = new Map();
    
    const { data: settings } = await supabaseAdmin.from('user_settings').select('movable_keywords, locked_keywords, work_keywords').eq('user_id', user.id).single();
    const movableKeywords = settings?.movable_keywords || [];
    const lockedKeywords = settings?.locked_keywords || [];
    const workKeywords = settings?.work_keywords || ['meeting', 'call', 'lesson', 'audition', 'rehearsal', 'appt', 'appointment', 'coaching', 'session', 'work session'];
    
    // Relaxed fixed keywords
    const fixedKeywords = /flight|train|hotel|check-in|check-out|reservation|doctor|dentist|hospital|wedding|funeral|performance|gig|concert|show|tech|dress|opening|closing|birthday|party|gala|anniversary/i;

    for (const cal of enabledCalendars) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendar_id)}/events?timeMin=${syncStartTime.toISOString()}&timeMax=${syncEndTime.toISOString()}&singleEvents=true&orderBy=startTime`;
      let res = await fetch(url, { headers: { Authorization: `Bearer ${googleAccessToken}` } });
      if (!res.ok) continue;
      
      const data = await res.json();
      const items = data.items || [];

      items.forEach(event => {
        const title = event.summary || 'Untitled';
        let start = event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date + "T09:00:00Z");
        let end = event.end.dateTime ? new Date(event.end.dateTime) : new Date(event.end.date + "T09:30:00Z");
        
        const isExplicitlyMovable = movableKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
        const isExplicitlyLocked = lockedKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
        
        // Default to MOVABLE unless strict match
        const isLocked = isExplicitlyLocked || (!isExplicitlyMovable && ((event.attendees?.length > 1) || fixedKeywords.test(title)));
        const isWork = workKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
        
        eventMap.set(event.id, {
          user_id: user.id, 
          event_id: event.id, 
          title: title, 
          description: event.description || null,
          location: event.location || null,
          start_time: start.toISOString(), 
          end_time: end.toISOString(),
          duration_minutes: Math.round((end.getTime() - start.getTime()) / 60000) || 30, 
          is_locked: isLocked, 
          is_work: isWork,
          provider: 'google', 
          source_calendar: cal.calendar_name, 
          source_calendar_id: cal.calendar_id, 
          last_synced_at: syncTimestamp, 
          last_seen_at: syncTimestamp
        });
      });
    }

    const uniqueEvents = Array.from(eventMap.values());
    if (uniqueEvents.length > 0) {
      await supabaseAdmin.from('calendar_events_cache').upsert(uniqueEvents, { onConflict: 'user_id, event_id' });
    }
    
    const cleanupThreshold = new Date(new Date(syncTimestamp).getTime() - 60000).toISOString();
    await supabaseAdmin.from('calendar_events_cache')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', 'google')
      .gte('start_time', syncStartTime.toISOString())
      .lt('last_seen_at', cleanupThreshold);
    
    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})