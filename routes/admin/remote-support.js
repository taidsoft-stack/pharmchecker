const express = require('express');
const router = express.Router();
const supabase = require('../../config/supabase');
const requireAdmin = require('./admin-auth-middleware');
const { getUserEmail, getAdminEmail } = require('../../utils/admin-email-helper');

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

    // 원격 지원 세션 조회 (RLS 정책: is_admin() 함수로 전체 접근)
    let query = req.supabase
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
      console.error('[원격 지원 조회 오류]', error);
      return res.status(500).json({ error: '서버 오류' });
    }

    // 각 세션의 회원 정보 조회
    const sessionsWithUsers = await Promise.all(
      (sessions || []).map(async (session) => {
        // users 테이블에서 회원 정보 (RLS 정책: is_admin() 함수로 전체 접근)
        const { data: user } = await req.supabase
          .from('users')
          .select('pharmacy_name, pharmacist_name')
          .eq('user_id', session.user_id)
          .single();

        // 이메일 조회 (admin-email-helper 사용)
        const email = await getUserEmail(session.user_id, req.admin.admin_id, 'remote_session_list');

        // agent_id가 있으면 상담원 정보도 조회
        let agentEmail = '';
        if (session.agent_id) {
          agentEmail = await getAdminEmail(req.supabase, session.agent_id);
        }

        return {
          ...session,
          pharmacy_name: user?.pharmacy_name || '',
          pharmacist_name: user?.pharmacist_name || '',
          email: email || '',
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

    // 원격 지원 세션 조회 (RLS 정책: is_admin() 함수로 전체 접근)
    const { data: session, error } = await req.supabase
      .from('remote_support_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error || !session) {
      console.error('[원격 지원 상세 조회 오류]', error);
      return res.status(404).json({ error: '원격 지원 세션을 찾을 수 없습니다.' });
    }

    // 회원 정보 조회 (RLS 정책: is_admin() 함수로 전체 접근)
    const { data: user } = await req.supabase
      .from('users')
      .select('pharmacy_name, pharmacist_name')
      .eq('user_id', session.user_id)
      .single();

    // 이메일 조회 (admin-email-helper 사용)
    const email = await getUserEmail(session.user_id, req.admin.admin_id, 'remote_session_detail');

    // agent_id가 있으면 상담원 정보도 조회
    let agentEmail = '';
    if (session.agent_id) {
      agentEmail = await getAdminEmail(req.supabase, session.agent_id);
    }

    res.json({
      ...session,
      pharmacy_name: user?.pharmacy_name || '',
      pharmacist_name: user?.pharmacist_name || '',
      email: email || '',
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
    const adminId = req.admin.admin_id;  // requireAdmin에서 설정한 admin_id
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
    const { data: existingSession } = await req.supabase
      .from('remote_support_sessions')
      .select('agent_id')
      .eq('session_id', sessionId)
      .single();

    // agent_id가 없는 경우에만 현재 관리자로 설정
    if (!existingSession?.agent_id) {
      updateData.agent_id = adminId;
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

    // 세션 업데이트 (RLS 정책: is_admin() 함수로 전체 접근)
    const { data: updatedSession, error } = await req.supabase
      .from('remote_support_sessions')
      .update(updateData)
      .eq('session_id', sessionId)
      .select()
      .single();

    if (error) {
      console.error('원격 지원 업데이트 오류:', error);
      return res.status(500).json({ error: '서버 오류' });
    }

    // 업데이트된 세션의 상담원 정보 조회
    let agentEmail = '';
    if (updatedSession.agent_id) {
      agentEmail = await getAdminEmail(req.supabase, updatedSession.agent_id);
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
