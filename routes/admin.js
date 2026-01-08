const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 서버 인스턴스 ID (서버 시작 시마다 새로 생성)
const SERVER_INSTANCE_ID = crypto.randomBytes(16).toString('hex');
const SERVER_START_TIME = Date.now();

console.log(`[Admin] 서버 인스턴스 ID: ${SERVER_INSTANCE_ID}`);
console.log(`[Admin] 서버 시작 시각: ${new Date(SERVER_START_TIME).toISOString()}`);

// ===== 관리자 인증 미들웨어 =====
async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[requireAdmin] Authorization 헤더 없음');
    return res.status(401).json({ error: '인증 필요' });
  }
  
  const sessionToken = authHeader.substring(7);
  console.log('[requireAdmin] 받은 토큰 앞 50자:', sessionToken.substring(0, 50));
  console.log('[requireAdmin] 토큰 길이:', sessionToken.length);
  console.log('[requireAdmin] 토큰 끝 20자:', sessionToken.substring(sessionToken.length - 20));
  
  try {
    // 세션 토큰 파싱 (우리가 발급한 커스텀 토큰)
    // 형식: v1.BASE64_PAYLOAD.sig
    const firstDotIndex = sessionToken.indexOf('.');
    const lastDotIndex = sessionToken.lastIndexOf('.');
    console.log('[requireAdmin] firstDotIndex:', firstDotIndex, 'lastDotIndex:', lastDotIndex);
    
    if (firstDotIndex === -1 || lastDotIndex === -1 || firstDotIndex === lastDotIndex) {
      console.log('[requireAdmin] 잘못된 토큰 형식: 구분자 없음');
      return res.status(401).json({ error: '잘못된 토큰 형식' });
    }
    
    const version = sessionToken.substring(0, firstDotIndex);
    const payload = sessionToken.substring(firstDotIndex + 1, lastDotIndex);
    const signature = sessionToken.substring(lastDotIndex + 1);
    
    if (version !== 'v1') {
      console.log('[requireAdmin] 잘못된 토큰 버전:', version);
      return res.status(401).json({ error: '잘못된 토큰 버전' });
    }
    
    const tokenData = JSON.parse(Buffer.from(payload, 'base64').toString());
    console.log('[requireAdmin] 토큰 파싱 성공, email:', tokenData.email);
    
    // 서버 인스턴스 ID 확인 (서버 재시작 시 이전 토큰 무효화)
    if (tokenData.instanceId !== SERVER_INSTANCE_ID) {
      console.log('[requireAdmin] 인스턴스 ID 불일치:', tokenData.instanceId, '!=', SERVER_INSTANCE_ID);
      return res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해주세요.' });
    }
    
    // 토큰에서 idToken 추출
    const idToken = tokenData.idToken;
    
    // Google OAuth ID Token에서 이메일 추출 (간단한 JWT 파싱)
    const oauthPayload = JSON.parse(
      Buffer.from(idToken.split('.')[1], 'base64').toString()
    );
    const email = oauthPayload.email;
    
    if (!email) {
      console.log('[requireAdmin] 이메일 없음');
      return res.status(401).json({ error: '유효하지 않은 토큰' });
    }
    
    console.log('[requireAdmin] 이메일 확인:', email);
    
    // auth.users에서 사용자 조회
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    const authUser = users?.find(u => u.email === email);
    
    if (!authUser) {
      console.log('[requireAdmin] 사용자 없음:', email);
      return res.status(401).json({ error: '유효하지 않은 사용자' });
    }
    
    console.log('[requireAdmin] 사용자 확인:', authUser.id);
    
    // 관리자 권한 확인 (public.admins)
    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('*')
      .eq('admin_id', authUser.id)
      .eq('is_active', true)
      .single();
    
    if (adminError || !admin) {
      console.log('[requireAdmin] 관리자 권한 없음:', adminError?.message || '데이터 없음');
      return res.status(403).json({ error: '관리자 권한 없음' });
    }
    
    console.log('[requireAdmin] 인증 성공:', admin.admin_id);
    req.admin = admin;
    req.user = authUser;
    next();
  } catch (error) {
    console.error('[requireAdmin] 인증 오류:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
}

// ===== 페이지 렌더링 =====

// 관리자 메인 페이지 (/admin)
router.get('/', async (req, res) => {
  // 서버에서 직접 토큰 검증 후 페이지 렌더링
  const token = req.cookies?.admin_session_token || null;
  
  if (!token) {
    // 토큰이 없으면 로그인 페이지 렌더링
    return res.render('admin-login');
  }
  
  try {
    // 커스텀 세션 토큰 파싱
    // 형식: v1.BASE64_PAYLOAD.sig
    const firstDotIndex = token.indexOf('.');
    const lastDotIndex = token.lastIndexOf('.');
    
    if (firstDotIndex === -1 || lastDotIndex === -1 || firstDotIndex === lastDotIndex) {
      res.clearCookie('admin_session_token', { path: '/' });
      res.clearCookie('admin_session_token', { path: '/admin' });
      return res.render('admin-login');
    }
    
    const version = token.substring(0, firstDotIndex);
    const payload = token.substring(firstDotIndex + 1, lastDotIndex);
    
    if (version !== 'v1') {
      res.clearCookie('admin_session_token', { path: '/' });
      res.clearCookie('admin_session_token', { path: '/admin' });
      return res.render('admin-login');
    }
    
    const tokenData = JSON.parse(Buffer.from(payload, 'base64').toString());
    
    // 서버 인스턴스 ID 확인 (서버 재시작 시 이전 토큰 무효화)
    if (tokenData.instanceId !== SERVER_INSTANCE_ID) {
      console.log('[Admin] 세션 무효: 서버가 재시작되었습니다.');
      res.clearCookie('admin_session_token', { path: '/' });
      res.clearCookie('admin_session_token', { path: '/admin' });
      return res.render('admin-login');
    }
    
    const email = tokenData.email;
    const idToken = tokenData.idToken;
    
    if (!email || !idToken) {
      // 유효하지 않은 토큰 - 쿠키 삭제
      res.clearCookie('admin_session_token', { path: '/' });
      res.clearCookie('admin_session_token', { path: '/admin' });
      return res.render('admin-login');
    }
    
    // 사용자 존재 여부 확인
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    const authUser = users?.find(u => u.email === email);
    
    if (!authUser) {
      // 사용자 없음 - 쿠키 삭제
      res.clearCookie('admin_session_token', { path: '/' });
      res.clearCookie('admin_session_token', { path: '/admin' });
      return res.render('admin-login');
    }
    
    // 관리자 권한 확인
    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('*')
      .eq('admin_id', authUser.id)
      .eq('is_active', true)
      .single();
    
    if (adminError || !admin) {
      // 관리자 권한 없음 - 쿠키 삭제
      res.clearCookie('admin_session_token', { path: '/' });
      res.clearCookie('admin_session_token', { path: '/admin' });
      return res.render('admin-login');
    }
    
    // 인증 성공 - 대시보드 렌더링
    return res.render('admin-dashboard', { adminName: email });
    
  } catch (error) {
    console.error('관리자 인증 오류:', error);
    // 토큰 파싱 실패 등 - 쿠키 삭제
    res.clearCookie('admin_session_token', { path: '/' });
    res.clearCookie('admin_session_token', { path: '/admin' });
    return res.render('admin-login');
  }
});

// 로그인 페이지
router.get('/login', (req, res) => {
  res.render('admin-login');
});

// 대시보드 페이지
router.get('/dashboard', (req, res) => {
  res.render('admin-dashboard');
});

// 모바일 조회 페이지
router.get('/mobile', async (req, res) => {
  const token = req.cookies?.admin_session_token || null;
  
  if (!token) {
    return res.render('admin-login');
  }
  
  try {
    const firstDotIndex = token.indexOf('.');
    const lastDotIndex = token.lastIndexOf('.');
    
    if (firstDotIndex === -1 || lastDotIndex === -1 || firstDotIndex === lastDotIndex) {
      res.clearCookie('admin_session_token', { path: '/' });
      res.clearCookie('admin_session_token', { path: '/admin' });
      return res.render('admin-login');
    }
    
    const version = token.substring(0, firstDotIndex);
    const payload = token.substring(firstDotIndex + 1, lastDotIndex);
    
    if (version !== 'v1') {
      res.clearCookie('admin_session_token', { path: '/' });
      res.clearCookie('admin_session_token', { path: '/admin' });
      return res.render('admin-login');
    }
    
    const tokenData = JSON.parse(Buffer.from(payload, 'base64').toString());
    
    if (tokenData.instanceId !== SERVER_INSTANCE_ID) {
      res.clearCookie('admin_session_token', { path: '/' });
      res.clearCookie('admin_session_token', { path: '/admin' });
      return res.render('admin-login');
    }
    
    const email = tokenData.email;
    
    if (!email) {
      res.clearCookie('admin_session_token', { path: '/' });
      res.clearCookie('admin_session_token', { path: '/admin' });
      return res.render('admin-login');
    }
    
    return res.render('admin-mobile', { adminName: email });
  } catch (error) {
    console.error('모바일 페이지 인증 오류:', error);
    res.clearCookie('admin_session_token', { path: '/' });
    res.clearCookie('admin_session_token', { path: '/admin' });
    return res.render('admin-login');
  }
});

// ===== API 엔드포인트 =====

// 로그인 (구글 OAuth)
router.post('/api/login', async (req, res) => {
  const { idToken, email } = req.body;
  
  try {
    console.log('관리자 로그인 시도:', email);
    
    // 1. auth.users에서 이메일로 사용자 조회
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    const authUser = users?.find(u => u.email === email);

    if (!authUser) {
      return res.status(401).json({ 
        success: false,
        error: '등록되지 않은 계정입니다' 
      });
    }

    console.log('auth.users 발견:', authUser.id);
    
    // 2. 관리자 권한 확인 (public.admins)
    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('*')
      .eq('admin_id', authUser.id)
      .eq('is_active', true)
      .single();
    
    if (adminError || !admin) {
      console.log('관리자 권한 없음:', authUser.id);
      return res.status(403).json({ 
        success: false,
        error: '관리자 권한이 없습니다. 슈퍼 관리자에게 문의하세요.' 
      });
    }

    console.log('관리자 로그인 성공:', admin.admin_id, 'role:', admin.role);
    
    // 3. 세션 기록
    await supabase
      .from('admin_sessions')
      .insert({
        admin_id: admin.admin_id,
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      });
    
    // 4. 활동 로그
    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: admin.admin_id,
        action: '로그인',
        target_type: 'auth',
        ip_address: req.ip
      });
    
    // 5. 커스텀 세션 토큰 생성 (서버 인스턴스 ID 포함)
    const customToken = {
      idToken: idToken,
      email: authUser.email,
      instanceId: SERVER_INSTANCE_ID,
      issuedAt: Date.now()
    };
    
    // Base64 인코딩 (간단한 JWT 형태)
    const sessionToken = 'v1.' + Buffer.from(JSON.stringify(customToken)).toString('base64') + '.sig';
    
    res.json({
      success: true,
      session_token: sessionToken,
      admin: {
        id: admin.admin_id,
        email: authUser.email,
        role: admin.role
      }
    });
  } catch (error) {
    console.error('관리자 로그인 오류:', error);
    res.status(500).json({ 
      success: false,
      error: '서버 오류가 발생했습니다' 
    });
  }
});

// 모바일 조회용 회원 목록 API
router.get('/api/mobile/users', requireAdmin, async (req, res) => {
  try {
    const {
      pharmacy_name = '',
      name = ''
    } = req.query;

    // users 테이블에서 검색 (탈퇴 회원 포함)
    let query = supabase
      .from('users')
      .select('user_id, pharmacy_name, address, detail_address, postcode, pharmacist_name, pharmacist_phone, is_deleted')
      .limit(100);

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
      console.error('모바일 회원 조회 오류:', error);
      return res.status(500).json({ error: '서버 오류' });
    }

    // 각 회원의 최근 메모 3개 및 구독 정보 조회
    const usersWithDetails = await Promise.all(
      (users || []).map(async (user) => {
        // 최근 메모 조회
        const { data: memos } = await supabase
          .from('admin_user_memos')
          .select('memo, created_at, admin_id')
          .eq('user_id', user.user_id)
          .order('created_at', { ascending: false })
          .limit(3);

        // admin_id로 이메일 조회
        const memosWithEmail = await Promise.all(
          (memos || []).map(async (memo) => {
            const { data: { user: adminUser } } = await supabase.auth.admin.getUserById(memo.admin_id);
            return {
              ...memo,
              admin_email: adminUser?.email || '알 수 없음'
            };
          })
        );

        // 구독 정보 조회
        const { data: subscription } = await supabase
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
          // entry_plan 조회
          if (subscription.entry_plan_id) {
            const { data } = await supabase
              .from('subscription_plans')
              .select('plan_id, plan_code, plan_name, monthly_price')
              .eq('plan_id', subscription.entry_plan_id)
              .single();
            entryPlan = data;
          }

          // billing_plan 조회
          if (subscription.billing_plan_id) {
            const { data } = await supabase
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
    console.error('모바일 회원 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 로그아웃
router.post('/api/logout', requireAdmin, async (req, res) => {
  try {
    // 활동 로그 기록
    await supabase
      .from('admin_activity_logs')
      .insert({
        admin_id: req.admin.admin_id,
        action: '로그아웃',
        target_type: 'auth',
        ip_address: req.ip
      });
    
    res.json({ success: true });
  } catch (error) {
    console.error('로그아웃 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 내 정보
router.get('/api/me', requireAdmin, async (req, res) => {
  res.json({
    admin_id: req.admin.admin_id,
    admin_name: req.user.email.split('@')[0],
    email: req.user.email,
    role: req.admin.role
  });
});

// 회원 비고 조회
router.get('/api/users/:userId/memos', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const { data, error } = await supabase
      .from('admin_user_memos')
      .select('memo_id, memo, remarks, created_at, updated_at, admin_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('메모 조회 오류:', error);
      return res.status(500).json({ error: '서버 오류' });
    }
    
    // admin_id로 이메일 조회
    const memosWithEmail = await Promise.all(
      (data || []).map(async (memo) => {
        const { data: { user: adminUser } } = await supabase.auth.admin.getUserById(memo.admin_id);
        return {
          ...memo,
          admin_email: adminUser?.email || '알 수 없음'
        };
      })
    );
    
    res.json({ memos: memosWithEmail });
  } catch (error) {
    console.error('메모 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 회원 메모/비고 추가/업데이트
router.post('/api/users/:userId/memos', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { remarks, memo } = req.body;
    
    // 메모 또는 비고 중 하나는 있어야 함
    if (!remarks && !memo) {
      return res.status(400).json({ error: '메모 또는 비고를 입력해주세요' });
    }
    
    // 항상 새로운 메모 생성 (이력 관리)
    const { data, error } = await supabase
      .from('admin_user_memos')
      .insert({
        user_id: userId,
        admin_id: req.admin.admin_id,
        remarks: remarks || '',
        memo: memo || ''
      })
      .select()
      .single();
    
    if (error) throw error;
    
    console.log('[메모 저장 성공]', { userId, admin_id: req.admin.admin_id, memo_id: data.memo_id });
    
    // 활동 로그 기록
    await supabase.from('admin_activity_logs').insert({
      admin_id: req.admin.admin_id,
      action_type: 'create_user_memo',
      target_type: 'user',
      target_id: userId,
      details: { 
        remarks: remarks || '',
        memo: memo || '',
        has_memo: !!memo,
        has_remarks: !!remarks
      }
    });
    
    res.json({ success: true, memo: data });
  } catch (error) {
    console.error('메모 저장 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 회원 목록 조회 (검색, 필터링, 페이지네이션)
router.get('/api/users', requireAdmin, async (req, res) => {
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
      const { data: { users: authUsers } } = await supabase.auth.admin.listUsers();
      emailMatchedUserIds = authUsers
        .filter(u => u.email?.toLowerCase().includes(email.toLowerCase()))
        .map(u => u.id);
      
      if (emailMatchedUserIds.length === 0) {
        return res.json({ users: [], total: 0, page: parseInt(page), limit: parseInt(limit), totalPages: 0 });
      }
    }
    
    // 2단계: users 테이블에서 조건에 맞는 회원 조회
    let query = supabase
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
    const usersWithDetails = await Promise.all(
      (users || []).map(async (user) => {
        // 이메일 조회
        const { data: { user: authUser } } = await supabase.auth.admin.getUserById(user.user_id);
        
        // 활성 구독 조회
        const { data: subscriptions } = await supabase
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
        
        // 구독이 있으면 플랜 정보 조회
        let billingPlan = null;
        if (subscription?.billing_plan_id) {
          const { data } = await supabase
            .from('subscription_plans')
            .select('plan_id, plan_code, plan_name, monthly_price')
            .eq('plan_id', subscription.billing_plan_id)
            .single();
          billingPlan = data;
        }
        
        // 마지막 결제 정보 조회
        const { data: lastPayment } = await supabase
          .from('billing_payments')
          .select('payment_date, amount, status')
          .eq('user_id', user.user_id)
          .eq('status', 'success')
          .order('payment_date', { ascending: false })
          .limit(1)
          .single();
        
        // 적용된 프로모션 조회
        const { data: promotions } = await supabase
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
        
        // 최근 관리자 메모/비고 조회 (가장 최근 업데이트된 것 1개)
        const { data: memos } = await supabase
          .from('admin_user_memos')
          .select('remarks, memo, created_at, updated_at')
          .eq('user_id', user.user_id)
          .order('updated_at', { ascending: false })
          .limit(1);
        
        const latestMemo = memos?.[0];
        
        return {
          ...user,
          email: authUser?.email || 'N/A',
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
router.get('/api/users/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // 1. 기본 회원 정보
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (userError || !user) {
      return res.status(404).json({ error: '회원을 찾을 수 없습니다' });
    }
    
    // 2. auth.users에서 이메일 조회
    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userId);
    
    // 3. 구독 내역 (전체)
    const { data: subscriptions } = await supabase
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
          billing_period,
          price
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    // 4. 결제 내역 (전체)
    const { data: payments } = await supabase
      .from('billing_payments')
      .select(`
        payment_id,
        payment_date,
        amount,
        status,
        payment_method,
        toss_payment_key,
        toss_order_id,
        failure_code,
        failure_message,
        created_at
      `)
      .eq('user_id', userId)
      .order('payment_date', { ascending: false });
    
    // 5. 프로모션 내역 (전체)
    const { data: promotions } = await supabase
      .from('subscription_promotions')
      .select(`
        promotion_id,
        promotion_type,
        discount_rate,
        free_months,
        start_date,
        expires_at,
        is_active,
        created_at
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    // 6. 관리자 메모/비고 내역 (전체)
    const { data: memosRaw, error: memosError } = await supabase
      .from('admin_user_memos')
      .select('memo_id, memo, remarks, created_at, updated_at, admin_id')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    
    console.log(`[메모 조회] userId: ${userId}, 메모 개수: ${memosRaw?.length || 0}`);
    if (memosError) console.error('[메모 조회 오류]', memosError);
    
    // admin_id로 이메일 조회
    const memos = await Promise.all(
      (memosRaw || []).map(async (memo) => {
        const { data: { user: adminUser } } = await supabase.auth.admin.getUserById(memo.admin_id);
        return {
          ...memo,
          admin_email: adminUser?.email || '알 수 없음'
        };
      })
    );
    
    if (memos && memos.length > 0) {
      console.log('[첫 번째 메모]', JSON.stringify(memos[0], null, 2));
    }
    
    // 7. 관리자 활동 로그 (이 회원에 대한)
    const { data: activityLogs } = await supabase
      .from('admin_activity_logs')
      .select(`
        log_id,
        action_type,
        details,
        created_at,
        admin_id,
        admins (
          email
        )
      `)
      .eq('target_type', 'user')
      .eq('target_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    
    res.json({
      user: {
        ...user,
        email: authUser?.email || 'N/A',
        email_confirmed_at: authUser?.email_confirmed_at,
        last_sign_in_at: authUser?.last_sign_in_at
      },
      subscriptions: subscriptions || [],
      payments: payments || [],
      promotions: promotions || [],
      memos: memos || [],
      activity_logs: activityLogs || []
    });
  } catch (error) {
    console.error('회원 상세 정보 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 대시보드 통계
router.get('/api/dashboard/stats', requireAdmin, async (req, res) => {
  try {
    // 전체 회원 수
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('is_deleted', false);
    
    // 활성 구독 수
    const { count: activeSubscriptions } = await supabase
      .from('user_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
    
    // 이번 달 매출
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const { data: payments } = await supabase
      .from('billing_payments')
      .select('amount')
      .eq('status', 'success')
      .gte('approved_at', startOfMonth.toISOString());
    
    const monthlyRevenue = payments?.reduce((sum, p) => sum + p.amount, 0) || 0;
    
    // 활성 프로모션 수
    const { count: activePromotions } = await supabase
      .from('subscription_promotions')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);
    
    res.json({
      totalUsers: totalUsers || 0,
      activeSubscriptions: activeSubscriptions || 0,
      monthlyRevenue: monthlyRevenue,
      activePromotions: activePromotions || 0
    });
  } catch (error) {
    console.error('통계 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 최근 활동 로그
router.get('/api/activities/recent', requireAdmin, async (req, res) => {
  try {
    const { data: activities } = await supabase
      .from('admin_activity_logs')
      .select(`
        *,
        admins (
          admin_id
        )
      `)
      .order('created_at', { ascending: false })
      .limit(10);
    
    // auth.users에서 이메일 가져오기
    const activitiesWithNames = await Promise.all(
      (activities || []).map(async (act) => {
        const { data: { user } } = await supabase.auth.admin.getUserById(act.admin_id);
        return {
          ...act,
          admin_name: user?.email?.split('@')[0] || '알 수 없음',
          action_type: act.action
        };
      })
    );
    
    res.json(activitiesWithNames);
  } catch (error) {
    console.error('활동 로그 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 구독 현황 조회
router.get('/api/subscriptions', requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      startDate = '',
      endDate = '',
      status = '',
      pharmacistName = '',
      pharmacyName = ''
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 구독 조회
    let query = supabase
      .from('user_subscriptions')
      .select(`
        subscription_id,
        user_id,
        status,
        current_period_start,
        current_period_end,
        next_billing_at,
        created_at,
        canceled_at,
        cancel_at_period_end,
        billing_plan_id,
        subscription_plans!user_subscriptions_billing_plan_id_fkey (
          plan_name,
          monthly_price
        )
      `, { count: 'exact' });

    // 상태 필터
    if (status) {
      query = query.eq('status', status);
    }

    // 기간 필터 (구독 시작일 기준)
    if (startDate) {
      query = query.gte('created_at', new Date(startDate).toISOString());
    }
    if (endDate) {
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);
      query = query.lte('created_at', endDateTime.toISOString());
    }

    // 최신순 정렬
    query = query.order('created_at', { ascending: false });

    // 페이지네이션
    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: subscriptions, error, count } = await query;

    if (error) {
      console.error('구독 조회 오류:', error);
      return res.status(500).json({ error: '서버 오류' });
    }

    // 각 구독의 회원 정보 조회
    let subscriptionsWithUsers = await Promise.all(
      (subscriptions || []).map(async (sub) => {
        // users 테이블에서 회원 정보
        const { data: user } = await supabase
          .from('users')
          .select('pharmacy_name, pharmacist_name')
          .eq('user_id', sub.user_id)
          .single();

        // auth.users에서 이메일
        const { data: { user: authUser } } = await supabase.auth.admin.getUserById(sub.user_id);

        return {
          ...sub,
          pharmacy_name: user?.pharmacy_name || '',
          pharmacist_name: user?.pharmacist_name || '',
          email: authUser?.email || '',
          plan_name: sub.subscription_plans?.plan_name || '',
          monthly_price: sub.subscription_plans?.monthly_price || 0
        };
      })
    );

    // 약사명/약국명 필터링 (클라이언트 측)
    if (pharmacistName) {
      subscriptionsWithUsers = subscriptionsWithUsers.filter(sub => 
        sub.pharmacist_name.includes(pharmacistName)
      );
    }
    if (pharmacyName) {
      subscriptionsWithUsers = subscriptionsWithUsers.filter(sub => 
        sub.pharmacy_name.includes(pharmacyName)
      );
    }

    res.json({
      subscriptions: subscriptionsWithUsers,
      total: subscriptionsWithUsers.length,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(subscriptionsWithUsers.length / parseInt(limit))
    });
  } catch (error) {
    console.error('구독 현황 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 결제 내역 조회
router.get('/api/payments', requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      startDate = '',
      endDate = '',
      status = '',
      pharmacyName = '',
      pharmacistName = ''
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 결제 내역 조회
    let query = supabase
      .from('billing_payments')
      .select(`
        payment_id,
        subscription_id,
        user_id,
        order_id,
        payment_key,
        amount,
        status,
        fail_reason,
        requested_at,
        approved_at,
        created_at
      `, { count: 'exact' });

    // 상태 필터
    if (status) {
      query = query.eq('status', status);
    }

    // 기간 필터 (결제 요청일 기준)
    if (startDate) {
      query = query.gte('requested_at', new Date(startDate).toISOString());
    }
    if (endDate) {
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);
      query = query.lte('requested_at', endDateTime.toISOString());
    }

    // 최신순 정렬
    query = query.order('requested_at', { ascending: false });

    // 페이지네이션
    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: payments, error, count } = await query;

    if (error) {
      console.error('결제 내역 조회 오류:', error);
      return res.status(500).json({ error: '서버 오류' });
    }

    // 각 결제의 회원 정보 조회
    const paymentsWithUsers = await Promise.all(
      (payments || []).map(async (payment) => {
        // users 테이블에서 회원 정보
        const { data: user } = await supabase
          .from('users')
          .select('pharmacy_name, pharmacist_name')
          .eq('user_id', payment.user_id)
          .single();

        // auth.users에서 이메일
        const { data: { user: authUser } } = await supabase.auth.admin.getUserById(payment.user_id);

        return {
          ...payment,
          pharmacy_name: user?.pharmacy_name || '',
          pharmacist_name: user?.pharmacist_name || '',
          email: authUser?.email || ''
        };
      })
    );

    // 약국명/약사명 필터링 (클라이언트에서 전달받은 경우)
    let filteredPayments = paymentsWithUsers;
    if (pharmacyName || pharmacistName) {
      filteredPayments = paymentsWithUsers.filter(payment => {
        const matchPharmacy = !pharmacyName || 
          (payment.pharmacy_name && payment.pharmacy_name.toLowerCase().includes(pharmacyName.toLowerCase()));
        const matchPharmacist = !pharmacistName || 
          (payment.pharmacist_name && payment.pharmacist_name.toLowerCase().includes(pharmacistName.toLowerCase()));
        return matchPharmacy && matchPharmacist;
      });
    }

    res.json({
      payments: filteredPayments,
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil((count || 0) / parseInt(limit))
    });
  } catch (error) {
    console.error('결제 내역 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 문의 관리 - 목록 조회
router.get('/api/support-tickets', requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = ''
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 문의 조회
    let query = supabase
      .from('support_tickets')
      .select('*', { count: 'exact' });

    // 상태 필터
    if (status) {
      query = query.eq('status', status);
    }

    // 최신순 정렬
    query = query.order('created_at', { ascending: false });

    // 페이지네이션
    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: tickets, error, count } = await query;

    if (error) {
      console.error('문의 조회 오류:', error);
      return res.status(500).json({ error: '서버 오류' });
    }

    // 각 문의의 회원 정보 조회
    const ticketsWithUsers = await Promise.all(
      (tickets || []).map(async (ticket) => {
        // users 테이블에서 회원 정보
        const { data: user } = await supabase
          .from('users')
          .select('pharmacy_name, pharmacist_name')
          .eq('user_id', ticket.user_id)
          .single();

        // auth.users에서 이메일
        const { data: { user: authUser } } = await supabase.auth.admin.getUserById(ticket.user_id);

        return {
          ...ticket,
          pharmacy_name: user?.pharmacy_name || '',
          pharmacist_name: user?.pharmacist_name || '',
          email: authUser?.email || ''
        };
      })
    );

    res.json({
      tickets: ticketsWithUsers,
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil((count || 0) / parseInt(limit))
    });
  } catch (error) {
    console.error('문의 목록 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 문의 관리 - 상세 조회
router.get('/api/support-tickets/:ticketId', requireAdmin, async (req, res) => {
  try {
    const { ticketId } = req.params;

    // 문의 상세 정보
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('ticket_id', ticketId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: '문의를 찾을 수 없습니다.' });
    }

    // 문의 첨부파일 조회 (reply_id가 NULL인 것만)
    const { data: attachments, error: attachError } = await supabase
      .from('support_attachments')
      .select('*')
      .eq('ticket_id', ticketId)
      .is('reply_id', null)
      .order('created_at', { ascending: true });

    console.log('문의 첨부파일 조회:', {
      ticketId,
      attachments,
      attachError,
      count: attachments?.length || 0
    });

    // 답변 조회
    const { data: replies } = await supabase
      .from('support_replies')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    console.log('답변 조회:', { count: replies?.length || 0 });

    // 답변 첨부파일 조회 (reply_id가 있는 것만)
    const replyIds = replies?.map(r => r.reply_id) || [];
    let replyAttachments = [];
    if (replyIds.length > 0) {
      const { data: replyAttachmentsData } = await supabase
        .from('support_attachments')
        .select('*')
        .in('reply_id', replyIds);
      replyAttachments = replyAttachmentsData || [];
      console.log('답변 첨부파일 조회:', { count: replyAttachments.length });
    }

    // 회원 정보
    const { data: user } = await supabase
      .from('users')
      .select('pharmacy_name, pharmacist_name')
      .eq('user_id', ticket.user_id)
      .single();

    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(ticket.user_id);

    // 첨부파일 URL 생성 (Signed URL 방식 - Private Storage)
    const attachmentsWithUrl = await Promise.all((attachments || []).map(async (att) => {
      // Signed URL 생성 (1시간 유효) - service_role 권한으로 발급
      const { data: signedData, error: signedError } = await supabase
        .storage
        .from('support-attachments')
        .createSignedUrl(att.file_path, 3600);
      
      if (signedError) {
        console.error('Signed URL 생성 실패:', att.file_name, signedError);
      }
      
      return {
        ...att,
        file_url: signedData?.signedUrl || null // Signed URL만 사용 (Public URL 없음)
      };
    }));

    const replyAttachmentsWithUrl = await Promise.all(replyAttachments.map(async (att) => {
      const { data: signedData, error: signedError } = await supabase
        .storage
        .from('support-attachments')
        .createSignedUrl(att.file_path, 3600);
      
      if (signedError) {
        console.error('답변 첨부 Signed URL 생성 실패:', att.file_name, signedError);
      }
      
      return {
        ...att,
        file_url: signedData?.signedUrl || null
      };
    }));

    console.log('첨부파일 Signed URL 생성 완료:', {
      count: attachmentsWithUrl.length,
      samples: attachmentsWithUrl.slice(0, 2).map(a => ({ 
        file_name: a.file_name, 
        has_url: !!a.file_url,
        url_preview: a.file_url?.substring(0, 80) + '...'
      }))
    });

    res.json({
      ticket: {
        ...ticket,
        pharmacy_name: user?.pharmacy_name || '',
        pharmacist_name: user?.pharmacist_name || '',
        email: authUser?.email || ''
      },
      attachments: attachmentsWithUrl,
      replies: (replies || []).map(reply => ({
        ...reply,
        attachments: replyAttachmentsWithUrl.filter(a => a.reply_id === reply.reply_id)
      }))
    });
  } catch (error) {
    console.error('문의 상세 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 문의 관리 - 답변 작성
router.post('/api/support-tickets/:ticketId/reply', requireAdmin, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { reply_content, attachments = [] } = req.body;
    const adminId = req.session.adminUser?.id;

    if (!adminId) {
      return res.status(401).json({ error: '관리자 인증이 필요합니다.' });
    }

    if (!reply_content?.trim()) {
      return res.status(400).json({ error: '답변 내용을 입력해주세요.' });
    }

    // 답변 저장
    const { data: reply, error: replyError } = await supabase
      .from('support_replies')
      .insert({
        ticket_id: ticketId,
        admin_id: adminId,
        reply_content: reply_content.trim(),
        is_public: true
      })
      .select()
      .single();

    if (replyError) {
      throw replyError;
    }

    // 첨부파일 저장 (support_attachments 테이블 사용)
    if (attachments.length > 0 && reply) {
      const attachmentRecords = attachments.map(att => ({
        ticket_id: ticketId,
        reply_id: reply.reply_id,
        file_path: att.file_path,
        file_name: att.file_name,
        mime_type: att.mime_type,
        file_size: att.file_size || null,
        uploaded_by: 'admin'
      }));

      await supabase.from('support_attachments').insert(attachmentRecords);
    }

    // 문의 상태를 'answered'로 업데이트
    await supabase
      .from('support_tickets')
      .update({ status: 'answered', updated_at: new Date().toISOString() })
      .eq('ticket_id', ticketId);

    res.json({ success: true, reply });
  } catch (error) {
    console.error('답변 작성 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ==================== 원격 지원 관리 ====================

// 원격 지원 목록 조회
router.get('/api/remote-sessions', requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      startDate = '',
      endDate = ''
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 원격 지원 세션 조회
    let query = supabase
      .from('remote_support_sessions')
      .select(`
        session_id,
        session_number,
        user_id,
        customer_phone,
        requested_at,
        agent_id,
        connected_at,
        connection_note,
        issue_category,
        notes,
        resolution,
        ended_at,
        status,
        created_at,
        updated_at
      `, { count: 'exact' });

    // 상태 필터
    if (status) {
      query = query.eq('status', status);
    }

    // 기간 필터 (요청일 기준)
    if (startDate) {
      query = query.gte('requested_at', new Date(startDate).toISOString());
    }
    if (endDate) {
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);
      query = query.lte('requested_at', endDateTime.toISOString());
    }

    // 최신순 정렬
    query = query.order('requested_at', { ascending: false });

    // 페이지네이션
    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: sessions, error, count } = await query;

    if (error) {
      console.error('원격 지원 목록 조회 오류:', error);
      return res.status(500).json({ error: '서버 오류' });
    }

    // 각 세션의 회원 정보 조회
    const sessionsWithUsers = await Promise.all(
      (sessions || []).map(async (session) => {
        // users 테이블에서 회원 정보
        const { data: user } = await supabase
          .from('users')
          .select('pharmacy_name, pharmacist_name')
          .eq('user_id', session.user_id)
          .single();

        // auth.users에서 이메일
        const { data: { user: authUser } } = await supabase.auth.admin.getUserById(session.user_id);

        // agent_id가 있으면 상담원 정보도 조회
        let agentEmail = '';
        if (session.agent_id) {
          const { data: { user: agentAuthUser } } = await supabase.auth.admin.getUserById(session.agent_id);
          agentEmail = agentAuthUser?.email || '';
        }

        return {
          ...session,
          pharmacy_name: user?.pharmacy_name || '',
          pharmacist_name: user?.pharmacist_name || '',
          email: authUser?.email || '',
          agent_email: agentEmail
        };
      })
    );

    res.json({
      sessions: sessionsWithUsers,
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil((count || 0) / parseInt(limit))
    });
  } catch (error) {
    console.error('원격 지원 목록 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 원격 지원 상세 조회
router.get('/api/remote-sessions/:sessionId', requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // 원격 지원 세션 조회
    const { data: session, error } = await supabase
      .from('remote_support_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error || !session) {
      return res.status(404).json({ error: '원격 지원 세션을 찾을 수 없습니다.' });
    }

    // 회원 정보 조회
    const { data: user } = await supabase
      .from('users')
      .select('pharmacy_name, pharmacist_name')
      .eq('user_id', session.user_id)
      .single();

    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(session.user_id);

    // agent_id가 있으면 상담원 정보도 조회
    let agentEmail = '';
    if (session.agent_id) {
      const { data: { user: agentAuthUser } } = await supabase.auth.admin.getUserById(session.agent_id);
      agentEmail = agentAuthUser?.email || '';
    }

    res.json({
      ...session,
      pharmacy_name: user?.pharmacy_name || '',
      pharmacist_name: user?.pharmacist_name || '',
      email: authUser?.email || '',
      agent_email: agentEmail
    });
  } catch (error) {
    console.error('원격 지원 상세 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 원격 지원 상태 업데이트 (시작, 완료, 취소)
router.patch('/api/remote-sessions/:sessionId', requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const adminId = req.user.id;  // authUser.id
    const { 
      status, 
      connection_note, 
      issue_category, 
      notes, 
      resolution 
    } = req.body;

    // 유효성 검사
    if (!status || !['requested', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: '유효하지 않은 상태입니다.' });
    }

    // 업데이트할 데이터 준비
    const updateData = {
      status,
      updated_at: new Date().toISOString()
    };

    // 상담원 ID는 항상 현재 관리자로 설정 (없는 경우에만)
    // 단, 이미 agent_id가 설정된 경우 기존 데이터 확인
    const { data: existingSession } = await supabase
      .from('remote_support_sessions')
      .select('agent_id')
      .eq('session_id', sessionId)
      .single();

    console.log('기존 세션 agent_id:', existingSession?.agent_id);
    console.log('현재 관리자 ID:', adminId);

    // agent_id가 없는 경우에만 현재 관리자로 설정
    if (!existingSession?.agent_id) {
      updateData.agent_id = adminId;
      console.log('agent_id 설정:', adminId);
    }

    // 상태별 추가 처리
    if (status === 'in_progress') {
      updateData.connected_at = new Date().toISOString();
    } else if (status === 'completed') {
      updateData.ended_at = new Date().toISOString();
    }

    // 선택적 필드 업데이트
    if (connection_note !== undefined) updateData.connection_note = connection_note;
    if (issue_category !== undefined) updateData.issue_category = issue_category;
    if (notes !== undefined) updateData.notes = notes;
    if (resolution !== undefined) updateData.resolution = resolution;

    // 세션 업데이트
    const { data: updatedSession, error } = await supabase
      .from('remote_support_sessions')
      .update(updateData)
      .eq('session_id', sessionId)
      .select()
      .single();

    if (error) {
      console.error('원격 지원 업데이트 오류:', error);
      return res.status(500).json({ error: '서버 오류' });
    }

    console.log('업데이트된 세션:', updatedSession);

    // 업데이트된 세션의 상담원 정보 조회
    let agentEmail = '';
    if (updatedSession.agent_id) {
      console.log('상담원 정보 조회 시작:', updatedSession.agent_id);
      const { data: { user: agentAuthUser } } = await supabase.auth.admin.getUserById(updatedSession.agent_id);
      agentEmail = agentAuthUser?.email || '';
      console.log('상담원 이메일:', agentEmail);
    } else {
      console.log('agent_id 없음');
    }

    res.json({ 
      success: true, 
      session: {
        ...updatedSession,
        agent_email: agentEmail
      }
    });
  } catch (error) {
    console.error('원격 지원 업데이트 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

module.exports = router;
