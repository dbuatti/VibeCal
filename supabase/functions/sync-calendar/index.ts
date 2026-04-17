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
    console.log("[sync-calendar] Request received");
    
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.error("[sync-calendar] No authorization header found");
      throw new Error('No authorization header');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // 1. Get the user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      console.error("[sync-calendar] User error:", userError);
      throw userError || new Error('User not found');
    }

    // 2. Get the session to find the provider token
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession()
    if (sessionError || !session) {
      console.error("[sync-calendar] Session error:", sessionError);
      throw sessionError || new Error('Session not found');
    }
    
    const providerToken = session.provider_token
    if (!providerToken) {
      console.error("[sync-calendar] No Google provider token found in session");
      throw new Error('No Google provider token found. Please sign out and sign back in to refresh your permissions.');
    }

    // 3. Fetch events from Google Calendar API (Next 14 days)
    const now = new Date()
    const fourteenDaysLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    
    const timeMin = now.toISOString()
    const timeMax = fourteenDaysLater.toISOString()

    console.log(`[sync-calendar] Fetching events from ${timeMin} to ${timeMax}`);

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
      {
        headers: { Authorization: `Bearer ${providerToken}` }
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      console.error("[sync-calendar] Google API Error:", errorData);
      throw new Error(`Google API Error: ${errorData.error?.message || response.statusText}`)
    }

    const data = await response.json()
    const events = data.items || []
    console.log(`[sync-calendar] Successfully fetched ${events.length} events from Google`);

    // 4. Cache events in the database with enhanced mapping
    const formattedEvents = events.map((event: any) => {
      const start = new Date(event.start.dateTime || event.start.date)
      const end = new Date(event.end.dateTime || event.end.date)
      const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
      
      // Detect if it's a recurring event (Google singleEvents=true expands them, but they have recurringEventId)
      const isRecurring = !!event.recurringEventId
      
      return {
        user_id: user.id,
        event_id: event.id,
        title: event.summary || 'Untitled Event',
        description: event.description || '',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        duration_minutes: durationMinutes,
        is_recurring: isRecurring,
        is_locked: isRecurring, // Basic locked detection: recurring events are locked
        source_calendar: 'primary',
        last_synced_at: new Date().toISOString()
      }
    })

    if (formattedEvents.length > 0) {
      console.log(`[sync-calendar] Upserting ${formattedEvents.length} events to database...`);
      const { error: upsertError } = await supabaseClient
        .from('calendar_events_cache')
        .upsert(formattedEvents, { onConflict: 'user_id, event_id' })
      
      if (upsertError) {
        console.error("[sync-calendar] Database upsert error:", upsertError);
        throw upsertError;
      }
      console.log("[sync-calendar] Database upsert successful");
    }

    return new Response(
      JSON.stringify({ 
        message: 'Sync successful', 
        count: formattedEvents.length,
        timeRange: { start: timeMin, end: timeMax }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error("[sync-calendar] Fatal error:", error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})