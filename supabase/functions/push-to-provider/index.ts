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

  const functionName = "push-to-provider";

  try {
    const authHeader = req.headers.get('Authorization')
    const { eventId, provider, startTime, endTime, googleAccessToken, calendarId } = await req.json();

    console.log(`[${functionName}] START - Updating ${provider} event: ${eventId}`);
    console.log(`[${functionName}] Payload - Start: ${startTime}, End: ${endTime}, Calendar: ${calendarId}`);

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
      let token = googleAccessToken;
      if (!token) {
        console.log(`[${functionName}] Token missing from request, checking DB cache...`);
        const { data: profile } = await supabaseAdmin.from('profiles').select('google_access_token').eq('id', user.id).single();
        token = profile?.google_access_token;
      }

      if (!token) throw new Error("Missing Google Access Token");
      
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${eventId}`;
      console.log(`[${functionName}] PATCHing Google API: ${url}`);
      
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          start: { dateTime: startTime },
          end: { dateTime: endTime }
        })
      });

      const data = await res.json();
      
      if (!res.ok) {
        console.error(`[${functionName}] Google API Error:`, JSON.stringify(data));
        throw new Error(`Google API Error: ${data.error?.message || 'Unknown error'}`);
      }
      
      console.log(`[${functionName}] SUCCESS`);
      return new Response(JSON.stringify({ success: true, data }), { headers: corsHeaders });
    }

    console.warn(`[${functionName}] Unsupported provider: ${provider}`);
    return new Response(JSON.stringify({ success: false, message: "Unsupported provider" }), { headers: corsHeaders });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})