/**
 * PharmChecker 자동결제 스케줄러
 * 
 * 실행 시각: 매일 오전 1시 (구독 종료일 다음날)
 * 기능: current_period_end가 지난 active 구독을 자동 결제
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const got = require('got');
const { v4: uuidv4 } = require('uuid');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY;

/**
 * 구독 기간 계산 (시분초 제거, 자정~23:59:59)
 */
function calculateNextPeriod(currentEndDate) {
  const prevEnd = new Date(currentEndDate);
  
  // 시작일: 이전 종료일의 다음날 자정
  const newPeriodStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() + 1, 0, 0, 0, 0);
  
  // 종료일: 다음달 같은 날짜 23:59:59 (월말 처리 포함)
  const nextMonth = new Date(newPeriodStart.getFullYear(), newPeriodStart.getMonth() + 1, newPeriodStart.getDate(), 23, 59, 59, 999);
  
  // 월말 처리: 1/31 → 2/28(29), 3/31 → 4/30
  if (nextMonth.getDate() !== newPeriodStart.getDate()) {
    nextMonth.setDate(0); // 이전 달 마지막날
    nextMonth.setHours(23, 59, 59, 999);
  }
  
  return {
    start: newPeriodStart,
    end: nextMonth
  };
}

/**
 * 사용량 기반 플랜 자동 결정
 */
async function determineOptimalPlan(subscriptionId, periodStart) {
  // 이번 결제 주기 사용량 조회
  const { data: usageStats } = await supabase
    .from('usage_billing_period_stats')
    .select('total_rx_count')
    .eq('subscription_id', subscriptionId)
    .eq('period_start', periodStart)
    .single();

  const totalRxCount = usageStats?.total_rx_count || 0;

  // 모든 활성 플랜 조회 (가격 오름차순)
  const { data: allPlans } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('monthly_price', { ascending: true });

  let selectedPlan = allPlans[0]; // 기본값: 가장 저렴한 플랜

  // 사용량에 맞는 최적 플랜 찾기
  for (const plan of allPlans) {
    if (plan.daily_rx_limit === null || plan.daily_rx_limit >= 999999) {
      // 무제한 플랜
      selectedPlan = plan;
      break;
    } else if (totalRxCount <= plan.daily_rx_limit * 30) {
      // 월간 사용량이 플랜 한도 안에 들어오면 선택
      selectedPlan = plan;
      break;
    }
  }

  return { selectedPlan, totalRxCount };
}

/**
 * 토스 페이먼츠 자동결제 실행
 */
async function executeRecurringPayment(subscription, paymentMethod, plan, userId) {
  const encryptedSecretKey = "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");
  const orderId = 'REC_' + userId.substring(0, 8) + '_' + Date.now();
  
  try {
    const paymentResponse = await got.post(`https://api.tosspayments.com/v1/billing/${paymentMethod.billing_key}`, {
      headers: {
        Authorization: encryptedSecretKey,
        "Content-Type": "application/json",
      },
      json: {
        customerKey: subscription.customer_key,
        amount: plan.monthly_price,
        orderId: orderId,
        orderName: `PharmChecker ${plan.plan_name} 플랜 (정기결제)`,
        customerEmail: '',
        customerName: '',
      },
      responseType: "json",
    });

    return {
      success: true,
      payment: paymentResponse.body,
      orderId
    };
  } catch (error) {
    console.error(`결제 실패 [${userId}]:`, error.response?.body || error.message);
    return {
      success: false,
      error: error.response?.body || error,
      orderId
    };
  }
}

/**
 * 메인 스케줄러 실행 함수
 */
async function runRecurringBillingScheduler() {
  console.log('\n========================================');
  console.log('자동결제 스케줄러 시작:', new Date().toISOString());
  console.log('========================================\n');

  try {
    // 오늘 자정 (오전 1시 실행이므로 어제 날짜의 23:59:59가 종료일)
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 23, 59, 59, 999);

    console.log('결제 대상 조회 기준 시각:', yesterday.toISOString());

    // current_period_end가 어제 자정(23:59:59) 이하인 active 구독 조회
    const { data: subscriptions, error } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('status', 'active')
      .lte('current_period_end', yesterday.toISOString());

    if (error) {
      throw error;
    }

    console.log(`결제 대상 구독: ${subscriptions?.length || 0}건\n`);

    if (!subscriptions || subscriptions.length === 0) {
      console.log('결제할 구독이 없습니다.');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    // 각 구독에 대해 자동결제 실행
    for (const subscription of subscriptions) {
      console.log(`\n----- 처리 중: ${subscription.user_id} -----`);

      try {
        // 1. 결제수단 조회
        const { data: paymentMethod } = await supabase
          .from('payment_methods')
          .select('*')
          .eq('payment_method_id', subscription.payment_method_id)
          .is('disabled_at', null)
          .single();

        if (!paymentMethod) {
          console.error('유효한 결제수단 없음');
          failCount++;
          continue;
        }

        // 2. 사용량 기반 플랜 결정
        const { selectedPlan, totalRxCount } = await determineOptimalPlan(
          subscription.subscription_id,
          subscription.current_period_start
        );

        console.log(`사용량: ${totalRxCount}건 → 플랜: ${selectedPlan.plan_name} (${selectedPlan.monthly_price}원)`);

        // 3. 자동결제 실행
        const paymentResult = await executeRecurringPayment(
          subscription,
          paymentMethod,
          selectedPlan,
          subscription.user_id
        );

        if (paymentResult.success) {
          // 4. 결제 성공 - 결제 기록 저장
          await supabase
            .from('billing_payments')
            .insert({
              payment_id: uuidv4(),
              subscription_id: subscription.subscription_id,
              user_id: subscription.user_id,
              order_id: paymentResult.orderId,
              payment_key: paymentResult.payment.paymentKey,
              billing_key: paymentMethod.billing_key,
              payment_method_id: paymentMethod.payment_method_id,
              amount: selectedPlan.monthly_price,
              status: 'success',
              requested_at: new Date().toISOString(),
              approved_at: new Date().toISOString(),
            });

          // 5. 구독 기간 갱신
          const newPeriod = calculateNextPeriod(subscription.current_period_end);

          await supabase
            .from('user_subscriptions')
            .update({
              billing_plan_id: selectedPlan.plan_id,
              current_period_start: newPeriod.start.toISOString(),
              current_period_end: newPeriod.end.toISOString(),
              is_first_billing: false,
              failed_at: null,  // 실패 기록 초기화
              grace_until: null,
              updated_at: new Date().toISOString(),
            })
            .eq('subscription_id', subscription.subscription_id);

          console.log(`✅ 결제 성공: ${selectedPlan.monthly_price}원`);
          console.log(`   다음 결제일: ${newPeriod.end.toISOString()}`);
          successCount++;

        } else {
          // 6. 결제 실패 - 7일 유예기간 설정
          const failedAt = new Date();
          const graceUntil = new Date(failedAt);
          graceUntil.setDate(graceUntil.getDate() + 7);

          await supabase
            .from('user_subscriptions')
            .update({
              status: 'failed',
              failed_at: failedAt.toISOString(),
              grace_until: graceUntil.toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('subscription_id', subscription.subscription_id);

          // 실패 기록 저장
          await supabase
            .from('billing_payments')
            .insert({
              payment_id: uuidv4(),
              subscription_id: subscription.subscription_id,
              user_id: subscription.user_id,
              order_id: paymentResult.orderId,
              billing_key: paymentMethod.billing_key,
              payment_method_id: paymentMethod.payment_method_id,
              amount: 0,
              status: 'failed',
              fail_reason: paymentResult.error?.message || '알 수 없는 오류',
              requested_at: new Date().toISOString(),
            });

          console.error(`❌ 결제 실패: ${paymentResult.error?.message}`);
          console.error(`   유예기간: ${graceUntil.toISOString()}까지`);
          failCount++;
        }

      } catch (error) {
        console.error(`처리 중 오류:`, error);
        failCount++;
      }
    }

    console.log('\n========================================');
    console.log('자동결제 스케줄러 완료');
    console.log(`성공: ${successCount}건 / 실패: ${failCount}건`);
    console.log('========================================\n');

  } catch (error) {
    console.error('스케줄러 실행 오류:', error);
    throw error;
  }
}

// 직접 실행 시
if (require.main === module) {
  runRecurringBillingScheduler()
    .then(() => {
      console.log('스케줄러 종료');
      process.exit(0);
    })
    .catch((error) => {
      console.error('스케줄러 에러:', error);
      process.exit(1);
    });
}

module.exports = { runRecurringBillingScheduler };
