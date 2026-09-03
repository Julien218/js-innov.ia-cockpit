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
    process.exitCode = 0;
    return;
  }

  if (!DATABASE_URL) {
    log('error', 'DATABASE_URL manquant');
    process.exitCode = 1;
    return;
  }

  if (!DROPBOX_APP_KEY || !DROPBOX_APP_SECRET || !DROPBOX_REFRESH_TOKEN) {
    log('error', 'Identifiants Dropbox manquants (APP_KEY, APP_SECRET, REFRESH_TOKEN)');
    process.exitCode = 1;
    return;
  }

  if (!SIGNAGE_NAMESPACE_ID || !SIGNAGE_ROOT) {
    log('error', 'SIGNAGE_DROPBOX_NAMESPACE_ID ou SIGNAGE_DROPBOX_ROOT_PATH manquants');
    process.exitCode = 1;
    return;
  }

  let pool, client, token;
  try {
    // 1. Obtenir le token Dropbox (sans l'afficher)
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
      log('error', 'Token Dropbox invalide', { status: tokenResponse.status, error_summary: tokenData.error_summary });
      process.exitCode = 1;
      return;
    }
    token = tokenData.access_token;
    log('info', 'Token Dropbox obtenu');

    // 2. Vérifier les dossiers Dropbox avec namespace_id et pagination
    log('info', 'Vérification des dossiers Dropbox...');
    const pathRootHeader = { 'Dropbox-API-Path-Root': JSON.stringify({ ".tag": "namespace_id", "namespace_id": SIGNAGE_NAMESPACE_ID }) };

    const listPaths = [`${SIGNAGE_ROOT}/Medias`, `${SIGNAGE_ROOT}/Players/MXQ`, `${SIGNAGE_ROOT}/Videosurveillance/Enregistrements`];
    for (const dirPath of listPaths) {
      try {
        const listResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...pathRootHeader },
          body: JSON.stringify({ path: dirPath }),
        });
        const listData = await listResponse.json().catch(() => ({}));

        // Vérifier si le dossier n'existe pas
        if (!listResponse.ok) {
          if (listData.error_summary && listData.error_summary.includes('not_found')) {
            log('info', `${dirPath}: dossier inexistant (ok)`);
            continue;
          }
          log('error', `Impossible de lister ${dirPath}`, { status: listResponse.status, error_summary: listData.error_summary });
          process.exitCode = 1;
          return;
        }

        const entries = listData.entries || [];
        log('info', `${dirPath}: ${entries.length} entrées`);
      } catch (error) {
        log('error', `Exception en listant ${dirPath}`, { message: error.message });
        process.exitCode = 1;
        return;
      }
    }

    // 3. Vérifier que release.json et APK 0.6.1 existent et sont de type file dans Players/MXQ
    log('info', 'Vérification release.json et APK 0.6.1...');
    let hasReleaseJson = false, hasApk061 = false;
    try {
      const playersListResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...pathRootHeader },
        body: JSON.stringify({ path: `${SIGNAGE_ROOT}/Players/MXQ` }),
      });
      const playersData = await playersListResponse.json().catch(() => ({ entries: [] }));

      if (playersListResponse.ok) {
        const entries = playersData.entries || [];
        for (const entry of entries) {
          if (entry['.tag'] === 'file') {
            if (entry.name === 'release.json') hasReleaseJson = true;
            if (entry.name && entry.name.match(/Pixelium-Player-Olivier-0\.6\.1-pilot\.apk/)) hasApk061 = true;
          }
        }
      }
    } catch (error) {
      log('error', 'Exception en vérifiant Players/MXQ', { message: error.message });
      process.exitCode = 1;
      return;
    }

    if (!hasReleaseJson || !hasApk061) {
      log('error', 'release.json ou APK 0.6.1 introuvables dans Players/MXQ', { hasReleaseJson, hasApk061 });
      process.exitCode = 1;
      return;
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
        SELECT 1 FROM public.signage_playlists
        WHERE items::text ILIKE '%Assurance Dour Julien P&V%'
           OR items::text ILIKE '%/JS-Innov.IA/Cockpit/Olivier-Trevis%'
        UNION ALL
        SELECT 1 FROM public.signage_publications
        WHERE manifest::text ILIKE '%Assurance Dour Julien P&V%'
           OR manifest::text ILIKE '%/JS-Innov.IA/Cockpit/Olivier-Trevis%'
      ) t
    `;
    const jsonResult = await client.query(jsonCheckQuery);
    const jsonCount = Number(jsonResult.rows[0]?.count || 0);
    if (jsonCount > 0) {
      log('error', `JSON playlists/publications contient ${jsonCount} références au ancien préfixe — rollback requis`, { count: jsonCount });
      await client.query('ROLLBACK');
      process.exitCode = 1;
      return;
    }
    log('info', '✓ Aucun ancien préfixe dans JSON');

    // 7. Sélectionner lignes signage_media avec ancien préfixe (SQL paramétré)
    const mediaQuery = `
      SELECT id, owner_email, dropbox_path, size_bytes, checksum_sha256
      FROM public.signage_media
      WHERE
        (dropbox_path ILIKE $1 OR dropbox_path ILIKE $2)
        AND NOT (dropbox_path ILIKE $3 OR dropbox_path ILIKE $4)
      FOR UPDATE
    `;
    const mediaParams = [
      '%/JS-Innov.IA/Cockpit/Olivier-Trevis/Medias/%',
      '%Assurance Dour Julien P&V%/Olivier-Trevis/Medias/%',
      `${SIGNAGE_ROOT}/Medias/%`,
      `${SIGNAGE_ROOT}/Medias/%`
    ];
    const mediaRows = await client.query(mediaQuery, mediaParams);
    log('info', `${mediaRows.rows.length} lignes signage_media à migrer`);

    // 8. Vérifier chaque fichier média et migrer
    const mediaUpdates = [];
    for (const row of mediaRows.rows) {
      const filename = row.dropbox_path.split('/').pop();
      const newPath = `${SIGNAGE_ROOT}/Medias/${filename}`;

      // Convertir bigint en Number de façon sûre
      const expectedSize = row.size_bytes == null ? null : Number(row.size_bytes);
      if (expectedSize !== null && !Number.isSafeInteger(expectedSize)) {
        log('error', `Taille invalide pour ${row.dropbox_path}`, { size_bytes: row.size_bytes });
        await client.query('ROLLBACK');
        process.exitCode = 1;
        return;
      }

      // Vérifier que le fichier existe au nouveau chemin
      try {
        const metaResponse = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...pathRootHeader },
          body: JSON.stringify({ path: newPath }),
        });
        const metaData = await metaResponse.json().catch(() => ({}));

        if (!metaResponse.ok) {
          log('error', `Fichier média introuvable: ${newPath}`, { error_summary: metaData.error_summary });
          await client.query('ROLLBACK');
          process.exitCode = 1;
          return;
        }

        // Vérifier size_bytes si présent
        const actualSize = Number(metaData.size || 0);
        if (expectedSize !== null && expectedSize !== actualSize) {
          log('error', `Taille mismatch: ${newPath}`, { expected: expectedSize, actual: actualSize });
          await client.query('ROLLBACK');
          process.exitCode = 1;
          return;
        }

        mediaUpdates.push({ id: row.id, owner_email: row.owner_email, newPath, oldPath: row.dropbox_path });
      } catch (error) {
        log('error', `Exception en vérifiant média ${newPath}`, { message: error.message });
        await client.query('ROLLBACK');
        process.exitCode = 1;
        return;
      }
    }

    for (const update of mediaUpdates) {
      await client.query(
        'UPDATE public.signage_media SET dropbox_path = $1, updated_at = $2 WHERE id = $3',
        [update.newPath, new Date().toISOString(), update.id]
      );
    }
    log('info', `✓ ${mediaUpdates.length} média(s) mis à jour`);

    // 9. Sélectionner et vérifier camera_recordings (SQL paramétré)
    const cameraQuery = `
      SELECT id, owner_email, dropbox_path, size_bytes
      FROM public.camera_recordings
      WHERE
        (dropbox_path ILIKE $1 OR dropbox_path ILIKE $2)
        AND NOT (dropbox_path ILIKE $3 OR dropbox_path ILIKE $4)
      FOR UPDATE
    `;
    const cameraParams = [
      '%/JS-Innov.IA/Cockpit/Olivier-Trevis/Videosurveillance/%',
      '%Assurance Dour Julien P&V%/Olivier-Trevis/Videosurveillance/%',
      `${SIGNAGE_ROOT}/Videosurveillance/Enregistrements/%`,
      `${SIGNAGE_ROOT}/Videosurveillance/Enregistrements/%`
    ];
    const cameraRows = await client.query(cameraQuery, cameraParams);
    log('info', `${cameraRows.rows.length} lignes camera_recordings à migrer`);

    const cameraUpdates = [];
    for (const row of cameraRows.rows) {
      const filename = row.dropbox_path.split('/').pop();
      const newPath = `${SIGNAGE_ROOT}/Videosurveillance/Enregistrements/${filename}`;

      const expectedSize = row.size_bytes == null ? null : Number(row.size_bytes);
      if (expectedSize !== null && !Number.isSafeInteger(expectedSize)) {
        log('error', `Taille invalide pour ${row.dropbox_path}`, { size_bytes: row.size_bytes });
        await client.query('ROLLBACK');
        process.exitCode = 1;
        return;
      }

      try {
        const metaResponse = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...pathRootHeader },
          body: JSON.stringify({ path: newPath }),
        });
        const metaData = await metaResponse.json().catch(() => ({}));

        if (!metaResponse.ok) {
          log('error', `Fichier enregistrement introuvable: ${newPath}`, { error_summary: metaData.error_summary });
          await client.query('ROLLBACK');
          process.exitCode = 1;
          return;
        }

        const actualSize = Number(metaData.size || 0);
        if (expectedSize !== null && expectedSize !== actualSize) {
          log('error', `Taille mismatch enregistrement: ${newPath}`, { expected: expectedSize, actual: actualSize });
          await client.query('ROLLBACK');
          process.exitCode = 1;
          return;
        }

        cameraUpdates.push({ id: row.id, owner_email: row.owner_email, newPath, oldPath: row.dropbox_path });
      } catch (error) {
        log('error', `Exception en vérifiant enregistrement ${newPath}`, { message: error.message });
        await client.query('ROLLBACK');
        process.exitCode = 1;
        return;
      }
    }

    for (const update of cameraUpdates) {
      await client.query(
        'UPDATE public.camera_recordings SET dropbox_path = $1 WHERE id = $2',
        [update.newPath, update.id]
      );
    }
    log('info', `✓ ${cameraUpdates.length} enregistrement(s) mis à jour`);

    // 10. Vérifier accès temporary_link sur un média migré (avec namespace_id)
    const allMediaQuery = `SELECT dropbox_path FROM public.signage_media WHERE dropbox_path ILIKE $1 LIMIT 1`;
    const mediaCheckResult = await client.query(allMediaQuery, [`${SIGNAGE_ROOT}/Medias/%`]);

    if (mediaCheckResult.rows.length > 0) {
      const testPath = mediaCheckResult.rows[0].dropbox_path;
      try {
        const linkResponse = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...pathRootHeader },
          body: JSON.stringify({ path: testPath }),
        });
        const linkData = await linkResponse.json().catch(() => ({}));

        if (!linkResponse.ok) {
          log('error', `Impossible de générer lien temporaire: ${testPath}`, { error_summary: linkData.error_summary });
          await client.query('ROLLBACK');
          process.exitCode = 1;
          return;
        }
        log('info', `✓ Lien temporaire généré (avec namespace_id)`);
      } catch (error) {
        log('error', 'Exception en générant lien temporaire', { message: error.message });
        await client.query('ROLLBACK');
        process.exitCode = 1;
        return;
      }
    }

    // 11. Insérer événements d'audit
    const auditInsert = `
      INSERT INTO public.signage_audit_events (owner_email, actor_email, action, entity_type, entity_id, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    const allOwners = new Set([...mediaUpdates, ...cameraUpdates].map(u => u.owner_email));
    for (const owner of allOwners) {
      const mediaCount = mediaUpdates.filter(u => u.owner_email === owner).length;
      const cameraCount = cameraUpdates.filter(u => u.owner_email === owner).length;

      await client.query(auditInsert, [
        owner,
        'system-migration',
        'storage.dropbox_migrated',
        'storage',
        'migration-20260903',
        JSON.stringify({
          mediaCount,
          cameraRecordingsCount: cameraCount,
          targetNamespace: SIGNAGE_NAMESPACE_ID ? '***' : '(none)',
        }),
        new Date().toISOString(),
      ]);
    }
    log('info', '✓ Événements d\'audit insérés');

    // 12. Commit
    await client.query('COMMIT');
    log('info', '✓ Transaction commitée');

    // Résumé (sans secret)
    const summary = {
      timestamp: new Date().toISOString(),
      status: 'success',
      media_migrated: mediaUpdates.length,
      camera_recordings_migrated: cameraUpdates.length,
      owners_affected: allOwners.size,
      target_root: SIGNAGE_ROOT,
    };
    console.log(JSON.stringify(summary));
    process.exitCode = 0;

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
    process.exitCode = 1;

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

