
-- 1. Clean up orphan next-step notes (tickets already gone)
DELETE FROM public.claim_next_steps
WHERE ticket_code NOT IN (SELECT ref_number FROM public.claim_tickets WHERE ref_number IS NOT NULL);

-- 2. Ensure claim_tickets.ref_number is unique (needed for FK target)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.claim_tickets'::regclass
      AND contype IN ('u','p')
      AND conkey = (SELECT array_agg(attnum) FROM pg_attribute
                    WHERE attrelid = 'public.claim_tickets'::regclass
                      AND attname = 'ref_number')
  ) THEN
    ALTER TABLE public.claim_tickets
      ADD CONSTRAINT claim_tickets_ref_number_key UNIQUE (ref_number);
  END IF;
END $$;

-- 3. Add FK with ON DELETE CASCADE
ALTER TABLE public.claim_next_steps
  ADD CONSTRAINT claim_next_steps_ticket_fk
  FOREIGN KEY (ticket_code)
  REFERENCES public.claim_tickets(ref_number)
  ON DELETE CASCADE;
