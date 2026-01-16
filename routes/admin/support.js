const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const supabase = require('../../config/supabase');  // service_role supabase
const { getUserEmail, getAdminEmail } = require('../../utils/admin-email-helper');
const requireAdmin = require('./admin-auth-middleware');

// Multer 설정 (메모리 저장)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|zip/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('허용되지 않는 파일 형식입니다.'));
  }
});

// ==================== 문의 관리 ====================

// 문의 관리 - 목록 조회
router.get('/api/support-tickets', requireAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = ''
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 문의 조회 (RLS 적용)
    let query = req.supabase
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
      return res.status(500).json({ error: '서버 오류' });
    }

    // 각 문의의 회원 정보 조회
    const ticketsWithUsers = await Promise.all(
      (tickets || []).map(async (ticket) => {
        // users 테이블에서 회원 정보 (RLS 적용)
        const { data: user } = await req.supabase
          .from('users')
          .select('pharmacy_name, pharmacist_name')
          .eq('user_id', ticket.user_id)
          .single();

        // 이메일 조회 (admin-email-helper 사용)
        const email = await getUserEmail(ticket.user_id, req.admin.admin_id, 'support_ticket_list');

        return {
          ...ticket,
          pharmacy_name: user?.pharmacy_name || '',
          pharmacist_name: user?.pharmacist_name || '',
          email: email || ''
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
    res.status(500).json({ error: '서버 오류' });
  }
});

// 문의 관리 - 상세 조회
router.get('/api/support-tickets/:ticketId', requireAdmin, async (req, res) => {
  try {
    const { ticketId } = req.params;

    // 문의 상세 정보 (RLS 적용)
    const { data: ticket, error: ticketError } = await req.supabase
      .from('support_tickets')
      .select('*')
      .eq('ticket_id', ticketId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: '문의를 찾을 수 없습니다.' });
    }

    // 문의 첨부파일 조회 (RLS 적용)
    const { data: attachments } = await req.supabase
      .from('support_attachments')
      .select('*')
      .eq('ticket_id', ticketId)
      .is('reply_id', null)
      .order('created_at', { ascending: true });

    // 답변 조회 (RLS 적용)
    const { data: replies } = await req.supabase
      .from('support_replies')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    // 답변 첨부파일 조회 (reply_id가 있는 것만) - 관리자 권한으로 RLS 통과
    const replyIds = replies?.map(r => r.reply_id) || [];

    let replyAttachments = [];
    if (replyIds.length > 0) {
      const { data: replyAttachmentsData, error: replyAttError } = await req.supabase
        .from('support_attachments')
        .select('*')
        .in('reply_id', replyIds);

      replyAttachments = replyAttachmentsData || [];
    } else {

    }

    // 회원 정보
    const { data: user } = await req.supabase
      .from('users')
      .select('pharmacy_name, pharmacist_name')
      .eq('user_id', ticket.user_id)
      .single();

    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(ticket.user_id);

    // 첨부파일 URL 생성 (Signed URL 방식 - Private Storage)
    const attachmentsWithUrl = await Promise.all((attachments || []).map(async (att) => {
      // Signed URL 생성 (1시간 유효) - 관리자 권한으로 발급
      const { data: signedData, error: signedError } = await req.supabase
        .storage
        .from('support-attachments')
        .createSignedUrl(att.file_path, 3600);
      
      if (signedError) {
        console.error('첨부파일 Signed URL 생성 실패:', att.file_name, signedError);
      }
      
      return {
        ...att,
        file_url: signedData?.signedUrl || null // Signed URL만 사용 (Public URL 없음)
      };
    }));

    const replyAttachmentsWithUrl = await Promise.all(replyAttachments.map(async (att) => {
      const { data: signedData, error: signedError } = await req.supabase
        .storage
        .from('support-attachments')
        .createSignedUrl(att.file_path, 3600);
      
      if (signedError) {
        console.error('답변 첨부파일 Signed URL 생성 실패:', att.file_name, signedError);
      }
      
      return {
        ...att,
        file_url: signedData?.signedUrl || null
      };
    }));

    // 답변에 admin_email과 첨부파일 추가
    const repliesWithEmailAndAttachments = await Promise.all((replies || []).map(async (reply) => {
      const adminEmail = await getAdminEmail(req.supabase, reply.admin_id);
      
      // 이 답변의 첨부파일 찾기
      const replyAtts = replyAttachmentsWithUrl.filter(att => att.reply_id === reply.reply_id);
      
      return {
        ...reply,
        admin_email: adminEmail,
        attachments: replyAtts
      };
    }));

    res.json({
      ticket: {
        ...ticket,
        pharmacy_name: user?.pharmacy_name || '',
        pharmacist_name: user?.pharmacist_name || '',
        email: authUser?.email || ''
      },
      attachments: attachmentsWithUrl,
      replies: repliesWithEmailAndAttachments,
      reply_attachments: replyAttachmentsWithUrl
    });
  } catch (error) {
    res.status(500).json({ error: '서버 오류' });
  }
});

// 문의 관리 - 답변 작성 (multer로 파일 업로드 지원)
router.post('/api/support-tickets/:ticketId/reply', requireAdmin, upload.array('attachments', 5), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { reply_content } = req.body;
    const adminId = req.admin.admin_id; // requireAdmin에서 설정됨

    if (!reply_content?.trim()) {
      return res.status(400).json({ error: '답변 내용을 입력해주세요.' });
    }

    // 답변 저장 (RLS 적용)
    const { data: reply, error: replyError } = await req.supabase
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

    // 첨부파일 업로드 (support.js와 동일한 로직)
    if (req.files && req.files.length > 0) {

      
      for (const file of req.files) {
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(7);
        const fileExt = path.extname(file.originalname);
        
        // 한글 파일명 처리: Buffer로 올바르게 디코딩
        const originalFileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        
        const fileName = `${timestamp}_${randomStr}${fileExt}`;
        const filePath = `${ticketId}/${fileName}`;


        // Storage에 업로드 (관리자 권한으로 RLS 통과)
        const { data: uploadData, error: uploadError } = await req.supabase
          .storage
          .from('support-attachments')
          .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false
          });

        if (uploadError) {

          continue; // 실패해도 계속 진행
        }

        // 파일이 실제로 존재하는지 확인
        const { data: fileExists, error: checkError } = await req.supabase
          .storage
          .from('support-attachments')
          .list(ticketId);
        // 메타데이터 저장 (관리자 권한으로 RLS 통과)
        const { error: metaError } = await req.supabase
          .from('support_attachments')
          .insert({
            ticket_id: ticketId,
            reply_id: reply.reply_id,
            file_path: filePath,
            file_name: originalFileName,
            mime_type: file.mimetype,
            file_size: file.size,
            uploaded_by: 'admin'
          });

        if (metaError) {

        } else {
          
          // 저장 직후 바로 조회 확인 (동일한 req.supabase 사용)
          const { data: checkData, error: checkError } = await req.supabase
            .from('support_attachments')
            .select('*')
            .eq('reply_id', reply.reply_id);
        }
      }
    }

    // 문의 상태를 'answered'로 업데이트 (RLS 적용)
    const { error: updateError } = await req.supabase
      .from('support_tickets')
      .update({ status: 'answered', updated_at: new Date().toISOString() })
      .eq('ticket_id', ticketId);
    
    if (updateError) {
    }

    res.json({ success: true, reply });
  } catch (error) {
    res.status(500).json({ error: '서버 오류' });
  }
});

module.exports = router;
