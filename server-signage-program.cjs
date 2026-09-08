const express = require('express');
const crypto = require('crypto');
const { requireSession } = require('./server-security.cjs');
const { getPool, ensureReady } = require('./server-postgres.cjs');
const { notifyVideosOnline } = require('./server-signelya-whatsapp.cjs');

const router = express.Router();
const FFmpeg_PROFILE = { video_codec: 'h264', pixel_format: 'yuv420p', audio_codec: 'aac', container: 'mp4', faststart: true };
const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const safeEmail = value => String(value || '').trim().toLowerCase();
const isAdmin = req => ['admin', 'superadmin'].includes(req.user?.role);

async function query(text, values = []) {
  await ensureReady();
  return (await getPool().query(text, values)).rows;
}

function owner(req) {
  const own = safeEmail(req.user?.email);
  if (!isAdmin(req)) return own;
  const requested = safeEmail(req.headers['x-client-email']);
  return requested && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requested) ? requested : own;
}

async function requireDigitalSignageAccess(req, res, next) {
  try {
    if (isAdmin(req)) return next();
    const email = owner(req);
    const rows = await query(
      `select 1 from client_module_entitlements
       where lower(email)=lower($1) and module_code='digital_signage' and enabled=true limit 1`,
      [email]
    );
    if (!rows.length) return res.status(403).json({ error: 'Module Digital Signage non actif' });
    next();
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
}

async function device(req) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!bearer) return null;
  const rows = await query('select * from signage_players where token_hash=$1 limit 1', [hash(bearer)]);
  return rows[0] || null;
}

function mediaIdOf(item) {
  return String(item?.mediaId || item?.media_id || item?.media?.id || '');
}

async function audit(ownerEmail, actorEmail, action, entityType, entityId, details = {}) {
  await query(
    `insert into signage_audit_events(owner_email,actor_email,action,entity_type,entity_id,details)
     values($1,$2,$3,$4,$5,$6::jsonb)`,
    [ownerEmail, actorEmail || 'device', action, entityType, entityId || null, JSON.stringify(details)]
  ).catch(error => console.error('[signage][program-audit]', error.message));
}

router.post('/manage/publications', requireSession('client'), requireDigitalSignageAccess, async (req, res) => {
  const ownerEmail = owner(req);
  const playerId = String(req.body?.playerId || '');
  const playlistId = String(req.body?.playlistId || '');
  const scheduledAt = new Date(req.body?.scheduledAt || Date.now());
  if (!playerId || !playlistId) return res.status(400).json({ error: 'Player et programme requis' });
  if (!Number.isFinite(scheduledAt.getTime())) return res.status(400).json({ error: 'Date de diffusion invalide' });
  if (scheduledAt.getTime() < Date.now() - 60_000) return res.status(400).json({ error: 'La diffusion ne peut pas être programmée dans le passé' });

  const client = await getPool().connect();
  try {
    await client.query('begin');
    const playerRows = await client.query(
      `select * from signage_players
       where lower(owner_email)=lower($1)
       order by case when status='online' and last_seen_at > now() - interval '2 minutes' then 0 else 1 end,
                last_seen_at desc nulls last, created_at asc
       for update`,
      [ownerEmail]
    );
    const requested = playerRows.rows.find(item => item.id === playerId);
    const targetPlayer = playerRows.rows.find(item => item.status === 'online' && item.last_seen_at && Date.now() - new Date(item.last_seen_at).getTime() < 120000) || requested;
    if (!targetPlayer) throw new Error('Player introuvable');

    const playlistRows = await client.query(
      'select * from signage_playlists where id=$1 and lower(owner_email)=lower($2) limit 1',
      [playlistId, ownerEmail]
    );
    const playlist = playlistRows.rows[0];
    if (!playlist) throw new Error('Programme introuvable');
    const items = Array.isArray(playlist.items) ? playlist.items : [];
    if (!items.length) throw new Error('Le programme doit contenir au moins un média');

    for (const item of items) {
      const mediaId = mediaIdOf(item);
      if (!mediaId) throw new Error('Un média du programme est invalide');
      const mediaRows = await client.query(
        'select id,status,rendition from signage_media where id=$1 and lower(owner_email)=lower($2) limit 1',
        [mediaId, ownerEmail]
      );
      const media = mediaRows.rows[0];
      if (!media) throw new Error('Un média du programme est introuvable');
      const rendition = media.rendition && typeof media.rendition === 'object' ? media.rendition : {};
      if (media.status !== 'ready' || rendition.state !== 'ready') throw new Error('Un média doit encore être préparé avant sa diffusion');
    }

    const now = new Date().toISOString();
    const replaced = await client.query(
      `update signage_publications
       set status='rolled_back', rolled_back_at=$3, updated_at=$3,
           error='Remplacée par un programme plus récent'
       where player_id=$1 and lower(owner_email)=lower($2) and status='pending'
       returning id,playlist_id,scheduled_at`,
      [targetPlayer.id, ownerEmail, now]
    );

    const manifest = {
      version: 2,
      revision: playlist.revision,
      playlistId: playlist.id,
      items,
      profile: FFmpeg_PROFILE,
      createdAt: now,
      programPolicy: 'single_current_program',
    };
    const inserted = await client.query(
      `insert into signage_publications
       (owner_email,player_id,playlist_id,status,manifest,previous_publication_id,scheduled_at,recurrence,created_at,updated_at)
       values($1,$2,$3,'pending',$4::jsonb,$5,$6,'{"type":"none"}'::jsonb,$7,$7)
       returning *`,
      [ownerEmail, targetPlayer.id, playlist.id, JSON.stringify(manifest), targetPlayer.current_publication_id || null, scheduledAt.toISOString(), now]
    );
    await client.query('commit');

    const publication = inserted.rows[0];
    await audit(ownerEmail, req.user?.email, 'program.replacement_scheduled', 'publication', publication.id, {
      playlistId: playlist.id,
      scheduledAt: scheduledAt.toISOString(),
      replacedPendingPublicationIds: replaced.rows.map(item => item.id),
      recurrenceRequested: req.body?.recurrence?.type || 'none',
      recurrenceApplied: 'none',
    });
    res.status(201).json({ ...publication, replacedPendingCount: replaced.rowCount, programPolicy: 'single_current_program' });
  } catch (error) {
    await client.query('rollback').catch(() => {});
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.post('/player/publications/:id/ack', async (req, res) => {
  const player = await device(req).catch(() => null);
  if (!player) return res.status(401).json({ error: 'Player non autorisé' });
  const publicationId = String(req.params.id || '');
  const ok = req.body?.status === 'active';
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const pubRows = await client.query(
      'select * from signage_publications where id=$1 and player_id=$2 for update',
      [publicationId, player.id]
    );
    const publication = pubRows.rows[0];
    if (!publication) throw new Error('Publication introuvable');
    const now = new Date().toISOString();

    if (ok) {
      await client.query(
        `update signage_publications
         set status='completed', updated_at=$3
         where player_id=$1 and lower(owner_email)=lower($2) and status='active' and id<>$4`,
        [player.id, player.owner_email, now, publication.id]
      );
      await client.query(
        `update signage_publications
         set status='rolled_back', rolled_back_at=$3, updated_at=$3,
             error='Remplacée par le programme activé le plus récent'
         where player_id=$1 and lower(owner_email)=lower($2) and status='pending' and id<>$4`,
        [player.id, player.owner_email, now, publication.id]
      );
      await client.query(
        `update signage_publications
         set status='active', activated_at=$2, acknowledged_at=$2,
             recurrence='{"type":"none"}'::jsonb, error=null, rolled_back_at=null, updated_at=$2
         where id=$1`,
        [publication.id, now]
      );
      await client.query(
        `update signage_players
         set current_publication_id=$2,status='online',updated_at=$3
         where id=$1`,
        [player.id, publication.id, now]
      );
    } else {
      await client.query(
        `update signage_publications
         set status='failed', acknowledged_at=$2, rolled_back_at=$2,
             error=$3, updated_at=$2
         where id=$1`,
        [publication.id, now, String(req.body?.error || 'Validation Player échouée').slice(0, 500)]
      );
    }
    await client.query('commit');

    await audit(player.owner_email, 'player', ok ? 'program.activated' : 'program.activation_failed', 'publication', publication.id, {
      playlistId: publication.playlist_id,
    });
    if (ok) {
      notifyVideosOnline({ publicationId: publication.id, ownerEmail: player.owner_email, playerName: player.name })
        .catch(error => console.error('[signelya][videos-online]', error.message));
    }
    res.json({ success: true, activeProgramId: ok ? publication.id : player.current_publication_id, recurrenceScheduled: false });
  } catch (error) {
    await client.query('rollback').catch(() => {});
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

async function reconcileLegacyPrograms() {
  await ensureReady();
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const players = await client.query('select id,owner_email,current_publication_id from signage_players');
    let rolledBackPending = 0;
    let completedExtraActive = 0;
    let normalizedCurrent = 0;

    for (const player of players.rows) {
      const pending = await client.query(
        `select id,created_at,recurrence from signage_publications
         where player_id=$1 and lower(owner_email)=lower($2) and status='pending'
         order by created_at desc`,
        [player.id, player.owner_email]
      );
      const manual = pending.rows.filter(item => String(item.recurrence?.type || 'none') === 'none');
      const keepId = manual[0]?.id || null;
      for (const item of pending.rows) {
        const recurrenceType = String(item.recurrence?.type || 'none');
        if (item.id === keepId && recurrenceType === 'none') continue;
        await client.query(
          `update signage_publications
           set status='rolled_back',rolled_back_at=now(),updated_at=now(),
               error='Nettoyage automatique : ancien programme ou répétition devenue inutile'
           where id=$1`,
          [item.id]
        );
        rolledBackPending += 1;
      }

      if (player.current_publication_id) {
        const completed = await client.query(
          `update signage_publications
           set status='completed',updated_at=now()
           where player_id=$1 and lower(owner_email)=lower($2) and status='active' and id<>$3
           returning id`,
          [player.id, player.owner_email, player.current_publication_id]
        );
        completedExtraActive += completed.rowCount;
        const normalized = await client.query(
          `update signage_publications
           set recurrence='{"type":"none"}'::jsonb,updated_at=now()
           where id=$1 and coalesce(recurrence->>'type','none')<>'none'
           returning id`,
          [player.current_publication_id]
        );
        normalizedCurrent += normalized.rowCount;
      }
    }
    await client.query('commit');
    console.log(`[signage][program-policy] single-current reconciled: pending=${rolledBackPending}, extraActive=${completedExtraActive}, normalized=${normalizedCurrent}`);
    return { rolledBackPending, completedExtraActive, normalizedCurrent };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    console.error('[signage][program-policy] reconciliation failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { router, reconcileLegacyPrograms };
