/**
 * 관리자 전용 이메일 조회 헬퍼
 * 
 * 설계 원칙:
 * - public.users에는 email 컬럼 없음 (개인정보, 탈퇴 시 즉시 파기)
 * - 관리자가 필요 시에만 auth.users에서 조회
 * - service role 사용을 이 함수로 제한하여 통제
 * - 모든 조회는 감사 로그 기록
 */

const { supabaseAdmin } = require('../config/supabase');

/**
 * 단일 사용자 이메일 조회
 * @param {string} userId - 조회할 user_id
 * @param {string} adminId - 조회하는 관리자 ID
 * @param {string} purpose - 조회 목적 (로깅용)
 * @returns {Promise<string|null>} 이메일 주소 또는 null
 */
async function getUserEmail(userId, adminId, purpose = '회원 정보 조회') {
  try {
    // 1. auth.users에서 이메일 조회 (service role)
    const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (error) {
      // 사용자가 삭제된 경우 에러 로그를 출력하지 않음 (정상적인 상황)
      if (error.code !== 'user_not_found') {
        console.error(`[이메일 조회 실패] userId: ${userId}, error:`, error);
      }
      return null;
    }
    
    // 2. 감사 로그 기록
    await logEmailAccess(adminId, userId, purpose, user?.email || null);
    
    return user?.email || null;
  } catch (error) {
    console.error('[getUserEmail 오류]', error);
    return null;
  }
}

/**
 * 다중 사용자 이메일 일괄 조회
 * @param {Array<string>} userIds - 조회할 user_id 배열
 * @param {string} adminId - 조회하는 관리자 ID
 * @param {string} purpose - 조회 목적
 * @returns {Promise<Map<string, string>>} userId -> email 매핑
 */
async function getUserEmailsBatch(userIds, adminId, purpose = '회원 목록 조회') {
  const emailMap = new Map();
  
  try {
    // 병렬 조회 (성능 최적화)
    const results = await Promise.all(
      userIds.map(async (userId) => {
        const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(userId);
        // user_not_found 에러는 무시 (삭제된 사용자)
        if (error && error.code !== 'user_not_found') {
          console.error(`[배치 이메일 조회 실패] userId: ${userId}`);
        }
        return { userId, email: user?.email || null, error };
      })
    );
    
    // 결과 매핑
    results.forEach(({ userId, email }) => {
      if (email) {
        emailMap.set(userId, email);
      }
    });
    
    // 감사 로그 기록 (일괄)
    await logEmailAccessBatch(adminId, userIds, purpose);
    
    return emailMap;
  } catch (error) {
    console.error('[getUserEmailsBatch 오류]', error);
    return emailMap;
  }
}

/**
 * 관리자 이메일 조회 (admins 테이블에 있으므로 직접 조회)
 * @param {Object} supabase - Supabase 클라이언트 (RLS 적용)
 * @param {string} adminId - 조회할 admin_id
 * @returns {Promise<string|null>} 이메일 주소 또는 null
 */
async function getAdminEmail(supabase, adminId) {
  try {
    const { data: admin, error } = await supabase
      .from('admins')
      .select('email')
      .eq('admin_id', adminId)
      .single();
    
    if (error) {
      console.error(`[관리자 이메일 조회 실패] adminId: ${adminId}`, error);
      return null;
    }
    
    return admin?.email || null;
  } catch (error) {
    console.error('[getAdminEmail 오류]', error);
    return null;
  }
}

/**
 * 이메일 접근 감사 로그 기록
 * @param {string} adminId - 조회한 관리자 ID
 * @param {string} targetUserId - 조회된 사용자 ID
 * @param {string} purpose - 조회 목적
 * @param {string|null} email - 조회된 이메일
 */
async function logEmailAccess(adminId, targetUserId, purpose, email) {
  try {
    await supabaseAdmin
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'email_access',
        target_type: 'user',
        target_id: targetUserId,
        details: {
          purpose,
          email_accessed: !!email,
          timestamp: new Date().toISOString()
        }
      });
  } catch (error) {
    console.error('[감사 로그 기록 실패]', error);
  }
}

/**
 * 일괄 이메일 접근 감사 로그 기록
 * @param {string} adminId - 조회한 관리자 ID
 * @param {Array<string>} targetUserIds - 조회된 사용자 ID 배열
 * @param {string} purpose - 조회 목적
 */
async function logEmailAccessBatch(adminId, targetUserIds, purpose) {
  try {
    await supabaseAdmin
      .from('admin_activity_logs')
      .insert({
        admin_id: adminId,
        action_type: 'email_access_batch',
        target_type: 'users',
        details: {
          purpose,
          user_count: targetUserIds.length,
          user_ids: targetUserIds,
          timestamp: new Date().toISOString()
        }
      });
  } catch (error) {
    console.error('[일괄 감사 로그 기록 실패]', error);
  }
}

module.exports = {
  getUserEmail,
  getUserEmailsBatch,
  getAdminEmail,
};
