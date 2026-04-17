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
    if (!authHeader) throw new Error('No authorization header');

    const { googleAccessToken } = await req.json();
    if (!googleAccessToken) throw new Error('Google access token is required');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw userError || new Error('User not found');

    const now = new Date()
    const fourteenDaysLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${fourteenDaysLater.toISOString()}&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${googleAccessToken}` } }
    )

    if (!response.ok) throw new Error(`Google API Error: ${response.statusText}`)

    const data = await response.json()
    const events = data.items || []

    const formattedEvents = events.map((event: any) => {
      const start = new Date(event.start.dateTime || event.start.date)
      const end = new Date(event.end.dateTime || event.end.date)
      const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
      
      // SMART LOCK LOGIC:
      // 1. Recurring events are locked
      // 2. Events with other people (attendees) are locked
      // 3. Events explicitly marked as "Busy" (transparency is undefined/opaque) 
      //    vs "Free" (transparency is 'transparent')
      const isRecurring = !!event.recurringEventId;
      const hasAttendees = !!event.attendees && event.attendees.length > 1;
      const isBusy = event.transparency !== 'transparent';
      
      // Heuristic: If it's a "Session", "Lecture", or "Audition", it's likely fixed
      const title = event.summary || 'Untitled Event';
      const isLikelyFixed = /session|lecture|audition|work session|gig|call/i.test(title);

      return {
        user_id: user.id,
        event_id: event.id,
        title: title,
        description: event.description || '',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        duration_minutes: durationMinutes,
        is_recurring: isRecurring,
        is_locked: isRecurring || hasAttendees || isLikelyFixed,
        source_calendar: 'primary',
        last_synced_at: new Date().toISOString()
      }
    })

    if (formattedEvents.length > 0) {
      await supabaseClient
        .from('calendar_events_cache')
        .upsert(formattedEvents, { onConflict: 'user_id, event_id' })
    }

    return new Response(
      JSON.stringify({ message: 'Sync successful', count: formattedEvents.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})