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
    const body = await req.json();
    const { action, mediaId, data } = body;

    if (action === 'list') {
      const medias = await target.asServiceRole.entities.MascoMedia.list('-created_date');
      return Response.json({ medias, total: medias.length });
    }

    if (action === 'update') {
      if (!mediaId || !data) {
        return Response.json({ error: 'Missing mediaId or data' }, { status: 400 });
      }
      await target.asServiceRole.entities.MascoMedia.update(mediaId, data);
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});