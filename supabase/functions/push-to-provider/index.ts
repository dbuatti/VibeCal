// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  const functionName = "push-to-provider";

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.error(`[${functionName}] Missing Authorization header`);
      return new Response(JSON.stringify({ error: "Unauthorized: Missing Authorization header" }), { status: 401, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const { eventId, provider, startTime, endTime, googleAccessToken, calendarId } = body;

    if (!eventId || !provider || !startTime || !endTime) {
      console.error(`[${functionName}] Missing required parameters`, { eventId, provider, startTime, endTime });
      return new Response(JSON.stringify({ error: "Missing required parameters: eventId, provider, startTime, and endTime are required." }), { status: 400, headers: corsHeaders });
    }

    console.log(`[${functionName}] START - Updating ${provider} event: ${eventId}`);
    console.log(`[${functionName}] Payload - Start: ${startTime}, End: ${endTime}, Calendar: ${calendarId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, { 
      global: { headers: { Authorization: authHeader } } 
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      console.error(`[${functionName}] Auth error:`, authError?.message || "User not found");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    if (provider === 'google') {
      let token = googleAccessToken;
      if (!token) {
        console.log(`[${functionName}] Token missing from request, checking DB cache...`);
        const { data: profile, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('google_access_token')
          .eq('id', user.id)
          .single();
        
        if (profileError) {
          console.error(`[${functionName}] Profile fetch error:`, profileError.message);
        }
        token = profile?.google_access_token;
      }

      if (!token) {
        console.error(`[${functionName}] Missing Google Access Token for user ${user.id}`);
        throw new Error("Missing Google Access Token. Please reconnect your Google Calendar.");
      }
      
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
        // If token is expired, we might want to return a specific error so the client can trigger a sync/refresh
        if (res.status === 401) {
          return new Response(JSON.stringify({ error: "Google session expired. Please refresh your calendar.", code: "GOOGLE_AUTH_EXPIRED" }), { status: 401, headers: corsHeaders });
        }
        throw new Error(`Google API Error: ${data.error?.message || 'Unknown error'}`);
      }
      
      console.log(`[${functionName}] SUCCESS`);
      return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.warn(`[${functionName}] Unsupported provider: ${provider}`);
    return new Response(JSON.stringify({ success: false, message: `Unsupported provider: ${provider}` }), { status: 400, headers: corsHeaders });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})
