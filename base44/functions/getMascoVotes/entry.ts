import { createClientFromRequest, createClient } from 'npm:@base44/sdk@0.8.31';

const TARGET_APP = '6a199bf9a8a9f3bf17256d73';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const target = createClient({ appId: TARGET_APP });
    const votes = await target.asServiceRole.entities.MascoVote.list();

    const counts = { Lion: 0, Canari: 0, Biche: 0, Renard: 0, Ours: 0 };
    let total = 0;
    for (const v of votes) {
      if (v.mascotte && counts.hasOwnProperty(v.mascotte)) {
        counts[v.mascotte]++;
        total++;
      }
    }

    return Response.json({ counts, total });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});