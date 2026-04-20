// @ts-nocheck
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function refreshGoogleToken(refreshToken) {
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
  if (!res.ok) throw new Error("Refresh Failed");
  return data.access_token;
}

Deno.serve(async (req) => {
  const functionName = "sync-calendar";
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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
    
    let token = profile?.google_access_token;
    if (!token && profile?.google_refresh_token) {
      token = await refreshGoogleToken(profile.google_refresh_token);
    }
    if (!token) throw new Error("No Google Token");

    // 3. Fetch Calendars from Google
    let listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { 
      headers: { Authorization: `Bearer ${token}` } 
    });
    
    if (listRes.status === 401 && profile?.google_refresh_token) {
      token = await refreshGoogleToken(profile.google_refresh_token);
      listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { 
        headers: { Authorization: `Bearer ${token}` } 
      });
    }

    const listData = await listRes.json();
    console.log(`[${functionName}] Found ${listData.items?.length} calendars in Google`);
    const googleCalendars = (listData.items || []).filter(cal => !cal.id.includes('@import.calendar.google.com'));

    // 4. Sync Calendar List to user_calendars table
    const existingCalsRes = await fetch(`${supabaseUrl}/rest/v1/user_calendars?user_id=eq.${user.id}&provider=eq.google`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const existingCals = await existingCalsRes.json();
    console.log(`[${functionName}] Found ${existingCals.length} existing calendars in DB`);
    
    let calendarsToUpsert = googleCalendars.map(cal => {
      // Try to find existing by ID, or if this is primary, try to find by 'primary' ID
      let existing = existingCals.find(e => e.calendar_id === cal.id);
      if (!existing && cal.primary) {
        existing = existingCals.find(e => e.calendar_id === 'primary');
      }

      return {
        user_id: user.id,
        calendar_id: cal.primary ? 'primary' : cal.id, // Normalize primary ID
        calendar_name: cal.summaryOverride || cal.summary,
        provider: 'google',
        color: cal.backgroundColor,
        is_enabled: existing ? existing.is_enabled : (cal.primary || false)
      };
    });

    // Safety check: If no calendars are enabled, enable the primary one
    if (!calendarsToUpsert.some(c => c.is_enabled)) {
      const primaryIdx = calendarsToUpsert.findIndex(c => c.calendar_id === 'primary');
      if (primaryIdx !== -1) {
        calendarsToUpsert[primaryIdx].is_enabled = true;
        console.log(`[${functionName}] No calendars enabled, force-enabling primary`);
      } else if (calendarsToUpsert.length > 0) {
        calendarsToUpsert[0].is_enabled = true;
        console.log(`[${functionName}] No primary found, force-enabling first calendar`);
      }
    }

    if (calendarsToUpsert.length > 0) {
      console.log(`[${functionName}] Upserting ${calendarsToUpsert.length} calendars to DB`);
      const calUpsertRes = await fetch(`${supabaseUrl}/rest/v1/user_calendars?on_conflict=user_id,calendar_id`, {
        method: 'POST',
        headers: { 
          'apikey': supabaseKey, 
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(calendarsToUpsert)
      });
      if (!calUpsertRes.ok) {
        console.error(`[${functionName}] Calendar Upsert Error:`, await calUpsertRes.text());
      }
    }

    // 5. Filter to only ENABLED calendars for event sync
    const enabledCalendarIds = calendarsToUpsert
      .filter(c => c.is_enabled)
      .map(c => c.calendar_id);

    console.log(`[${functionName}] Syncing events for ${enabledCalendarIds.length} enabled calendars`);

    // 6. Sync Events (Last 7 days to +2 years)
    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 7);
    const syncEndTime = new Date();
    syncEndTime.setFullYear(syncEndTime.getFullYear() + 2);

    const allEvents = [];
    for (const calId of enabledCalendarIds) {
      // If we normalized to 'primary', we can use 'primary' in the URL too
      console.log(`[${functionName}] Fetching events for calendar: ${calId}`);
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${syncStartTime.toISOString()}&timeMax=${syncEndTime.toISOString()}&singleEvents=true&orderBy=startTime`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        console.error(`[${functionName}] Error fetching events for ${calId}:`, await res.text());
        continue;
      }
      const data = await res.json();
      console.log(`[${functionName}] Found ${data.items?.length || 0} events in ${calId}`);
      
      const events = (data.items || []).map(event => ({
        user_id: user.id,
        event_id: event.id,
        title: event.summary || 'Untitled',
        start_time: event.start.dateTime || event.start.date,
        end_time: event.end.dateTime || event.end.date,
        provider: 'google',
        source_calendar: data.summary || 'Unknown',
        source_calendar_id: calId,
        last_synced_at: new Date().toISOString()
      }));
      allEvents.push(...events);
    }

    // 7. Upsert to Supabase (Direct REST)
    if (allEvents.length > 0) {
      console.log(`[${functionName}] Upserting ${allEvents.length} total events to cache`);
      const upsertRes = await fetch(`${supabaseUrl}/rest/v1/calendar_events_cache?on_conflict=user_id,event_id`, {
        method: 'POST',
        headers: { 
          'apikey': supabaseKey, 
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(allEvents)
      });
      
      if (!upsertRes.ok) {
        const errorText = await upsertRes.text();
        console.error(`[${functionName}] Upsert Error:`, errorText);
      }
    }

    // 8. Cleanup: Remove events from cache that belong to calendars that are now disabled
    const disabledCalendarIds = calendarsToUpsert
      .filter(c => !c.is_enabled)
      .map(c => c.calendar_id);
    
    if (disabledCalendarIds.length > 0) {
      console.log(`[${functionName}] Cleaning up ${disabledCalendarIds.length} disabled calendars from cache`);
      for (const calId of disabledCalendarIds) {
        await fetch(`${supabaseUrl}/rest/v1/calendar_events_cache?user_id=eq.${user.id}&source_calendar_id=eq.${encodeURIComponent(calId)}`, {
          method: 'DELETE',
          headers: { 
            'apikey': supabaseKey, 
            'Authorization': `Bearer ${supabaseKey}`
          }
        });
      }
    }

    return new Response(JSON.stringify({ count: allEvents.length }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})
