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

  const functionName = "sync-calendar";

  try {
    console.log(`[${functionName}] START - Google Sync Process`);
    const authHeader = req.headers.get('Authorization')
    let { googleAccessToken } = await req.json();

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const supabaseUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) throw new Error("Unauthorized");

    // FALLBACK: If token is missing from request, check the database cache
    if (!googleAccessToken) {
      console.log(`[${functionName}] Token missing from request, checking database cache for user: ${user.id}`);
      const { data: profile } = await supabaseAdmin.from('profiles').select('google_access_token').eq('id', user.id).single();
      googleAccessToken = profile?.google_access_token;
    }

    if (!googleAccessToken) {
      console.error(`[${functionName}] No Google Access Token found in request or database.`);
      return new Response(JSON.stringify({ error: "Missing Google Access Token" }), { status: 400, headers: corsHeaders });
    }

    console.log(`[${functionName}] Fetching existing lock statuses from DB...`);
    const { data: existingEvents } = await supabaseAdmin
      .from('calendar_events_cache')
      .select('event_id, is_locked')
      .eq('user_id', user.id);
    
    const existingLockStatus = new Map(existingEvents?.map(e => [e.event_id, e.is_locked]) || []);
    console.log(`[${functionName}] Found ${existingLockStatus.size} existing events in cache.`);

    console.log(`[${functionName}] Fetching user settings...`);
    const { data: settings } = await supabaseAdmin.from('user_settings').select('movable_keywords, locked_keywords, work_keywords').eq('user_id', user.id).single();
    const movableKeywords = settings?.movable_keywords || [];
    const lockedKeywords = settings?.locked_keywords || [];
    const workKeywords = settings?.work_keywords || ['meeting', 'call', 'lesson', 'audition', 'rehearsal', 'appt', 'appointment', 'coaching', 'session', 'work session'];
    console.log(`[${functionName}] Keywords - Movable: ${movableKeywords.length}, Locked: ${lockedKeywords.length}, Work: ${workKeywords.length}`);

    console.log(`[${functionName}] Fetching Google Calendar list...`);
    const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers: { Authorization: `Bearer ${googleAccessToken}` } })
    
    if (!listRes.ok) {
      const errorData = await listRes.json();
      console.error(`[${functionName}] Google API Error (CalendarList):`, JSON.stringify(errorData));
      return new Response(JSON.stringify({ error: `Google API Error: ${errorData.error?.message || listRes.statusText}` }), { status: listRes.status, headers: corsHeaders });
    }

    const listData = await listRes.json()
    if (listData.items) {
      const discovered = listData.items.filter(cal => !cal.id.includes('@import.calendar.google.com')).map(cal => ({
        user_id: user.id, calendar_id: cal.id, calendar_name: cal.summary, provider: 'google', color: cal.backgroundColor || '#6366f1'
      }));
      console.log(`[${functionName}] Discovered ${discovered.length} calendars. Upserting to DB...`);
      if (discovered.length > 0) await supabaseAdmin.from('user_calendars').upsert(discovered, { onConflict: 'user_id, calendar_id' });
    }

    const { data: enabled } = await supabaseAdmin.from('user_calendars').select('calendar_id, calendar_name, is_enabled').eq('user_id', user.id).eq('provider', 'google');
    const enabledCalendars = (enabled || []).filter(c => c.is_enabled);
    console.log(`[${functionName}] ${enabledCalendars.length} calendars are enabled for sync.`);
    if (enabledCalendars.length === 0) return new Response(JSON.stringify({ count: 0 }), { headers: corsHeaders });

    const syncStartTime = new Date();
    syncStartTime.setHours(0, 0, 0, 0);
    const syncEndTime = new Date();
    syncEndTime.setDate(syncEndTime.getDate() + 365);
    
    const eventMap = new Map();
    const syncTimestamp = new Date().toISOString();
    
    const fixedKeywords = /choir|appointment|appt|lesson|session|meeting|call|rehearsal|ceremony|lecture|christening|baptism|assessment|audition|coaching|program|work session|q & a|weekly|yoga|show|tech|dress|night|opening|closing|birthday|party|gala|buffer|probe|experiment|quinceanera|🎭|✨|lunch|dinner|breakfast|brunch|bump in|performance|gig|concert|wedding|funeral|doctor|dentist|flight|train|hotel|check-in|check-out|reservation|40th|50th|60th|anniversary/i;
    const fixedPatterns = [/\$\d+/, /\d+\s*min/i, /between|with/i];

    for (const cal of enabledCalendars) {
      console.log(`[${functionName}] Fetching events for calendar: ${cal.calendar_name} (${cal.calendar_id})`);
      let res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendar_id)}/events?timeMin=${syncStartTime.toISOString()}&timeMax=${syncEndTime.toISOString()}&singleEvents=true&orderBy=startTime`, { headers: { Authorization: `Bearer ${googleAccessToken}` } });
      
      if (!res.ok) {
        console.error(`[${functionName}] Error fetching events for ${cal.calendar_name}:`, res.statusText);
        continue;
      }
      
      const data = await res.json()
      if (data.items) {
        console.log(`[${functionName}] Processing ${data.items.length} events from ${cal.calendar_name}...`);
        data.items.forEach(event => {
          const title = event.summary || 'Untitled';
          let start = event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date + "T09:00:00");
          let end = event.end.dateTime ? new Date(event.end.dateTime) : new Date(event.end.date + "T09:30:00");
          
          if (start < syncStartTime) return;

          let isLocked = existingLockStatus.has(event.id) ? existingLockStatus.get(event.id) : null;

          if (isLocked === null) {
            const isExplicitlyMovable = movableKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
            const isExplicitlyLocked = lockedKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
            const isHighPriorityFixed = /lunch|dinner|birthday|party|quinceanera|wedding|funeral/i.test(title);
            
            // Logic: Locked if explicitly locked, or high priority, or (not explicitly movable AND (has attendees OR matches fixed keywords))
            isLocked = isExplicitlyLocked || isHighPriorityFixed || (!isExplicitlyMovable && ((event.attendees?.length > 1) || fixedKeywords.test(title) || fixedPatterns.some(p => p.test(title))));
          }

          const isWork = workKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
          
          if (title.toLowerCase().includes("moulin rouge")) {
            console.log(`[${functionName}] DEBUG: Found Moulin Rouge event. Title: "${title}", isLocked: ${isLocked}, isWork: ${isWork}`);
          }

          eventMap.set(event.id, {
            user_id: user.id, event_id: event.id, title: title, start_time: start.toISOString(), end_time: end.toISOString(),
            duration_minutes: Math.round((end.getTime() - start.getTime()) / 60000) || 30, is_locked: isLocked, is_work: isWork,
            provider: 'google', source_calendar: cal.calendar_name, source_calendar_id: cal.calendar_id, last_synced_at: syncTimestamp
          });
        });
      }
    }

    const uniqueEvents = Array.from(eventMap.values());
    console.log(`[${functionName}] Total unique events to upsert: ${uniqueEvents.length}`);
    
    if (uniqueEvents.length > 0) {
      const { error: upsertError } = await supabaseAdmin.from('calendar_events_cache').upsert(uniqueEvents, { onConflict: 'user_id, event_id' });
      if (upsertError) {
        console.error(`[${functionName}] Upsert Error:`, upsertError);
        throw upsertError;
      }
    }
    
    console.log(`[${functionName}] Cleaning up old events...`);
    await supabaseAdmin.from('calendar_events_cache').delete().eq('user_id', user.id).eq('provider', 'google').lt('start_time', syncStartTime.toISOString());
    
    console.log(`[${functionName}] SUCCESS`);
    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: corsHeaders })
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
  }
})