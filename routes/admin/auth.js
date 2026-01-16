const express = require('express');
const router = express.Router();
const supabase = require('../../config/supabase');
const crypto = require('crypto');

// 서버 인스턴스 ID 생성
const SERVER_INSTANCE_ID = crypto.randomBytes(8).toString('hex');

// 로그인 API
router.post('/login', async (req, res) => {
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
    
    // 5. 커스텀 세션 토큰 생성
    const customToken = {
      idToken: idToken,
      email: authUser.email,
      instanceId: SERVER_INSTANCE_ID,
      issuedAt: Date.now()
    };
    
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

// 로그아웃 API
router.post('/logout', async (req, res) => {
  try {
    res.json({ success: true });
  } catch (error) {
    console.error('로그아웃 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 로그인 페이지 렌더링
router.get('/login', (req, res) => {
  res.render('admin-login');
});

module.exports = router;
