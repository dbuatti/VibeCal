// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { toDate } from "https://esm.sh/date-fns-tz@3.1.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function refreshGoogleToken(refreshToken: string, functionName: string) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    console.error(`[${functionName}] CRITICAL: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set.`);
    throw new Error("Server configuration error: Missing Google API credentials");
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`[${functionName}] Refresh Error:`, JSON.stringify(data));
    throw new Error(`Google Refresh Failed: ${data.error_description || data.error}`);
  }
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const functionName = "sync-calendar";

  try {
    console.log(`[${functionName}] --- NEW SYNC INVOCATION ---`);
    const authHeader = req.headers.get('Authorization')
    let { googleAccessToken } = await req.json();

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const supabaseUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } })
    
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) throw new Error("Unauthorized");

    console.log(`[${functionName}] User ID: ${user.id}`);

    const { data: profile } = await supabaseAdmin.from('profiles').select('google_access_token, google_refresh_token, timezone').eq('id', user.id).single();
    let token = googleAccessToken || profile?.google_access_token;
    const refreshToken = profile?.google_refresh_token;

    if (!token && !refreshToken) {
      return new Response(JSON.stringify({ error: "No tokens found. Please log in again." }), { status: 401, headers: corsHeaders });
    }

    // Validate token
    let listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', { 
      headers: { Authorization: `Bearer ${token}` } 
    });

    if (listRes.status === 401 && refreshToken) {
      console.log(`[${functionName}] Token expired, refreshing...`);
      token = await refreshGoogleToken(refreshToken, functionName);
      await supabaseAdmin.from('profiles').update({ google_access_token: token }).eq('id', user.id);
    }

    // 1. DISCOVER CALENDARS
    console.log(`[${functionName}] Fetching calendar list from Google...`);
    const fullListRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { 
      headers: { Authorization: `Bearer ${token}` } 
    });
    
    const listData = await fullListRes.json();
    console.log(`[${functionName}] Google API Response (Calendar List):`, JSON.stringify(listData).substring(0, 500) + "...");

    if (listData.items) {
      const discovered = listData.items
        .filter(cal => !cal.id.includes('@import.calendar.google.com'))
        .map(cal => ({
          user_id: user.id, 
          calendar_id: cal.id, 
          calendar_name: cal.summary, 
          provider: 'google', 
          color: cal.backgroundColor || '#6366f1'
        }));
      
      console.log(`[${functionName}] Found ${discovered.length} valid calendars. Upserting to DB...`);
      const { error: upsertError } = await supabaseAdmin.from('user_calendars').upsert(discovered, { onConflict: 'user_id, calendar_id' });
      if (upsertError) console.error(`[${functionName}] DB Upsert Error:`, upsertError);
    } else {
      console.warn(`[${functionName}] No 'items' found in Google response. Check permissions.`);
    }

    // 2. CHECK ENABLED CALENDARS
    const { data: allCals } = await supabaseAdmin.from('user_calendars').select('*').eq('user_id', user.id).eq('provider', 'google');
    console.log(`[${functionName}] DB State: ${allCals?.length || 0} total Google calendars in DB.`);
    
    const enabledCalendars = (allCals || []).filter(c => c.is_enabled);
    if (enabledCalendars.length === 0) {
      console.log(`[${functionName}] EXIT: No calendars are enabled in the database for this user.`);
      return new Response(JSON.stringify({ count: 0, message: "No calendars enabled. Please enable them in Settings." }), { headers: corsHeaders });
    }

    // 3. SYNC EVENTS (Rest of the logic remains the same but with more logs)
    console.log(`[${functionName}] Syncing events for ${enabledCalendars.length} enabled calendars...`);
    
    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 1);
    const syncEndTime = new Date();
    syncEndTime.setDate(syncEndTime.getDate() + 365);
    const syncTimestamp = new Date().toISOString();
    const eventMap = new Map();
    
    const { data: settings } = await supabaseAdmin.from('user_settings').select('*').eq('user_id', user.id).single();
    const dayStartStr = settings?.day_start_time || '09:00';

    for (const cal of enabledCalendars) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendar_id)}/events?timeMin=${syncStartTime.toISOString()}&timeMax=${syncEndTime.toISOString()}&singleEvents=true&orderBy=startTime`;
      let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) continue;
      
      const data = await res.json();
      (data.items || []).forEach(event => {
        const title = event.summary || 'Untitled';
        let startIso, endIso;
        const eventTimeZone = event.start.timeZone || profile?.timezone || 'Australia/Melbourne';
        
        if (event.start.dateTime) {
          startIso = new Date(event.start.dateTime).toISOString();
          endIso = new Date(event.end.dateTime).toISOString();
        } else {
          const [h, min] = dayStartStr.split(':').map(Number);
          const floatingStart = `${event.start.date}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
          startIso = toDate(floatingStart, { timeZone: eventTimeZone }).toISOString();
          endIso = new Date(new Date(startIso).getTime() + 30 * 60000).toISOString();
        }
        
        eventMap.set(event.id, {
          user_id: user.id, 
          event_id: event.id, 
          title: title, 
          description: event.description || null,
          location: event.location || null,
          start_time: startIso, 
          end_time: endIso,
          duration_minutes: Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000) || 30, 
          is_locked: true, // Default to locked for now
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
    
    console.log(`[${functionName}] SUCCESS - Synced ${uniqueEvents.length} events`);
    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})