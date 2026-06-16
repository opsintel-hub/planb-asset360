UPDATE public.claim_tickets
SET opened_at = (now() - ((payload->>'totalTime')::numeric * interval '1 hour'))
WHERE opened_at IS NULL
  AND (payload->>'totalTime') ~ '^[0-9]+(\.[0-9]+)?$';