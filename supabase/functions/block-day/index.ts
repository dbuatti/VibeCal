// @ts-nocheck
// Creates a cal.com date override marking a day as UNAVAILABLE (day off).
// Also saves to day_status table for local cache.
// Requires CAL_COM_API_KEY and CAL_COM_SCHEDULE_ID env vars (set via supabase secrets).
// Deploy with: supabase functions deploy block-day --project-ref <ref>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  const functionName = "block-day";
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const calApiKey = Deno.env.get('CAL_COM_API_KEY');
    const scheduleId = Deno.env.get('CAL_COM_SCHEDULE_ID');

    const { date, blocked } = await req.json();
    if (!date) throw new Error('Missing date parameter');

    // 1. Get user
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    const userRes = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    const user = userRes.data.user;
    if (!user?.id) throw new Error("Unauthorized");

    console.log(`[${functionName}] Blocking date ${date} for user ${user.id}, blocked=${blocked}`);

    // 2. Call cal.com API to set date override
    if (calApiKey && scheduleId) {
      try {
        // Fetch current schedule to get existing overrides
        console.log(`[${functionName}] Fetching cal.com schedule ${scheduleId}`);
        const getRes = await fetch(
          `https://api.cal.com/v1/schedules/${scheduleId}?apiKey=${calApiKey}`,
          { headers: { 'Content-Type': 'application/json' } }
        );
        const scheduleData = await getRes.json();
        const schedule = scheduleData.schedule || scheduleData;

        // Prepare date overrides
        const overrideDate = new Date(date).toISOString().split('T')[0];
        let dateOverrides = schedule.dateOverrides || [];

        if (blocked) {
          // Remove any existing override for this date, then add the blocked one
          dateOverrides = dateOverrides.filter(o => o.date?.split('T')[0] !== overrideDate);
          dateOverrides.push({
            date: overrideDate + 'T00:00:00.000Z',
            startTime: 0,
            endTime: 0,
          });
        } else {
          // Remove the override for this date (unblock)
          dateOverrides = dateOverrides.filter(o => o.date?.split('T')[0] !== overrideDate);
        }

        // Update schedule via cal.com API
        console.log(`[${functionName}] Updating cal.com schedule with ${dateOverrides.length} date overrides`);
        const putRes = await fetch(
          `https://api.cal.com/v1/schedules/${scheduleId}?apiKey=${calApiKey}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...schedule,
              dateOverrides,
            }),
          }
        );

        if (!putRes.ok) {
          const putError = await putRes.text();
          console.error(`[${functionName}] cal.com API error: ${putError}`);
        } else {
          console.log(`[${functionName}] cal.com schedule updated successfully`);
        }
      } catch (calErr) {
        console.error(`[${functionName}] cal.com API call failed:`, calErr.message);
      }
    } else {
      console.log(`[${functionName}] CAL_COM_API_KEY or CAL_COM_SCHEDULE_ID not set, skipping cal.com`);
    }

    // 3. Upsert to day_status table
    const { error: upsertError } = await supabase
      .from('day_status')
      .upsert(
        { user_id: user.id, date, is_blocked: blocked },
        { onConflict: 'user_id,date' }
      );

    if (upsertError) {
      console.error(`[${functionName}] Failed to upsert day_status:`, upsertError.message);
      throw upsertError;
    }

    console.log(`[${functionName}] day_status upserted: ${date} blocked=${blocked}`);

    return new Response(JSON.stringify({ success: true, date, blocked }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});
