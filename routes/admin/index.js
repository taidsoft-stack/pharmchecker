const express = require('express');
const router = express.Router();

// 모듈화된 라우터 import
const authRouter = require('./auth');
const dashboardRouter = require('./dashboard');
const usersRouter = require('./users');
const subscriptionsRouter = require('./subscriptions');
const paymentsRouter = require('./payments');
const supportRouter = require('./support');
const remoteSupportRouter = require('./remote-support');
const faqsRouter = require('./faqs');
const promotionsRouter = require('./promotions');
const plansRouter = require('./plans');
const referralCodesRouter = require('./referral-codes');
const promotionAssignRouter = require('./promotion-assign');

// 페이지 렌더링 라우터
router.get('/', (req, res) => {
  res.render('admin-dashboard');
});

router.get('/dashboard', (req, res) => {
  res.render('admin-dashboard');
});

router.get('/users', (req, res) => {
  res.render('admin-users');
});

router.get('/mobile', (req, res) => {
  res.render('admin-mobile');
});

router.get('/subscriptions', (req, res) => {
  res.render('admin-subscriptions');
});

router.get('/payments', (req, res) => {
  res.render('admin-payments');
});

router.get('/support-tickets', (req, res) => {
  res.render('admin-support-tickets');
});

router.get('/remote-support', (req, res) => {
  res.render('admin-remote-support');
});

// API 라우터 연결
router.use('/api', authRouter);
router.use('/api', dashboardRouter);
router.use('/api', usersRouter);
router.use('/api', subscriptionsRouter);
router.use('/api', paymentsRouter);
router.use('/api', supportRouter);
router.use('/api', remoteSupportRouter);
router.use('/api', faqsRouter);
router.use('/api', promotionsRouter);
router.use('/api', plansRouter);
router.use('/api', referralCodesRouter);
router.use('/api', promotionAssignRouter);

module.exports = router;
