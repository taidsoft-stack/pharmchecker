const express = require('express');
const router = express.Router();
const { requireAdmin } = require('./middleware');

// 관리자 정보 조회
router.get('/me', requireAdmin, async (req, res) => {
  try {
    res.json({
      admin_id: req.admin.admin_id,
      email: req.user.email,
      admin_name: req.admin.admin_name || req.user.email,
      role: req.admin.role
    });
  } catch (error) {
    console.error('내 정보 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 대시보드 통계
router.get('/dashboard/stats', requireAdmin, async (req, res) => {
  try {
    // 전체 회원 수 (RLS 정책: is_admin() 함수로 전체 접근)
    const { data: usersData, count: totalUsers, error: usersError } = await req.supabase
      .from('users')
      .select('user_id', { count: 'exact' })
      .eq('is_deleted', false);
    
    if (usersError) {
      console.error('회원 수 조회 에러:', usersError);
    }
    
    // 활성 구독 수
    const { data: subsData, count: activeSubscriptions, error: subsError } = await req.supabase
      .from('user_subscriptions')
      .select('subscription_id', { count: 'exact' })
      .eq('status', 'active');
    
    if (subsError) {
      console.error('구독 수 조회 에러:', subsError);
    }
    
    // 이번 달 매출
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const { data: payments, error: paymentsError } = await req.supabase
      .from('billing_payments')
      .select('amount')
      .eq('status', 'success')
      .gte('approved_at', startOfMonth.toISOString());
    
    if (paymentsError) {
      console.error('결제 내역 조회 에러:', paymentsError);
    }
    
    const monthlyRevenue = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;
    
    // 활성 프로모션 수
    const { data: promosData, count: activePromotions, error: promosError } = await req.supabase
      .from('subscription_promotions')
      .select('promotion_id', { count: 'exact' })
      .eq('is_active', true);
    
    if (promosError) {
      console.error('프로모션 수 조회 에러:', promosError);
    }
    
    const result = {
      totalUsers: totalUsers || 0,
      activeSubscriptions: activeSubscriptions || 0,
      monthlyRevenue: monthlyRevenue,
      activePromotions: activePromotions || 0
    };
    
    res.json(result);
  } catch (error) {
    console.error('통계 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

// 최근 활동 로그
router.get('/activities/recent', requireAdmin, async (req, res) => {
  try {
    const { data: activities } = await req.supabase
      .from('admin_activity_logs')
      .select(`
        *,
        admins (
          admin_id
        )
      `)
      .order('created_at', { ascending: false })
      .limit(10);

    res.json({ activities: activities || [] });
  } catch (error) {
    console.error('최근 활동 로그 조회 오류:', error);
    res.status(500).json({ error: '서버 오류' });
  }
});

module.exports = router;
