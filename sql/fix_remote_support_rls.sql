-- remote_support_sessions 테이블 RLS 정책 재설정
-- 문제: 중복 정책 및 관리자 INSERT 차단 정책 제거

-- 기존 정책 모두 삭제
DROP POLICY IF EXISTS "Admin cannot insert remote support session" ON remote_support_sessions;
DROP POLICY IF EXISTS "Admin manage remote support" ON remote_support_sessions;
DROP POLICY IF EXISTS "Admin manage remote support sessions" ON remote_support_sessions;
DROP POLICY IF EXISTS "User can create remote support session" ON remote_support_sessions;
DROP POLICY IF EXISTS "User can insert own remote sessions" ON remote_support_sessions;
DROP POLICY IF EXISTS "User can read own remote sessions" ON remote_support_sessions;
DROP POLICY IF EXISTS "User can read own remote support sessions" ON remote_support_sessions;
DROP POLICY IF EXISTS "User cannot update remote support session" ON remote_support_sessions;
DROP POLICY IF EXISTS "User create remote support session" ON remote_support_sessions;
DROP POLICY IF EXISTS "remote_support_sessions_admin_full_access" ON remote_support_sessions;
DROP POLICY IF EXISTS "remote_support_sessions_user_insert" ON remote_support_sessions;
DROP POLICY IF EXISTS "remote_support_sessions_user_own" ON remote_support_sessions;

-- 관리자 정책: 전체 접근 (is_admin() 함수 사용)
CREATE POLICY "remote_support_sessions_admin_full_access" ON remote_support_sessions
  FOR ALL
  TO public
  USING (is_admin());

-- 사용자 정책: 본인 세션 조회
CREATE POLICY "remote_support_sessions_user_select" ON remote_support_sessions
  FOR SELECT
  TO public
  USING (auth.uid() = user_id);

-- 사용자 정책: 본인 세션 생성 (요청 상태만 허용)
CREATE POLICY "remote_support_sessions_user_insert" ON remote_support_sessions
  FOR INSERT
  TO public
  WITH CHECK (auth.uid() = user_id AND status = 'requested');

-- 사용자 정책: 수정 금지
CREATE POLICY "remote_support_sessions_user_no_update" ON remote_support_sessions
  FOR UPDATE
  TO public
  USING (false);

-- 사용자 정책: 삭제 금지
CREATE POLICY "remote_support_sessions_user_no_delete" ON remote_support_sessions
  FOR DELETE
  TO public
  USING (false);
