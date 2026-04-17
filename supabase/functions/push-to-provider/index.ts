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

    console.log(`[push-to-provider] START - Updating ${provider} event: ${eventId}`);
    console.log(`[push-to-provider] Payload - Start: ${startTime}, End: ${endTime}, Calendar: ${calendarId}`);

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
      
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${eventId}`;
      
      const res = await fetch(url, {
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
      
      if (!res.ok) {
        console.error("[push-to-provider] Google API Error:", JSON.stringify(data));
        throw new Error(`Google API Error: ${data.error?.message || 'Unknown error'}`);
      }
      
      console.log("[push-to-provider] SUCCESS");
      return new Response(JSON.stringify({ success: true, data }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: false, message: "Unsupported provider" }), { headers: corsHeaders });
  } catch (error) {
    console.error("[push-to-provider] FATAL ERROR:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})