// ─── Supabase Client — Studio Vidéo JS-Innov.IA ───────────────────────────
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://rzvvwcwyaddzsaattwqt.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6dnZ3Y3d5YWRkenNhYXR0d3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMTU4NjAsImV4cCI6MjA5NjY5MTg2MH0.VOEFK5BG_dxCnijcz2RexqMg1yDGoXdw58-2Ud_a7hM"

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

// ─── Upload fichier vers Supabase Storage ─────────────────────────────────
export async function uploadToStorage(file, bucket = 'videos', path = null) {
  const filePath = path || `${Date.now()}_${file.name}`;
  const { data, error } = await supabase.storage.from(bucket).upload(filePath, file, { upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return publicUrl;
}

// ─── Compatibilité base44 SDK (shim pour les composants existants) ─────────
// Permet d'utiliser les composants du générateur sans modifier leur code
export const base44Shim = {
  entities: {
    VideoProject: {
      list: async (order, limit) => { const { data } = await videoDb.VideoProject.list(order, limit); return data || []; },
      filter: async (filters) => { const { data } = await videoDb.VideoProject.filter(filters); return data || []; },
      create: async (data) => { const { data: d } = await videoDb.VideoProject.create(data); return d; },
      update: async (id, data) => { const { data: d } = await videoDb.VideoProject.update(id, data); return d; },
      delete: async (id) => { await videoDb.VideoProject.delete(id); },
    },
    AIVideoReport: {
      list: async (order, limit) => { const { data } = await videoDb.AIVideoReport.list(order, limit); return data || []; },
      filter: async (filters) => { const { data } = await videoDb.AIVideoReport.filter(filters); return data || []; },
      create: async (data) => { const { data: d } = await videoDb.AIVideoReport.create(data); return d; },
      update: async (id, data) => { const { data: d } = await videoDb.AIVideoReport.update(id, data); return d; },
      delete: async (id) => { await videoDb.AIVideoReport.delete(id); },
    },
    VideoExport: {
      list: async (order, limit) => { const { data } = await videoDb.VideoExport.list(order, limit); return data || []; },
      filter: async (filters) => { const { data } = await videoDb.VideoExport.filter(filters); return data || []; },
      create: async (data) => { const { data: d } = await videoDb.VideoExport.create(data); return d; },
      update: async (id, data) => { const { data: d } = await videoDb.VideoExport.update(id, data); return d; },
      delete: async (id) => { await videoDb.VideoExport.delete(id); },
      subscribe: (callback) => {
        const channel = supabase.channel('video_export_changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'VideoExport' },
            (payload) => callback({ type: payload.eventType, id: payload.old?.id, data: payload.new })
          ).subscribe();
        return () => supabase.removeChannel(channel);
      },
    },
    Project: {
      list: async (order, limit) => { const { data } = await supabase.from('projets_fr').select('*').order('created_date', { ascending: false }).limit(limit || 50); return data || []; },
      filter: async (filters) => { const { data } = await supabase.from('projets_fr').select('*').match(filters); return data || []; },
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
        const data = await res.json();
        return { url: data.image_url || data.url || '' };
      },
      UploadFile: async ({ file, fileName }) => {
        const url = await uploadToStorage(file, 'uploads', fileName);
        return { url };
      },
    },
  },
};
