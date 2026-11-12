// Deploy with --no-verify-jwt. A separate scheduler secret protects this endpoint.
Deno.serve(async (request) => {
  const secret = Deno.env.get('REMINDER_CRON_SECRET');
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const providerKey = Deno.env.get('RESEND_API_KEY');
  const sender = Deno.env.get('REMINDER_FROM');
  if (!providerKey || !sender) return new Response('Reminder delivery is not configured', { status: 503 });
  const base = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  async function rpc(name, args = {}) {
    const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Database operation failed (${response.status})`);
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }
  try {
    const jobs = await rpc('claim_task_reminders');
    let sent = 0;
    for (const job of jobs) {
      let error = null;
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { authorization: `Bearer ${providerKey}`, 'content-type': 'application/json', 'idempotency-key': `task-reminder-${job.id}` },
          body: JSON.stringify({ from: sender, to: [job.email], subject: `Task reminder: ${job.task_name}`,
            text: `${job.task_name}\nDue: ${job.due_date}\n\nOpen BingeBerry: ${Deno.env.get('APP_URL') || 'https://shireenvarma.github.io/bingeberry/'}` }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
        sent++;
      } catch (cause) { error = cause instanceof Error ? cause.message : 'Delivery failed'; }
      await rpc('finish_task_reminder', { p_id: job.id, p_attempt: job.attempt, p_error: error });
    }
    return Response.json({ sent, claimed: jobs.length });
  } catch { return new Response('Reminder processing failed; delivery will retry', { status: 500 }); }
});
