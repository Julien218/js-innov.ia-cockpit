create index if not exists campaign_generation_jobs_worker_idx
  on public.campaign_generation_jobs(worker_id)
  where worker_id is not null;
