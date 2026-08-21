// ─── Supabase Client — Studio Vidéo JS-Innov.IA ───────────────────────────
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://rzvvwcwyaddzsaattwqt.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6dnZ3Y3d5YWRkenNhYXR0d3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTU4NjAsImV4cCI6MjA5NjY5MTg2MH0.VOEFK5BG_dxCnijcz2RexqMg1yDGoXdw58-2Ud_a7hM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Helpers CRUD génériques ───────────────────────────────────────────────
export const videoDb = {
  VideoProject: {
    list: (order = '-created_date', limit = 50) =>
      supabase.from('VideoProject').select('*').order('created_date', { ascending: false }).limit(limit),
    get: (id) => supabase.from('VideoProject').select('*').eq('id', id).single(),
    filter: (filters) => supabase.from('VideoProject').select('*').match(filters),
    create: (data) => supabase.from('VideoProject').insert({ ...data, created_date: new Date().toISOString(), updated_date: new Date().toISOString() }).select().single(),
    update: (id, data) => supabase.from('VideoProject').update({ ...data, updated_date: new Date().toISOString() }).eq('id', id).select().single(),
    delete: (id) => supabase.from('VideoProject').delete().eq('id', id),
  },
  AIVideoReport: {
    list: (order = '-created_date', limit = 20) =>
      supabase.from('AIVideoReport').select('*').order('created_date', { ascending: false }).limit(limit),
    get: (id) => supabase.from('AIVideoReport').select('*').eq('id', id).single(),
    filter: (filters) => supabase.from('AIVideoReport').select('*').match(filters),
    create: (data) => supabase.from('AIVideoReport').insert({ ...data, created_date: new Date().toISOString(), updated_date: new Date().toISOString() }).select().single(),
    update: (id, data) => supabase.from('AIVideoReport').update({ ...data, updated_date: new Date().toISOString() }).eq('id', id).select().single(),
    delete: (id) => supabase.from('AIVideoReport').delete().eq('id', id),
  },
  VideoExport: {
    list: (order = '-created_date', limit = 100) =>
      supabase.from('VideoExport').select('*').order('created_date', { ascending: false }).limit(limit),
    get: (id) => supabase.from('VideoExport').select('*').eq('id', id).single(),
    filter: (filters) => supabase.from('VideoExport').select('*').match(filters),
    create: (data) => supabase.from('VideoExport').insert({ ...data, created_date: new Date().toISOString(), updated_date: new Date().toISOString() }).select().single(),
    update: (id, data) => supabase.from('VideoExport').update({ ...data, updated_date: new Date().toISOString() }).eq('id', id).select().single(),
    delete: (id) => supabase.from('VideoExport').delete().eq('id', id),
  },
};

const unwrapSupabase = async (operation, { label = 'Opération Supabase', fallback = null, required = false } = {}) => {
  const { data, error } = await operation;
  if (error) {
    throw new Error(`${label} : ${error.message}`);
  }
  if (required && (data === null || data === undefined)) {
    throw new Error(`${label} : la base a renvoyé une réponse vide.`);
  }
  return data ?? fallback;
};

// ─── Upload fichier vers Supabase Storage ─────────────────────────────────
export async function uploadToStorage(file, bucket = 'videos', path = null) {
  const filePath = path || `${Date.now()}_${file.name}`;
  const { error } = await supabase.storage.from(bucket).upload(filePath, file, { upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return publicUrl;
}

// ─── Compatibilité base44 SDK (shim pour les composants existants) ─────────
// Permet d'utiliser les composants du générateur sans modifier leur code
export const base44Shim = {
  entities: {
    VideoProject: {
      list: (order, limit) => unwrapSupabase(videoDb.VideoProject.list(order, limit), {
        label: 'Chargement des montages vidéo',
        fallback: [],
      }),
      filter: (filters) => unwrapSupabase(videoDb.VideoProject.filter(filters), {
        label: 'Recherche du montage vidéo',
        fallback: [],
      }),
      create: (data) => unwrapSupabase(videoDb.VideoProject.create(data), {
        label: 'Création du montage vidéo',
        required: true,
      }),
      update: (id, data) => unwrapSupabase(videoDb.VideoProject.update(id, data), {
        label: 'Mise à jour du montage vidéo',
        required: true,
      }),
      delete: (id) => unwrapSupabase(videoDb.VideoProject.delete(id), {
        label: 'Suppression du montage vidéo',
      }),
    },
    AIVideoReport: {
      list: (order, limit) => unwrapSupabase(videoDb.AIVideoReport.list(order, limit), {
        label: 'Chargement des rapports vidéo IA',
        fallback: [],
      }),
      filter: (filters) => unwrapSupabase(videoDb.AIVideoReport.filter(filters), {
        label: 'Recherche du rapport vidéo IA',
        fallback: [],
      }),
      create: (data) => unwrapSupabase(videoDb.AIVideoReport.create(data), {
        label: 'Création du rapport vidéo IA',
        required: true,
      }),
      update: (id, data) => unwrapSupabase(videoDb.AIVideoReport.update(id, data), {
        label: 'Mise à jour du rapport vidéo IA',
        required: true,
      }),
      delete: (id) => unwrapSupabase(videoDb.AIVideoReport.delete(id), {
        label: 'Suppression du rapport vidéo IA',
      }),
    },
    VideoExport: {
      list: (order, limit) => unwrapSupabase(videoDb.VideoExport.list(order, limit), {
        label: 'Chargement des exports vidéo',
        fallback: [],
      }),
      filter: (filters) => unwrapSupabase(videoDb.VideoExport.filter(filters), {
        label: 'Recherche de l’export vidéo',
        fallback: [],
      }),
      create: (data) => unwrapSupabase(videoDb.VideoExport.create(data), {
        label: 'Création de l’export vidéo',
        required: true,
      }),
      update: (id, data) => unwrapSupabase(videoDb.VideoExport.update(id, data), {
        label: 'Mise à jour de l’export vidéo',
        required: true,
      }),
      delete: (id) => unwrapSupabase(videoDb.VideoExport.delete(id), {
        label: 'Suppression de l’export vidéo',
      }),
      subscribe: (callback) => {
        const channel = supabase.channel('video_export_changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'VideoExport' },
            (payload) => callback({ type: payload.eventType, id: /** @type {any} */ (payload.old)?.id, data: payload.new })
          ).subscribe();
        return () => { void supabase.removeChannel(channel); };
      },
    },
    Project: {
      list: (order, limit) => unwrapSupabase(
        supabase.from('projets_fr').select('*').order('created_date', { ascending: false }).limit(limit || 50),
        { label: 'Chargement des projets', fallback: [] },
      ),
      filter: (filters) => unwrapSupabase(
        supabase.from('projets_fr').select('*').match(filters),
        { label: 'Recherche du projet source', fallback: [] },
      ),
    },
  },
  integrations: {
    Core: {
      // Génération d'image via novaChat backend
      GenerateImage: async ({ prompt }) => {
        const res = await fetch('https://js-innov-command-center-production.up.railway.app/api/nova', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate_image', prompt }),
        });
        if (!res.ok) {
          throw new Error(`Génération d’image impossible (${res.status}).`);
        }
        const data = await res.json();
        return { url: data.image_url || data.url || '' };
      },
      UploadFile: async ({ file, fileName = file?.name }) => {
        const url = await uploadToStorage(file, 'uploads', fileName);
        return { url };
      },
    },
  },
};
