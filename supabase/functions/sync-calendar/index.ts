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
    console.log("[sync-calendar] START - Google Sync Process");
    
    const authHeader = req.headers.get('Authorization')
    const { googleAccessToken } = await req.json();

    if (!googleAccessToken) {
      console.error("[sync-calendar] ERROR: Missing Google Access Token");
      return new Response(JSON.stringify({ error: "Missing Google Access Token" }), { status: 400, headers: corsHeaders });
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

    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('movable_keywords, locked_keywords')
      .eq('user_id', user.id)
      .single();
    
    const movableKeywords = settings?.movable_keywords || [];
    const lockedKeywords = settings?.locked_keywords || [];

    // 1. Fetch Calendar List
    console.log("[sync-calendar] Fetching Google calendar list...");
    const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    })
    
    if (!listRes.ok) {
      const errorData = await listRes.json();
      console.error("[sync-calendar] Google List Error:", errorData);
      throw new Error(`Google API Error: ${errorData.error?.message || 'Failed to fetch calendar list'}`);
    }

    const listData = await listRes.json()
    if (listData.items) {
      console.log(`[sync-calendar] Discovered ${listData.items.length} Google calendars.`);
      const filteredItems = listData.items.filter(cal => 
        !cal.id.includes('@import.calendar.google.com') && 
        !cal.id.toLowerCase().includes('icloud')
      );
      
      const discovered = filteredItems.map(cal => ({
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

    // 2. Get Enabled Calendars
    const { data: enabled } = await supabaseAdmin
      .from('user_calendars')
      .select('calendar_id, calendar_name, is_enabled')
      .eq('user_id', user.id)
      .eq('provider', 'google');
    
    const enabledCalendars = (enabled || []).filter(c => c.is_enabled);
    console.log(`[sync-calendar] ${enabledCalendars.length} Google calendars are enabled.`);

    if (enabledCalendars.length === 0) {
      console.log("[sync-calendar] No enabled Google calendars found. Please check your settings.");
      return new Response(JSON.stringify({ count: 0 }), { headers: corsHeaders });
    }

    // Clear existing cache for this provider
    await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'google');

    // 3. Fetch Events
    const now = new Date()
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const eventMap = new Map();

    const fixedKeywords = /choir|appointment|appt|lesson|session|meeting|call|rehearsal|ceremony|lecture|christening|baptism|assessment|audition|coaching|program|work session|q & a|weekly/i;
    const fixedPatterns = [/\$\d+/, /\d+\s*min/i, /between|with/i];

    for (const cal of enabledCalendars) {
      let calId = cal.calendar_id;
      console.log(`[sync-calendar] Fetching events for: "${cal.calendar_name}"`);
      
      let res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`, { 
        headers: { Authorization: `Bearer ${googleAccessToken}` } 
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        console.error(`[sync-calendar] Google Events Error for "${cal.calendar_name}":`, errorData);
        continue;
      }

      const data = await res.json()
      if (data.items) {
        console.log(`[sync-calendar] Found ${data.items.length} events in "${cal.calendar_name}"`);
        data.items.forEach(event => {
          const title = event.summary || 'Untitled';
          let start, end;
          
          if (event.start.date) {
            start = new Date(event.start.date + "T09:00:00"); 
            end = new Date(event.end.date + "T09:30:00");
          } else {
            start = new Date(event.start.dateTime);
            end = new Date(event.end.dateTime);
          }

          const isExplicitlyMovable = movableKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
          const isExplicitlyLocked = lockedKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
          
          const isLocked = isExplicitlyLocked || (!isExplicitlyMovable && (
            (event.attendees?.length > 1) ||
            fixedKeywords.test(title) ||
            fixedPatterns.some(p => p.test(title))
          ));
          
          eventMap.set(event.id, {
            user_id: user.id,
            event_id: event.id,
            title: title,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            duration_minutes: Math.round((end.getTime() - start.getTime()) / 60000) || 30,
            is_locked: isLocked,
            provider: 'google',
            source_calendar: cal.calendar_name,
            source_calendar_id: calId,
            last_synced_at: new Date().toISOString()
          });
        });
      }
    }

    const uniqueEvents = Array.from(eventMap.values());
    if (uniqueEvents.length > 0) {
      await supabaseAdmin.from('calendar_events_cache').upsert(uniqueEvents, { onConflict: 'user_id, event_id' });
    }

    console.log(`[sync-calendar] FINISHED - Cached ${uniqueEvents.length} unique events from Google.`);
    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: corsHeaders })
  } catch (error) {
    console.error("[sync-calendar] FATAL ERROR:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
  }
})