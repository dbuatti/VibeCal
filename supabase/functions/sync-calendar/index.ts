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
    const authHeader = req.headers.get('Authorization')
    let { googleAccessToken } = await req.json();

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const supabaseUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } })
    
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseAdmin.from('profiles').select('google_access_token, google_refresh_token, timezone').eq('id', user.id).single();
    let token = googleAccessToken || profile?.google_access_token;
    const refreshToken = profile?.google_refresh_token;

    if (!token && !refreshToken) {
      return new Response(JSON.stringify({ error: "No tokens found." }), { status: 401, headers: corsHeaders });
    }

    // 1. PARALLEL CALENDAR DISCOVERY & SYNC
    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 1);
    const syncEndTime = new Date();
    syncEndTime.setDate(syncEndTime.getDate() + 90); // Scan 3 months ahead
    const syncTimestamp = new Date().toISOString();

    const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { 
      headers: { Authorization: `Bearer ${token}` } 
    });
    
    if (listRes.status === 401 && refreshToken) {
      token = await refreshGoogleToken(refreshToken, functionName);
      await supabaseAdmin.from('profiles').update({ google_access_token: token }).eq('id', user.id);
    }

    const listData = await listRes.json();
    const enabledCalendars = (listData.items || []).filter(cal => !cal.id.includes('@import.calendar.google.com'));

    // Process all calendars in parallel for maximum speed
    const eventPromises = enabledCalendars.map(async (cal) => {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${syncStartTime.toISOString()}&timeMax=${syncEndTime.toISOString()}&singleEvents=true&orderBy=startTime`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map(event => ({
        user_id: user.id, 
        event_id: event.id, 
        title: event.summary || 'Untitled', 
        description: event.description || null,
        location: event.location || null,
        start_time: event.start.dateTime || toDate(event.start.date, { timeZone: profile?.timezone || 'UTC' }).toISOString(), 
        end_time: event.end.dateTime || toDate(event.end.date, { timeZone: profile?.timezone || 'UTC' }).toISOString(),
        duration_minutes: Math.round((new Date(event.end.dateTime || event.end.date).getTime() - new Date(event.start.dateTime || event.start.date).getTime()) / 60000) || 30, 
        is_locked: true,
        provider: 'google', 
        source_calendar: cal.summary, 
        source_calendar_id: cal.id, 
        last_synced_at: syncTimestamp, 
        last_seen_at: syncTimestamp
      }));
    });

    const results = await Promise.all(eventPromises);
    const allEvents = results.flat();

    if (allEvents.length > 0) {
      // Batch upsert for efficiency
      await supabaseAdmin.from('calendar_events_cache').upsert(allEvents, { onConflict: 'user_id, event_id' });
    }

    return new Response(JSON.stringify({ count: allEvents.length }), { headers: corsHeaders });
  } catch (error) {
    console.error(`[${functionName}] Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})