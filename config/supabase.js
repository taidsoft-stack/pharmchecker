const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Supabase 설정
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase 환경 변수가 설정되지 않았습니다.');
  console.error('SUPABASE_URL:', supabaseUrl ? '설정됨' : '❌ 없음');
  console.error('SUPABASE_ANON_KEY:', supabaseAnonKey ? '설정됨' : '❌ 없음');
  throw new Error('SUPABASE_URL과 SUPABASE_ANON_KEY를 .env 파일에 추가하세요.');
}

if (!supabaseServiceRoleKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
  console.error('.env 파일에 SUPABASE_SERVICE_ROLE_KEY를 추가하세요.');
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

// Supabase 클라이언트 생성 (RLS 적용을 위해 anon key 사용)
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Service Role 클라이언트 (백그라운드 작업 전용 - 스케줄러, 시스템 작업 등)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

module.exports = supabase;
module.exports.supabaseAdmin = supabaseAdmin;
