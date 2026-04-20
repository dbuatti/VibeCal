// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function refreshGoogleToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID') || '',
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') || '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error("Failed to refresh Google token");
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const functionName = "sync-calendar";

  try {
    const authHeader = req.headers.get('Authorization')
    let { googleAccessToken } = await req.json();

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const supabaseUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } })
    
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseAdmin.from('profiles').select('google_access_token, google_refresh_token, timezone').eq('id', user.id).single();
    const userTimezone = profile?.timezone || 'Australia/Melbourne';
    
    let token = googleAccessToken || profile?.google_access_token;
    const refreshToken = profile?.google_refresh_token;

    if (!token && !refreshToken) {
      return new Response(JSON.stringify({ error: "Missing Google Access Token" }), { status: 401, headers: corsHeaders });
    }

    let listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', { 
      headers: { Authorization: `Bearer ${token}` } 
    });

    if (listRes.status === 401 && refreshToken) {
      token = await refreshGoogleToken(refreshToken);
      await supabaseAdmin.from('profiles').update({ google_access_token: token }).eq('id', user.id);
      listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', { 
        headers: { Authorization: `Bearer ${token}` } 
      });
    }

    const fullListRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { 
      headers: { Authorization: `Bearer ${token}` } 
    });
    const listData = await fullListRes.json();
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

    const { data: allCals } = await supabaseAdmin.from('user_calendars').select('calendar_id, calendar_name, is_enabled').eq('user_id', user.id).eq('provider', 'google');
    const enabledCalendars = (allCals || []).filter(c => c.is_enabled);
    
    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 1);
    const syncEndTime = new Date();
    syncEndTime.setDate(syncEndTime.getDate() + 365);
    
    const syncTimestamp = new Date().toISOString();
    const eventMap = new Map();
    
    const { data: settings } = await supabaseAdmin.from('user_settings').select('movable_keywords, locked_keywords, work_keywords, day_start_time').eq('user_id', user.id).single();
    const movableKeywords = settings?.movable_keywords || [];
    const lockedKeywords = settings?.locked_keywords || [];
    const workKeywords = settings?.work_keywords || ['meeting', 'call', 'lesson', 'audition', 'rehearsal', 'appt', 'appointment', 'coaching', 'session', 'work session'];
    const dayStartStr = settings?.day_start_time || '09:00';
    
    const fixedKeywords = /flight|train|hotel|check-in|check-out|reservation|doctor|dentist|hospital|wedding|funeral|performance|gig|concert|show|tech|dress|opening|closing|birthday|party|gala|anniversary/i;

    for (const cal of enabledCalendars) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendar_id)}/events?timeMin=${syncStartTime.toISOString()}&timeMax=${syncEndTime.toISOString()}&singleEvents=true&orderBy=startTime`;
      let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) continue;
      
      const data = await res.json();
      const items = data.items || [];

      items.forEach(event => {
        const title = event.summary || 'Untitled';
        let start, end;

        if (event.start.dateTime) {
          start = new Date(event.start.dateTime);
          end = new Date(event.end.dateTime);
        } else {
          // All-day event: Place it at the start of the work day in user's timezone
          const [y, m, d] = event.start.date.split('-').map(Number);
          const [h, min] = dayStartStr.split(':').map(Number);
          
          // Create a UTC date that represents the local time
          const localDate = new Date(Date.UTC(y, m - 1, d, h, min, 0));
          
          // Find offset
          const formatter = new Intl.DateTimeFormat('en-US', { timeZone: userTimezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
          const parts = formatter.formatToParts(localDate);
          const getPart = (type) => parts.find(p => p.type === type).value;
          const formattedInTz = new Date(Date.UTC(parseInt(getPart('year')), parseInt(getPart('month')) - 1, parseInt(getPart('day')), parseInt(getPart('hour')), parseInt(getPart('minute')), parseInt(getPart('second'))));
          const offsetMs = formattedInTz.getTime() - localDate.getTime();
          
          start = new Date(localDate.getTime() - offsetMs);
          end = new Date(start.getTime() + 30 * 60000); // Default 30m for all-day placeholders
        }
        
        const isExplicitlyMovable = movableKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
        const isExplicitlyLocked = lockedKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
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
    await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'google').gte('start_time', syncStartTime.toISOString()).lt('last_seen_at', cleanupThreshold);
    
    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})