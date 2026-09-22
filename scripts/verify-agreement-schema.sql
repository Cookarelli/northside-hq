-- Read-only: run against the explicitly selected Northside project.
select n.nspname as schema,c.relname,c.relrowsecurity as rls,
 has_table_privilege('authenticated',c.oid,'INSERT') as employee_insert,
 has_table_privilege('authenticated',c.oid,'UPDATE') as employee_update,
 has_table_privilege('authenticated',c.oid,'DELETE') as employee_delete,
 has_table_privilege('authenticated',c.oid,'TRUNCATE') as employee_truncate
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='private' and c.relname in ('agreement_documents','agreement_assignments','agreement_acceptances');
select to_regprocedure('public.hub_agreement_gate()') as gate,
 to_regprocedure('public.hub_accept_agreement(uuid,text,text,text)') as accept,
 to_regprocedure('public.hub_defer_agreement(uuid)') as forbidden_defer;
select column_default from information_schema.columns where table_schema='private' and table_name='agreement_acceptances' and column_name='accepted_at';
select version,name from supabase_migrations.schema_migrations order by version;
