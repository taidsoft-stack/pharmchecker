const express = require('express');
const router = express.Router();
const { requireAdmin } = require('./middleware');
const { supabaseAdmin } = require('../../config/supabase');
const { getUserEmail, getUserEmailsBatch } = require('../../utils/admin-email-helper');

// 모바일 조회용 회원 목록 API
router.get('/mobile/users', requireAdmin, async (req, res) => {
  try {
    const {
      pharmacy_name = '',
      name = '',
      limit = '100'
    } = req.query;

    // users 테이블에서 검색 (RLS 적용)
    let query = req.supabase
      .from('users')
      .select('user_id, pharmacy_name, address, detail_address, postcode, pharmacist_name, pharmacist_phone, is_deleted')
      .limit(parseInt(limit));

    // 약국명 검색 (선택사항)
    if (pharmacy_name) {
      query = query.ilike('pharmacy_name', `%${pharmacy_name}%`);
    }

    // 약사명 검색 (선택사항)
    if (name) {
      query = query.ilike('pharmacist_name', `%${name}%`);
    }

    query = query.order('created_at', { ascending: false });

    const { data: users, error } = await query;

    if (error) {
      console.error('[모바일 회원 조회 오류]', error);
      return res.status(500).json({ error: '서버 오류' });
    }

    console.log(`[모바일 회원 조회] 검색 결과: ${users?.length || 0}명`);

    // 각 회원의 최근 메모 3개 및 구독 정보 조회
    const usersWithDetails = await Promise.all(
      (users || []).map(async (user) => {
        // 최근 메모 조회 (RLS 적용)
        const { data: memos } = await req.supabase
          .from('admin_user_memos')
          .select('memo, created_at, admin_id')
          .eq('user_id', user.user_id)
          .order('created_at', { ascending: false })
          .limit(3);

        // admin_id로 이메일 조회 (admins 테이블에서)
        const adminIds = [...new Set((memos || []).map(m => m.admin_id))];
        const { data: adminEmails } = await req.supabase
          .from('admins')
          .select('admin_id, email')
          .in('admin_id', adminIds);
        
        const adminEmailMap = new Map((adminEmails || []).map(a => [a.admin_id, a.email]));
        
        const memosWithEmail = (memos || []).map(memo => ({
          ...memo,
          admin_email: adminEmailMap.get(memo.admin_id) || '알 수 없음'
        }));

        // 구독 정보 조회 (RLS 적용)
        const { data: subscription } = await req.supabase
          .from('user_subscriptions')
          .select(`
            subscription_id,
            status,
            current_period_start,
            current_period_end,
            next_billing_at,
            cancel_at_period_end,
            canceled_at,
            promotion_id,
            promotion_applied_at,
            promotion_expires_at,
            failed_at,
            grace_until,
            entry_plan_id,
            billing_plan_id
          `)
          .eq('user_id', user.user_id)
          .single();

        // 플랜 정보 조회
        let entryPlan = null;
        let billingPlan = null;

        if (subscription) {
          // entry_plan 조회 (RLS 적용)
          if (subscription.entry_plan_id) {
            const { data } = await req.supabase
              .from('subscription_plans')
              .select('plan_id, plan_code, plan_name, monthly_price')
              .eq('plan_id', subscription.entry_plan_id)
              .single();
            entryPlan = data;
          }

          // billing_plan 조회 (RLS 적용)
          if (subscription.billing_plan_id) {
            const { data } = await req.supabase
              .from('subscription_plans')
              .select('plan_id, plan_code, plan_name, monthly_price')
              .eq('plan_id', subscription.billing_plan_id)
              .single();
            billingPlan = data;
          }
        }

        return {
          ...user,
          latest_memos: memosWithEmail,
          subscription: subscription || null,
          entry_plan: entryPlan,
          billing_plan: billingPlan
        };
      })
    );

    res.json({ users: usersWithDetails });
  } catch (error) {
    console.error('[모바일 회원 조회 오류]', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 회원 목록 조회 (검색, 필터링, 페이지네이션)
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      name = '',           // 약사명 검색
      email = '',          // 이메일 검색
      startDate = '',      // 기간 검색 시작일
      endDate = '',        // 기간 검색 종료일
      subscriptionStatus = '', // 'active', 'cancelled', 'none'
      accountStatus = '', // 'active', 'deleted'
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // 1단계: 이메일 검색이 있으면 auth.users에서 먼저 필터링
    let emailMatchedUserIds = null;
    if (email) {
      const { data: { users: authUsers }, error: authError } = await supabaseAdmin.auth.admin.listUsers();
      
      if (authError) {
        console.error('[이메일 검색 오류]', authError);
      } else {
        emailMatchedUserIds = authUsers
          .filter(u => u.email?.toLowerCase().includes(email.toLowerCase()))
          .map(u => u.id);
        
        console.log(`[이메일 검색] 검색어: "${email}", 매칭된 사용자: ${emailMatchedUserIds.length}명`);
        
        if (emailMatchedUserIds.length === 0) {
          return res.json({ users: [], total: 0, page: parseInt(page), limit: parseInt(limit), totalPages: 0 });
        }
      }
    }
    
    // 2단계: users 테이블에서 조건에 맞는 회원 조회
    // RLS 정책 적용을 위해 인증된 supabase 클라이언트 사용
    let query = req.supabase
      .from('users')
      .select(`
        user_id,
        pharmacist_name,
        pharmacy_name,
        pharmacist_phone,
        is_active,
        is_deleted,
        created_at,
        deleted_at
      `, { count: 'exact' });
    
    // 이메일 검색 결과로 필터링
    if (emailMatchedUserIds) {
      query = query.in('user_id', emailMatchedUserIds);
    }
    
    // 이름 검색 (AND 조건)
    if (name) {
      query = query.ilike('pharmacist_name', `%${name}%`);
    }
    
    // 계정 상태 필터
    if (accountStatus === 'active') {
      query = query.eq('is_deleted', false).eq('is_active', true);
    } else if (accountStatus === 'deleted') {
      query = query.eq('is_deleted', true);
    } else if (accountStatus === 'returning') {
      query = query.eq('is_deleted', false).eq('is_returning_customer', true);
    }
    
    // 정렬
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });
    
    // 페이지네이션
    query = query.range(offset, offset + parseInt(limit) - 1);
    
    const { data: users, error, count } = await query;
    
    if (error) {
      console.error('회원 조회 오류:', error);
      return res.status(500).json({ error: '서버 오류' });
    }
    
    // 3단계: 각 회원의 상세 정보 조회
    // 이메일은 통제된 헬퍼 함수로 일괄 조회 (감사 로그 기록)
    const userIds = (users || []).map(u => u.user_id);
    const emailMap = await getUserEmailsBatch(userIds, req.admin.admin_id, '회원 목록 조회');
    
    const usersWithDetails = await Promise.all(
      (users || []).map(async (user) => {
        
        // 활성 구독 조회 (RLS 적용)
        const { data: subscriptions } = await req.supabase
          .from('user_subscriptions')
          .select(`
            subscription_id,
            status,
            current_period_start,
            current_period_end,
            next_billing_at,
            billing_plan_id,
            entry_plan_id,
            promotion_id,
            promotion_applied_at,
            promotion_expires_at,
            cancel_at_period_end
          `)
          .eq('user_id', user.user_id)
          .order('created_at', { ascending: false })
          .limit(1);
        
        const subscription = subscriptions?.[0];
        
        // 구독이 있으면 플랜 정보 조회 (RLS 적용)
        let billingPlan = null;
        if (subscription?.billing_plan_id) {
          const { data } = await req.supabase
            .from('subscription_plans')
            .select('plan_id, plan_code, plan_name, monthly_price')
            .eq('plan_id', subscription.billing_plan_id)
            .single();
          billingPlan = data;
        }
        
        // 마지막 결제 정보 조회 (RLS 적용)
        const { data: lastPayment } = await req.supabase
          .from('billing_payments')
          .select('payment_date, amount, status')
          .eq('user_id', user.user_id)
          .eq('status', 'success')
          .order('payment_date', { ascending: false })
          .limit(1)
          .single();
        
        // 적용된 프로모션 조회 (RLS 적용)
        const { data: promotions } = await req.supabase
          .from('subscription_promotions')
          .select(`
            promotion_id,
            promotion_type,
            discount_rate,
            free_months,
            expires_at,
            is_active
          `)
          .eq('user_id', user.user_id)
          .eq('is_active', true)
          .order('created_at', { ascending: false });
        
        // 최근 관리자 메모/비고 조회 (가장 최근 업데이트된 것 1개) (RLS 적용)
        const { data: memos } = await req.supabase
          .from('admin_user_memos')
          .select('remarks, memo, created_at, updated_at')
          .eq('user_id', user.user_id)
          .order('updated_at', { ascending: false })
          .limit(1);
        
        const latestMemo = memos?.[0];
        
        return {
          ...user,
          email: emailMap.get(user.user_id) || 'N/A', // 통제된 헬퍼로 조회한 이메일
          subscription: subscription ? {
            status: subscription.status,
            plan_name: billingPlan?.plan_name || 'N/A',
            plan_code: billingPlan?.plan_code || 'N/A',
            monthly_price: billingPlan?.monthly_price || 0,
            current_period_start: subscription.current_period_start,
            current_period_end: subscription.current_period_end,
            next_billing_at: subscription.next_billing_at,
            promotion_id: subscription.promotion_id,
            promotion_applied_at: subscription.promotion_applied_at,
            promotion_expires_at: subscription.promotion_expires_at,
            cancel_at_period_end: subscription.cancel_at_period_end
          } : null,
          last_payment: lastPayment ? {
            date: lastPayment.payment_date,
            amount: lastPayment.amount
          } : null,
          active_promotions: promotions || [],
          latest_remarks: latestMemo?.remarks || '',
          latest_memo: latestMemo?.memo || ''
        };
      })
    );
    
    // 4단계: 필터 적용
    let filteredUsers = usersWithDetails;
    
    // 구독 상태 필터
    if (subscriptionStatus === 'active') {
      filteredUsers = filteredUsers.filter(u => u.subscription?.status === 'active');
    } else if (subscriptionStatus === 'cancelled') {
      filteredUsers = filteredUsers.filter(u => u.subscription?.status === 'cancelled');
    } else if (subscriptionStatus === 'none') {
      filteredUsers = filteredUsers.filter(u => !u.subscription);
    }
    
    // 기간 필터 (가입일 또는 구독 기간)
    if (startDate || endDate) {
      filteredUsers = filteredUsers.filter(u => {
        // 구독 상태에 따라 다른 기준 적용
        if (accountStatus === 'deleted') {
          // 탈퇴 회원: 탈퇴일 기준
          const targetDate = new Date(u.deleted_at);
          const start = startDate ? new Date(startDate) : null;
          const end = endDate ? new Date(endDate) : null;
          
          if (start && targetDate < start) return false;
          if (end && targetDate > end) return false;
          return true;
        } else if (subscriptionStatus === 'active') {
          // 활성 구독: 구독 기간 내 포함 여부
          if (!u.subscription) return false;
          
          const subStart = new Date(u.subscription.current_period_start);
          const subEnd = new Date(u.subscription.current_period_end);
          const filterStart = startDate ? new Date(startDate) : null;
          const filterEnd = endDate ? new Date(endDate) : null;
          
          // 구독 기간이 필터 기간과 겹치는지 확인
          if (filterStart && subEnd < filterStart) return false;
          if (filterEnd && subStart > filterEnd) return false;
          return true;
        } else {
          // 기본: 가입일 기준
          const targetDate = new Date(u.created_at);
          const start = startDate ? new Date(startDate) : null;
          const end = endDate ? new Date(endDate) : null;
          
          if (start && targetDate < start) return false;
          if (end && targetDate > end) return false;
          return true;
        }
      });
    }
    
    res.json({
      users: filteredUsers,
      total: filteredUsers.length,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(filteredUsers.length / parseInt(limit))
    });
  } catch (error) {
    console.error('회원 목록 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 회원 상세 정보 조회
router.get('/users/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // 1. 기본 회원 정보 (RLS 적용)
    const { data: user, error: userError } = await req.supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (userError || !user) {
      return res.status(404).json({ error: '회원을 찾을 수 없습니다' });
    }
    
    // 2. 이메일 조회 (통제된 헬퍼 사용, 감사 로그 기록)
    const email = await getUserEmail(userId, req.admin.admin_id, '회원 상세 정보 조회');
    
    // 3. 구독 내역 (전체) (RLS 적용)
    const { data: subscriptions, error: subscriptionsError } = await req.supabase
      .from('user_subscriptions')
      .select(`
        subscription_id,
        status,
        current_period_start,
        current_period_end,
        next_billing_at,
        created_at,
        canceled_at,
        billing_plan_id,
        subscription_plans!user_subscriptions_billing_plan_id_fkey (
          plan_name,
          monthly_price
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    console.log(`[구독 내역] userId: ${userId}, 구독 개수: ${subscriptions?.length || 0}`);
    if (subscriptionsError) console.error('[구독 내역 오류]', subscriptionsError);
    
    // 4. 결제 내역 (전체) (RLS 적용)
    const { data: paymentsRaw, error: paymentsError } = await req.supabase
      .from('billing_payments')
      .select(`
        payment_id,
        order_id,
        payment_key,
        amount,
        status,
        fail_reason,
        requested_at,
        approved_at,
        created_at,
        promotion_id,
        payment_methods!billing_payments_payment_method_id_fkey (
          card_company,
          card_last4
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    console.log(`[결제 내역] userId: ${userId}, 결제 개수: ${paymentsRaw?.length || 0}`);
    if (paymentsError) console.error('[결제 내역 오류]', paymentsError);
    
    // 프론트엔드 호환성을 위한 필드명 변환
    const payments = (paymentsRaw || []).map(p => ({
      payment_id: p.payment_id,
      payment_date: p.approved_at || p.requested_at, // 결제일 = 승인일 또는 요청일
      amount: p.amount,
      status: p.status,
      payment_method: p.payment_methods ? `${p.payment_methods.card_company} (${p.payment_methods.card_last4})` : '알 수 없음', // 결제수단
      toss_order_id: p.order_id, // 주문번호
      toss_payment_key: p.payment_key,
      failure_message: p.fail_reason, // 실패사유
      created_at: p.created_at
    }));
    
    // 5. 사용자 프로모션 내역 (RLS 적용)
    const { data: userPromotionsRaw, error: promotionsError } = await req.supabase
      .from('pending_user_promotions')
      .select(`
        pending_id,
        promotion_id,
        created_at,
        applied_at,
        payment_id,
        status,
        subscription_promotions!pending_user_promotions_promotion_id_fkey (
          promotion_code,
          promotion_name,
          discount_type,
          discount_value,
          free_months,
          start_at,
          end_at
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    console.log(`[프로모션 내역] userId: ${userId}, 프로모션 개수: ${userPromotionsRaw?.length || 0}`);
    if (promotionsError) console.error('[프로모션 내역 오류]', promotionsError);
    
    // 프론트엔드 호환성을 위한 필드명 변환
    const promotions = (userPromotionsRaw || []).map(p => ({
      promotion_id: p.promotion_id,
      promotion_type: p.subscription_promotions?.discount_type || 'unknown', // discount_type -> promotion_type
      discount_rate: p.subscription_promotions?.discount_type === 'percent' ? p.subscription_promotions?.discount_value : null,
      free_months: p.subscription_promotions?.free_months,
      start_date: p.subscription_promotions?.start_at || p.created_at,
      expires_at: p.subscription_promotions?.end_at,
      is_active: p.status === 'applied' || p.status === 'selected',
      promotion_name: p.subscription_promotions?.promotion_name,
      used_at: p.applied_at
    }));
    
    // 6. 관리자 메모/비고 내역 (전체) (RLS 적용)
    // admins.email은 테이블에 있으므로 조인으로 직접 조회
    const { data: memos, error: memosError } = await req.supabase
      .from('admin_user_memos')
      .select(`
        memo_id, 
        memo, 
        remarks, 
        created_at, 
        updated_at, 
        admin_id
      `)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    
    console.log(`[메모 조회] userId: ${userId}, 메모 개수: ${memos?.length || 0}`);
    if (memosError) console.error('[메모 조회 오류]', memosError);
    
    // 메모 작성자 이메일 조회 (admins 테이블에서)
    const adminIds = [...new Set((memos || []).map(m => m.admin_id))];
    const { data: adminEmails } = await req.supabase
      .from('admins')
      .select('admin_id, email')
      .in('admin_id', adminIds);
    
    const adminEmailMap = new Map((adminEmails || []).map(a => [a.admin_id, a.email]));
    
    // 메모 데이터 변환
    const memosFormatted = (memos || []).map(memo => ({
      memo_id: memo.memo_id,
      memo: memo.memo,
      remarks: memo.remarks,
      created_at: memo.created_at,
      updated_at: memo.updated_at,
      admin_id: memo.admin_id,
      admin_email: adminEmailMap.get(memo.admin_id) || '알 수 없음'
    }));
    
    if (memos && memos.length > 0) {
      console.log('[첫 번째 메모]', JSON.stringify(memos[0], null, 2));
    }
    
    // 7. 관리자 활동 로그 (이 회원에 대한) (RLS 적용)
    const { data: activityLogsRaw, error: logsError } = await req.supabase
      .from('admin_activity_logs')
      .select(`
        log_id,
        action,
        target_type,
        target_id,
        created_at,
        admin_id
      `)
      .eq('target_type', 'user')
      .eq('target_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    console.log(`[활동 로그] userId: ${userId}, 로그 개수: ${activityLogsRaw?.length || 0}`);
    if (logsError) console.error('[활동 로그 오류]', logsError);
    
    // 활동 로그 작성자 이메일 조회
    const logAdminIds = [...new Set((activityLogsRaw || []).map(l => l.admin_id))];
    const { data: logAdminEmails } = await req.supabase
      .from('admins')
      .select('admin_id, email')
      .in('admin_id', logAdminIds);
    
    const logAdminEmailMap = new Map((logAdminEmails || []).map(a => [a.admin_id, a.email]));
    
    const activityLogs = (activityLogsRaw || []).map(log => ({
      ...log,
      admin_email: logAdminEmailMap.get(log.admin_id) || '알 수 없음'
    }));
    
    res.json({
      user: {
        ...user,
        email: email || 'N/A', // 통제된 헬퍼로 조회한 이메일
      },
      subscriptions: subscriptions || [],
      payments: payments || [],
      promotions: promotions || [],
      memos: memosFormatted || [],
      activity_logs: activityLogs || []
    });
  } catch (error) {
    console.error('회원 상세 정보 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 회원 비고 조회
router.get('/users/:userId/memos', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const { data, error } = await req.supabase
      .from('admin_user_memos')
      .select('memo_id, memo, remarks, created_at, updated_at, admin_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('메모 조회 오류:', error);
      return res.status(500).json({ error: '서버 오류' });
    }
    
    // admin_id로 이메일 조회 (admins 테이블에서)
    const adminIds = [...new Set((data || []).map(m => m.admin_id))];
    const { data: adminEmails } = await req.supabase
      .from('admins')
      .select('admin_id, email')
      .in('admin_id', adminIds);
    
    const adminEmailMap = new Map((adminEmails || []).map(a => [a.admin_id, a.email]));
    
    const memosWithEmail = (data || []).map(memo => ({
      ...memo,
      admin_email: adminEmailMap.get(memo.admin_id) || '알 수 없음'
    }));
    
    res.json({ memos: memosWithEmail });
  } catch (error) {
    console.error('메모 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 회원 메모/비고 추가/업데이트
router.post('/users/:userId/memos', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { remarks, memo } = req.body;
    
    // 메모 또는 비고 중 하나는 있어야 함
    if (!remarks && !memo) {
      return res.status(400).json({ error: '메모 또는 비고를 입력해주세요' });
    }
    
    // 항상 새로운 메모 생성 (이력 관리) - RLS 적용
    const { data, error } = await req.supabase
      .from('admin_user_memos')
      .insert({
        user_id: userId,
        admin_id: req.admin.admin_id,
        remarks: remarks || null,
        memo: memo || remarks  // memo가 없으면 remarks 사용 (memo는 NOT NULL)
      })
      .select()
      .single();
    
    if (error) {
      console.error('[메모 저장 오류]', error);
      throw error;
    }
    
    console.log('[메모 저장 성공]', { userId, admin_id: req.admin.admin_id, memo_id: data.memo_id });
    
    // 활동 로그 기록 (RLS 적용)
    await req.supabase.from('admin_activity_logs').insert({
      admin_id: req.admin.admin_id,
      action: 'create_user_memo',
      target_type: 'user',
      target_id: userId
    });
    
    res.json({ success: true, memo: data });
  } catch (error) {
    console.error('메모 저장 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

module.exports = router;
