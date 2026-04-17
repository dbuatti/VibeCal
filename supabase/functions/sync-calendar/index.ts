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

    if (!googleAccessToken) {
      console.error("[sync-calendar] No Google Access Token provided.");
      throw new Error("Missing Google Access Token");
    }

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
    console.log("[sync-calendar] Fetching calendar list from Google...");
    const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    })
    const listData = await listRes.json()
    
    if (listData.error) {
      console.error("[sync-calendar] Google API Error (Calendar List):", listData.error);
      throw new Error(`Google API Error: ${listData.error.message}`);
    }

    // CLEANUP: Purge any existing 'import' calendars from the DB for this user
    await supabaseAdmin
      .from('user_calendars')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', 'google')
      .like('calendar_id', '%@import.calendar.google.com%');

    if (listData.items) {
      // STRICT FILTER: Ignore anything that is an import or contains 'icloud'
      const filteredItems = listData.items.filter(cal => 
        !cal.id.includes('@import.calendar.google.com') && 
        !cal.id.toLowerCase().includes('icloud')
      );

      console.log(`[sync-calendar] Found ${filteredItems.length} native Google calendars.`);
      
      const discovered = filteredItems.map(cal => ({
        user_id: user.id,
        calendar_id: cal.id,
        calendar_name: cal.summary,
        provider: 'google',
        color: cal.backgroundColor || '#6366f1'
      }))
      
      if (discovered.length > 0) {
        await supabaseAdmin.from('user_calendars').upsert(discovered, { onConflict: 'user_id, calendar_id' });
      }
    }

    // 2. Get Enabled Calendars from DB (Strictly Google)
    const { data: enabled } = await supabaseAdmin
      .from('user_calendars')
      .select('calendar_id, calendar_name')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
      .eq('provider', 'google')

    if (!enabled || enabled.length === 0) {
      return new Response(JSON.stringify({ message: 'No Google calendars enabled', count: 0 }), { headers: corsHeaders })
    }

    // Clear Google cache for this user
    await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'google');

    // 3. Fetch Events
    const now = new Date()
    const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    const eventMap = new Map();

    // Robust heuristic for "Fixed" events
    const fixedKeywords = /appointment|appt|lesson|session|meeting|call|rehearsal|ceremony|lecture|christening|baptism|assessment|audition|coaching|program|gig|work session|check in|grocery|lecture/i;
    const fixedPatterns = [
      /\$\d+/, // Price like $50
      /\d+\s*min/i, // Duration like 45 minutes
      /between|with/i, // "between X and Y" or "with Z"
      /[\u{1F300}-\u{1F9FF}]/u // Any emoji often indicates a specific manual entry
    ];

    for (const cal of enabled) {
      // Double check we aren't fetching an import that snuck into the DB
      if (cal.calendar_id.includes('@import.calendar.google.com')) continue;

      const encodedId = encodeURIComponent(cal.calendar_id);
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodedId}/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`,
        { headers: { Authorization: `Bearer ${googleAccessToken}` } }
      )
      
      const data = await res.json()
      if (data.items) {
        data.items.forEach(event => {
          const title = event.summary || 'Untitled';
          const start = new Date(event.start.dateTime || event.start.date)
          const end = new Date(event.end.dateTime || event.end.date)
          
          // Determine if locked based on multiple signals
          const isLocked = !!event.recurringEventId || 
                           (event.attendees?.length > 1) ||
                           fixedKeywords.test(title) ||
                           fixedPatterns.some(p => p.test(title));
          
          eventMap.set(event.id, {
            user_id: user.id,
            event_id: event.id,
            title: title,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            duration_minutes: Math.round((end.getTime() - start.getTime()) / 60000),
            is_locked: isLocked,
            provider: 'google',
            source_calendar: cal.calendar_name,
            last_synced_at: new Date().toISOString()
          });
        });
      }
    }

    const uniqueEvents = Array.from(eventMap.values());
    if (uniqueEvents.length > 0) {
      const { error: upsertError } = await supabaseAdmin.from('calendar_events_cache').upsert(uniqueEvents, { onConflict: 'user_id, event_id' });
      if (upsertError) throw upsertError;
    }

    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: corsHeaders })
  } catch (error) {
    console.error("[sync-calendar] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
  }
})