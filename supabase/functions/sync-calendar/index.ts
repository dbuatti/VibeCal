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
    console.log(`[sync-calendar] Authenticated user: ${user.id}`);

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
    console.log("[sync-calendar] Provider token found, fetching from Google...");

    // 3. Fetch events from Google Calendar API
    const now = new Date().toISOString()
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&maxResults=50&singleEvents=true&orderBy=startTime`,
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

    // 4. Cache events in the database
    const formattedEvents = events.map((event: any) => ({
      user_id: user.id,
      event_id: event.id,
      title: event.summary || 'Untitled Event',
      description: event.description || '',
      start_time: event.start.dateTime || event.start.date,
      end_time: event.end.dateTime || event.end.date,
      source_calendar: 'primary',
      last_synced_at: new Date().toISOString()
    }))

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
        count: formattedEvents.length 
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