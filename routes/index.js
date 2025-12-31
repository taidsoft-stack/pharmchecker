const express = require("express");
const got = require("got");
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');

// 토스페이먼츠 시크릿 키 (환경 변수에서 로드)
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || 'test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R';

const router = express.Router();

// 첫 화면 - 세션 체크 후 라우팅
router.get('/', function (req, res) {
  // 클라이언트 사이드에서 세션 체크하도록 임시 페이지 렌더링
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>PharmChecker</title>
    </head>
    <body>
      <script>
        const user = JSON.parse(sessionStorage.getItem('user') || '{}');
        if (user.userId) {
          window.location.href = '/pharmchecker';
        } else {
          window.location.href = '/login';
        }
      </script>
    </body>
    </html>
  `);
});

// 로그인 페이지
router.get('/login', function (req, res) {
  res.render('login');
});

// 회원가입 페이지
router.get('/join', function (req, res) {
  res.render('join');
});

// 회원가입 API
router.post('/api/signup', async function (req, res) {
  try {
    const {
      email,
      pharmacistName,
      pharmacistPhone,
      businessNumber,
      pharmacyName,
      pharmacyPhone,
      postcode,
      address,
      detailAddress,
      googlePicture
    } = req.body;

    // 필수 필드 검증
    if (!email || !pharmacistName || !pharmacistPhone || !businessNumber || 
        !pharmacyName || !pharmacyPhone || !postcode || !address) {
      return res.status(400).json({
        success: false,
        message: '모든 필수 항목을 입력해주세요.'
      });
    }

    // 이메일 중복 체크
    const { data: existingEmail } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .single();

    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: '이미 가입된 이메일입니다.'
      });
    }

    // 사업자 번호 중복 체크
    const { data: existingBusiness } = await supabase
      .from('users')
      .select('business_number')
      .eq('business_number', businessNumber)
      .single();

    if (existingBusiness) {
      return res.status(409).json({
        success: false,
        message: '이미 등록된 사업자 번호입니다.'
      });
    }

    // UUID 생성
    const userId = uuidv4();

    // 사용자 데이터 삽입
    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          user_id: userId,
          email: email,
          pharmacist_name: pharmacistName,
          pharmacist_phone: pharmacistPhone,
          business_number: businessNumber,
          pharmacy_name: pharmacyName,
          pharmacy_phone: pharmacyPhone,
          postcode: postcode,
          address: address,
          detail_address: detailAddress || null,
          google_picture: googlePicture || null,
          is_active: true
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('회원가입 DB 에러:', error);
      return res.status(500).json({
        success: false,
        message: '회원가입 중 오류가 발생했습니다.',
        error: error.message
      });
    }

    // 회원가입 성공
    res.status(201).json({
      success: true,
      message: '회원가입이 완료되었습니다.',
      data: {
        userId: data.user_id,
        email: data.email,
        pharmacistName: data.pharmacist_name,
        pharmacyName: data.pharmacy_name
      }
    });

  } catch (error) {
    console.error('회원가입 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// 이메일 중복 확인 API
router.get('/api/check-email/:email', async function (req, res) {
  try {
    const { email } = req.params;

    const { data } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .single();

    res.json({
      exists: !!data,
      message: data ? '이미 사용 중인 이메일입니다.' : '사용 가능한 이메일입니다.'
    });
  } catch (error) {
    res.status(500).json({
      exists: false,
      message: '이메일 확인 중 오류가 발생했습니다.'
    });
  }
});

// 사업자 번호 중복 확인 API
router.get('/api/check-business/:businessNumber', async function (req, res) {
  try {
    const { businessNumber } = req.params;

    const { data } = await supabase
      .from('users')
      .select('business_number')
      .eq('business_number', businessNumber)
      .single();

    res.json({
      exists: !!data,
      message: data ? '이미 등록된 사업자 번호입니다.' : '사용 가능한 사업자 번호입니다.'
    });
  } catch (error) {
    res.status(500).json({
      exists: false,
      message: '사업자 번호 확인 중 오류가 발생했습니다.'
    });
  }
});

// 로그인 API
router.post('/api/login', async function (req, res) {
  try {
    const { email } = req.body;

    // 이메일 검증
    if (!email) {
      return res.status(400).json({
        success: false,
        message: '이메일을 입력해주세요.'
      });
    }

    // 사용자 조회
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('is_active', true)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: '등록되지 않은 이메일입니다. 회원가입을 먼저 진행해주세요.'
      });
    }

    // 로그인 성공
    res.status(200).json({
      success: true,
      message: '로그인에 성공했습니다.',
      data: {
        userId: user.user_id,
        email: user.email,
        pharmacistName: user.pharmacist_name,
        pharmacyName: user.pharmacy_name,
        googlePicture: user.google_picture
      }
    });

  } catch (error) {
    console.error('로그인 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// 구독 플랜 목록 조회 API
router.get('/api/subscription/plans', async function (req, res) {
  try {
    const { data: plans, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('monthly_price', { ascending: true });

    if (error) {
      console.error('플랜 조회 에러:', error);
      return res.status(500).json({
        success: false,
        message: '플랜 정보를 불러오는데 실패했습니다.',
        error: error.message
      });
    }

    res.status(200).json({
      success: true,
      data: plans
    });

  } catch (error) {
    console.error('플랜 조회 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// 사용자 구독 상태 조회 API
router.get('/api/subscription/status', async function (req, res) {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId가 필요합니다.'
      });
    }

    // 활성 구독 조회
    const { data: subscription } = await supabase
      .from('user_subscriptions')
      .select(`
        *,
        subscription_plans:entry_plan_id (
          plan_name,
          monthly_price,
          daily_rx_limit
        ),
        billing_plans:billing_plan_id (
          plan_name,
          monthly_price,
          daily_rx_limit
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!subscription) {
      return res.status(200).json({
        success: true,
        hasSubscription: false,
        message: '활성 구독이 없습니다.'
      });
    }

    res.status(200).json({
      success: true,
      hasSubscription: true,
      data: {
        subscriptionId: subscription.subscription_id,
        status: subscription.status,
        entryPlan: subscription.subscription_plans,
        billingPlan: subscription.billing_plans,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        isFirstBilling: subscription.is_first_billing,
      }
    });

  } catch (error) {
    console.error('구독 상태 조회 에러:', error);
    res.status(500).json({
      success: false,
      message: '구독 상태 조회에 실패했습니다.',
      error: error.message
    });
  }
});

// 구독 취소 API
router.post('/api/subscription/cancel', async function (req, res) {
  try {
    const { userId, reason } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId가 필요합니다.'
      });
    }

    // 활성 구독 조회
    const { data: subscription } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: '활성 구독을 찾을 수 없습니다.'
      });
    }

    // 구독 상태를 'cancelled'로 변경
    await supabase
      .from('user_subscriptions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('subscription_id', subscription.subscription_id);

    // TODO: 토스페이먼츠에는 빌링키 삭제 API가 없으므로, 
    // DB에서만 상태 변경하고 빌링키는 보관 (재구독 시 재사용 가능)

    res.status(200).json({
      success: true,
      message: '구독이 취소되었습니다. 현재 결제 기간이 끝나면 자동결제가 중지됩니다.'
    });

  } catch (error) {
    console.error('구독 취소 에러:', error);
    res.status(500).json({
      success: false,
      message: '구독 취소에 실패했습니다.',
      error: error.message
    });
  }
});

// 구독 플랜 선택 페이지
router.get('/subscription/plans', function (req, res) {
  res.render('subscription-plans');
});

// 구독 결제 페이지
router.get('/subscription/payment', function (req, res) {
  res.render('subscription-payment', {
    tossClientKey: process.env.TOSS_CLIENT_KEY || 'test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq'
  });
});

// 자동결제 카드 등록 성공 처리 (빌링키 발급)
router.get('/subscription/billing-success', async function (req, res) {
  try {
    const { authKey, customerKey, planId, userId, amount } = req.query;

    console.log('빌링키 발급 시작:', { authKey, customerKey, planId, userId, amount });

    // ===== 1단계: 중복 구독 확인 (이미 활성 구독이 있으면 에러) =====
    const { data: existingSubscription } = await supabase
      .from('user_subscriptions')
      .select('subscription_id, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (existingSubscription) {
      console.warn('이미 활성 구독이 있음:', existingSubscription.subscription_id);
      return res.redirect('/subscription/payment-fail?message=' + encodeURIComponent('이미 구독 중입니다. 구독 관리 페이지에서 확인하세요.'));
    }

    // 토스페이먼츠 시크릿 키 인코딩
    const encryptedSecretKey = "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");

    // ===== 2단계: authKey로 빌링키 발급 =====
    const billingResponse = await got.post('https://api.tosspayments.com/v1/billing/authorizations/issue', {
      headers: {
        Authorization: encryptedSecretKey,
        "Content-Type": "application/json",
      },
      json: {
        authKey: authKey,
        customerKey: customerKey,
      },
      responseType: "json",
    });

    const billingData = billingResponse.body;
    const billingKey = billingData.billingKey;
    
    // 토스 페이먼츠 API 응답 전체 로그 (카드 정보 구조 확인용)
    console.log('빌링키 발급 응답 전체:', JSON.stringify(billingData, null, 2));
    
    // 카드사 정보 추출 (issuerCode 또는 acquirerCode 사용)
    const cardCompany = billingData.card?.company || billingData.card?.issuerCode || null;
    const cardLast4 = billingData.cardNumber || billingData.card?.number?.slice(-4) || null;

    console.log('빌링키 발급 성공:', { billingKey, cardCompany, cardLast4, cardObject: billingData.card });

    // ===== 3단계: 빌링키로 첫 결제 승인 =====
    const orderId = 'SUB_' + userId.substring(0, 8) + '_' + Date.now();
    
    // 플랜 정보 조회
    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('plan_id', planId)
      .single();

    const paymentResponse = await got.post(`https://api.tosspayments.com/v1/billing/${billingKey}`, {
      headers: {
        Authorization: encryptedSecretKey,
        "Content-Type": "application/json",
      },
      json: {
        customerKey: customerKey,
        amount: parseInt(amount),
        orderId: orderId,
        orderName: `PharmChecker ${plan.plan_name} 플랜 (첫 달)`,
        customerEmail: '',
        customerName: '',
      },
      responseType: "json",
    });

    const payment = paymentResponse.body;

    console.log('첫 결제 승인 성공:', { paymentKey: payment.paymentKey, orderId });

    // ===== 4단계: payment_methods에 카드 정보 저장 =====
    const paymentMethodId = uuidv4();
    await supabase
      .from('payment_methods')
      .insert({
        payment_method_id: paymentMethodId,
        user_id: userId,
        billing_key: billingKey,
        card_company: cardCompany,
        card_last4: cardLast4,
        is_default: true,  // 첫 카드는 기본 결제수단
      });

    // ===== 5단계: 구독 기간 계산 (시분초 제거, 자정~23:59:59) =====
    const now = new Date();
    
    // 시작일: 오늘 자정 (00:00:00)
    const currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    
    // 종료일: 다음달 같은 날짜의 23:59:59 (월말 처리 포함)
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate(), 23, 59, 59, 999);
    
    // 월말 처리: 1/31 → 2/28(29), 3/31 → 4/30 등
    if (nextMonth.getDate() !== now.getDate()) {
      // 다음달에 해당 날짜가 없으면 (예: 1/31 → 3/3이 되는 경우)
      // 해당 월의 마지막 날로 설정
      nextMonth.setDate(0); // 전달 마지막날
      nextMonth.setHours(23, 59, 59, 999);
    }
    const currentPeriodEnd = nextMonth;

    const subscriptionId = uuidv4();

    // ===== 6단계: user_subscriptions 테이블에 구독 생성 =====
    await supabase
      .from('user_subscriptions')
      .insert({
        subscription_id: subscriptionId,
        user_id: userId,
        entry_plan_id: planId,        // 최초 선택 플랜 (변경 안됨)
        billing_plan_id: planId,       // 현재 결제 플랜 (사용량에 따라 변경됨)
        status: 'active',
        payment_method_id: paymentMethodId,  // 결제수단 참조
        customer_key: customerKey,
        current_period_start: currentPeriodStart.toISOString(),
        current_period_end: currentPeriodEnd.toISOString(),
        is_first_billing: true,
      });

    // ===== 7단계: 결제 기록 저장 =====
    await supabase
      .from('billing_payments')
      .insert({
        payment_id: uuidv4(),
        subscription_id: subscriptionId,
        user_id: userId,
        order_id: orderId,
        payment_key: payment.paymentKey,
        billing_key: billingKey,
        payment_method_id: paymentMethodId,
        amount: parseInt(amount),
        status: 'success',
        requested_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
      });

    console.log('신규 구독 생성 완료:', subscriptionId);

    // 성공 페이지로 리다이렉트
    res.redirect(`/subscription/complete?planName=${encodeURIComponent(plan.plan_name)}&amount=${amount}`);

  } catch (error) {
    console.error('빌링키 발급 또는 결제 실패:', error.response?.body || error);
    res.redirect('/subscription/payment-fail?message=' + encodeURIComponent(error.message));
  }
});

// 구독 결제 실패 처리
router.get('/subscription/payment-fail', function (req, res) {
  const message = req.query.message || '결제에 실패했습니다.';
  res.send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>결제 실패</title>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 50px; }
        h1 { color: #e74c3c; }
        button { padding: 12px 24px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; margin-top: 20px; }
      </style>
    </head>
    <body>
      <h1>❌ 결제 실패</h1>
      <p>${message}</p>
      <button onclick="window.location.href='/subscription/plans'">플랜 다시 선택하기</button>
    </body>
    </html>
  `);
});

// 구독 완료 페이지
router.get('/subscription/complete', function (req, res) {
  const planName = req.query.planName || '플랜';
  const amount = req.query.amount || '0';
  res.send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>구독 완료</title>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 50px; }
        h1 { color: #27ae60; }
        .info { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 400px; }
        button { padding: 12px 24px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; margin-top: 20px; }
      </style>
    </head>
    <body>
      <h1>✅ 구독이 완료되었습니다!</h1>
      <div class="info">
        <p><strong>플랜:</strong> ${planName}</p>
        <p><strong>결제 금액:</strong> ${parseInt(amount).toLocaleString()}원</p>
        <p><strong>다음 결제일:</strong> 1개월 후 자동결제</p>
      </div>
      <button onclick="window.location.href='/pharmchecker'">메인으로 이동</button>
    </body>
    </html>
  `);
});

// 결제 페이지 (팝업용)
router.get('/payment', function (req, res) {
  res.render('index');
});

// PharmChecker 메인 페이지
router.get('/pharmchecker', function (req, res) {
  res.render('pharmchecker');
});

// 결제 성공 페이지
router.get('/success', function (req, res) {
  res.render('success');
});

// 결제 실패 페이지
router.get('/fail', function (req, res) {
  res.render('fail', {
    code: req.query.code || 'UNKNOWN_ERROR',
    message: req.query.message || '알 수 없는 에러가 발생했습니다.'
  });
});

// 구매 완료 페이지
router.get('/purchase-complete', function (req, res) {
  res.render('purchase-complete');
});

// 매달 자동결제 실행 API (스케줄러에서 호출)
router.post('/api/subscription/recurring-payment', async function (req, res) {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId가 필요합니다.'
      });
    }

    // ===== 1단계: 활성 구독 조회 =====
    const { data: subscription } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: '활성 구독을 찾을 수 없습니다.'
      });
    }

    // payment_method_id로 billingKey 조회
    const { data: paymentMethod } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('payment_method_id', subscription.payment_method_id)
      .is('disabled_at', null)  // 비활성화되지 않은 카드만
      .single();

    if (!paymentMethod) {
      return res.status(404).json({
        success: false,
        message: '유효한 결제수단을 찾을 수 없습니다.'
      });
    }

    // ===== 2단계: 이번 달 사용량 조회 (사용량 기반 플랜 자동 결정) =====
    const currentPeriodStart = new Date(subscription.current_period_start);
    const currentPeriodEnd = new Date(subscription.current_period_end);

    // 이번 결제 기간의 총 처방전 건수 조회
    const { data: usageStats } = await supabase
      .from('usage_billing_period_stats')
      .select('total_rx_count')
      .eq('subscription_id', subscription.subscription_id)
      .eq('period_start', subscription.current_period_start)
      .single();

    const totalRxCount = usageStats?.total_rx_count || 0;

    console.log(`사용자 ${userId} 이번 달 사용량:`, totalRxCount, '건');

    // ===== 3단계: 사용량에 따른 최적 플랜 자동 결정 =====
    // 모든 플랜 조회 (가격 오름차순)
    const { data: allPlans } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('monthly_price', { ascending: true });

    let selectedPlan = allPlans[0]; // 기본값: 가장 저렴한 플랜

    // 사용량에 맞는 플랜 찾기
    for (const plan of allPlans) {
      if (plan.daily_rx_limit === null || plan.daily_rx_limit >= 999999) {
        // 무제한 플랜은 항상 가능
        selectedPlan = plan;
        break;
      } else if (totalRxCount <= plan.daily_rx_limit * 30) {
        // 월간 사용량이 플랜 한도 안에 들어오면 선택
        selectedPlan = plan;
        break;
      }
    }

    console.log(`자동 결정된 플랜: ${selectedPlan.plan_name} (${selectedPlan.monthly_price}원)`);

    // ===== 4단계: 토스페이먼츠 자동결제 승인 =====
    const encryptedSecretKey = "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");
    const orderId = 'REC_' + userId.substring(0, 8) + '_' + Date.now();
    
    const paymentResponse = await got.post(`https://api.tosspayments.com/v1/billing/${paymentMethod.billing_key}`, {
      headers: {
        Authorization: encryptedSecretKey,
        "Content-Type": "application/json",
      },
      json: {
        customerKey: subscription.customer_key,
        amount: selectedPlan.monthly_price,
        orderId: orderId,
        orderName: `PharmChecker ${selectedPlan.plan_name} 플랜 (정기결제)`,
        customerEmail: '',
        customerName: '',
      },
      responseType: "json",
    });

    const payment = paymentResponse.body;

    console.log('자동결제 승인 성공:', { paymentKey: payment.paymentKey, amount: selectedPlan.monthly_price });

    // ===== 5단계: 결제 기록 저장 =====
    await supabase
      .from('billing_payments')
      .insert({
        payment_id: uuidv4(),
        subscription_id: subscription.subscription_id,
        user_id: userId,
        order_id: orderId,
        payment_key: payment.paymentKey,
        billing_key: paymentMethod.billing_key,
        payment_method_id: paymentMethod.payment_method_id,
        amount: selectedPlan.monthly_price,
        status: 'success',
        requested_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
      });

    // ===== 6단계: 구독 기간 갱신 (시분초 제거, 자정~23:59:59) =====
    // 시작일: 이전 종료일의 다음날 자정
    const prevEnd = new Date(subscription.current_period_end);
    const newPeriodStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() + 1, 0, 0, 0, 0);
    
    // 종료일: 다음달 같은 날짜 23:59:59 (월말 처리 포함)
    const nextMonth = new Date(newPeriodStart.getFullYear(), newPeriodStart.getMonth() + 1, newPeriodStart.getDate(), 23, 59, 59, 999);
    
    // 월말 처리: 1/31 → 2/28(29)
    if (nextMonth.getDate() !== newPeriodStart.getDate()) {
      nextMonth.setDate(0); // 이전 달 마지막날
      nextMonth.setHours(23, 59, 59, 999);
    }
    const newPeriodEnd = nextMonth;

    await supabase
      .from('user_subscriptions')
      .update({
        billing_plan_id: selectedPlan.plan_id,  // 사용량 기반으로 플랜 자동 변경
        current_period_start: newPeriodStart.toISOString(),
        current_period_end: newPeriodEnd.toISOString(),
        is_first_billing: false,
        updated_at: new Date().toISOString(),
      })
      .eq('subscription_id', subscription.subscription_id);

    console.log('구독 업데이트 완료: billing_plan_id =', selectedPlan.plan_id);

    res.status(200).json({
      success: true,
      message: '자동결제가 완료되었습니다.',
      data: {
        orderId: orderId,
        previousPlan: subscription.billing_plan_id,
        newPlan: selectedPlan.plan_id,
        planName: selectedPlan.plan_name,
        amount: selectedPlan.monthly_price,
        usageCount: totalRxCount,
        nextBillingDate: newPeriodEnd.toISOString(),
      }
    });

  } catch (error) {
    console.error('자동결제 실패:', error.response?.body || error);
    
    // 결제 실패 시 구독 상태 업데이트 + 7일 유예기간 설정
    if (req.body.userId) {
      const failedAt = new Date();
      const graceUntil = new Date(failedAt);
      graceUntil.setDate(graceUntil.getDate() + 7); // 7일 유예

      await supabase
        .from('user_subscriptions')
        .update({ 
          status: 'failed',
          failed_at: failedAt.toISOString(),
          grace_until: graceUntil.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', req.body.userId)
        .eq('status', 'active');
      
      // 결제 실패 기록 저장
      const orderId = 'REC_FAIL_' + req.body.userId.substring(0, 8) + '_' + Date.now();
      const { data: subscription } = await supabase
        .from('user_subscriptions')
        .select('subscription_id, payment_method_id')
        .eq('user_id', req.body.userId)
        .single();
      
      const { data: paymentMethod } = await supabase
        .from('payment_methods')
        .select('billing_key')
        .eq('payment_method_id', subscription?.payment_method_id)
        .single();

      await supabase
        .from('billing_payments')
        .insert({
          payment_id: uuidv4(),
          subscription_id: subscription?.subscription_id,
          user_id: req.body.userId,
          order_id: orderId,
          billing_key: paymentMethod?.billing_key || '',
          payment_method_id: subscription?.payment_method_id,
          amount: 0,
          status: 'failed',
          fail_reason: error.response?.body?.message || error.message,
          requested_at: new Date().toISOString(),
        });
    }

    res.status(500).json({
      success: false,
      message: '자동결제에 실패했습니다. 7일 내에 결제수단을 변경해주세요.',
      error: error.message,
      graceUntil: req.body.userId ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null
    });
  }
});

router.post("/confirm", function (req, res) {
  // 클라이언트에서 받은 JSON 요청 바디입니다.
  const { paymentKey, orderId, amount } = req.body;

  // 토스페이먼츠 API는 시크릿 키를 사용자 ID로 사용하고, 비밀번호는 사용하지 않습니다.
  // 비밀번호가 없다는 것을 알리기 위해 시크릿 키 뒤에 콜론을 추가합니다.
  const widgetSecretKey = "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6";
  const encryptedSecretKey =
    "Basic " + Buffer.from(widgetSecretKey + ":").toString("base64");

  // 결제를 승인하면 결제수단에서 금액이 차감돼요.
  got
    .post("https://api.tosspayments.com/v1/payments/confirm", {
      headers: {
        Authorization: encryptedSecretKey,
        "Content-Type": "application/json",
      },
      json: {
        orderId: orderId,
        amount: amount,
        paymentKey: paymentKey,
      },
      responseType: "json",
    })
    .then(function (response) {
      // 결제 성공 비즈니스 로직을 구현하세요.
      console.log(response.body);
      res.status(response.statusCode).json(response.body)
    })
    .catch(function (error) {
      // 결제 실패 비즈니스 로직을 구현하세요.
      console.log(error.response.body);
      res.status(error.response.statusCode).json(error.response.body)
    });
});

module.exports = router;