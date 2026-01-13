-- public.users 테이블에 auth_user_id 컬럼 추가
-- Supabase Auth의 auth.users.id와 연결하기 위한 컬럼

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id);

-- 기존 users의 email과 auth.users의 email을 매칭하여 auth_user_id 채우기
-- (이미 가입한 사용자들을 위한 마이그레이션)
UPDATE public.users AS u
SET auth_user_id = au.id
FROM auth.users AS au
WHERE u.email = au.email
AND u.auth_user_id IS NULL;

-- auth_user_id에 유니크 제약 추가 (한 명의 Supabase Auth 사용자는 한 명의 약사만 가능)
ALTER TABLE public.users
ADD CONSTRAINT users_auth_user_id_key UNIQUE (auth_user_id);

-- 인덱스 추가 (성능 향상)
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.users(auth_user_id);

COMMENT ON COLUMN public.users.auth_user_id IS 'Supabase Auth 사용자 ID (auth.users.id와 연결)';
