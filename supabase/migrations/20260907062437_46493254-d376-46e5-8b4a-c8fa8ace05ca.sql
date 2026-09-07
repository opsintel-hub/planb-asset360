CREATE OR REPLACE FUNCTION public.get_usage_analytics(
  _from timestamptz,
  _to timestamptz,
  _user_id uuid DEFAULT NULL,
  _department text DEFAULT NULL,
  _role text DEFAULT NULL,
  _device text DEFAULT NULL,
  _platform text DEFAULT NULL,
  _browser text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE res jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH base AS (
    SELECT e.*, p.department AS dept,
           COALESCE(p.display_name, e.email, 'unknown') AS display_name
    FROM public.user_activity_events e
    LEFT JOIN public.profiles p ON p.user_id = e.user_id
    WHERE (_user_id IS NULL OR e.user_id = _user_id)
      AND (_department IS NULL OR p.department = _department)
      AND (_device IS NULL OR e.device_type = _device)
      AND (_platform IS NULL OR e.platform = _platform)
      AND (_browser IS NULL OR e.browser = _browser)
      AND (_role IS NULL OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = e.user_id AND ur.role::text = _role))
  ), ranged AS (
    SELECT * FROM base WHERE created_at >= _from AND created_at < _to
  ), sess AS (
    SELECT session_id, user_id, display_name, dept,
           min(created_at) AS started_at, max(created_at) AS ended_at,
           count(*) FILTER (WHERE event_type = 'page_view') AS page_views,
           max(device_type) AS device_type, max(browser) AS browser, max(platform) AS platform,
           GREATEST(EXTRACT(epoch FROM (max(created_at) - min(created_at))) / 60.0, 1)::numeric(10,1) AS minutes
    FROM ranged WHERE session_id IS NOT NULL
    GROUP BY session_id, user_id, display_name, dept
  ), first_seen AS (
    SELECT user_id, min(created_at) AS first_at, max(created_at) AS last_at
    FROM base GROUP BY user_id
  )
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'totalUsers', (SELECT count(*) FROM public.profiles),
      'activeToday', (SELECT count(DISTINCT user_id) FROM base WHERE created_at >= date_trunc('day', now())),
      'activeWeek', (SELECT count(DISTINCT user_id) FROM base WHERE created_at >= now() - interval '7 days'),
      'activeMonth', (SELECT count(DISTINCT user_id) FROM base WHERE created_at >= now() - interval '30 days'),
      'totalSessions', (SELECT count(*) FROM sess),
      'avgSessionMinutes', COALESCE((SELECT round(avg(minutes), 1) FROM sess), 0)
    ),
    'daily', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'day') FROM (
        SELECT jsonb_build_object(
                 'day', to_char(date_trunc('day', created_at), 'YYYY-MM-DD'),
                 'users', count(DISTINCT user_id),
                 'events', count(*)) AS x
        FROM ranged GROUP BY date_trunc('day', created_at)) t), '[]'::jsonb),
    'hourly', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'hour')::int) FROM (
        SELECT jsonb_build_object('hour', EXTRACT(hour FROM created_at)::int,
                                  'events', count(*),
                                  'users', count(DISTINCT user_id)) AS x
        FROM ranged GROUP BY EXTRACT(hour FROM created_at)) t), '[]'::jsonb),
    'weekly', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'week') FROM (
        SELECT jsonb_build_object('week', to_char(date_trunc('week', created_at), 'YYYY-MM-DD'),
                                  'users', count(DISTINCT user_id),
                                  'events', count(*)) AS x
        FROM ranged GROUP BY date_trunc('week', created_at)) t), '[]'::jsonb),
    'monthly', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'month') FROM (
        SELECT jsonb_build_object('month', to_char(date_trunc('month', created_at), 'YYYY-MM'),
                                  'users', count(DISTINCT user_id),
                                  'events', count(*)) AS x
        FROM ranged GROUP BY date_trunc('month', created_at)) t), '[]'::jsonb),
    'topUsers', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('userId', user_id, 'name', display_name,
                                  'events', count(*), 'sessions', count(DISTINCT session_id)) AS x
        FROM ranged GROUP BY user_id, display_name
        ORDER BY count(*) DESC LIMIT 10) t), '[]'::jsonb),
    'byDepartment', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('department', COALESCE(dept, 'ไม่ระบุ'),
                                  'users', count(DISTINCT user_id), 'events', count(*)) AS x
        FROM ranged GROUP BY COALESCE(dept, 'ไม่ระบุ') ORDER BY count(*) DESC) t), '[]'::jsonb),
    'heatmap', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('dow', EXTRACT(dow FROM created_at)::int,
                                  'hour', EXTRACT(hour FROM created_at)::int,
                                  'events', count(*)) AS x
        FROM ranged
        GROUP BY EXTRACT(dow FROM created_at), EXTRACT(hour FROM created_at)) t), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', COALESCE(device_type, 'unknown'), 'value', count(*)) AS x
        FROM ranged GROUP BY COALESCE(device_type, 'unknown')) t), '[]'::jsonb),
    'browsers', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', COALESCE(browser, 'unknown'), 'value', count(*)) AS x
        FROM ranged GROUP BY COALESCE(browser, 'unknown')) t), '[]'::jsonb),
    'analytics', jsonb_build_object(
      'dau', (SELECT count(DISTINCT user_id) FROM base WHERE created_at >= now() - interval '1 day'),
      'wau', (SELECT count(DISTINCT user_id) FROM base WHERE created_at >= now() - interval '7 days'),
      'mau', (SELECT count(DISTINCT user_id) FROM base WHERE created_at >= now() - interval '30 days'),
      'retentionRate', COALESCE((
        SELECT round(100.0 * count(*) FILTER (WHERE cur) / GREATEST(count(*) FILTER (WHERE prev), 1), 1)
        FROM (SELECT user_id,
                     bool_or(created_at >= now() - interval '7 days') AS cur,
                     bool_or(created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days') AS prev
              FROM base GROUP BY user_id) r
        WHERE prev), 0),
      'avgSessionMinutes', COALESCE((SELECT round(avg(minutes), 1) FROM sess), 0),
      'avgVisitsPerUser', COALESCE((SELECT round(count(*)::numeric / GREATEST(count(DISTINCT user_id), 1), 1) FROM sess), 0),
      'bounceRate', COALESCE((SELECT round(100.0 * count(*) FILTER (WHERE page_views <= 1) / GREATEST(count(*), 1), 1) FROM sess), 0),
      'returningUsers', (SELECT count(*) FROM first_seen f WHERE f.first_at < _from AND EXISTS (SELECT 1 FROM ranged r WHERE r.user_id = f.user_id)),
      'newUsers', (SELECT count(*) FROM first_seen f WHERE f.first_at >= _from AND f.first_at < _to)
    ),
    'table', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object(
                 'userId', r.user_id,
                 'name', r.display_name,
                 'email', max(r.email),
                 'department', COALESCE(max(r.dept), 'ไม่ระบุ'),
                 'lastLogin', max(r.created_at) FILTER (WHERE r.event_type = 'login'),
                 'loginCount', count(*) FILTER (WHERE r.event_type = 'login'),
                 'sessions', count(DISTINCT r.session_id),
                 'totalMinutes', COALESCE((SELECT round(sum(s.minutes), 1) FROM sess s WHERE s.user_id = r.user_id), 0),
                 'avgSessionMinutes', COALESCE((SELECT round(avg(s.minutes), 1) FROM sess s WHERE s.user_id = r.user_id), 0),
                 'pagesVisited', count(*) FILTER (WHERE r.event_type = 'page_view'),
                 'topFeature', (SELECT COALESCE(r2.feature, r2.path) FROM ranged r2
                                 WHERE r2.user_id = r.user_id AND COALESCE(r2.feature, r2.path) IS NOT NULL
                                 GROUP BY COALESCE(r2.feature, r2.path) ORDER BY count(*) DESC LIMIT 1),
                 'lastActivity', max(r.created_at)) AS x
        FROM ranged r GROUP BY r.user_id, r.display_name
        ORDER BY max(r.created_at) DESC) t), '[]'::jsonb),
    'alerts', jsonb_build_object(
      'unusualLogins', COALESCE((SELECT jsonb_agg(x) FROM (
          SELECT jsonb_build_object('userId', user_id, 'name', display_name,
                                    'day', to_char(date_trunc('day', created_at), 'YYYY-MM-DD'),
                                    'failed', count(*)) AS x
          FROM base WHERE event_type = 'login' AND success = false
          GROUP BY user_id, display_name, date_trunc('day', created_at)
          HAVING count(*) >= 5) t), '[]'::jsonb),
      'inactiveUsers', COALESCE((SELECT jsonb_agg(x) FROM (
          SELECT jsonb_build_object('userId', p.user_id, 'name', COALESCE(p.display_name, p.email),
                                    'lastActivity', f.last_at) AS x
          FROM public.profiles p
          LEFT JOIN first_seen f ON f.user_id = p.user_id
          WHERE f.last_at IS NULL OR f.last_at < now() - interval '30 days'
          ORDER BY f.last_at NULLS FIRST LIMIT 50) t), '[]'::jsonb),
      'heavyUsers', COALESCE((SELECT jsonb_agg(x) FROM (
          SELECT jsonb_build_object('userId', user_id, 'name', display_name,
                                    'minutes', round(sum(minutes), 1)) AS x
          FROM sess GROUP BY user_id, display_name
          HAVING sum(minutes) > 600 ORDER BY sum(minutes) DESC LIMIT 20) t), '[]'::jsonb)
    ),
    'options', jsonb_build_object(
      'departments', COALESCE((SELECT jsonb_agg(DISTINCT COALESCE(dept, 'ไม่ระบุ')) FROM base), '[]'::jsonb),
      'devices', COALESCE((SELECT jsonb_agg(DISTINCT device_type) FROM base WHERE device_type IS NOT NULL), '[]'::jsonb),
      'platforms', COALESCE((SELECT jsonb_agg(DISTINCT platform) FROM base WHERE platform IS NOT NULL), '[]'::jsonb),
      'browsers', COALESCE((SELECT jsonb_agg(DISTINCT browser) FROM base WHERE browser IS NOT NULL), '[]'::jsonb),
      'users', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.user_id, 'name', COALESCE(p.display_name, p.email)) ORDER BY COALESCE(p.display_name, p.email)) FROM public.profiles p), '[]'::jsonb),
      'roles', COALESCE((SELECT jsonb_agg(DISTINCT ur.role::text) FROM public.user_roles ur), '[]'::jsonb)
    )
  ) INTO res;

  RETURN res;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_usage_analytics(timestamptz, timestamptz, uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_usage_analytics(timestamptz, timestamptz, uuid, text, text, text, text, text) TO authenticated;