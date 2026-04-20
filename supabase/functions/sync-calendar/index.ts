// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { formatInTimeZone } from 'https://esm.sh/date-fns-tz@3.2.0?deps=date-fns@3.6.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function refreshGoogleToken(refreshToken, supabaseUrl, supabaseKey, userId) {
  console.log(`[sync-calendar] Attempting to refresh token for user: ${userId}`);
  
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID'),
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  
  const data = await res.json();
  
  if (!res.ok) {
    console.error(`[sync-calendar] Refresh Failed:`, data);
    throw new Error("AUTH_EXPIRED");
  }

  const newAccessToken = data.access_token;

  // Persist the new token immediately
  await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 
      'apikey': supabaseKey, 
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ google_access_token: newAccessToken })
  });

  console.log(`[sync-calendar] Token refreshed and persisted for user: ${userId}`);
  return newAccessToken;
}

Deno.serve(async (req) => {
  const functionName = "sync-calendar";
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const body = await req.json().catch(() => ({}));
    const { timeMin: customMin, timeMax: customMax, googleAccessToken } = body;

    // 1. Get User
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': authHeader, 'apikey': Deno.env.get('SUPABASE_ANON_KEY') }
    });
    const user = await userRes.json();
    if (!user?.id) throw new Error("Unauthorized");

    // 2. Get Profile
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=google_access_token,google_refresh_token,timezone`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const profiles = await profileRes.json();
    const profile = profiles[0];
    const userTimezone = profile?.timezone || 'Australia/Melbourne';
    
    let token = googleAccessToken || profile?.google_access_token;
    
    // 3. Helper for Google API calls with retry logic
    const fetchWithRetry = async (url, options = {}) => {
      let res = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
      
      if (res.status === 401 && profile?.google_refresh_token) {
        try {
          token = await refreshGoogleToken(profile.google_refresh_token, supabaseUrl, supabaseKey, user.id);
          res = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
        } catch (e) {
          if (e.message === "AUTH_EXPIRED") throw e;
          throw new Error("GOOGLE_API_ERROR");
        }
      }
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error(`[sync-calendar] Google API Error:`, errorData);
        if (res.status === 401) throw new Error("AUTH_EXPIRED");
        throw new Error("GOOGLE_API_ERROR");
      }
      
      return res.json();
    };

    if (!token && profile?.google_refresh_token) {
      token = await refreshGoogleToken(profile.google_refresh_token, supabaseUrl, supabaseKey, user.id);
    }

    if (!token) throw new Error("AUTH_EXPIRED");

    // 4. Cleanup Step: Delete past Google events to fix "Ghost" data
    // We use the start of today in the user's timezone as the cutoff
    const todayStartISO = formatInTimeZone(new Date(), userTimezone, "yyyy-MM-dd'T'00:00:00XXX");
    console.log(`[${functionName}] Cleaning up events before ${todayStartISO}`);
    
    const cleanupUrl = `${supabaseUrl}/rest/v1/calendar_events_cache?user_id=eq.${user.id}&provider=eq.google&start_time=lt.${encodeURIComponent(todayStartISO)}`;
    await fetch(cleanupUrl, {
      method: 'DELETE',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });

    // 5. Fetch Calendars
    const listData = await fetchWithRetry('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    const googleCalendars = (listData.items || []).filter(cal => !cal.id.includes('@import.calendar.google.com'));

    // 6. Sync Calendar List
    const existingCalsRes = await fetch(`${supabaseUrl}/rest/v1/user_calendars?user_id=eq.${user.id}&provider=eq.google`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const existingCals = await existingCalsRes.json();
    
    let calendarsToUpsert = googleCalendars.map(cal => {
      let existing = existingCals.find(e => e.calendar_id === cal.id);
      if (!existing && cal.primary) {
        existing = existingCals.find(e => e.calendar_id === 'primary');
      }

      return {
        user_id: user.id,
        calendar_id: cal.primary ? 'primary' : cal.id,
        calendar_name: cal.summaryOverride || cal.summary,
        provider: 'google',
        color: cal.backgroundColor,
        is_enabled: existing ? existing.is_enabled : (cal.primary || false)
      };
    });

    if (calendarsToUpsert.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/user_calendars?on_conflict=user_id,calendar_id`, {
        method: 'POST',
        headers: { 
          'apikey': supabaseKey, 
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(calendarsToUpsert)
      });
    }

    const enabledCalendarIds = calendarsToUpsert.filter(c => c.is_enabled).map(c => c.calendar_id);

    // 7. Sync Events (Today onwards only)
    const syncStartTime = customMin ? new Date(customMin) : new Date(todayStartISO);
    const syncEndTime = customMax ? new Date(customMax) : new Date();
    if (!customMax) syncEndTime.setFullYear(syncEndTime.getFullYear() + 1);

    const allEvents = [];
    for (const calId of enabledCalendarIds) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${syncStartTime.toISOString()}&singleEvents=true&orderBy=startTime&timeMax=${syncEndTime.toISOString()}`;
      const data = await fetchWithRetry(url);
      
      const events = (data.items || []).map(event => {
        const start = event.start.dateTime || event.start.date;
        const end = event.end.dateTime || event.end.date;
        const durationMinutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);

        return {
          user_id: user.id,
          event_id: event.id,
          title: event.summary || 'Untitled',
          start_time: start,
          end_time: end,
          duration_minutes: durationMinutes,
          provider: 'google',
          source_calendar: data.summary || 'Unknown',
          source_calendar_id: calId,
          last_synced_at: new Date().toISOString()
        };
      });
      allEvents.push(...events);
    }

    if (allEvents.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/calendar_events_cache?on_conflict=user_id,event_id`, {
        method: 'POST',
        headers: { 
          'apikey': supabaseKey, 
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(allEvents)
      });
    }

    return new Response(JSON.stringify({ count: allEvents.length }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    const status = error.message === "AUTH_EXPIRED" ? 401 : 400;
    return new Response(JSON.stringify({ error: error.message }), { status, headers: corsHeaders });
  }
})