const supabase = require('../config/supabase');
const { createClient } = require('@supabase/supabase-js');

/**
 * Supabase Auth Bearer Token 검증 미들웨어
 * Authorization 헤더에서 Bearer 토큰을 추출하고 검증합니다.
 * 검증 성공 시 req.user에 사용자 정보를, req.supabase에 인증된 클라이언트를 저장합니다.
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: '인증 토큰이 필요합니다.'
      });
    }
    
    const token = authHeader.substring(7); // 'Bearer ' 제거
    
    // Supabase에서 토큰 검증
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('토큰 검증 실패:', error);
      return res.status(401).json({
        success: false,
        message: '유효하지 않은 토큰입니다.'
      });
    }
    
    // req.user에 사용자 정보 저장
    req.user = user;
    req.accessToken = token;
    
    // 사용자의 access_token으로 인증된 Supabase 클라이언트 생성
    // 이 클라이언트를 사용하면 RLS 정책이 auth.uid()를 올바르게 인식함
    req.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      }
    );
    
    next();
  } catch (error) {
    console.error('인증 미들웨어 오류:', error);
    return res.status(500).json({
      success: false,
      message: '인증 처리 중 오류가 발생했습니다.'
    });
  }
}

/**
 * 선택적 인증 미들웨어 (토큰이 있으면 검증, 없으면 통과)
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user }, error } = await supabase.auth.getUser(token);
      
      if (!error && user) {
        req.user = user;
        req.accessToken = token;
        req.supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_ANON_KEY,
          {
            global: {
              headers: {
                Authorization: `Bearer ${token}`
              }
            }
          }
        );
      }
    }
    
    next();
  } catch (error) {
    // 에러가 있어도 계속 진행
    next();
  }
}

module.exports = {
  requireAuth,
  optionalAuth
};
