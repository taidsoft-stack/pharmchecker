const { createClient } = require('@supabase/supabase-js');
const supabase = require('../../config/supabase');

// ===== 관리자 인증 미들웨어 (Supabase Auth 기반) =====
async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증 필요' });
  }
  
  const token = authHeader.substring(7);
  
  try {
    // 커스텀 세션 토큰 파싱 (v1.{base64}.sig 형식)
    let actualToken = token;
    
    if (token.startsWith('v1.') && token.endsWith('.sig')) {
      try {
        const base64Part = token.slice(3, -4);
        const decoded = JSON.parse(Buffer.from(base64Part, 'base64').toString('utf8'));
        actualToken = decoded.idToken;
      } catch (decodeError) {
        return res.status(401).json({ error: '잘못된 토큰 형식' });
      }
    }
    
    // Supabase에서 토큰 검증
    const { data: { user }, error } = await supabase.auth.getUser(actualToken);
    
    if (error || !user) {
      return res.status(401).json({ error: '유효하지 않은 토큰' });
    }
    
    // 인증된 Supabase 클라이언트 생성 (RLS 적용)
    req.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${actualToken}`
          }
        }
      }
    );
    
    // 관리자 권한 확인 (RLS 정책이 자동으로 확인)
    const { data: admin, error: adminError } = await req.supabase
      .from('admins')
      .select('*')
      .eq('admin_id', user.id)
      .eq('is_active', true)
      .single();
    
    if (adminError || !admin) {
      return res.status(403).json({ error: '관리자 권한 없음' });
    }
    
    req.admin = admin;
    req.user = user;
    req.accessToken = actualToken;
    next();
  } catch (error) {
    return res.status(500).json({ error: '서버 오류' });
  }
}

module.exports = requireAdmin;
