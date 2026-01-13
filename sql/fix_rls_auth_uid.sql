-- RLS 정책 수정: auth.uid() = user_id로 변경
-- public.users.user_id는 auth.users.id와 동일하므로, email 매칭 불필요

-- 1. user_subscriptions 정책 재생성
DROP POLICY IF EXISTS "user_subscriptions_select_own" ON user_subscriptions;
DROP POLICY IF EXISTS "user_subscriptions_insert_own" ON user_subscriptions;
DROP POLICY IF EXISTS "user_subscriptions_update_own" ON user_subscriptions;

CREATE POLICY "user_subscriptions_select_own" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_subscriptions_insert_own" ON user_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_subscriptions_update_own" ON user_subscriptions
  FOR UPDATE USING (auth.uid() = user_id);

-- 2. billing_payments 정책 재생성
DROP POLICY IF EXISTS "billing_payments_select_own" ON billing_payments;

CREATE POLICY "billing_payments_select_own" ON billing_payments
  FOR SELECT USING (auth.uid() = user_id);

-- 3. payment_methods 정책 재생성
DROP POLICY IF EXISTS "payment_methods_select_own" ON payment_methods;
DROP POLICY IF EXISTS "payment_methods_insert_own" ON payment_methods;
DROP POLICY IF EXISTS "payment_methods_update_own" ON payment_methods;
DROP POLICY IF EXISTS "payment_methods_delete_own" ON payment_methods;

CREATE POLICY "payment_methods_select_own" ON payment_methods
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "payment_methods_insert_own" ON payment_methods
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "payment_methods_update_own" ON payment_methods
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "payment_methods_delete_own" ON payment_methods
  FOR DELETE USING (auth.uid() = user_id);

-- 4. usage_billing_period_stats 정책 재생성
DROP POLICY IF EXISTS "usage_billing_period_stats_select_own" ON usage_billing_period_stats;

CREATE POLICY "usage_billing_period_stats_select_own" ON usage_billing_period_stats
  FOR SELECT USING (
    auth.uid() IN (
      SELECT user_id FROM user_subscriptions WHERE subscription_id = usage_billing_period_stats.subscription_id
    )
  );

-- 5. usage_daily_stats 정책 재생성
DROP POLICY IF EXISTS "usage_daily_stats_select_own" ON usage_daily_stats;

CREATE POLICY "usage_daily_stats_select_own" ON usage_daily_stats
  FOR SELECT USING (auth.uid() = user_id);

-- 6. users 정책 추가 (본인 정보만 조회 가능)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;

CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (auth.uid() = user_id);

COMMENT ON POLICY "users_select_own" ON users IS '사용자는 본인의 정보만 조회 가능';
COMMENT ON POLICY "users_update_own" ON users IS '사용자는 본인의 정보만 수정 가능';
