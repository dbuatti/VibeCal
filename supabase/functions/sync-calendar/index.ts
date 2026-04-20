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

    // Refresh token if needed
    let listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', { 
      headers: { Authorization: `Bearer ${token}` } 
    });

    if (listRes.status === 401 && refreshToken) {
      token = await refreshGoogleToken(refreshToken);
      await supabaseAdmin.from('profiles').update({ google_access_token: token }).eq('id', user.id);
    }

    // Discover calendars
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

    const interpretToUtc = (isoStr, timeZone) => {
      // If it has an explicit offset or Z, use it directly and ensure Z
      if (isoStr.includes('Z') || isoStr.includes('+') || (isoStr.includes('-') && isoStr.includes('T'))) {
        return new Date(isoStr).toISOString();
      }
      
      // Floating time: Treat as local in the provided timeZone
      const [datePart, timePart] = isoStr.split('T');
      const [y, m, d] = datePart.split('-').map(Number);
      const [h, min, sec] = (timePart || '00:00:00').split(':').map(Number);

      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false
        });

        const guessUtc = new Date(Date.UTC(y, m - 1, d, h, min, sec || 0));
        const parts = formatter.formatToParts(guessUtc);
        const p = {};
        parts.forEach(part => p[part.type] = part.value);
        
        const formattedInTz = new Date(Date.UTC(
          parseInt(p.year),
          parseInt(p.month) - 1,
          parseInt(p.day),
          parseInt(p.hour),
          parseInt(p.minute),
          parseInt(p.second)
        ));

        const offsetMs = formattedInTz.getTime() - guessUtc.getTime();
        return new Date(guessUtc.getTime() - offsetMs).toISOString();
      } catch (e) {
        return new Date(isoStr).toISOString();
      }
    };

    for (const cal of enabledCalendars) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendar_id)}/events?timeMin=${syncStartTime.toISOString()}&timeMax=${syncEndTime.toISOString()}&singleEvents=true&orderBy=startTime`;
      let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) continue;
      
      const data = await res.json();
      const items = data.items || [];

      items.forEach(event => {
        const title = event.summary || 'Untitled';
        let startIso, endIso;

        const eventTimeZone = event.start.timeZone || userTimezone;

        if (event.start.dateTime) {
          startIso = interpretToUtc(event.start.dateTime, eventTimeZone);
          endIso = interpretToUtc(event.end.dateTime, eventTimeZone);
        } else {
          const [h, min] = dayStartStr.split(':').map(Number);
          startIso = interpretToUtc(`${event.start.date}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`, eventTimeZone);
          endIso = new Date(new Date(startIso).getTime() + 30 * 60000).toISOString();
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
          start_time: startIso, 
          end_time: endIso,
          duration_minutes: Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000) || 30, 
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