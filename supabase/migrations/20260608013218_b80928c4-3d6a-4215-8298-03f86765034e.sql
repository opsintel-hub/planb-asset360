SELECT cron.schedule(
  'sync-claims-every-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--6d2903c3-530f-4343-83c9-b9ada7a70d18.lovable.app/api/public/hooks/sync-claims',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtZWR6bGpibHpuZ3Jsc2FsZnNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNDU5MjAsImV4cCI6MjA5NDgyMTkyMH0.dUcQfG1qZm-Z1lMpqyPXagM2hzHpFUxqEesLmQOX0k0"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);