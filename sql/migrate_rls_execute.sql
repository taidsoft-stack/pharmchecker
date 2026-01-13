-- ========================================
-- STEP 1: 기존 정책 모두 삭제
-- ========================================

-- Service role 정책 삭제
DROP POLICY IF EXISTS "Service role can access all subscriptions" ON user_subscriptions;
DROP POLICY IF EXISTS "Service role can access all payments" ON billing_payments;
DROP POLICY IF EXISTS "Service role can access all payment methods" ON payment_methods;
DROP POLICY IF EXISTS "Service role can access usage stats" ON usage_billing_period_stats;
DROP POLICY IF EXISTS "Service role can access daily stats" ON usage_daily_stats;
DROP POLICY IF EXISTS "Service role can access subscription promotions" ON subscription_promotions;
DROP POLICY IF EXISTS "Service role can access promotions" ON pending_user_promotions;
DROP POLICY IF EXISTS "Service role full access" ON promotion_usage_history;
DROP POLICY IF EXISTS "No direct access for users" ON promotion_usage_history;
DROP POLICY IF EXISTS "Service role can manage subscription plans" ON subscription_plans;
DROP POLICY IF EXISTS "Service role can manage all FAQs" ON faqs;

-- 이미 생성되었을 수 있는 새 정책들도 삭제
DROP POLICY IF EXISTS "Users can view own subscriptions" ON user_subscriptions;
DROP POLICY IF EXISTS "Users can insert own subscriptions" ON user_subscriptions;
DROP POLICY IF EXISTS "Users can update own subscriptions" ON user_subscriptions;
DROP POLICY IF EXISTS "Users can view own payments" ON billing_payments;
DROP POLICY IF EXISTS "Users can insert own payments" ON billing_payments;
DROP POLICY IF EXISTS "Users cannot update payments" ON billing_payments;
DROP POLICY IF EXISTS "Users can view own payment methods" ON payment_methods;
DROP POLICY IF EXISTS "Users can insert own payment methods" ON payment_methods;
DROP POLICY IF EXISTS "Users can update own payment methods" ON payment_methods;
DROP POLICY IF EXISTS "Users can delete own payment methods" ON payment_methods;
DROP POLICY IF EXISTS "Users can view own usage stats" ON usage_billing_period_stats;
DROP POLICY IF EXISTS "Users cannot modify usage stats" ON usage_billing_period_stats;
DROP POLICY IF EXISTS "Users can view own daily stats" ON usage_daily_stats;
DROP POLICY IF EXISTS "Users cannot modify daily stats" ON usage_daily_stats;
DROP POLICY IF EXISTS "Users can view active promotions" ON subscription_promotions;
DROP POLICY IF EXISTS "Users cannot modify promotions" ON subscription_promotions;
DROP POLICY IF EXISTS "Users can view own pending promotions" ON pending_user_promotions;
DROP POLICY IF EXISTS "Users cannot modify pending promotions" ON pending_user_promotions;
DROP POLICY IF EXISTS "Users can view own promotion history" ON promotion_usage_history;
DROP POLICY IF EXISTS "Users cannot modify promotion history" ON promotion_usage_history;
DROP POLICY IF EXISTS "Users cannot modify subscription plans" ON subscription_plans;
DROP POLICY IF EXISTS "Users cannot modify FAQs" ON faqs;
DROP POLICY IF EXISTS "Users cannot insert subscription plans" ON subscription_plans;
DROP POLICY IF EXISTS "Users cannot update subscription plans" ON subscription_plans;
DROP POLICY IF EXISTS "Users cannot delete subscription plans" ON subscription_plans;
DROP POLICY IF EXISTS "Users cannot insert FAQs" ON faqs;
DROP POLICY IF EXISTS "Users cannot update FAQs" ON faqs;
DROP POLICY IF EXISTS "Users cannot delete FAQs" ON faqs;

-- ========================================
-- STEP 2: 새로운 사용자 기반 정책 생성
-- ========================================

-- 1. user_subscriptions
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

-- 2. billing_payments
CREATE POLICY "Users can view own payments"
ON billing_payments FOR SELECT
TO public
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own payments"
ON billing_payments FOR INSERT
TO public
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users cannot update payments"
ON billing_payments FOR UPDATE
TO public
USING (false);

-- 3. payment_methods
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

-- 4. usage_billing_period_stats
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

CREATE POLICY "Users cannot modify usage stats"
ON usage_billing_period_stats FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- 5. usage_daily_stats
CREATE POLICY "Users can view own daily stats"
ON usage_daily_stats FOR SELECT
TO public
USING (auth.uid() = user_id);

CREATE POLICY "Users cannot modify daily stats"
ON usage_daily_stats FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- 6. subscription_promotions
CREATE POLICY "Users can view active promotions"
ON subscription_promotions FOR SELECT
TO public
USING (is_active = true);

CREATE POLICY "Users cannot modify promotions"
ON subscription_promotions FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- 7. pending_user_promotions
CREATE POLICY "Users can view own pending promotions"
ON pending_user_promotions FOR SELECT
TO public
USING (auth.uid() = user_id);

CREATE POLICY "Users cannot modify pending promotions"
ON pending_user_promotions FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- 8. promotion_usage_history
CREATE POLICY "Users can view own promotion history"
ON promotion_usage_history FOR SELECT
TO public
USING (auth.uid() = user_id);

CREATE POLICY "Users cannot modify promotion history"
ON promotion_usage_history FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- 9. subscription_plans (user_id 컬럼 없음 - 공통 리소스)
-- 읽기 정책은 "Anyone can view subscription plans"가 이미 존재하므로 수정 금지만 추가
CREATE POLICY "Users cannot insert subscription plans"
ON subscription_plans FOR INSERT
TO public
WITH CHECK (false);

CREATE POLICY "Users cannot update subscription plans"
ON subscription_plans FOR UPDATE
TO public
USING (false);

CREATE POLICY "Users cannot delete subscription plans"
ON subscription_plans FOR DELETE
TO public
USING (false);

-- 10. faqs (user_id 컬럼 없음 - 공통 리소스)
-- 읽기 정책은 "Anyone can read active FAQs"가 이미 존재하므로 수정 금지만 추가
CREATE POLICY "Users cannot insert FAQs"
ON faqs FOR INSERT
TO public
WITH CHECK (false);

CREATE POLICY "Users cannot update FAQs"
ON faqs FOR UPDATE
TO public
USING (false);

CREATE POLICY "Users cannot delete FAQs"
ON faqs FOR DELETE
TO public
USING (false);
