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
    
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser()
    if (userError || !user) throw new Error("Unauthorized: " + (userError?.message || "No user found"));

    console.log(`[${functionName}] User ID: ${user.id}`);

    if (!googleAccessToken) {
      console.log(`[${functionName}] No token in request, checking profile...`);
      const { data: profile } = await supabaseAdmin.from('profiles').select('google_access_token').eq('id', user.id).single();
      googleAccessToken = profile?.google_access_token;
    }

    if (!googleAccessToken) {
      console.error(`[${functionName}] ERROR: No Google Access Token found.`);
      return new Response(JSON.stringify({ error: "Missing Google Access Token" }), { status: 401, headers: corsHeaders });
    }

    // 1. Discover & Update Calendars
    console.log(`[${functionName}] Fetching calendar list from Google...`);
    const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { 
      headers: { Authorization: `Bearer ${googleAccessToken}` } 
    });
    
    if (!listRes.ok) {
      const errorData = await listRes.json();
      console.error(`[${functionName}] Google Calendar List API Error:`, errorData);
      throw new Error(`Google API Error: ${errorData.error?.message || 'Unknown'}`);
    }

    const listData = await listRes.json();
    console.log(`[${functionName}] Found ${listData.items?.length || 0} total calendars in Google account.`);

    if (listData.items) {
      const discovered = listData.items.filter(cal => !cal.id.includes('@import.calendar.google.com')).map(cal => ({
        user_id: user.id, 
        calendar_id: cal.id, 
        calendar_name: cal.summary, 
        provider: 'google', 
        color: cal.backgroundColor || '#6366f1'
      }));
      
      if (discovered.length > 0) {
        const { error: upsertError } = await supabaseAdmin.from('user_calendars').upsert(discovered, { onConflict: 'user_id, calendar_id' });
        if (upsertError) console.error(`[${functionName}] Error upserting calendars:`, upsertError);
      }
    }

    // 2. Get Enabled Calendars
    const { data: enabled, error: enabledError } = await supabaseAdmin
      .from('user_calendars')
      .select('calendar_id, calendar_name, is_enabled')
      .eq('user_id', user.id)
      .eq('provider', 'google');
    
    if (enabledError) throw enabledError;
    
    const enabledCalendars = (enabled || []).filter(c => c.is_enabled);
    console.log(`[${functionName}] Enabled calendars for sync: ${enabledCalendars.length}`);
    
    if (enabledCalendars.length === 0) {
      console.warn(`[${functionName}] WARNING: No calendars are enabled. Check your settings.`);
      return new Response(JSON.stringify({ count: 0, message: "No calendars enabled" }), { headers: corsHeaders });
    }

    // 3. Sync Window: Look back 1 day and forward 365 days
    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 1);
    const syncEndTime = new Date();
    syncEndTime.setDate(syncEndTime.getDate() + 365);
    
    console.log(`[${functionName}] Sync Window: ${syncStartTime.toISOString()} to ${syncEndTime.toISOString()}`);
    
    const syncTimestamp = new Date().toISOString();
    const eventMap = new Map();
    
    // Fetch existing lock statuses to preserve them
    const { data: existingEvents } = await supabaseAdmin.from('calendar_events_cache').select('event_id, is_locked').eq('user_id', user.id);
    const existingLockStatus = new Map(existingEvents?.map(e => [e.event_id, e.is_locked]) || []);

    const { data: settings } = await supabaseAdmin.from('user_settings').select('movable_keywords, locked_keywords, work_keywords').eq('user_id', user.id).single();
    const movableKeywords = settings?.movable_keywords || [];
    const lockedKeywords = settings?.locked_keywords || [];
    const workKeywords = settings?.work_keywords || ['meeting', 'call', 'lesson', 'audition', 'rehearsal', 'appt', 'appointment', 'coaching', 'session', 'work session'];

    const fixedKeywords = /choir|appointment|appt|lesson|session|meeting|call|rehearsal|ceremony|lecture|christening|baptism|assessment|audition|coaching|program|work session|q & a|weekly|yoga|show|tech|dress|night|opening|closing|birthday|party|gala|buffer|probe|experiment|quinceanera|🎭|✨|lunch|dinner|breakfast|brunch|bump in|performance|gig|concert|wedding|funeral|doctor|dentist|flight|train|hotel|check-in|check-out|reservation|40th|50th|60th|anniversary/i;

    for (const cal of enabledCalendars) {
      console.log(`[${functionName}] Fetching events for calendar: ${cal.calendar_name} (${cal.calendar_id})`);
      
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendar_id)}/events?timeMin=${syncStartTime.toISOString()}&timeMax=${syncEndTime.toISOString()}&singleEvents=true&orderBy=startTime`;
      
      let res = await fetch(url, { 
        headers: { Authorization: `Bearer ${googleAccessToken}` } 
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        console.error(`[${functionName}] Error fetching events for ${cal.calendar_name}:`, errorData);
        continue;
      }
      
      const data = await res.json();
      const items = data.items || [];
      console.log(`[${functionName}] Received ${items.length} events from Google for ${cal.calendar_name}.`);

      items.forEach(event => {
        const title = event.summary || 'Untitled';
        let start = event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date + "T09:00:00");
        let end = event.end.dateTime ? new Date(event.end.dateTime) : new Date(event.end.date + "T09:30:00");
        
        let isLocked = existingLockStatus.has(event.id) ? existingLockStatus.get(event.id) : null;
        if (isLocked === null) {
          const isExplicitlyMovable = movableKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
          const isExplicitlyLocked = lockedKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
          isLocked = isExplicitlyLocked || (!isExplicitlyMovable && ((event.attendees?.length > 1) || fixedKeywords.test(title)));
        }

        const isWork = workKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
        
        eventMap.set(event.id, {
          user_id: user.id, 
          event_id: event.id, 
          title: title, 
          start_time: start.toISOString(), 
          end_time: end.toISOString(),
          duration_minutes: Math.round((end.getTime() - start.getTime()) / 60000) || 30, 
          is_locked: isLocked, 
          is_work: isWork,
          provider: 'google', 
          source_calendar: cal.calendar_name, 
          source_calendar_id: cal.calendar_id, 
          last_synced_at: syncTimestamp, 
          last_seen_at: syncTimestamp
        });
      });
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
    
    // 4. Cleanup: Remove events that were NOT seen in this sync but are within the sync window
    const cleanupThreshold = new Date(new Date(syncTimestamp).getTime() - 60000).toISOString();
    
    const { error: deleteError, count: deletedCount } = await supabaseAdmin.from('calendar_events_cache')
      .delete({ count: 'exact' })
      .eq('user_id', user.id)
      .eq('provider', 'google')
      .gte('start_time', syncStartTime.toISOString())
      .lt('last_seen_at', cleanupThreshold);
    
    if (deleteError) console.error(`[${functionName}] Cleanup Error:`, deleteError);
    else console.log(`[${functionName}] Cleanup: Removed ${deletedCount || 0} stale events.`);
    
    console.log(`[${functionName}] SUCCESS - Synced ${uniqueEvents.length} events.`);
    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})