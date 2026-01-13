const express = require("express");
const got = require("got");
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabase');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, optionalAuth } = require('../middleware/auth');

// 토스페이먼츠 시크릿 키 (환경 변수에서 로드)
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || 'test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R';

const router = express.Router();

// 첫 화면 - 세션 체크 후 라우팅 (쿠키 기반)
router.get('/', function (req, res) {
  const token = req.cookies?.user_session_token || null;
  if (token) {
    return res.redirect('/pharmchecker');
  } else {
    return res.redirect('/login');
  }
});

// 로그인 페이지
router.get('/login', function (req, res) {
  res.render('login');
});

// 회원가입 페이지
router.get('/join', function (req, res) {
  res.render('join');
});

// 회원탈퇴 페이지
router.get('/withdraw', function (req, res) {
  res.render('withdraw');
});

// 회원탈퇴 API - 인증 필요
router.post('/api/user/withdraw', requireAuth, async function (req, res) {
  try {
    const userId = req.user.id; // requireAuth에서 추출
    const { reason } = req.body;

    console.log('회원탈퇴 요청 사유:', reason);

    // 1. public.users에서 사용자 조회
    const { data: user, error: getUserError } = await req.supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (getUserError || !user) {
      console.error('사용자 조회 실패:', getUserError);
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.'
      });
    }

    // 2. 활성 구독 조회 및 취소
    const { data: activeSubscriptions } = await req.supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'trial']);

    if (activeSubscriptions && activeSubscriptions.length > 0) {
      // 구독 취소 처리
      const { error: cancelError } = await req.supabase
        .from('user_subscriptions')
        .update({
          status: 'cancelled',
          canceled_at: new Date().toISOString(),
          next_billing_at: null
        })
        .eq('user_id', userId)
        .in('status', ['active', 'trial']);

      if (cancelError) {
        console.error('구독 취소 실패:', cancelError);
      } else {
        console.log('활성 구독 취소 완료:', activeSubscriptions.length, '건');
      }
    }

    // 3. public.users 개인정보 익명화 (법적 "즉시 파기" 시점)
    // 사업자번호는 결제·세무 목적으로 5년 보관 (전자상거래법·세법)
    const { error: anonymizeError } = await req.supabase
      .from('users')
      .update({
        pharmacist_name: '(탈퇴한 사용자)',
        pharmacist_phone: '000-0000-0000',
        // business_number: 보관 (결제·세무 목적)
        pharmacy_name: '(삭제됨)',
        pharmacy_phone: '000-0000-0000',
        postcode: '00000',
        address: '(삭제됨)',
        detail_address: '(삭제됨)',
        google_picture: null,
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_reason: reason || '사용자 요청',
        deleted_by: null  // 본인 탈퇴
      })
      .eq('user_id', userId);

    if (anonymizeError) {
      console.error('개인정보 익명화 실패:', anonymizeError);
      return res.status(500).json({
        success: false,
        message: '탈퇴 처리 중 오류가 발생했습니다.',
        error: anonymizeError.message
      });
    }

    console.log('개인정보 익명화 완료');

    // 4. user_deletion_logs에 기록
    const { error: logError } = await req.supabase
      .from('user_deletion_logs')
      .insert({
        user_id: userId,
        deleted_by: null,  // 본인 탈퇴
        reason: reason || '사용자 요청',
        ip_address: req.ip || req.connection.remoteAddress,
        user_agent: req.headers['user-agent']
      });

    if (logError) {
      console.error('탈퇴 로그 기록 실패:', logError);
    } else {
      console.log('탈퇴 로그 기록 완료');
    }

    // 5. auth.users 삭제 (Supabase Admin API)
    try {
      const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      
      if (deleteAuthError) {
        console.error('auth.users 삭제 실패:', deleteAuthError);
        // auth.users 삭제 실패해도 이미 익명화는 완료되었으므로 성공으로 처리
      } else {
        console.log('auth.users 삭제 완료');
      }
    } catch (authError) {
      console.error('auth.users 삭제 예외:', authError);
    }

    res.status(200).json({
      success: true,
      message: '회원 탈퇴가 완료되었습니다.'
    });

  } catch (error) {
    console.error('회원탈퇴 처리 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// Google 로그인 후 auth.users.id 획득 API
router.post('/api/auth/get-user-id', async function (req, res) {
  try {
    const { email, name, picture, googleToken } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Google 인증 정보가 필요합니다.'
      });
    }

    console.log('Google 로그인 시도:', email);

    // 1. auth.users에서 이메일로 사용자 조회 (listUsers 사용)
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error('auth.users 조회 실패:', listError);
    }

    const authUser = users?.find(u => u.email === email);
    let authUserId;

    if (authUser) {
      // 이미 auth.users에 존재하는 경우
      authUserId = authUser.id;
      console.log('기존 auth.users 발견:', authUserId);
    } else {
      // auth.users에 없는 경우 새로 생성 (Admin API 사용)
      const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        email_confirm: true,
        user_metadata: {
          name: name,
          picture: picture
        }
      });

      if (createError || !newAuthUser.user) {
        console.error('auth.users 생성 실패:', createError);
        return res.status(500).json({
          success: false,
          message: 'auth.users 생성에 실패했습니다.',
          error: createError?.message
        });
      }

      authUserId = newAuthUser.user.id;
      console.log('새로운 auth.users 생성:', authUserId);
    }

    // 2. public.users에 이미 회원가입했는지 확인
    const { data: existingUser } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', authUserId)
      .single();

    console.log('public.users 존재 여부:', !!existingUser);

    res.status(200).json({
      success: true,
      userId: authUserId,
      isExistingUser: !!existingUser,
      email: email
    });

  } catch (error) {
    console.error('사용자 확인 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// Supabase Auth 기반 - 이미 가입된 사용자인지 확인
router.post('/api/auth/check-existing-user', requireAuth, async function (req, res) {
  try {
    const { userId } = req.body;
    const authenticatedUserId = req.user.id;

    // 요청한 userId와 인증된 userId가 일치하는지 확인
    if (userId !== authenticatedUserId) {
      return res.status(403).json({
        success: false,
        message: '권한이 없습니다.'
      });
    }

    // public.users에 이미 회원가입했는지 확인
    const { data: existingUser, error } = await req.supabase
      .from('users')
      .select('user_id')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('사용자 확인 실패:', error);
      return res.status(500).json({
        success: false,
        message: '사용자 확인에 실패했습니다.'
      });
    }

    res.status(200).json({
      success: true,
      isExistingUser: !!existingUser
    });

  } catch (error) {
    console.error('인증 처리 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// 회원가입 API - Supabase Auth 인증 필요
router.post('/api/signup', requireAuth, async function (req, res) {
  try {
    const authUserId = req.user.id; // requireAuth에서 추출한 사용자 ID
    const {
      pharmacistName,
      pharmacistPhone,
      businessNumber,
      pharmacyName,
      pharmacyPhone,
      postcode,
      address,
      detailAddress,
      referralCode,
      googlePicture
    } = req.body;

    // 필수 필드 검증
    if (!pharmacistName || !pharmacistPhone || !businessNumber || 
        !pharmacyName || !pharmacyPhone || !postcode || !address) {
      return res.status(400).json({
        success: false,
        message: '모든 필수 항목을 입력해주세요.'
      });
    }

    // 이미 회원가입한 사용자인지 확인 (user_id 중복 체크)
    const { data: existingUser } = await req.supabase
      .from('users')
      .select('user_id')
      .eq('user_id', authUserId)
      .single();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: '이미 회원가입이 완료된 계정입니다.'
      });
    }

    // 사업자 번호 중복 체크
    const { data: existingBusiness } = await req.supabase
      .from('users')
      .select('business_number')
      .eq('business_number', businessNumber)
      .eq('is_deleted', false)
      .single();

    if (existingBusiness) {
      return res.status(409).json({
        success: false,
        message: '이미 등록된 사업자 번호입니다.'
      });
    }

    // 추천인 코드 검증 (선택)
    let validPromotion = null;
    if (referralCode) {
      const { data: referralData, error: refError } = await req.supabase
        .from('referral_codes')
        .select(`
          *,
          promotion:promotion_id (*)
        `)
        .eq('code', referralCode)
        .eq('is_active', true)
        .single();

      if (refError || !referralData) {
        return res.status(400).json({
          success: false,
          message: '유효하지 않은 추천인 코드입니다.'
        });
      }

      // 추가 검증
      const now = new Date();
      
      // 만료 확인
      if (referralData.expires_at && new Date(referralData.expires_at) < now) {
        return res.status(400).json({
          success: false,
          message: '만료된 추천인 코드입니다.'
        });
      }

      // 사용 횟수 확인
      if (referralData.max_uses !== null && referralData.used_count >= referralData.max_uses) {
        return res.status(400).json({
          success: false,
          message: '추천인 코드 사용 가능 횟수가 초과되었습니다.'
        });
      }

      validPromotion = {
        referralCodeId: referralData.referral_code_id,
        promotionId: referralData.promotion_id
      };

      console.log('추천인 코드 검증 성공:', referralCode, '-> promotion:', validPromotion.promotionId);
    }

    // 3. auth.users.id를 그대로 사용 (UUID 일치)
    const userId = authUserId;

    // 3.5 재가입 여부 확인 (사업자번호 기준)
    const businessNumberClean = businessNumber.replace(/-/g, '');
    
    // promotion_usage_history에서 프로모션 사용 이력 확인
    const { data: promotionHistory } = await req.supabase
      .from('promotion_usage_history')
      .select('history_id')
      .eq('business_number', businessNumberClean)
      .limit(1);
    
    const hasPromotionHistory = promotionHistory && promotionHistory.length > 0;
    
    // 재가입 여부 = 프로모션 사용 이력이 있으면 재가입자
    const isReturningCustomer = hasPromotionHistory;
    
    console.log('🔍 재가입 여부 확인:', {
      businessNumber: businessNumberClean,
      hasPromotionHistory,
      isReturningCustomer
    });

    // 4. 사용자 데이터 삽입
    const { data, error } = await req.supabase
      .from('users')
      .insert([
        {
          user_id: userId,
          pharmacist_name: pharmacistName,
          pharmacist_phone: pharmacistPhone,
          business_number: businessNumber,
          pharmacy_name: pharmacyName,
          pharmacy_phone: pharmacyPhone,
          postcode: postcode,
          address: address,
          detail_address: detailAddress || null,
          google_picture: googlePicture || null,
          is_active: true,
          is_returning_customer: isReturningCustomer  // ✅ 재가입 여부 저장
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

    // 추천인 코드가 유효한 경우 → 프로모션 사용 이력 확인 후 pending_user_promotions 저장
    if (validPromotion) {
      // 📌 탈퇴 후 재가입 검증: 동일 사업자번호로 프로모션 사용 이력 확인
      const businessNumberClean = businessNumber.replace(/-/g, '');
      console.log('🔍 프로모션 사용 이력 조회:', businessNumberClean);
      
      const { data: usageHistory, error: usageError } = await req.supabase
        .from('promotion_usage_history')
        .select('promotion_id, business_number, is_exhausted, first_used_at')
        .eq('business_number', businessNumberClean);

      if (usageError) {
        console.error('❌ promotion_usage_history 조회 실패:', usageError);
      } else {
        console.log('📊 조회 결과:', usageHistory ? usageHistory.length + '건' : 'null', usageHistory);
      }

      const hasPromotionHistory = usageHistory && usageHistory.length > 0;

      if (!hasPromotionHistory) {
        // ✅ 프로모션 사용 이력 없음 → pending_user_promotions에 저장
        const { error: pendingError } = await req.supabase
          .from('pending_user_promotions')
          .insert({
            user_id: userId,
            promotion_id: validPromotion.promotionId,
            referral_code_id: validPromotion.referralCodeId,
            source: 'referral'
          });

        if (pendingError) {
          console.error('프로모션 예약 저장 실패:', pendingError);
          // 프로모션 저장 실패는 회원가입 실패로 처리하지 않음 (사용자 경험 고려)
        } else {
          console.log('✅ 프로모션 예약 완료 (사용 이력 없음):', userId, '->', validPromotion.promotionId);
        }
      } else {
        // ⚠️ 프로모션 사용 이력 있음 → 추천인 코드 무시 (재가입 케이스)
        console.log('⚠️ 프로모션 사용 이력 존재 - 추천인 코드 무시:', businessNumberClean, '(사용 이력:', usageHistory.length, '건)');
        console.log('  → 기존 사용 이력:', usageHistory.map(h => `${h.promotion_id} (${h.first_used_at})`).join(', '));
      }
    }

    // 회원가입 성공
    res.status(201).json({
      success: true,
      message: validPromotion ? '회원가입이 완료되었습니다. 1개월 무료 혜택이 적용됩니다!' : '회원가입이 완료되었습니다.',
      data: {
        userId: data.user_id,
        email: data.email,
        pharmacistName: data.pharmacist_name,
        pharmacyName: data.pharmacy_name,
        hasPromotion: !!validPromotion
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

    // auth.users에서 email 조회
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
    const authUser = users?.find(u => u.email === email);

    if (!authUser) {
      return res.json({
        exists: false,
        message: '사용 가능한 이메일입니다.'
      });
    }

    // public.users에서 user_id로 조회
    const { data } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', authUser.id)
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
    const { email, idToken } = req.body;

    // 이메일 검증
    if (!email) {
      return res.status(400).json({
        success: false,
        message: '이메일을 입력해주세요.'
      });
    }

    console.log('로그인 시도:', email);

    // 1. auth.users에서 이메일로 사용자 조회
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    const authUser = users?.find(u => u.email === email);

    if (!authUser) {
      return res.status(401).json({
        success: false,
        message: '등록되지 않은 이메일입니다. 회원가입을 먼저 진행해주세요.'
      });
    }

    console.log('auth.users 발견:', authUser.id);

    // 2. public.users에서 user_id로 사용자 조회 (로그인은 인증 전이므로 supabaseAdmin 사용)
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('user_id', authUser.id)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .single();

    if (error || !user) {
      console.error('public.users 조회 실패:', error);
      return res.status(401).json({
        success: false,
        message: '등록되지 않은 이메일입니다. 회원가입을 먼저 진행해주세요.'
      });
    }

    console.log('로그인 성공');

    // 세션 토큰 생성 (구글 ID 토큰을 그대로 사용)
    const sessionToken = req.body.idToken || '';

    // 로그인 성공
    res.status(200).json({
      success: true,
      message: '로그인에 성공했습니다.',
      session_token: sessionToken,
      data: {
        userId: user.user_id,
        email: authUser.email,
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
router.get('/api/subscription/status', requireAuth, async function (req, res) {
  try {
    const userId = req.user.id; // requireAuth에서 추출

    // 활성 구독 조회
    const { data: subscription } = await req.supabase
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

// 구독 플랜 선택 페이지
router.get('/subscription/plans', function (req, res) {
  res.render('subscription-plans');
});

// 마이페이지
router.get('/my-subscription', function (req, res) {
  res.render('my-subscription');
});

// 결제 내역 페이지
router.get('/payment-history', function (req, res) {
  res.render('payment-history');
});

// 결제수단 변경 페이지
router.get('/update-payment', function (req, res) {
  res.render('update-payment');
});

// 구독 결제 페이지
router.get('/subscription/payment', optionalAuth, async function (req, res) {
  try {
    const userId = req.query.userId;
    const planId = req.query.planId;
    
    console.log('🔍 /subscription/payment 접근:', { planId });
    
    if (!userId || !planId) {
      console.log('❌ userId 또는 planId 없음');
      return res.redirect('/subscription/plans');
    }

    // ===== 플랜 정보 조회 =====
    const { data: planData, error: planError } = await (req.supabase || supabase)
      .from('subscription_plans')
      .select('plan_name, monthly_price')
      .eq('plan_id', planId)
      .single();

    console.log('📋 플랜 조회 결과:', { planData, planError });

    if (!planData) {
      console.log('❌ 플랜 정보 없음, 리다이렉트');
      return res.redirect('/subscription/plans');
    }

    // ===== 사용자 정보 조회 =====
    const { data: userData } = await (req.supabase || supabase)
      .from('users')
      .select('business_number')
      .eq('user_id', userId)
      .single();

    let canUseFreePromotion = true;
    let availablePromotions = [];

    // ===== 사업자번호로 무료 프로모션 이력 체크 =====
    if (userData && userData.business_number) {
      const businessNumberClean = userData.business_number.replace(/[^0-9]/g, '');
      
      const { data: promotionHistory } = await (req.supabase || supabase)
        .from('promotion_usage_history')
        .select('*')
        .eq('business_number', businessNumberClean)
        .eq('promotion_code', 'FREE_1MONTH')
        .single();

      if (promotionHistory) {
        canUseFreePromotion = false;
      }
    }

    // ===== pending_user_promotions에서 사용 가능한 프로모션 목록 조회 =====
    const { data: pendingPromotions } = await (req.supabase || supabase)
      .from('pending_user_promotions')
      .select(`
        promotion_id,
        referral_code_id,
        subscription_promotions (
          promotion_name,
          discount_type,
          discount_value,
          free_months,
          promotion_code,
          first_payment_only,
          max_usage_per_user
        ),
        referral_codes (
          code
        )
      `)
      .eq('user_id', userId)
      .is('applied_at', null)
      .order('created_at', { ascending: false });

    if (pendingPromotions && pendingPromotions.length > 0) {
      const businessNumberClean = userData?.business_number?.replace(/[^0-9]/g, '') || '';
      
      // ✅ 첫 결제 판단 (LLM 설계 기준)
      // 1. billing_payments 테이블에서 성공한 유료 결제(amount > 0) 이력 확인
      const { data: userPayments } = await (req.supabase || supabase)
        .from('billing_payments')
        .select('payment_id')
        .eq('user_id', userId)
        .in('status', ['paid', 'success'])
        .gt('amount', 0);
      
      const hasPaymentHistory = userPayments && userPayments.length > 0;
      
      // 2. promotion_usage_history에서 동일 사업자번호의 이력 확인 (탈퇴 후 재가입 대응)
      const { data: usageHistory } = await (req.supabase || supabase)
        .from('promotion_usage_history')
        .select('promotion_id, business_number, is_exhausted')
        .eq('business_number', businessNumberClean);
      
      // ✅ 프로모션 사용 이력이 하나라도 있으면 재사용 불가 (is_exhausted 무관)
      const hasPromotionHistory = usageHistory && usageHistory.length > 0;
      
      // ✅ 첫 결제 여부: billing_payments AND promotion_usage_history 둘 다 없어야 함
      const isFirstPayment = !hasPaymentHistory && !hasPromotionHistory;
      
      // max_usage_per_user 체크용 카운트
      const promotionUsageCount = {};
      if (usageHistory) {
        usageHistory.forEach(h => {
          promotionUsageCount[h.promotion_id] = (promotionUsageCount[h.promotion_id] || 0) + 1;
        });
      }
      
      pendingPromotions.forEach(promo => {
        const promotionData = promo.subscription_promotions;
        
        // first_payment_only 체크: 첫 결제에만 사용 가능한 프로모션
        if (promotionData.first_payment_only && !isFirstPayment) {
          console.log(`프로모션 제외 (first_payment_only): ${promotionData.promotion_name}`);
          return;
        }
        
        // max_usage_per_user 체크: 사용자당 최대 사용 횟수
        if (promotionData.max_usage_per_user) {
          const usageCount = promotionUsageCount[promo.promotion_id] || 0;
          if (usageCount >= promotionData.max_usage_per_user) {
            console.log(`프로모션 제외 (max_usage_per_user 초과): ${promotionData.promotion_name} (사용 ${usageCount}/${promotionData.max_usage_per_user})`);
            return;
          }
        }
        
        // 무료 프로모션이고 이미 사용한 경우 제외
        if (promotionData.discount_type === 'free' && !canUseFreePromotion) {
          return;
        }
        
        availablePromotions.push({
          promotion_id: promo.promotion_id,
          referral_code_id: promo.referral_code_id,
          promotion_name: promotionData.promotion_name,
          promotion_code: promotionData.promotion_code,
          discount_type: promotionData.discount_type,
          discount_value: promotionData.discount_value,
          free_months: promotionData.free_months,
          referral_code: promo.referral_codes?.code || null
        });
      });
    }

    res.render('subscription-payment', {
      tossClientKey: process.env.TOSS_CLIENT_KEY || 'test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq',
      planName: planData.plan_name,
      originalPrice: planData.monthly_price,
      availablePromotions: availablePromotions,
      userId: userId,
      planId: planId
    });

  } catch (error) {
    console.error('/subscription/payment 에러:', error);
    res.redirect('/subscription/plans');
  }
});

// 자동결제 카드 등록 성공 처리 (빌링키 발급)
router.get('/subscription/billing-success', async function (req, res) {
  try {
    const { authKey, customerKey, planId, userId, amount, originalPrice, promotionId, referralCodeId } = req.query;
    
    // amount: 프로모션 적용된 최종 금액 (프론트엔드에서 계산됨)
    // originalPrice: 플랜의 원래 가격
    const finalAmount = parseInt(amount);
    const planOriginalPrice = originalPrice ? parseInt(originalPrice) : finalAmount;
    
    // referralCodeId 정규화: "null" 문자열을 null로 변환
    const normalizedReferralCodeId = (referralCodeId === 'null' || referralCodeId === 'undefined' || !referralCodeId) ? null : referralCodeId;

    console.log('빌링키 발급 시작:', { planId, finalAmount, planOriginalPrice, promotionId, referralCodeId: normalizedReferralCodeId });

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
    
    // 카드 정보 추출 (Toss API v1 구조: card 객체 내부)
    // cardCompany는 최상위 필드에 있음 (issuerCode는 코드번호)
    const cardCompany = billingData.cardCompany || billingData.card?.issuerCode || null;
    const cardLast4 = (billingData.cardNumber || billingData.card?.number || '').slice(-4) || null;
    // Toss API에는 유효기간 필드가 없음 (null 허용)
    const expiresYear = null;
    const expiresMonth = null;

    console.log('빌링키 발급 성공:', { billingKey, cardCompany, cardLast4, expiresYear, expiresMonth });

    // ===== 3단계: 프로모션 정보 조회 (promotionId가 있는 경우) =====
    let promotionData = null;
    
    if (promotionId && promotionId !== '') {
      const { data: promoData } = await supabase
        .from('subscription_promotions')
        .select('*')
        .eq('promotion_id', promotionId)
        .single();
      
      if (promoData) {
        promotionData = promoData;
        console.log('프로모션 정보:', {
          promotionId,
          promotionName: promotionData.promotion_name,
          discountType: promotionData.discount_type,
          freeMonths: promotionData.free_months
        });
      }
    }

    // ===== 4단계: 사업자번호 조회 (무료 프로모션 이력 저장용) =====
    const { data: userData } = await supabase
      .from('users')
      .select('business_number')
      .eq('user_id', userId)
      .single();

    let businessNumberClean = null;
    if (userData && userData.business_number) {
      businessNumberClean = userData.business_number.replace(/[^0-9]/g, '');
    }

    // ===== 5단계: 플랜 정보 조회 =====
    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('plan_id', planId)
      .single();

    if (!plan) {
      throw new Error('플랜 정보를 찾을 수 없습니다.');
    }

    // ===== 6단계: orderId 생성 (0원 결제도 필요) =====
    const orderId = 'SUB_' + userId.substring(0, 8) + '_' + Date.now();
    console.log('orderId 생성:', orderId);

    let payment = null;

    // 💡 0원 결제는 토스 API 호출 생략 (토스는 0원 결제 미지원)
    if (finalAmount === 0) {
      console.log('0원 결제: 토스 API 호출 생략 (무료 프로모션 적용)');
      payment = {
        paymentKey: 'FREE_' + orderId,  // 가상 paymentKey
        orderId: orderId,
        amount: 0,
        status: 'DONE'
      };
    } else {
      // 일반 결제: 토스 API 호출
      const paymentResponse = await got.post(`https://api.tosspayments.com/v1/billing/${billingKey}`, {
        headers: {
          Authorization: encryptedSecretKey,
          "Content-Type": "application/json",
        },
        json: {
          customerKey: customerKey,
          amount: finalAmount,  // 프로모션 적용된 금액
          orderId: orderId,
          orderName: promotionData ? 
            `PharmChecker ${plan.plan_name} 플랜 (${promotionData.promotion_name})` : 
            `PharmChecker ${plan.plan_name} 플랜 (첫 달)`,
          customerEmail: '',
          customerName: '',
        },
        responseType: "json",
      });

      payment = paymentResponse.body;
    }

    console.log('첫 결제 승인 성공:', { paymentKey: payment.paymentKey, orderId, amount: finalAmount });

    // ===== 5단계: UUID 선언 (순서 중요!) =====
    const subscriptionId = uuidv4();
    const paymentMethodId = uuidv4();

    // ===== 6단계: payment_methods에 카드 정보 저장 =====
    const { error: paymentMethodError } = await supabase
      .from('payment_methods')
      .insert({
        payment_method_id: paymentMethodId,
        user_id: userId,
        billing_key: billingKey,
        card_company: cardCompany,
        card_last4: cardLast4,
        expires_year: expiresYear,
        expires_month: expiresMonth,
        is_default: true,  // 첫 카드는 기본 결제수단
      });

    if (paymentMethodError) {
      console.error('❌ payment_methods INSERT 실패:', paymentMethodError);
      throw new Error(`결제수단 저장 실패: ${paymentMethodError.message}`);
    }

    console.log('✅ payment_methods 저장 완료:', paymentMethodId);

    // ===== 7단계: 구독 기간 계산 =====
    const now = new Date();
    let subscriptionData;
    
    if (finalAmount === 0 && promotionData) {
      // 💡 무료 프로모션: current_period는 NULL, next_billing_at만 설정
      // 예: 1/7 가입 → 2/6까지 무료, 2/7 00:00:00에 첫 유료 결제
      const freeEndDate = new Date(now);
      freeEndDate.setMonth(freeEndDate.getMonth() + promotionData.free_months);
      freeEndDate.setHours(0, 0, 0, 0);  // ✅ 다음 달 같은 날짜 자정
      
      console.log(`무료 기간: ${now.toISOString()} ~ ${new Date(freeEndDate.getTime() - 1).toISOString()}`);
      console.log(`첫 유료 결제 예정: ${freeEndDate.toISOString()}`);
      
      subscriptionData = {
        subscription_id: subscriptionId,
        user_id: userId,
        entry_plan_id: planId,
        billing_plan_id: planId,
        promotion_id: promotionId,
        promotion_applied_at: new Date().toISOString(),
        promotion_expires_at: freeEndDate.toISOString(),
        status: 'active',
        payment_method_id: paymentMethodId,
        customer_key: customerKey,
        current_period_start: null,     // ⚠️ 무료 기간은 결제 주기 아님
        current_period_end: null,       // ⚠️ 무료 기간은 결제 주기 아님
        next_billing_at: freeEndDate.toISOString(),  // 무료 종료 = 첫 유료 결제 시점
        is_first_billing: true,
      };
    } else {
      // 💰 유료 결제: 일반적인 결제 주기 설정
      // 예: 1/7 00:00:00 결제 → 2/6 23:59:59까지 사용, 2/7 00:00:00에 다음 결제
      const currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const nextBillingDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate(), 0, 0, 0, 0);
      
      // 월말 처리: 1/31 → 2/28(29), 3/31 → 4/30 등
      if (nextBillingDate.getDate() !== now.getDate()) {
        nextBillingDate.setDate(0);
        nextBillingDate.setHours(0, 0, 0, 0);  // ✅ 다음 달 자정
      }
      
      // 현재 주기 종료일 = 다음 결제일 -1ms (2/6 23:59:59.999)
      const currentPeriodEnd = new Date(nextBillingDate.getTime() - 1);
      
      console.log(`유료 결제 주기: ${currentPeriodStart.toISOString()} ~ ${currentPeriodEnd.toISOString()}`);
      console.log(`다음 결제 예정: ${nextBillingDate.toISOString()}`);
      
      subscriptionData = {
        subscription_id: subscriptionId,
        user_id: userId,
        entry_plan_id: planId,
        billing_plan_id: planId,
        promotion_id: promotionId || null,
        promotion_applied_at: promotionId ? new Date().toISOString() : null,
        promotion_expires_at: null,
        status: 'active',
        payment_method_id: paymentMethodId,
        customer_key: customerKey,
        current_period_start: currentPeriodStart.toISOString(),
        current_period_end: currentPeriodEnd.toISOString(),
        next_billing_at: nextBillingDate.toISOString(),  // ✅ 다음 달 같은 날짜 자정
        is_first_billing: true,
      };
    }

    // ===== 8단계: user_subscriptions 테이블에 구독 생성 =====
    const { error: subscriptionError } = await supabase
      .from('user_subscriptions')
      .insert(subscriptionData);

    if (subscriptionError) {
      console.error('❌ user_subscriptions INSERT 실패:', subscriptionError);
      throw new Error(`구독 생성 실패: ${subscriptionError.message}`);
    }

    console.log('✅ user_subscriptions 생성 완료:', subscriptionId);

    // ===== 9단계: 무료 프로모션 기록 저장 (subscription_free_grants) =====
    if (finalAmount === 0 && promotionData) {
      // 💡 effective_end = next_billing_at - 1ms (무료 종료 시점)
      // 예: 1/7 가입, 1개월 무료 → 2/6 23:59:59.999까지 무료, 2/7 00:00:00 첫 결제
      const nextBillingDate = new Date(now);
      nextBillingDate.setMonth(nextBillingDate.getMonth() + promotionData.free_months);
      nextBillingDate.setHours(0, 0, 0, 0);  // 다음 결제일 자정
      
      const freeEndDate = new Date(nextBillingDate.getTime() - 1);  // 1ms 빼기 (전날 23:59:59.999)
      
      const { error: freeGrantError } = await supabase
        .from('subscription_free_grants')
        .insert({
          free_grant_id: uuidv4(),
          user_id: userId,
          subscription_id: subscriptionId,
          promotion_id: promotionId,
          referral_code_id: normalizedReferralCodeId,
          free_months: promotionData.free_months,
          granted_at: new Date().toISOString(),
          effective_start: now.toISOString(),
          effective_end: freeEndDate.toISOString(),  // ✅ 2/6 23:59:59.999
        });

      if (freeGrantError) {
        console.error('❌ subscription_free_grants INSERT 실패:', freeGrantError);
        throw new Error(`무료 프로모션 기록 실패: ${freeGrantError.message}`);
      }

      console.log('✅ 무료 프로모션 부여 기록 저장 완료:', {
        userId,
        freeMonths: promotionData.free_months,
        effectiveStart: now.toISOString(),
        effectiveEnd: freeEndDate.toISOString(),
        nextBilling: nextBillingDate.toISOString()
      });

      // 무료 프로모션 사용 이력 저장 (promotion_usage_history)
      if (businessNumberClean && promotionData.promotion_code) {
        const { error: historyError } = await supabase
          .from('promotion_usage_history')
          .insert({
            business_number: businessNumberClean,
            promotion_code: promotionData.promotion_code,
            promotion_id: promotionId,
            used_months: 1,
            is_exhausted: true,
            last_applied_at: new Date().toISOString()
          });

        if (historyError && historyError.code !== '23505') {
          console.error('❌ promotion_usage_history INSERT 실패:', historyError);
        } else {
          console.log('✅ 무료 프로모션 사용 이력 저장 완료:', businessNumberClean);
        }
      }
    }

    // ===== 10단계: 결제 기록 저장 (billing_payments - 0원/유료 모두 기록) =====
    // 📌 payment_key: 0원 결제는 NULL (PG 호출 안 함), 유료 결제는 토스에서 발급받음
    // 📌 promotion_id: 실제 결제에 적용된 프로모션 ID 저장 (Source of Truth)
    const paymentData = {
      payment_id: uuidv4(),
      subscription_id: subscriptionId,
      user_id: userId,
      order_id: orderId,
      payment_key: finalAmount === 0 ? null : payment.paymentKey,  // 0원은 NULL
      billing_key: billingKey,
      payment_method_id: paymentMethodId,
      amount: finalAmount,
      promotion_id: promotionId || null,  // ✅ 실제 적용된 프로모션 저장
      status: 'success',
      requested_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
    };

    const { error: paymentError } = await supabase
      .from('billing_payments')
      .insert(paymentData);

    if (paymentError) {
      console.error('❌ billing_payments INSERT 실패:', paymentError);
      throw new Error(`결제 기록 저장 실패: ${paymentError.message}`);
    }

    console.log('✅ 결제 기록 저장 완료:', {
      amount: finalAmount,
      paymentKey: paymentData.payment_key || 'NULL (0원 결제)',
      paymentType: finalAmount === 0 ? '무료 프로모션' : '유료 결제'
    });

    // ===== 11단계: pending_user_promotions 상태 관리 & referral_codes.used_count 증가 =====
    if (promotionId && promotionId !== '') {
      // ✅ 적용된 프로모션: status = 'applied', applied_at, payment_id 설정
      const { error: appliedError } = await supabase
        .from('pending_user_promotions')
        .update({ 
          status: 'applied',
          applied_at: new Date().toISOString(),
          payment_id: paymentData.payment_id
        })
        .eq('promotion_id', promotionId)
        .eq('user_id', userId)
        .is('applied_at', null);

      if (appliedError) {
        console.warn('⚠️ pending_user_promotions 적용 업데이트 실패:', appliedError);
      } else {
        console.log('✅ 프로모션 적용 완료:', { promotionId, status: 'applied' });
      }

      // ❌ 적용되지 않은 나머지 예약 프로모션: status = 'expired'
      const { error: expiredError } = await supabase
        .from('pending_user_promotions')
        .update({ status: 'expired' })
        .eq('user_id', userId)
        .is('applied_at', null)
        .neq('promotion_id', promotionId)
        .in('status', ['reserved', 'selected']);

      if (expiredError) {
        console.warn('⚠️ 나머지 프로모션 만료 처리 실패:', expiredError);
      } else {
        console.log('✅ 나머지 예약 프로모션 만료 처리 완료');
      }

      // 추천인 코드 사용 횟수 증가
      if (referralCodeId && referralCodeId !== '') {
        const { data: incrementResult } = await supabase
          .rpc('increment_referral_code_usage', { p_referral_code_id: referralCodeId });

        if (incrementResult) {
          console.log('✅ 추천인 코드 사용 횟수 증가:', referralCodeId);
        } else {
          console.warn('⚠️ 추천인 코드 사용 횟수 증가 실패 (max_uses 초과 또는 만료)');
        }
      }
    }

    console.log('신규 구독 생성 완료:', subscriptionId);

    // 성공 페이지로 리다이렉트
    res.redirect(`/subscription/complete?planName=${encodeURIComponent(plan.plan_name)}&amount=${finalAmount}`);

  } catch (error) {
    console.error('=== 결제 처리 실패 ===');
    console.error('에러 전체:', JSON.stringify(error.response?.body || error, null, 2));
    console.error('에러 코드:', error.response?.body?.code);
    console.error('에러 메시지:', error.response?.body?.message);
    console.error('===================');
    
    // 토스 페이먼츠 에러 처리
    let errorMessage = '결제 처리 중 오류가 발생했습니다.';
    let errorCode = error.response?.body?.code || null;
    
    if (errorCode === 'NOT_SUPPORTED_CARD_TYPE') {
      errorMessage = '자동결제는 신용카드만 사용 가능합니다. 체크카드는 이용하실 수 없습니다.';
    } else if (errorCode === 'INVALID_CARD_EXPIRATION') {
      errorMessage = '카드 유효기간이 만료되었습니다. 다른 카드를 사용해주세요.';
    } else if (errorCode === 'INVALID_CARD_INSTALLMENT_PLAN') {
      errorMessage = '할부 설정이 올바르지 않습니다.';
    } else if (errorCode === 'NOT_ALLOWED_POINT_USE') {
      errorMessage = '포인트 사용이 불가능한 카드입니다.';
    } else if (errorCode === 'INVALID_CARD_COMPANY') {
      errorMessage = '지원하지 않는 카드사입니다.';
    } else if (errorCode === 'EXCEED_MAX_CARD_AMOUNT_PER_DAY') {
      errorMessage = '일일 카드 결제 한도를 초과했습니다.';
    } else if (errorCode === 'INVALID_PASSWORD') {
      errorMessage = '카드 비밀번호가 올바르지 않습니다.';
    } else if (error.code === 'SQLITE_CONSTRAINT' || error.message?.includes('duplicate key') || error.message?.includes('UNIQUE constraint')) {
      errorMessage = '이미 등록된 카드입니다. 다른 카드를 사용해주세요.';
      errorCode = 'DUPLICATE_BILLING_KEY';
    } else if (error.response?.body?.message) {
      errorMessage = error.response.body.message;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.redirect('/subscription/payment-fail?message=' + encodeURIComponent(errorMessage) + '&code=' + encodeURIComponent(errorCode || 'UNKNOWN'));
  }
});

// 구독 결제 실패 처리
router.get('/subscription/payment-fail', function (req, res) {
  const message = req.query.message || '결제에 실패했습니다.';
  const code = req.query.code || '';
  
  // 사용자 친화적인 아이콘 및 안내
  let icon = '❌';
  let title = '결제 실패';
  let additionalInfo = '';
  
  if (code === 'NOT_SUPPORTED_CARD_TYPE') {
    icon = '💳';
    title = '카드 종류 확인 필요';
    additionalInfo = '<p style="color: #e74c3c; font-weight: bold;">📌 자동결제는 <u>신용카드</u>만 가능합니다</p><p>체크카드, 선불카드는 사용하실 수 없습니다.</p>';
  } else if (code === 'INVALID_CARD_EXPIRATION') {
    icon = '📅';
    title = '카드 유효기간 만료';
  } else if (code === 'INVALID_PASSWORD') {
    icon = '🔒';
    title = '비밀번호 오류';
  }
  
  res.send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - PharmChecker</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          max-width: 500px;
          width: 100%;
          padding: 40px;
          text-align: center;
        }
        .icon { font-size: 80px; margin-bottom: 20px; }
        h1 { 
          color: #2c3e50; 
          font-size: 24px; 
          margin-bottom: 15px;
        }
        .message {
          color: #555;
          font-size: 16px;
          line-height: 1.6;
          margin-bottom: 20px;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 12px;
          border-left: 4px solid #e74c3c;
        }
        .additional-info {
          margin-bottom: 20px;
          line-height: 1.8;
        }
        button {
          padding: 14px 32px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 600;
          transition: transform 0.2s;
        }
        button:hover {
          transform: translateY(-2px);
        }
        .help-text {
          margin-top: 20px;
          font-size: 14px;
          color: #7f8c8d;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">${icon}</div>
        <h1>${title}</h1>
        <div class="message">${message}</div>
        ${additionalInfo ? `<div class="additional-info">${additionalInfo}</div>` : ''}
        <button onclick="window.location.href='/subscription/plans'">플랜 다시 선택하기</button>
        <p class="help-text">문제가 계속되면 고객센터로 문의해주세요.</p>
      </div>
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

// 결제수단 변경 성공 콜백 (authKey 받기)
router.get('/api/subscription/update-payment-success', async function (req, res) {
  const { authKey, customerKey } = req.query;
  
  if (!authKey || !customerKey) {
    return res.redirect('/update-payment?error=missing_params');
  }

  try {
    // authKey를 사용하여 결제수단 업데이트 처리
    const response = await fetch('/api/subscription/update-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: customerKey,
        authKey: authKey
      })
    });

    const data = await response.json();

    if (data.success) {
      res.redirect('/purchase-complete?message=' + encodeURIComponent('결제수단이 변경되고 재결제가 완료되었습니다.'));
    } else {
      res.redirect('/update-payment?error=' + encodeURIComponent(data.message));
    }
  } catch (error) {
    console.error('결제수단 변경 처리 오류:', error);
    res.redirect('/update-payment?error=processing_failed');
  }
});

// 내 구독 정보 조회
router.get('/api/subscription/my', requireAuth, async function (req, res) {
  try {
    const userId = req.user.id; // Supabase Auth에서 가져온 사용자 ID
    const userSupabase = req.supabase; // 인증된 Supabase 클라이언트 (RLS 적용됨)
    
    // 구독 정보 조회 - RLS 정책 적용 (auth.uid() = user_id)
    const { data: subscription, error: subError } = await userSupabase
      .from('user_subscriptions')
      .select('*, subscription_plans!user_subscriptions_billing_plan_id_fkey(plan_name, monthly_price)')
      .eq('user_id', userId)
      .maybeSingle();

    if (subError) {
      console.error('구독 정보 조회 실패:', subError);
      return res.json({ success: false, message: '구독 정보를 조회하는데 실패했습니다.' });
    }

    if (!subscription) {
      // 구독 없음 - 정상 응답
      return res.json({ success: false, message: '구독 정보가 없습니다.' });
    }

    // 카드 정보 조회 - RLS 적용
    let cardInfo = null;
    if (subscription.payment_method_id) {
      const { data: paymentMethod } = await userSupabase
        .from('payment_methods')
        .select('*')
        .eq('payment_method_id', subscription.payment_method_id)
        .single();
      
      if (paymentMethod) {
        cardInfo = {
          company: paymentMethod.card_company,
          last4: paymentMethod.card_last4,
          expiresYear: paymentMethod.expires_year,
          expiresMonth: paymentMethod.expires_month
        };
      }
    }

    // 현재 청구기간 사용량 조회 - RLS 적용
    let usageStats = null;
    if (subscription.current_period_start) {
      const { data: stats } = await userSupabase
        .from('usage_billing_period_stats')
        .select('*')
        .eq('subscription_id', subscription.subscription_id)
        .eq('period_start', subscription.current_period_start)
        .single();
      usageStats = stats;
    }

    // 무료 기간 여부 판단
    const isFreeTrialActive = subscription.current_period_start === null;

    res.json({
      success: true,
      subscription: {
        planName: subscription.subscription_plans.plan_name,
        price: subscription.subscription_plans.monthly_price,
        status: subscription.status,
        isFreeTrialActive: isFreeTrialActive,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        nextBillingAt: subscription.next_billing_at,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        failedAt: subscription.failed_at,
        graceUntil: subscription.grace_until,
        usage: usageStats?.total_rx_count || 0
      },
      cardInfo
    });
  } catch (error) {
    console.error('구독 정보 조회 오류:', error);
    res.status(500).json({ success: false, message: '구독 정보 조회 중 오류가 발생했습니다.' });
  }
});

// 결제 내역 조회
router.get('/api/subscription/payment-history', requireAuth, async function (req, res) {
  try {
    const userId = req.user.id; // requireAuth에서 추출

    // 결제 내역 조회
    const { data: payments, error } = await req.supabase
      .from('billing_payments')
      .select('*, user_subscriptions(subscription_plans!user_subscriptions_billing_plan_id_fkey(plan_name))')
      .eq('user_id', userId)
      .order('requested_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      payments: payments.map(p => ({
        orderId: p.order_id,
        planName: p.user_subscriptions?.subscription_plans?.plan_name || '알 수 없음',
        amount: p.amount,
        status: p.status,
        requestedAt: p.requested_at,
        failReason: p.fail_reason
      }))
    });
  } catch (error) {
    console.error('결제 내역 조회 오류:', error);
    res.status(500).json({ success: false, message: '결제 내역 조회 중 오류가 발생했습니다.' });
  }
});

// 카드 변경 (재결제)
router.post('/api/subscription/update-payment', requireAuth, async function (req, res) {
  try {
    const userId = req.user.id; // requireAuth에서 추출
    const { authKey } = req.body;
    
    if (!authKey) {
      return res.status(400).json({ success: false, message: '인증키가 필요합니다.' });
    }

    // 구독 정보 조회
    const { data: subscription } = await req.supabase
      .from('user_subscriptions')
      .select('*, subscription_plans!user_subscriptions_billing_plan_id_fkey(*)')
      .eq('user_id', userId)
      .single();

    if (!subscription) {
      return res.status(404).json({ success: false, message: '구독 정보를 찾을 수 없습니다.' });
    }

    // 기존 payment_method 비활성화
    if (subscription.payment_method_id) {
      await req.supabase
        .from('payment_methods')
        .update({ disabled_at: new Date().toISOString() })
        .eq('payment_method_id', subscription.payment_method_id);
    }

    // authKey로 billingKey 발급
    const billingResponse = await got.post(
      `https://api.tosspayments.com/v1/billing/authorizations/${authKey}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(process.env.TOSS_SECRET_KEY + ':').toString('base64')}`,
          'Content-Type': 'application/json',
        },
        json: { customerKey: userId },
        responseType: 'json',
      }
    );

    const billingData = billingResponse.body;

    // 카드 정보 추출 (첫 결제와 동일한 구조)
    const cardCompany = billingData.cardCompany || billingData.card?.issuerCode || null;
    const cardLast4 = (billingData.cardNumber || billingData.card?.number || '').slice(-4) || null;

    // 새 payment_method 저장
    const { data: newPaymentMethod } = await req.supabase
      .from('payment_methods')
      .insert({
        payment_method_id: uuidv4(),
        user_id: userId,
        billing_key: billingData.billingKey,
        card_company: cardCompany,
        card_last4: cardLast4,
        expires_year: null,
        expires_month: null,
        is_default: true,
      })
      .select()
      .single();

    // 즉시 재결제 시도
    const orderId = `RETRY_${Date.now()}_${userId.substring(0, 8)}`;
    const paymentResponse = await got.post(
      'https://api.tosspayments.com/v1/billing/' + billingData.billingKey,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(process.env.TOSS_SECRET_KEY + ':').toString('base64')}`,
          'Content-Type': 'application/json',
        },
        json: {
          customerKey: userId,
          amount: subscription.subscription_plans.price,
          orderId: orderId,
          orderName: `${subscription.subscription_plans.plan_name} 플랜 재결제`,
        },
        responseType: 'json',
      }
    );

    const paymentData = paymentResponse.body;

    // 구독 상태 업데이트
    await req.supabase
      .from('user_subscriptions')
      .update({
        payment_method_id: newPaymentMethod.payment_method_id,
        status: 'active',
        failed_at: null,
        grace_until: null,
      })
      .eq('subscription_id', subscription.subscription_id);

    // 결제 기록 저장
    await req.supabase.from('billing_payments').insert({
      payment_id: uuidv4(),
      subscription_id: subscription.subscription_id,
      user_id: userId,
      order_id: orderId,
      billing_key: billingData.billingKey,
      payment_method_id: newPaymentMethod.payment_method_id,
      amount: subscription.subscription_plans.price,
      status: 'completed',
      toss_payment_key: paymentData.paymentKey,
      requested_at: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: '결제수단이 변경되고 재결제가 완료되었습니다.',
      payment: paymentData,
    });
  } catch (error) {
    console.error('결제수단 변경 오류:', error);
    res.status(500).json({
      success: false,
      message: '결제수단 변경에 실패했습니다.',
      error: error.response?.body?.message || error.message,
    });
  }
});

// 구독 해지
router.post('/api/subscription/cancel', requireAuth, async function (req, res) {
  try {
    const userId = req.user.id; // requireAuth에서 추출

    const { data: subscription } = await req.supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!subscription) {
      return res.status(404).json({ success: false, message: '구독 정보를 찾을 수 없습니다.' });
    }

    // 즉시 해지가 아닌 다음 결제일에 해지
    const { error: updateError } = await req.supabase
      .from('user_subscriptions')
      .update({ 
        cancel_at_period_end: true,
        updated_at: new Date().toISOString()
      })
      .eq('subscription_id', subscription.subscription_id);

    if (updateError) {
      console.error('구독 해지 업데이트 실패:', updateError);
      return res.status(500).json({ success: false, message: 'DB 업데이트 중 오류가 발생했습니다.' });
    }

    console.log(`구독 해지 예약 완료: ${userId}, subscription_id: ${subscription.subscription_id}`);

    res.json({
      success: true,
      message: '구독 해지가 예약되었습니다. 현재 결제 기간 종료일까지 서비스를 이용하실 수 있습니다.',
      cancelDate: subscription.current_period_end,
    });
  } catch (error) {
    console.error('구독 해지 오류:', error);
    res.status(500).json({ success: false, message: '구독 해지 중 오류가 발생했습니다.' });
  }
});

// 구독 해지 취소
router.post('/api/subscription/reactivate', requireAuth, async function (req, res) {
  try {
    const userId = req.user.id; // requireAuth에서 추출

    const { data: subscription } = await req.supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!subscription) {
      return res.status(404).json({ success: false, message: '구독 정보를 찾을 수 없습니다.' });
    }

    if (!subscription.cancel_at_period_end) {
      return res.status(400).json({ success: false, message: '해지 예약된 구독이 아닙니다.' });
    }

    // 해지 취소: cancel_at_period_end를 false로 변경
    const { error: updateError } = await req.supabase
      .from('user_subscriptions')
      .update({ 
        cancel_at_period_end: false,
        updated_at: new Date().toISOString()
      })
      .eq('subscription_id', subscription.subscription_id);

    if (updateError) {
      console.error('구독 해지 취소 실패:', updateError);
      return res.status(500).json({ success: false, message: 'DB 업데이트 중 오류가 발생했습니다.' });
    }

    console.log(`구독 해지 취소 완료: ${userId}, subscription_id: ${subscription.subscription_id}`);

    res.json({
      success: true,
      message: '구독 해지가 취소되었습니다. 다음 결제일에 정상적으로 결제가 진행됩니다.',
    });
  } catch (error) {
    console.error('구독 해지 취소 오류:', error);
    res.status(500).json({ success: false, message: '구독 해지 취소 중 오류가 발생했습니다.' });
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

// ============================================
// 프로그램 다운로드
// ============================================

// 최신 프로그램 다운로드
router.get('/api/download/latest', requireAuth, async (req, res) => {
  try {
    console.log('다운로드 요청 - releases/pharmchecker/downloads 폴더에서 파일 목록 조회 중...');
    
    // pharmchecker/downloads 폴더 확인
    const { data: files, error } = await supabaseAdmin.storage
      .from('releases')
      .list('pharmchecker/downloads', {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    console.log('Storage 응답:', { filesCount: files?.length, error });
    
    if (error) {
      console.error('Storage 파일 목록 조회 오류:', error);
      return res.status(500).json({ 
        success: false, 
        message: '파일 목록을 불러오는 중 오류가 발생했습니다.',
        error: error.message 
      });
    }

    console.log('조회된 파일 목록:', files?.map(f => f.name));

    // exe, bat 파일 필터링
    const downloadFiles = files?.filter(file => {
      const name = file.name.toLowerCase();
      return name.endsWith('.exe') || name.endsWith('.bat');
    }) || [];
    
    console.log('다운로드 대상 파일:', downloadFiles?.map(f => f.name));

    if (downloadFiles.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: '다운로드 가능한 파일이 없습니다.' 
      });
    }

    // 모든 파일에 대한 Signed URL 생성
    const fileUrls = await Promise.all(
      downloadFiles.map(async (file) => {
        const { data: urlData, error: signError } = await supabaseAdmin.storage
          .from('releases')
          .createSignedUrl(`pharmchecker/downloads/${file.name}`, 3600);
        
        if (signError) {
          console.error(`Signed URL 생성 오류 (${file.name}):`, signError);
          return null;
        }
        
        return {
          filename: file.name,
          downloadUrl: urlData.signedUrl,
          size: file.metadata?.size,
          createdAt: file.created_at
        };
      })
    );

    // 실패한 파일 제외
    const validUrls = fileUrls.filter(url => url !== null);

    if (validUrls.length === 0) {
      return res.status(500).json({ 
        success: false, 
        message: '다운로드 링크 생성 중 오류가 발생했습니다.' 
      });
    }

    res.json({
      success: true,
      files: validUrls
    });

  } catch (error) {
    console.error('다운로드 URL 생성 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '다운로드 준비 중 오류가 발생했습니다.' 
    });
  }
});

module.exports = router;