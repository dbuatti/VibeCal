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

    // 3. Fetch Calendars
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
    const googleCalendars = (listData.items || []).filter(cal => !cal.id.includes('@import.calendar.google.com'));

    // 4. Sync Events (Last 7 days to +2 years)
    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 7);
    const syncEndTime = new Date();
    syncEndTime.setFullYear(syncEndTime.getFullYear() + 2);

    const allEvents = [];
    for (const cal of googleCalendars) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${syncStartTime.toISOString()}&timeMax=${syncEndTime.toISOString()}&singleEvents=true&orderBy=startTime`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) continue;
      const data = await res.json();
      
      const events = (data.items || []).map(event => ({
        user_id: user.id,
        event_id: event.id,
        title: event.summary || 'Untitled',
        start_time: event.start.dateTime || event.start.date,
        end_time: event.end.dateTime || event.end.date,
        provider: 'google',
        source_calendar: cal.summary,
        source_calendar_id: cal.id,
        last_synced_at: new Date().toISOString()
      }));
      allEvents.push(...events);
    }

    // 5. Upsert to Supabase (Direct REST)
    if (allEvents.length > 0) {
      await fetch(`${supabaseUrl}/rest/v1/calendar_events_cache`, {
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
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})
