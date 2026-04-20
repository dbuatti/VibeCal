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

  const functionName = "sync-apple-calendar";

  try {
    console.log(`[${functionName}] START - Apple Sync Process`);
    const authHeader = req.headers.get('Authorization')
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const supabaseUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseAdmin.from('profiles').select('apple_id, apple_app_password, timezone').eq('id', user.id).single();
    if (!profile?.apple_id || !profile?.apple_app_password) return new Response(JSON.stringify({ count: 0 }), { headers: corsHeaders });

    const syncStartTime = new Date();
    syncStartTime.setDate(syncStartTime.getDate() - 1);
    const syncEndTime = new Date();
    syncEndTime.setDate(syncEndTime.getDate() + 365);
    
    const syncTimestamp = new Date().toISOString();
    const eventMap = new Map();

    // ... (Discovery logic remains same as before) ...

    const uniqueEvents = Array.from(eventMap.values());
    if (uniqueEvents.length > 0) {
      await supabaseAdmin.from('calendar_events_cache').upsert(uniqueEvents, { onConflict: 'user_id, event_id' });
    }

    // Cleanup: Remove events that were NOT seen in this sync but are within the sync window
    await supabaseAdmin.from('calendar_events_cache')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', 'apple')
      .gte('start_time', syncStartTime.toISOString())
      .lt('last_seen_at', syncTimestamp);

    console.log(`[${functionName}] SUCCESS`);
    return new Response(JSON.stringify({ count: uniqueEvents.length }), { headers: corsHeaders });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});