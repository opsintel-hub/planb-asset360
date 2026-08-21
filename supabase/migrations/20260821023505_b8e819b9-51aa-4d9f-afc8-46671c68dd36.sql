insert into public.app_settings (key, value)
values ('crm_db_connection', jsonb_build_object('host','117.121.218.84','port',3306,'database','sugarcrm_prod','username','useroperation','view','view_productstatus'))
on conflict (key) do update set value = excluded.value;