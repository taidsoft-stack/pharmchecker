const express = require('express');
const router = express.Router();
const requireAdmin = require('./admin-auth-middleware');

// ===========================
// FAQ 관리 API
// ===========================

// FAQ 목록 조회
router.get('/api/faqs', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('faqs')
      .select('*')
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: '서버 오류' });
    }

    res.json({ success: true, faqs: data });
  } catch (error) {
    res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
  }
});

// FAQ 생성
router.post('/api/faqs', requireAdmin, async (req, res) => {
  try {
    const { question, answer, is_active, display_order } = req.body;

    if (!question || !answer) {
      return res.status(400).json({ error: '질문과 답변을 입력해주세요.' });
    }

    const { data, error } = await req.supabase
      .from('faqs')
      .insert({
        question,
        answer,
        is_active: is_active !== undefined ? is_active : true,
        display_order: display_order || 0
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: '서버 오류' });
    }

    res.json({ success: true, faq: data });
  } catch (error) {
    res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
  }
});

// FAQ 수정
router.put('/api/faqs/:faqId', requireAdmin, async (req, res) => {
  try {
    const { faqId } = req.params;
    const { question, answer, is_active, display_order } = req.body;

    if (!question || !answer) {
      return res.status(400).json({ error: '질문과 답변을 입력해주세요.' });
    }

    const { data, error } = await req.supabase
      .from('faqs')
      .update({
        question,
        answer,
        is_active,
        display_order,
        updated_at: new Date().toISOString()
      })
      .eq('faq_id', faqId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: '서버 오류' });
    }

    res.json({ success: true, faq: data });
  } catch (error) {
    res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
  }
});

// FAQ 삭제
router.delete('/api/faqs/:faqId', requireAdmin, async (req, res) => {
  try {
    const { faqId } = req.params;

    const { error } = await req.supabase
      .from('faqs')
      .delete()
      .eq('faq_id', faqId);

    if (error) {
      return res.status(500).json({ error: '서버 오류' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
