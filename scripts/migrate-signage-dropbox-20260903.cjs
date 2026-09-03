#!/usr/bin/env node
/**
 * Migration PostgreSQL idempotente : mise à jour des chemins Dropbox Digital Signage
 * 
 * Fail-closed : rollback à la moindre erreur, aucune modification live sans vérification complète.
 * 
 * Activation : SIGNAGE_DROPBOX_MIGRATION_20260903=enabled
 * 
 * Exigences :
 * - DATABASE_URL (PostgreSQL Railway compatible)
 * - DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN
 * - SIGNAGE_DROPBOX_NAMESPACE_ID
 * - SIGNAGE_DROPBOX_ROOT_PATH
 */

const { Pool } = require('pg');
const crypto = require('crypto');

const ENABLED = process.env.SIGNAGE_DROPBOX_MIGRATION_20260903 === 'enabled';
const DATABASE_URL = process.env.DATABASE_URL || '';
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY || '';
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET || '';
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || '';
const SIGNAGE_NAMESPACE_ID = process.env.SIGNAGE_DROPBOX_NAMESPACE_ID || '';
const SIGNAGE_ROOT = (process.env.SIGNAGE_DROPBOX_ROOT_PATH || '').replace(/\/$/, '');

const log = (level, msg, data = null) => {
  const ts = new Date().toISOString();
  const prefix = `[migrate-signage-dropbox][${level}]`;
  if (data) console.error(`${prefix} ${msg}`, data);
  else console.error(`${prefix} ${msg}`);
};

async function main() {
  if (!ENABLED) {
    log('info', 'Migration désactivée (SIGNAGE_DROPBOX_MIGRATION_20260903 != enabled)');
    process.exit(0);
  }

  if (!DATABASE_URL) {
    log('error', 'DATABASE_URL manquant');
    process.exit(1);
  }

  if (!DROPBOX_APP_KEY || !DROPBOX_APP_SECRET || !DROPBOX_REFRESH_TOKEN) {
    log('error', 'Identifiants Dropbox manquants (APP_KEY, APP_SECRET, REFRESH_TOKEN)');
    process.exit(1);
  }

  if (!SIGNAGE_NAMESPACE_ID || !SIGNAGE_ROOT) {
    log('error', 'SIGNAGE_DROPBOX_NAMESPACE_ID ou SIGNAGE_DROPBOX_ROOT_PATH manquants');
    process.exit(1);
  }

  let pool, client, token;
  try {
    // 1. Obtenir le token Dropbox
    log('info', 'Authentification Dropbox...');
    const credentials = Buffer.from(`${DROPBOX_APP_KEY}:${DROPBOX_APP_SECRET}`).toString('base64');
    const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: DROPBOX_REFRESH_TOKEN }),
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) {
      log('error', 'Token Dropbox invalide', { status: tokenResponse.status });
      process.exit(1);
    }
    token = tokenData.access_token;
    log('info', 'Token Dropbox obtenu');

    // 2. Lister les dossiers Dropbox avec namespace_id
    log('info', 'Vérification des dossiers Dropbox...');
    const pathRootHeader = { 'Dropbox-API-Path-Root': JSON.stringify({ ".tag": "namespace_id", "namespace_id": SIGNAGE_NAMESPACE_ID }) };
    
    const listPaths = [`${SIGNAGE_ROOT}/Medias`, `${SIGNAGE_ROOT}/Players/MXQ`, `${SIGNAGE_ROOT}/Videosurveillance/Enregistrements`];
    for (const dirPath of listPaths) {
      const listResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...pathRootHeader },
        body: JSON.stringify({ path: dirPath }),
      });
      const listData = await listResponse.json().catch(() => ({}));
      if (!listResponse.ok && !listData.error?.path?.tag?.includes('not_found')) {
        log('error', `Impossible de lister ${dirPath}`, { status: listResponse.status, error: listData.error });
        process.exit(1);
      }
      if (listResponse.ok) {
        log('info', `${dirPath}: ${(listData.entries || []).length} entrées`);
      }
    }

    // 3. Vérifier que release.json et APK 0.6.1 existent dans Players/MXQ
    const playersCheckResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...pathRootHeader },
      body: JSON.stringify({ path: `${SIGNAGE_ROOT}/Players/MXQ` }),
    });
    const playersData = await playersCheckResponse.json().catch(() => ({ entries: [] }));
    const playersFiles = (playersData.entries || []).map(e => e.name || '');
    const hasReleaseJson = playersFiles.includes('release.json');
    const hasApk061 = playersFiles.some(name => name.includes('Pixelium-Player-Olivier-0.6.1'));
    
    if (!hasReleaseJson || !hasApk061) {
      log('error', 'release.json ou APK 0.6.1 manquants dans Players/MXQ', { hasReleaseJson, hasApk061 });
      process.exit(1);
    }
    log('info', '✓ release.json et APK 0.6.1 vérifiés');

    // 4. Connexion PostgreSQL
    log('info', 'Connexion PostgreSQL...');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    client = await pool.connect();
    log('info', '✓ Connecté');

    // 5. Commencer la transaction
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    log('info', 'Transaction démarrée');

    // 6. Détecter les anciens chemins dans JSON (playlists/publications)
    const jsonCheckQuery = `
      SELECT COUNT(*) as count FROM (
        SELECT 1 FROM public.signage_playlists WHERE items::text LIKE '%Assurance Dour Julien P&V%' OR items::text LIKE '%/JS-Innov.IA/Cockpit/Olivier-Trevis%'
        UNION ALL
        SELECT 1 FROM public.signage_publications WHERE manifest::text LIKE '%Assurance Dour Julien P&V%' OR manifest::text LIKE '%/JS-Innov.IA/Cockpit/Olivier-Trevis%'
      ) t
    `;
    const jsonResult = await client.query(jsonCheckQuery);
    if (jsonResult.rows[0]?.count > 0) {
      log('error', `JSON playlists/publications contient ${jsonResult.rows[0].count} références au ancien préfixe — rollback requis`, { count: jsonResult.rows[0].count });
      await client.query('ROLLBACK');
      process.exit(1);
    }
    log('info', '✓ Aucun ancien préfixe dans JSON');

    // 7. Sélectionner lignes signage_media avec ancien préfixe
    const mediaQuery = `
      SELECT id, owner_email, dropbox_path, size_bytes, checksum_sha256
      FROM public.signage_media
      WHERE 
        (dropbox_path LIKE '%/JS-Innov.IA/Cockpit/Olivier-Trevis/Medias/%'
         OR dropbox_path LIKE '%Assurance Dour Julien P&V%/Olivier-Trevis/Medias/%')
        AND NOT dropbox_path LIKE '${SIGNAGE_ROOT}/Medias/%'
      FOR UPDATE
    `;
    const mediaRows = await client.query(mediaQuery);
    log('info', `${mediaRows.rows.length} lignes signage_media à migrer`);

    // 8. Vérifier chaque fichier média et migrer
    const mediaUpdates = [];
    for (const row of mediaRows.rows) {
      const filename = row.dropbox_path.split('/').pop();
      const newPath = `${SIGNAGE_ROOT}/Medias/${filename}`;
      
      // Vérifier que le fichier existe au nouveau chemin avec Dropbox API
      const metaResponse = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...pathRootHeader },
        body: JSON.stringify({ path: newPath }),
      });
      const metaData = await metaResponse.json().catch(() => ({}));
      if (!metaResponse.ok) {
        log('error', `Fichier média introuvable: ${newPath}`, { error: metaData.error });
        await client.query('ROLLBACK');
        process.exit(1);
      }

      // Vérifier size_bytes si présent
      if (row.size_bytes && metaData.size !== row.size_bytes) {
        log('error', `Taille mismatch: ${newPath}`, { expected: row.size_bytes, actual: metaData.size });
        await client.query('ROLLBACK');
        process.exit(1);
      }

      mediaUpdates.push({ id: row.id, owner_email: row.owner_email, newPath, oldPath: row.dropbox_path });
    }

    for (const update of mediaUpdates) {
      await client.query(
        'UPDATE public.signage_media SET dropbox_path = $1, updated_at = $2 WHERE id = $3',
        [update.newPath, new Date().toISOString(), update.id]
      );
    }
    log('info', `✓ ${mediaUpdates.length} média(s) mis à jour`);

    // 9. Sélectionner et vérifier camera_recordings
    const cameraQuery = `
      SELECT id, owner_email, dropbox_path, size_bytes
      FROM public.camera_recordings
      WHERE 
        (dropbox_path LIKE '%/JS-Innov.IA/Cockpit/Olivier-Trevis/Videosurveillance/%'
         OR dropbox_path LIKE '%Assurance Dour Julien P&V%/Olivier-Trevis/Videosurveillance/%')
        AND NOT dropbox_path LIKE '${SIGNAGE_ROOT}/Videosurveillance/%'
      FOR UPDATE
    `;
    const cameraRows = await client.query(cameraQuery);
    log('info', `${cameraRows.rows.length} lignes camera_recordings à migrer`);

    const cameraUpdates = [];
    for (const row of cameraRows.rows) {
      const filename = row.dropbox_path.split('/').pop();
      const newPath = `${SIGNAGE_ROOT}/Videosurveillance/Enregistrements/${filename}`;

      const metaResponse = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...pathRootHeader },
        body: JSON.stringify({ path: newPath }),
      });
      const metaData = await metaResponse.json().catch(() => ({}));
      if (!metaResponse.ok) {
        log('error', `Fichier enregistrement introuvable: ${newPath}`, { error: metaData.error });
        await client.query('ROLLBACK');
        process.exit(1);
      }

      if (row.size_bytes && metaData.size !== row.size_bytes) {
        log('error', `Taille mismatch enregistrement: ${newPath}`, { expected: row.size_bytes, actual: metaData.size });
        await client.query('ROLLBACK');
        process.exit(1);
      }

      cameraUpdates.push({ id: row.id, owner_email: row.owner_email, newPath, oldPath: row.dropbox_path });
    }

    for (const update of cameraUpdates) {
      await client.query(
        'UPDATE public.camera_recordings SET dropbox_path = $1 WHERE id = $2',
        [update.newPath, update.id]
      );
    }
    log('info', `✓ ${cameraUpdates.length} enregistrement(s) mis à jour`);

    // 10. Vérifier accès temporary_link sur un média migré (ou déjà au nouveau chemin)
    const allMediaQuery = `SELECT dropbox_path FROM public.signage_media WHERE dropbox_path LIKE $1 LIMIT 1`;
    const mediaCheckResult = await client.query(allMediaQuery, [`${SIGNAGE_ROOT}/Medias/%`]);
    if (mediaCheckResult.rows.length > 0) {
      const testPath = mediaCheckResult.rows[0].dropbox_path;
      const linkResponse = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...pathRootHeader },
        body: JSON.stringify({ path: testPath }),
      });
      const linkData = await linkResponse.json().catch(() => ({}));
      if (!linkResponse.ok) {
        log('error', `Impossible de générer lien temporaire: ${testPath}`, { error: linkData.error });
        await client.query('ROLLBACK');
        process.exit(1);
      }
      log('info', `✓ Lien temporaire généré (avec namespace_id)`);
    }

    // 11. Insérer événement d'audit
    const auditInsert = `
      INSERT INTO public.signage_audit_events (owner_email, actor_email, action, entity_type, entity_id, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    const allOwners = new Set([...mediaUpdates, ...cameraUpdates].map(u => u.owner_email));
    for (const owner of allOwners) {
      await client.query(auditInsert, [
        owner,
        'system-migration',
        'storage.dropbox_migrated',
        'storage',
        'migration-20260903',
        JSON.stringify({
          mediaCount: mediaUpdates.filter(u => u.owner_email === owner).length,
          cameraRecordingsCount: cameraUpdates.filter(u => u.owner_email === owner).length,
          targetNamespaceId: SIGNAGE_NAMESPACE_ID ? '***' : '(none)',
        }),
        new Date().toISOString(),
      ]);
    }
    log('info', '✓ Événements d\'audit insérés');

    // 12. Commit
    await client.query('COMMIT');
    log('info', '✓ Transaction commitée');

    // Résumé
    const summary = {
      timestamp: new Date().toISOString(),
      status: 'success',
      media_migrated: mediaUpdates.length,
      camera_recordings_migrated: cameraUpdates.length,
      owners_affected: allOwners.size,
      target_root: SIGNAGE_ROOT,
      namespace_id_used: SIGNAGE_NAMESPACE_ID ? '***' : 'none',
    };
    console.log(JSON.stringify(summary));
    process.exit(0);

  } catch (error) {
    log('error', 'Exception', { message: error.message });
    if (client) {
      try {
        await client.query('ROLLBACK');
        log('info', 'Rollback effectué');
      } catch (rollbackError) {
        log('error', 'Rollback failed', { message: rollbackError.message });
      }
    }
    process.exit(1);

  } finally {
    if (client) {
      try {
        client.release();
      } catch (e) {
        log('error', 'Failed to release client', { message: e.message });
      }
    }
    if (pool) {
      try {
        await pool.end();
      } catch (e) {
        log('error', 'Failed to close pool', { message: e.message });
      }
    }
  }
}

main();

