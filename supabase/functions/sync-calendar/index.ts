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
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // 1. Get the user and their session
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw userError || new Error('User not found')

    // 2. Get the provider token (access token) from the session
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession()
    if (sessionError || !session) throw sessionError || new Error('Session not found')
    
    const providerToken = session.provider_token
    if (!providerToken) throw new Error('No Google provider token found. Try logging out and back in.')

    console.log(`[sync-calendar] Fetching events for user: ${user.id}`)

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
      throw new Error(`Google API Error: ${errorData.error?.message || response.statusText}`)
    }

    const data = await response.json()
    const events = data.items || []

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
      const { error: upsertError } = await supabaseClient
        .from('calendar_events_cache')
        .upsert(formattedEvents, { onConflict: 'user_id, event_id' })
      
      if (upsertError) throw upsertError
    }

    return new Response(
      JSON.stringify({ 
        message: 'Sync successful', 
        count: formattedEvents.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error("[sync-calendar] Error:", error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})