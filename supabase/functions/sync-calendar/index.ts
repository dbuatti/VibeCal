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

    // Fetch user settings for movable keywords
    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('movable_keywords')
      .eq('user_id', user.id)
      .single();
    
    const movableKeywords = settings?.movable_keywords || [];

    // 1. Discover/Update Calendar List
    const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${googleAccessToken}` }
    })
    const listData = await listRes.json()
    
    if (listData.error) throw new Error(`Google API Error: ${listData.error.message}`);

    await supabaseAdmin.from('user_calendars').delete().eq('user_id', user.id).eq('provider', 'google').like('calendar_id', '%@import.calendar.google.com%');

    if (listData.items) {
      const filteredItems = listData.items.filter(cal => !cal.id.includes('@import.calendar.google.com') && !cal.id.toLowerCase().includes('icloud'));
      const discovered = filteredItems.map(cal => ({
        user_id: user.id,
        calendar_id: cal.id,
        calendar_name: cal.summary,
        provider: 'google',
        color: cal.backgroundColor || '#6366f1'
      }))
      if (discovered.length > 0) await supabaseAdmin.from('user_calendars').upsert(discovered, { onConflict: 'user_id, calendar_id' });
    }

    const { data: enabled } = await supabaseAdmin.from('user_calendars').select('calendar_id, calendar_name').eq('user_id', user.id).eq('is_enabled', true).eq('provider', 'google')
    if (!enabled || enabled.length === 0) return new Response(JSON.stringify({ count: 0 }), { headers: corsHeaders })

    await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'google');

    const now = new Date()
    const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    const eventMap = new Map();

    const fixedKeywords = /choir|appointment|appt|lesson|session|meeting|call|rehearsal|ceremony|lecture|christening|baptism|assessment|audition|coaching|program|gig|work session|check in|grocery|lecture/i;
    const fixedPatterns = [/\$\d+/, /\d+\s*min/i, /between|with/i, /[\u{1F300}-\u{1F9FF}]/u];

    for (const cal of enabled) {
      const encodedId = encodeURIComponent(cal.calendar_id);
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodedId}/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`, { headers: { Authorization: `Bearer ${googleAccessToken}` } })
      const data = await res.json()
      if (data.items) {
        data.items.forEach(event => {
          const title = event.summary || 'Untitled';
          const start = new Date(event.start.dateTime || event.start.date)
          const end = new Date(event.end.dateTime || event.end.date)
          
          // Check if title contains any user-defined movable keywords
          const isExplicitlyMovable = movableKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
          
          const isLocked = !isExplicitlyMovable && (
                           !!event.recurringEventId || 
                           (event.attendees?.length > 1) ||
                           fixedKeywords.test(title) ||
                           fixedPatterns.some(p => p.test(title)));
          
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
    if (uniqueEvents.length > 0) await supabaseAdmin.from('calendar_events_cache').upsert(uniqueEvents, { onConflict: 'user_id, event_id' });

    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: corsHeaders })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
  }
})