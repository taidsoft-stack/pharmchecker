-- 1️⃣ 테이블 + 컬럼 + 코멘트 (auth + public) 쿼리

select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default,
  col_description(
    (table_schema || '.' || table_name)::regclass::oid,
    ordinal_position
  ) as comment
from information_schema.columns
where table_schema in ('public', 'auth')
order by table_schema, table_name, ordinal_position;



--  2️⃣ 함수 / RPC 정의 (auth + public)
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'auth')
order by n.nspname, p.proname;


--3️⃣ RLS 정책 (auth + public)
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname in ('public', 'auth')
order by schemaname, tablename, policyname;


--4️⃣ 인덱스 정의 (auth + public)
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname in ('public', 'auth')
order by schemaname, tablename, indexname;


--6️⃣ 트리거 (auth + public)
select
  event_object_schema as schema,
  event_object_table as table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema in ('public', 'auth')
order by event_object_schema, event_object_table, trigger_name;


-- 모든 함수의 “전체 로직” 조회 (auth + public)
select
  n.nspname        as schema_name,
  p.proname        as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  l.lanname        as language,
  p.prosecdef     as security_definer,
  p.provolatile   as volatility,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname in ('public', 'auth')
order by n.nspname, p.proname;
