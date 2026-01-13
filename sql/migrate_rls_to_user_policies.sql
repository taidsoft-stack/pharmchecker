-- =====================================================
-- RLS 정책 마이그레이션: Service Role → User-based 정책
-- 생성일: 2026-01-12
-- 목적: Service role 의존성 제거, 사용자별 접근 제어 강화
-- =====================================================

-- 1. user_subscriptions 테이블
-- service_role 정책 삭제 및 사용자 정책 추가
DROP POLICY IF EXISTS "Service role can access all subscriptions" ON user_subscriptions;

CREATE POLICY "Users can view own subscriptions"
ON user_subscriptions FOR SELECT
TO public
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions"
ON user_subscriptions FOR INSERT
TO public
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
ON user_subscriptions FOR UPDATE
TO public
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 2. billing_payments 테이블
-- service_role 정책 삭제 및 사용자 정책 추가
DROP POLICY IF EXISTS "Service role can access all payments" ON billing_payments;

CREATE POLICY "Users can view own payments"
ON billing_payments FOR SELECT
TO public
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own payments"
ON billing_payments FOR INSERT
TO public
WITH CHECK (auth.uid() = user_id);

-- 결제는 시스템에서만 업데이트하므로 UPDATE 정책은 제한적으로
CREATE POLICY "Users cannot update payments"
ON billing_payments FOR UPDATE
TO public
USING (false);

-- 3. payment_methods 테이블
-- service_role 정책 삭제 및 사용자 정책 추가
DROP POLICY IF EXISTS "Service role can access all payment methods" ON payment_methods;

CREATE POLICY "Users can view own payment methods"
ON payment_methods FOR SELECT
TO public
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own payment methods"
ON payment_methods FOR INSERT
TO public
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own payment methods"
ON payment_methods FOR UPDATE
TO public
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own payment methods"
ON payment_methods FOR DELETE
TO public
USING (auth.uid() = user_id);

-- 4. usage_billing_period_stats 테이블
-- service_role 정책 삭제 및 사용자 정책 추가
DROP POLICY IF EXISTS "Service role can access usage stats" ON usage_billing_period_stats;

CREATE POLICY "Users can view own usage stats"
ON usage_billing_period_stats FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1 FROM user_subscriptions us
    WHERE us.subscription_id = usage_billing_period_stats.subscription_id
    AND us.user_id = auth.uid()
  )
);

-- 사용량 통계는 시스템에서만 생성/수정
CREATE POLICY "Users cannot modify usage stats"
ON usage_billing_period_stats FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- 5. usage_daily_stats 테이블
-- service_role 정책 삭제 및 사용자 정책 추가
DROP POLICY IF EXISTS "Service role can access daily stats" ON usage_daily_stats;

CREATE POLICY "Users can view own daily stats"
ON usage_daily_stats FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1 FROM user_subscriptions us
    WHERE us.subscription_id = usage_daily_stats.subscription_id
    AND us.user_id = auth.uid()
  )
);

-- 일일 통계는 시스템에서만 생성/수정
CREATE POLICY "Users cannot modify daily stats"
ON usage_daily_stats FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- 6. subscription_promotions 테이블
-- service_role 정책 삭제, 사용자는 읽기만 가능
DROP POLICY IF EXISTS "Service role can access subscription promotions" ON subscription_promotions;

CREATE POLICY "Users can view active promotions"
ON subscription_promotions FOR SELECT
TO public
USING (is_active = true);

CREATE POLICY "Users cannot modify promotions"
ON subscription_promotions FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- 7. pending_user_promotions 테이블
-- service_role 정책 삭제, 사용자는 본인 프로모션만 조회
DROP POLICY IF EXISTS "Service role can access promotions" ON pending_user_promotions;

CREATE POLICY "Users can view own pending promotions"
ON pending_user_promotions FOR SELECT
TO public
USING (auth.uid() = user_id);

CREATE POLICY "Users cannot modify pending promotions"
ON pending_user_promotions FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- 8. promotion_usage_history 테이블
-- service_role 정책 삭제, 사용자는 본인 히스토리만 조회
DROP POLICY IF EXISTS "Service role full access" ON promotion_usage_history;
DROP POLICY IF EXISTS "No direct access for users" ON promotion_usage_history;

CREATE POLICY "Users can view own promotion history"
ON promotion_usage_history FOR SELECT
TO public
USING (auth.uid() = user_id);

CREATE POLICY "Users cannot modify promotion history"
ON promotion_usage_history FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- 9. subscription_plans 테이블
-- service_role 정책 삭제, 모든 사용자는 활성 플랜 조회 가능
DROP POLICY IF EXISTS "Service role can manage subscription plans" ON subscription_plans;

-- "Anyone can view subscription plans" 정책은 유지 (이미 존재)
-- 사용자는 플랜을 수정할 수 없음
CREATE POLICY "Users cannot modify subscription plans"
ON subscription_plans FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- 10. faqs 테이블
-- service_role 정책 삭제
DROP POLICY IF EXISTS "Service role can manage all FAQs" ON faqs;

-- "Anyone can read active FAQs" 정책은 유지 (이미 존재)
-- 사용자는 FAQ를 수정할 수 없음
CREATE POLICY "Users cannot modify FAQs"
ON faqs FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- =====================================================
-- 검증 쿼리
-- =====================================================
-- 아래 쿼리로 정책이 올바르게 적용되었는지 확인
/*
SELECT schemaname, tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE tablename IN (
  'user_subscriptions',
  'billing_payments', 
  'payment_methods',
  'usage_billing_period_stats',
  'usage_daily_stats',
  'subscription_promotions',
  'pending_user_promotions',
  'promotion_usage_history',
  'subscription_plans',
  'faqs'
)
ORDER BY tablename, policyname;
*/
