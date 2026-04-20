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
  const functionName = "sync-calendar";

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.error(`[${functionName}] Missing Authorization header`);
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    let { googleAccessToken } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, { 
      global: { headers: { Authorization: authHeader } } 
    });
    
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      console.error(`[${functionName}] Auth error:`, authError?.message || "User not found");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('google_access_token, google_refresh_token, timezone')
      .eq('id', user.id)
      .single();
    
    if (profileError) {
      console.error(`[${functionName}] Profile fetch error:`, profileError.message);
    }

    let token = googleAccessToken || profile?.google_access_token;
    const refreshToken = profile?.google_refresh_token;

    if (!token && !refreshToken) {
      console.log(`[${functionName}] No Google tokens for user ${user.id}`);
      return new Response(JSON.stringify({ error: "No Google tokens found. Please connect your Google Calendar." }), { status: 401, headers: corsHeaders });
    }

    // 1. Fetch user's calendar preferences
    const { data: dbCalendars } = await supabaseAdmin
      .from('user_calendars')
      .select('calendar_id, is_enabled, calendar_name')
      .eq('user_id', user.id)
      .eq('provider', 'google');

    // 2. Fetch current list from Google
    let listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { 
      headers: { Authorization: `Bearer ${token}` } 
    });
    
    if (listRes.status === 401 && refreshToken) {
      console.log(`[${functionName}] Token expired, refreshing...`);
      token = await refreshGoogleToken(refreshToken, functionName);
      await supabaseAdmin.from('profiles').update({ google_access_token: token }).eq('id', user.id);
      listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { 
        headers: { Authorization: `Bearer ${token}` } 
      });
    }

    const listData = await listRes.json();
    if (!listRes.ok) {
      console.error(`[${functionName}] Google API Error (Calendar List):`, JSON.stringify(listData));
      throw new Error(`Google API Error: ${listData.error?.message || 'Unknown'}`);
    }

    const googleCalendars = (listData.items || []).filter(cal => !cal.id.includes('@import.calendar.google.com'));

    // 3. Discovery & Upsert
    const discoveryPayload = googleCalendars.map(cal => {
      const existing = dbCalendars?.find(db => db.calendar_id === cal.id || (cal.primary && db.calendar_id === 'primary'));
      return {
        user_id: user.id,
        calendar_id: cal.id,
        calendar_name: cal.summary,
        provider: 'google',
        is_enabled: existing ? existing.is_enabled : true 
      };
    });

    if (discoveryPayload.length > 0) {
      await supabaseAdmin.from('user_calendars').upsert(discoveryPayload, { onConflict: 'user_id, calendar_id' });
    }

    const finalEnabledIds = discoveryPayload.filter(p => p.is_enabled).map(p => p.calendar_id);

    if (finalEnabledIds.length === 0) {
      console.log(`[${functionName}] No Google calendars enabled for user ${user.id}`);
      await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'google');
      return new Response(JSON.stringify({ count: 0, message: "No calendars enabled" }), { headers: corsHeaders });
    }

    // 4. Sync Events
    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 7); // 1 week back
    const syncEndTime = new Date();
    syncEndTime.setFullYear(syncEndTime.getFullYear() + 2); // 2 years forward
    const syncTimestamp = new Date().toISOString();

    // Fetch existing cache to preserve manual lock statuses
    const { data: existingCache } = await supabaseAdmin
      .from('calendar_events_cache')
      .select('event_id, is_locked')
      .eq('user_id', user.id)
      .eq('provider', 'google');
    
    const lockMap = new Map(existingCache?.map(e => [e.event_id, e.is_locked]) || []);

    const eventPromises = googleCalendars
      .filter(cal => finalEnabledIds.includes(cal.id))
      .map(async (cal) => {
        try {
          const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${syncStartTime.toISOString()}&timeMax=${syncEndTime.toISOString()}&singleEvents=true&orderBy=startTime`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) {
            console.error(`[${functionName}] Error fetching events for ${cal.summary}: ${res.status}`);
            return [];
          }
          const data = await res.json();
          return (data.items || []).map(event => {
            const existingLock = lockMap.get(event.id);
            
            const start = event.start.dateTime || toDate(event.start.date, { timeZone: profile?.timezone || 'UTC' }).toISOString();
            const end = event.end.dateTime || toDate(event.end.date, { timeZone: profile?.timezone || 'UTC' }).toISOString();

            return {
              user_id: user.id, 
              event_id: event.id, 
              title: event.summary || 'Untitled', 
              description: event.description || null,
              location: event.location || null,
              start_time: start, 
              end_time: end,
              duration_minutes: Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000) || 30, 
              is_locked: existingLock !== undefined ? existingLock : true, 
              provider: 'google', 
              source_calendar: cal.summary, 
              source_calendar_id: cal.id, 
              last_synced_at: syncTimestamp, 
              last_seen_at: syncTimestamp
            };
          });
        } catch (e) {
          console.error(`[${functionName}] Error fetching calendar ${cal.summary}:`, e.message);
          return [];
        }
      });

    const results = await Promise.all(eventPromises);
    const allEvents = results.flat();

    if (allEvents.length > 0) {
      // Batch upsert
      const chunkSize = 100;
      for (let i = 0; i < allEvents.length; i += chunkSize) {
        const chunk = allEvents.slice(i, i + chunkSize);
        await supabaseAdmin.from('calendar_events_cache').upsert(chunk, { onConflict: 'user_id, event_id' });
      }
    }

    // 5. PURGE events from calendars that are no longer enabled
    if (finalEnabledIds.length > 0) {
      await supabaseAdmin
        .from('calendar_events_cache')
        .delete()
        .eq('user_id', user.id)
        .eq('provider', 'google')
        .not('source_calendar_id', 'in', `(${finalEnabledIds.map(id => `"${id}"`).join(',')})`);
    }

    console.log(`[${functionName}] SUCCESS - Synced ${allEvents.length} Google events for user ${user.id}.`);
    return new Response(JSON.stringify({ count: allEvents.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})
