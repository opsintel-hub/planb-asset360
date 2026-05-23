ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sale';

INSERT INTO public.app_settings (key, value)
VALUES ('role_menu_permissions', '{"manager":["/search","/claims"],"technician":["/search","/claims"],"sale":["/search"]}'::jsonb)
ON CONFLICT (key) DO NOTHING;