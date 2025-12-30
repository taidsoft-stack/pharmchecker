const express = require("express");
const got = require("got");
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');

const router = express.Router();

// 첫 화면 - 로그인 페이지로 리다이렉트
router.get('/', function (req, res) {
  res.redirect('/login');
});

// 로그인 페이지
router.get('/login', function (req, res) {
  res.render('login');
});

// 회원가입 페이지
router.get('/join', function (req, res) {
  res.render('join');
});

// 회원가입 API
router.post('/api/signup', async function (req, res) {
  try {
    const {
      email,
      pharmacistName,
      pharmacistPhone,
      businessNumber,
      pharmacyName,
      pharmacyPhone,
      postcode,
      address,
      detailAddress,
      googlePicture
    } = req.body;

    // 필수 필드 검증
    if (!email || !pharmacistName || !pharmacistPhone || !businessNumber || 
        !pharmacyName || !pharmacyPhone || !postcode || !address) {
      return res.status(400).json({
        success: false,
        message: '모든 필수 항목을 입력해주세요.'
      });
    }

    // 이메일 중복 체크
    const { data: existingEmail } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .single();

    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: '이미 가입된 이메일입니다.'
      });
    }

    // 사업자 번호 중복 체크
    const { data: existingBusiness } = await supabase
      .from('users')
      .select('business_number')
      .eq('business_number', businessNumber)
      .single();

    if (existingBusiness) {
      return res.status(409).json({
        success: false,
        message: '이미 등록된 사업자 번호입니다.'
      });
    }

    // UUID 생성
    const userId = uuidv4();

    // 사용자 데이터 삽입
    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          user_id: userId,
          email: email,
          pharmacist_name: pharmacistName,
          pharmacist_phone: pharmacistPhone,
          business_number: businessNumber,
          pharmacy_name: pharmacyName,
          pharmacy_phone: pharmacyPhone,
          postcode: postcode,
          address: address,
          detail_address: detailAddress || null,
          google_picture: googlePicture || null,
          is_active: true
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('회원가입 DB 에러:', error);
      return res.status(500).json({
        success: false,
        message: '회원가입 중 오류가 발생했습니다.',
        error: error.message
      });
    }

    // 회원가입 성공
    res.status(201).json({
      success: true,
      message: '회원가입이 완료되었습니다.',
      data: {
        userId: data.user_id,
        email: data.email,
        pharmacistName: data.pharmacist_name,
        pharmacyName: data.pharmacy_name
      }
    });

  } catch (error) {
    console.error('회원가입 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// 이메일 중복 확인 API
router.get('/api/check-email/:email', async function (req, res) {
  try {
    const { email } = req.params;

    const { data } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .single();

    res.json({
      exists: !!data,
      message: data ? '이미 사용 중인 이메일입니다.' : '사용 가능한 이메일입니다.'
    });
  } catch (error) {
    res.status(500).json({
      exists: false,
      message: '이메일 확인 중 오류가 발생했습니다.'
    });
  }
});

// 사업자 번호 중복 확인 API
router.get('/api/check-business/:businessNumber', async function (req, res) {
  try {
    const { businessNumber } = req.params;

    const { data } = await supabase
      .from('users')
      .select('business_number')
      .eq('business_number', businessNumber)
      .single();

    res.json({
      exists: !!data,
      message: data ? '이미 등록된 사업자 번호입니다.' : '사용 가능한 사업자 번호입니다.'
    });
  } catch (error) {
    res.status(500).json({
      exists: false,
      message: '사업자 번호 확인 중 오류가 발생했습니다.'
    });
  }
});

// 로그인 API
router.post('/api/login', async function (req, res) {
  try {
    const { email } = req.body;

    // 이메일 검증
    if (!email) {
      return res.status(400).json({
        success: false,
        message: '이메일을 입력해주세요.'
      });
    }

    // 사용자 조회
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('is_active', true)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: '등록되지 않은 이메일입니다. 회원가입을 먼저 진행해주세요.'
      });
    }

    // 로그인 성공
    res.status(200).json({
      success: true,
      message: '로그인에 성공했습니다.',
      data: {
        userId: user.user_id,
        email: user.email,
        pharmacistName: user.pharmacist_name,
        pharmacyName: user.pharmacy_name,
        googlePicture: user.google_picture
      }
    });

  } catch (error) {
    console.error('로그인 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.',
      error: error.message
    });
  }
});

// 결제 페이지 (팝업용)
router.get('/payment', function (req, res) {
  res.render('index');
});

// PharmChecker 메인 페이지
router.get('/pharmchecker', function (req, res) {
  res.render('pharmchecker');
});

// 결제 성공 페이지
router.get('/success', function (req, res) {
  res.render('success');
});

// 결제 실패 페이지
router.get('/fail', function (req, res) {
  res.render('fail', {
    code: req.query.code || 'UNKNOWN_ERROR',
    message: req.query.message || '알 수 없는 에러가 발생했습니다.'
  });
});

// 구매 완료 페이지
router.get('/purchase-complete', function (req, res) {
  res.render('purchase-complete');
});

router.post("/confirm", function (req, res) {
  // 클라이언트에서 받은 JSON 요청 바디입니다.
  const { paymentKey, orderId, amount } = req.body;

  // 토스페이먼츠 API는 시크릿 키를 사용자 ID로 사용하고, 비밀번호는 사용하지 않습니다.
  // 비밀번호가 없다는 것을 알리기 위해 시크릿 키 뒤에 콜론을 추가합니다.
  const widgetSecretKey = "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6";
  const encryptedSecretKey =
    "Basic " + Buffer.from(widgetSecretKey + ":").toString("base64");

  // 결제를 승인하면 결제수단에서 금액이 차감돼요.
  got
    .post("https://api.tosspayments.com/v1/payments/confirm", {
      headers: {
        Authorization: encryptedSecretKey,
        "Content-Type": "application/json",
      },
      json: {
        orderId: orderId,
        amount: amount,
        paymentKey: paymentKey,
      },
      responseType: "json",
    })
    .then(function (response) {
      // 결제 성공 비즈니스 로직을 구현하세요.
      console.log(response.body);
      res.status(response.statusCode).json(response.body)
    })
    .catch(function (error) {
      // 결제 실패 비즈니스 로직을 구현하세요.
      console.log(error.response.body);
      res.status(error.response.statusCode).json(error.response.body)
    });
});

module.exports = router;