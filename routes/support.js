const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// Multer 설정 (메모리 스토리지 사용)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5 // 최대 5개
  },
  fileFilter: (req, file, cb) => {
    // 허용된 MIME 타입
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'application/zip'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('허용되지 않는 파일 형식입니다.'));
    }
  }
});

// ============================================
// 페이지 라우트
// ============================================

// 내 문의 내역
router.get('/tickets', async (req, res) => {
  try {
    // localStorage에서 사용자 정보 확인 (클라이언트에서 처리)
    res.render('support-tickets');
  } catch (error) {
    console.error('Error loading tickets page:', error);
    res.status(500).send('페이지 로딩 중 오류가 발생했습니다.');
  }
});

// 문의 작성
router.get('/new', async (req, res) => {
  try {
    res.render('support-new');
  } catch (error) {
    console.error('Error loading new ticket page:', error);
    res.status(500).send('페이지 로딩 중 오류가 발생했습니다.');
  }
});

// 원격 지원 안내
router.get('/remote/request', async (req, res) => {
  try {
    res.render('support-remote-request');
  } catch (error) {
    console.error('Error loading remote request page:', error);
    res.status(500).send('페이지 로딩 중 오류가 발생했습니다.');
  }
});

// TeamViewer 다운로드
router.get('/remote/download', async (req, res) => {
  try {
    res.render('support-remote-download');
  } catch (error) {
    console.error('Error loading remote download page:', error);
    res.status(500).send('페이지 로딩 중 오류가 발생했습니다.');
  }
});

// FAQ
router.get('/faq', async (req, res) => {
  try {
    res.render('support-faq');
  } catch (error) {
    console.error('Error loading FAQ page:', error);
    res.status(500).send('페이지 로딩 중 오류가 발생했습니다.');
  }
});

// ============================================
// API 라우트
// ============================================

// 문의 목록 조회
router.get('/api/tickets', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id; // requireAuth에서 추출

    // 문의 목록 조회 (최신순) - RLS 적용
    const { data: tickets, error } = await req.supabase
      .from('support_tickets')
      .select(`
        ticket_id,
        ticket_type,
        title,
        content,
        status,
        created_at,
        updated_at,
        support_replies (
          reply_id,
          reply_content,
          created_at,
          is_public
        ),
        support_attachments!support_attachments_ticket_id_fkey (
          attachment_id,
          file_name,
          file_size
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching tickets:', error);
      return res.status(500).json({ error: '문의 목록을 불러오는데 실패했습니다.' });
    }

    // is_public=true인 답변만 필터링
    const filteredTickets = tickets.map(ticket => ({
      ...ticket,
      support_replies: ticket.support_replies.filter(reply => reply.is_public)
    }));

    res.json({ tickets: filteredTickets });
  } catch (error) {
    console.error('Error in GET /api/tickets:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 특정 문의 상세 조회
router.get('/api/tickets/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id; // requireAuth에서 추출
    const ticketId = req.params.id;

    // 문의 상세 조회 - RLS 적용
    const { data: ticket, error } = await req.supabase
      .from('support_tickets')
      .select(`
        ticket_id,
        ticket_type,
        title,
        content,
        status,
        created_at,
        updated_at,
        support_replies (
          reply_id,
          reply_content,
          created_at,
          is_public
        ),
        support_attachments!support_attachments_ticket_id_fkey (
          attachment_id,
          file_path,
          file_name,
          file_size,
          mime_type
        )
      `)
      .eq('ticket_id', ticketId)
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error fetching ticket:', error);
      return res.status(404).json({ error: '문의를 찾을 수 없습니다.' });
    }

    // is_public=true인 답변만 필터링
    ticket.support_replies = ticket.support_replies.filter(reply => reply.is_public);

    // 첨부파일 signed URL 생성
    if (ticket.support_attachments && ticket.support_attachments.length > 0) {
      for (let attachment of ticket.support_attachments) {
        const { data: signedUrl, error: urlError } = await req.supabase
          .storage
          .from('support-attachments')
          .createSignedUrl(attachment.file_path, 3600); // 1시간 유효

        if (urlError) {
          console.error('Signed URL 생성 실패:', attachment.file_name, urlError);
        }

        // file_url로 통일 (관리자 API와 일관성)
        attachment.file_url = signedUrl?.signedUrl || null;
        attachment.download_url = attachment.file_url; // 하위 호환성
      }
    }

    console.log('고객 문의 첨부파일 URL 생성:', ticket.support_attachments?.length || 0, '개');

    res.json({ ticket });
  } catch (error) {
    console.error('Error in GET /api/tickets/:id:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 문의 생성
router.post('/api/tickets', requireAuth, upload.array('attachments', 5), async (req, res) => {
  try {
    const userId = req.user.id; // requireAuth에서 추출

    // users 테이블에 해당 사용자가 존재하는지 확인
    const { data: user, error: userError } = await req.supabase
      .from('users')
      .select('user_id')
      .eq('user_id', userId)
      .single();

    if (userError || !user) {
      return res.status(401).json({ error: '유효하지 않은 사용자입니다. 다시 로그인해주세요.' });
    }

    const { title, content } = req.body;

    // 유효성 검사
    if (!title || !content) {
      return res.status(400).json({ error: '필수 항목을 모두 입력해주세요.' });
    }

    // 문의 생성 - RLS 적용
    const { data: ticket, error: ticketError } = await req.supabase
      .from('support_tickets')
      .insert({
        user_id: userId,
        ticket_type: 'question',
        title,
        content,
        status: 'open'
      })
      .select()
      .single();

    if (ticketError) {
      console.error('Error creating ticket:', ticketError);
      return res.status(500).json({ error: '문의 생성에 실패했습니다.' });
    }

    // 첨부파일 업로드
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(7);
        const fileExt = path.extname(file.originalname);
        
        // 한글 파일명 처리: Buffer로 올바르게 디코딩
        const originalFileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        
        const fileName = `${timestamp}_${randomStr}${fileExt}`;
        const filePath = `${ticket.ticket_id}/${fileName}`;

        // Storage에 업로드 (RLS 적용)
        const { data: uploadData, error: uploadError } = await req.supabase
          .storage
          .from('support-attachments')
          .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false
          });

        if (uploadError) {
          console.error('Error uploading file:', uploadError);
          continue; // 실패해도 계속 진행
        }

        // 메타데이터 저장 (RLS 적용) - 원본 파일명을 UTF-8로 저장
        const { error: metaError } = await req.supabase
          .from('support_attachments')
          .insert({
            ticket_id: ticket.ticket_id,
            file_path: filePath,
            file_name: originalFileName,
            mime_type: file.mimetype,
            file_size: file.size
          });

        if (metaError) {
          console.error('Error saving attachment metadata:', metaError);
        }
      }
    }

    res.json({
      success: true,
      ticket_id: ticket.ticket_id,
      message: '문의가 등록되었습니다.'
    });
  } catch (error) {
    console.error('Error in POST /api/tickets:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 원격 지원 요청
router.post('/api/remote/request', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id; // requireAuth에서 추출

    const { ticket_id, customer_phone, issue_category, notes } = req.body;

    // 유효성 검사
    if (!ticket_id || !customer_phone) {
      return res.status(400).json({ error: '필수 항목을 모두 입력해주세요.' });
    }

    // ticket이 본인 것인지 확인
    const { data: ticket, error: ticketError } = await req.supabase
      .from('support_tickets')
      .select('ticket_id, user_id, ticket_type')
      .eq('ticket_id', ticket_id)
      .eq('user_id', userId)
      .single();

    if (ticketError || !ticket) {
      return res.status(404).json({ error: '문의를 찾을 수 없습니다.' });
    }

    if (ticket.ticket_type !== 'remote_request') {
      return res.status(400).json({ error: '원격 지원 요청이 아닙니다.' });
    }

    // 세션 번호 생성 (RS-YYYYMMDD-XXX)
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    
    // 오늘 생성된 세션 수 조회
    const { count, error: countError } = await req.supabase
      .from('remote_support_sessions')
      .select('session_id', { count: 'exact', head: true })
      .gte('created_at', `${today.toISOString().slice(0, 10)}T00:00:00Z`)
      .lt('created_at', `${today.toISOString().slice(0, 10)}T23:59:59Z`);

    if (countError) {
      console.error('Error counting sessions:', countError);
      return res.status(500).json({ error: '세션 번호 생성에 실패했습니다.' });
    }

    const sessionNumber = `RS-${dateStr}-${String((count || 0) + 1).padStart(3, '0')}`;

    // 원격 지원 세션 생성 - RLS 적용
    const { data: session, error: sessionError } = await req.supabase
      .from('remote_support_sessions')
      .insert({
        session_number: sessionNumber,
        user_id: userId,
        ticket_id,
        customer_phone,
        issue_category: issue_category || null,
        notes: notes || null,
        status: 'requested'
      })
      .select()
      .single();

    if (sessionError) {
      console.error('Error creating remote session:', sessionError);
      return res.status(500).json({ error: '원격 지원 요청에 실패했습니다.' });
    }

    res.json({
      success: true,
      session_number: sessionNumber,
      message: '원격 지원 요청이 접수되었습니다.'
    });
  } catch (error) {
    console.error('Error in POST /api/remote/request:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 원격 지원 간소화 API (양식 없이 바로 세션 생성)
router.post('/api/remote/simple', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id; // requireAuth에서 추출

    // 1. users 테이블에서 전화번호 조회
    const { data: user, error: userError } = await req.supabase
      .from('users')
      .select('pharmacist_phone')
      .eq('user_id', userId)
      .single();

    if (userError || !user) {
      console.error('Error fetching user:', userError);
      return res.status(404).json({ error: '사용자 정보를 찾을 수 없습니다.' });
    }

    if (!user.pharmacist_phone) {
      return res.status(400).json({ error: '등록된 전화번호가 없습니다. 프로필에서 전화번호를 등록해주세요.' });
    }

    // 2. 세션 번호 생성 (RS-YYYYMMDD-XXX)
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    
    const { count, error: countError } = await req.supabase
      .from('remote_support_sessions')
      .select('session_id', { count: 'exact', head: true })
      .gte('created_at', `${today.toISOString().slice(0, 10)}T00:00:00Z`)
      .lt('created_at', `${today.toISOString().slice(0, 10)}T23:59:59Z`);

    if (countError) {
      console.error('Error counting sessions:', countError);
      return res.status(500).json({ error: '세션 번호 생성에 실패했습니다.' });
    }

    const sessionNumber = `RS-${dateStr}-${String((count || 0) + 1).padStart(3, '0')}`;

    // 3. 원격 지원 세션 생성
    const { data: session, error: sessionError } = await req.supabase
      .from('remote_support_sessions')
      .insert({
        session_number: sessionNumber,
        user_id: userId,
        customer_phone: user.pharmacist_phone,
        connection_note: '고객센터 전화 연결 후 원격 지원 요청',
        status: 'requested'
      })
      .select()
      .single();

    if (sessionError) {
      console.error('Error creating remote session:', sessionError);
      return res.status(500).json({ error: '원격 지원 요청에 실패했습니다.' });
    }

    res.json({
      success: true,
      session_number: sessionNumber,
      message: '원격 지원이 접수되었습니다.'
    });
  } catch (error) {
    console.error('Error in POST /api/remote/simple:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// FAQ 목록 조회
// FAQ 목록 조회
router.get('/api/faq', async (req, res) => {
  try {
    const { data: faqs, error } = await supabase
      .from('faqs')
      .select('faq_id, question, answer, display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching FAQs:', error);
      return res.status(500).json({ error: 'FAQ를 불러오는데 실패했습니다.' });
    }

    res.json({ faqs });
  } catch (error) {
    console.error('Error in GET /api/faq:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
