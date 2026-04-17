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
    const { eventId, provider, startTime, endTime, googleAccessToken, calendarId } = await req.json();

    console.log(`[push-to-provider] Updating ${provider} event: ${eventId}`);

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

    if (provider === 'google') {
      if (!googleAccessToken) throw new Error("Missing Google Access Token");
      
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${eventId}`, {
        method: 'PATCH',
        headers: { 
          'Authorization': `Bearer ${googleAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          start: { dateTime: startTime },
          end: { dateTime: endTime }
        })
      });

      const data = await res.json();
      if (data.error) throw new Error(`Google API Error: ${data.error.message}`);
      
      return new Response(JSON.stringify({ success: true, data }), { headers: corsHeaders });
    }

    if (provider === 'apple') {
      const { data: profile } = await supabaseAdmin.from('profiles').select('apple_id, apple_app_password').eq('id', user.id).single();
      if (!profile?.apple_id || !profile?.apple_app_password) throw new Error('Apple credentials missing.');

      // Note: Full CalDAV implementation for Apple requires fetching the existing ICS, 
      // modifying the DTSTART/DTEND, and PUTing it back. 
      // For now, we'll return a placeholder as CalDAV is complex for a single function.
      console.warn("[push-to-provider] Apple CalDAV update not fully implemented in this step.");
      return new Response(JSON.stringify({ success: false, message: "Apple update pending full CalDAV implementation" }), { headers: corsHeaders });
    }

    throw new Error("Unsupported provider");
  } catch (error) {
    console.error("[push-to-provider] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})