import { makeLocalClient, cloudJson } from '@/lib/music-motion/io';

export async function campaignApi(path, options = {}) {
  const response = await fetch('/api/campaigns' + path, {
    credentials: 'same-origin',
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : (options.headers || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ('Campagnes HTTP ' + response.status));
  return data;
}

export function csvToArray(value) {
  return String(value || '').split(/[\n,;]/).map(v => v.trim()).filter(Boolean);
}

export function arrayToCsv(value) {
  return (Array.isArray(value) ? value : []).join(', ');
}

export async function generateCampaignVideo({ postId, orchestration, allowPaidApi = false, localToken = '' }) {
  const desired = orchestration.video_engine || 'auto';
  const tryLocal = desired === 'local' || desired === 'auto';
  let localFailure = null;

  if (tryLocal) {
    try {
      const local = makeLocalClient(localToken);
      const caps = await local.json('/capabilities');
      const workflow = orchestration.local_workflow_id
        || (caps.video_workflows || []).find(item => item.available)?.id
        || '';
      if (!workflow) throw new Error('Aucun workflow vidéo local disponible.');

      const imageResponse = await fetch('/api/campaigns/posts/' + encodeURIComponent(postId) + '/image-file', { credentials: 'same-origin' });
      if (!imageResponse.ok) {
        const detail = await imageResponse.json().catch(() => ({}));
        throw new Error(detail.error || 'Image validée inaccessible.');
      }
      const blob = await imageResponse.blob();
      const uploaded = await local.upload(blob, 'campaign-' + postId + '.jpg');
      const job = await local.json('/jobs', {
        request_id: 'campaign_' + postId,
        type: 'video',
        prompt: orchestration.video_prompt,
        source_id: uploaded.id,
        workflow_id: workflow,
        duration_seconds: 8,
        format: '9:16'
      });
      await campaignApi('/posts/' + encodeURIComponent(postId), {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'video_generating',
          video_provider: 'local',
          video_job_id: job.id,
          video_status: job.status === 'completed' ? 'completed' : 'generating'
        })
      });
      return { provider: 'local', job };
    } catch (error) {
      localFailure = error;
      if (desired === 'local' || !orchestration.fallback_to_api) throw error;
    }
  }

  if (desired === 'api' || orchestration.fallback_to_api) {
    if (!allowPaidApi) {
      const error = new Error(localFailure
        ? 'Le moteur local est indisponible. Le fallback xAI est payant et nécessite une confirmation.'
        : 'La génération xAI est payante et nécessite une confirmation.');
      error.code = 'PAID_API_CONFIRMATION_REQUIRED';
      throw error;
    }
    const source = await campaignApi('/posts/' + encodeURIComponent(postId) + '/image-data');
    const job = await cloudJson('/jobs', {
      request_id: 'campaign_' + postId,
      type: 'video',
      prompt: orchestration.video_prompt,
      duration_seconds: 8,
      format: '9:16',
      image_data_url: source.data_url,
      consent: { paid: true, external_transfer: true, one_request: true }
    });
    await campaignApi('/posts/' + encodeURIComponent(postId), {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'video_generating',
        video_provider: 'xai',
        video_job_id: job.id,
        video_status: job.status === 'completed' ? 'completed' : 'generating'
      })
    });
    return { provider: 'xai', job };
  }

  throw localFailure || new Error('Aucun moteur vidéo disponible pour cette marque.');
}

export async function refreshCampaignVideo(post, localToken = '') {
  if (!post?.video_job_id || !post?.video_provider) return null;
  let job;
  if (post.video_provider === 'local') {
    job = await makeLocalClient(localToken).json('/jobs/' + encodeURIComponent(post.video_job_id));
  } else {
    job = await cloudJson('/jobs/' + encodeURIComponent(post.video_job_id));
  }
  const completed = job.status === 'completed';
  const failed = ['failed','cancelled','expired'].includes(job.status);
  await campaignApi('/posts/' + encodeURIComponent(post.id), {
    method: 'PATCH',
    body: JSON.stringify({
      status: completed ? 'video_review' : failed ? 'image_approved' : 'video_generating',
      video_status: completed ? 'completed' : failed ? 'failed' : 'generating',
      video_url: completed && post.video_provider !== 'local' ? '/api/music-motion/jobs/' + encodeURIComponent(post.video_job_id) + '/media' : post.video_url || null
    })
  });
  return job;
}
