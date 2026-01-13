-- RLS 정책에 관리자 예외 추가
-- 관리자(admins 테이블에 등록된 사용자)는 모든 데이터에 접근 가능

-- 헬퍼 함수: 현재 사용자가 관리자인지 확인
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admins
    WHERE admin_id = auth.uid()
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.is_admin() IS '현재 로그인한 사용자가 활성 관리자인지 확인';

-- 1. users 테이블: 관리자 전체 접근
DROP POLICY IF EXISTS "users_admin_full_access" ON users;
CREATE POLICY "users_admin_full_access" ON users
  FOR ALL USING (is_admin());

-- 2. user_subscriptions 테이블: 관리자 전체 접근
DROP POLICY IF EXISTS "user_subscriptions_admin_full_access" ON user_subscriptions;
CREATE POLICY "user_subscriptions_admin_full_access" ON user_subscriptions
  FOR ALL USING (is_admin());

-- 3. billing_payments 테이블: 관리자 전체 접근
DROP POLICY IF EXISTS "billing_payments_admin_full_access" ON billing_payments;
CREATE POLICY "billing_payments_admin_full_access" ON billing_payments
  FOR ALL USING (is_admin());

-- 4. payment_methods 테이블: 관리자 전체 접근
DROP POLICY IF EXISTS "payment_methods_admin_full_access" ON payment_methods;
CREATE POLICY "payment_methods_admin_full_access" ON payment_methods
  FOR ALL USING (is_admin());

-- 5. usage_billing_period_stats 테이블: 관리자 전체 접근
DROP POLICY IF EXISTS "usage_billing_period_stats_admin_full_access" ON usage_billing_period_stats;
CREATE POLICY "usage_billing_period_stats_admin_full_access" ON usage_billing_period_stats
  FOR ALL USING (is_admin());

-- 6. usage_daily_stats 테이블: 관리자 전체 접근
DROP POLICY IF EXISTS "usage_daily_stats_admin_full_access" ON usage_daily_stats;
CREATE POLICY "usage_daily_stats_admin_full_access" ON usage_daily_stats
  FOR ALL USING (is_admin());

-- 7. support_tickets 테이블: 관리자 전체 접근
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_tickets_admin_full_access" ON support_tickets;
CREATE POLICY "support_tickets_admin_full_access" ON support_tickets
  FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "support_tickets_user_own" ON support_tickets;
CREATE POLICY "support_tickets_user_own" ON support_tickets
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "support_tickets_user_insert" ON support_tickets;
CREATE POLICY "support_tickets_user_insert" ON support_tickets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 8. remote_support_sessions 테이블: 관리자 전체 접근
ALTER TABLE remote_support_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "remote_support_sessions_admin_full_access" ON remote_support_sessions;
CREATE POLICY "remote_support_sessions_admin_full_access" ON remote_support_sessions
  FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "remote_support_sessions_user_own" ON remote_support_sessions;
CREATE POLICY "remote_support_sessions_user_own" ON remote_support_sessions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "remote_support_sessions_user_insert" ON remote_support_sessions;
CREATE POLICY "remote_support_sessions_user_insert" ON remote_support_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- faqs 테이블: 관리자만 수정 가능
DROP POLICY IF EXISTS "faqs_admin_manage" ON faqs;
CREATE POLICY "faqs_admin_manage" ON faqs
  FOR ALL USING (is_admin());

-- subscription_plans 테이블: 관리자만 수정 가능
DROP POLICY IF EXISTS "subscription_plans_admin_manage" ON subscription_plans;
CREATE POLICY "subscription_plans_admin_manage" ON subscription_plans
  FOR ALL USING (is_admin());

-- subscription_promotions 테이블: 관리자만 수정 가능
DROP POLICY IF EXISTS "subscription_promotions_admin_manage" ON subscription_promotions;
CREATE POLICY "subscription_promotions_admin_manage" ON subscription_promotions
  FOR ALL USING (is_admin());

-- referral_codes 테이블: 관리자만 수정 가능
DROP POLICY IF EXISTS "referral_codes_admin_manage" ON referral_codes;
CREATE POLICY "referral_codes_admin_manage" ON referral_codes
  FOR ALL USING (is_admin());

-- pending_user_promotions 테이블: 관리자만 수정 가능
DROP POLICY IF EXISTS "pending_user_promotions_admin_manage" ON pending_user_promotions;
CREATE POLICY "pending_user_promotions_admin_manage" ON pending_user_promotions
  FOR ALL USING (is_admin());

-- promotion_usage_history 테이블: 관리자만 수정 가능
DROP POLICY IF EXISTS "promotion_usage_history_admin_manage" ON promotion_usage_history;
CREATE POLICY "promotion_usage_history_admin_manage" ON promotion_usage_history
  FOR ALL USING (is_admin());

-- admin_user_memos 테이블: 관리자만 수정 가능
DROP POLICY IF EXISTS "admin_user_memos_admin_manage" ON admin_user_memos;
ALTER TABLE admin_user_memos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_user_memos_admin_manage" ON admin_user_memos
  FOR ALL USING (is_admin());

-- admins 테이블: 본인 정보 조회 가능
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_select_own" ON admins;
CREATE POLICY "admins_select_own" ON admins
  FOR SELECT USING (auth.uid() = admin_id);

COMMENT ON POLICY "admins_select_own" ON admins IS '관리자는 본인 정보만 조회 가능';

-- 완료 메시지
DO $$
BEGIN
  RAISE NOTICE '✅ 관리자 RLS 정책 추가 완료';
  RAISE NOTICE '✅ is_admin() 함수 생성 완료';
  RAISE NOTICE '✅ 관리자는 이제 모든 테이블에 접근 가능합니다';
END $$;
