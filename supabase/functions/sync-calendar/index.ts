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

  try {
    console.log("[sync-calendar] Starting Google Sync...");
    
    const authHeader = req.headers.get('Authorization')
    const { googleAccessToken } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) throw new Error("Unauthorized");

    // 1. Discover/Update Calendar List
    const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    })
    const listData = await listRes.json()
    
    if (listData.items) {
      const discovered = listData.items.map(cal => ({
        user_id: user.id,
        calendar_id: cal.id,
        calendar_name: cal.summary,
        provider: 'google',
        color: cal.backgroundColor || '#6366f1'
      }))
      await supabaseAdmin.from('user_calendars').upsert(discovered, { onConflict: 'user_id, calendar_id' })
    }

    // 2. Get Enabled Calendars
    const { data: enabled } = await supabaseAdmin
      .from('user_calendars')
      .select('calendar_id, calendar_name')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
      .eq('provider', 'google')

    console.log(`[sync-calendar] Found ${enabled?.length || 0} enabled Google calendars.`);

    // Clear Google cache for this user
    await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'google');

    if (!enabled || enabled.length === 0) {
      return new Response(JSON.stringify({ message: 'No Google calendars enabled', count: 0 }), { headers: corsHeaders })
    }

    // 3. Fetch Events
    const now = new Date()
    const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    const allEvents = []

    for (const cal of enabled) {
      console.log(`[sync-calendar] Fetching events for: ${cal.calendar_name}`);
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendar_id)}/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`,
        { headers: { Authorization: `Bearer ${googleAccessToken}` } }
      )
      const data = await res.json()
      
      if (data.items) {
        data.items.forEach(event => {
          const start = new Date(event.start.dateTime || event.start.date)
          const end = new Date(event.end.dateTime || event.end.date)
          allEvents.push({
            user_id: user.id,
            event_id: event.id,
            title: event.summary || 'Untitled',
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            duration_minutes: Math.round((end.getTime() - start.getTime()) / 60000),
            is_locked: !!event.recurringEventId || (event.attendees?.length > 1),
            provider: 'google',
            source_calendar: cal.calendar_name,
            last_synced_at: new Date().toISOString()
          })
        })
      }
    }

    if (allEvents.length > 0) {
      const { error: insertError } = await supabaseAdmin.from('calendar_events_cache').upsert(allEvents, { onConflict: 'user_id, event_id' })
      if (insertError) throw insertError;
    }

    return new Response(JSON.stringify({ count: allEvents.length }), { headers: corsHeaders })
  } catch (error) {
    console.error("[sync-calendar] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
  }
})