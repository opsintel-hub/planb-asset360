CREATE OR REPLACE FUNCTION public.get_public_schema_info()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH tables AS (
    SELECT c.oid, c.relname AS table_name, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
  ),
  pks AS (
    SELECT t.table_name,
           array_agg(a.attname ORDER BY array_position(i.indkey, a.attnum)) AS pk_cols
    FROM tables t
    JOIN pg_index i ON i.indrelid = t.oid AND i.indisprimary
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    GROUP BY t.table_name
  ),
  fks AS (
    SELECT t.table_name,
      jsonb_agg(jsonb_build_object(
        'column', a.attname,
        'references_table', tt.relname,
        'references_column', af.attname
      ) ORDER BY a.attname) AS fks
    FROM tables t
    JOIN pg_constraint con ON con.conrelid = t.oid AND con.contype = 'f'
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = con.conkey[1]
    JOIN pg_class tt ON tt.oid = con.confrelid
    JOIN pg_attribute af ON af.attrelid = con.confrelid AND af.attnum = con.confkey[1]
    GROUP BY t.table_name
  ),
  cols AS (
    SELECT t.table_name,
      jsonb_agg(jsonb_build_object(
        'name', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'nullable', NOT a.attnotnull
      ) ORDER BY a.attnum) AS columns,
      count(*) AS column_count
    FROM tables t
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
    GROUP BY t.table_name
  ),
  rowcounts AS (
    SELECT c.relname AS table_name, c.reltuples::bigint AS est_rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  )
  SELECT jsonb_build_object(
    'tables', jsonb_agg(jsonb_build_object(
      'name', t.table_name,
      'kind', t.relkind,
      'primary_key', COALESCE(to_jsonb(p.pk_cols), '[]'::jsonb),
      'foreign_keys', COALESCE(f.fks, '[]'::jsonb),
      'columns', COALESCE(c.columns, '[]'::jsonb),
      'column_count', COALESCE(c.column_count, 0),
      'est_rows', COALESCE(r.est_rows, 0)
    ) ORDER BY t.table_name)
  )
  FROM tables t
  LEFT JOIN pks p USING (table_name)
  LEFT JOIN fks f USING (table_name)
  LEFT JOIN cols c USING (table_name)
  LEFT JOIN rowcounts r USING (table_name);
$$;

GRANT EXECUTE ON FUNCTION public.get_public_schema_info() TO authenticated;