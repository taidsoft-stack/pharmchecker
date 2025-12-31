# 토스페이먼츠 자동결제 설정 가이드

## 1. API 키 발급받기

### 토스페이먼츠 개발자센터 접속
1. https://developers.tosspayments.com 접속 후 로그인
2. 좌측 메뉴에서 **"내 개발 정보"** → **"API 키"** 클릭
3. **"API 개별 연동 키"** 탭 선택

### 테스트 키 확인
다음 두 가지 키를 복사하세요:
- **클라이언트 키**: `test_ck_...` 로 시작 (예: `test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq`)
- **시크릿 키**: `test_sk_...` 로 시작 (예: `test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R`)

> ⚠️ **주의**: 시크릿 키는 절대 GitHub나 클라이언트 코드에 노출하지 마세요!

---

## 2. 프로젝트에 키 적용하기

### 2-1. 환경 변수 파일 수정

프로젝트 루트 폴더에 `.env` 파일을 생성하고 다음 내용을 입력하세요:

```bash
# Supabase 설정
SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# 토스페이먼츠 설정 (테스트 환경)
TOSS_CLIENT_KEY=test_ck_여기에_발급받은_클라이언트_키_입력
TOSS_SECRET_KEY=test_sk_여기에_발급받은_시크릿_키_입력

# 서버 설정
PORT=8080
```

**예시:**
```bash
TOSS_CLIENT_KEY=test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq
TOSS_SECRET_KEY=test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R
```

### 2-2. 프론트엔드 코드 수정

`views/subscription-payment.ejs` 파일을 열고 **189번째 줄 근처**에서:

```javascript
// TODO: 아래 clientKey를 토스페이먼츠 개발자센터에서 발급받은 테스트 클라이언트 키로 교체하세요
const clientKey = 'test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq'; // 여기에 발급받은 test_ck_... 키를 입력
```

이 부분을 **발급받은 클라이언트 키**로 교체하세요.

---

## 3. 자동결제 흐름 이해하기

### 전체 프로세스
```
1. 사용자가 플랜 선택 → 결제 페이지 이동
   └─ /subscription/plans → /subscription/payment

2. 카드 등록하기 버튼 클릭 → 토스페이먼츠 카드 등록창
   └─ payment.requestBillingAuth() 호출

3. 카드 정보 입력 + 본인인증
   └─ 성공 시: /subscription/billing-success?authKey=...&customerKey=...

4. 서버에서 빌링키 발급
   └─ POST /v1/billing/authorizations/issue (authKey 전달)

5. 빌링키로 첫 결제 승인
   └─ POST /v1/billing/{billingKey} (첫 달 결제)

6. DB에 구독 정보 저장
   └─ user_subscriptions, billing_payments 테이블

7. 매달 자동결제
   └─ 스케줄러가 POST /api/subscription/recurring-payment 호출
```

---

## 4. 테스트 방법

### 테스트 카드 정보
토스페이먼츠 테스트 환경에서는 다음 카드 번호를 사용하세요:

- **카드번호**: 앞 6자리만 유효하면 됨 (예: `433012` + 아무 숫자)
- **유효기간**: 미래 날짜 아무거나 (예: `12/28`)
- **CVC**: 아무 3자리 숫자 (예: `123`)
- **비밀번호**: 앞 2자리 아무 숫자 (예: `12`)
- **본인인증번호**: `000000` (테스트 환경 고정값)

### 테스트 절차
1. 서버 실행: `npm start`
2. 회원가입/로그인
3. "구독 플랜 선택하기" 버튼 클릭
4. 플랜 선택 후 "선택하기" 클릭
5. 결제 페이지에서 "결제하기" 클릭
6. 토스페이먼츠 카드 등록창에서 테스트 카드 정보 입력
7. 본인인증 시 `000000` 입력
8. 결제 완료 확인

### 확인사항
- Supabase `user_subscriptions` 테이블에 새 레코드 생성 확인
- `billing_key` 필드에 빌링키 저장 확인
- `billing_payments` 테이블에 첫 결제 기록 확인

---

## 5. 매달 자동결제 스케줄링 (선택사항)

### Node.js Cron 사용 예시

```javascript
// 프로젝트 루트에 scheduled-tasks.js 파일 생성
const cron = require('node-cron');
const got = require('got');

// 매달 1일 오전 9시에 실행
cron.schedule('0 9 1 * *', async () => {
  console.log('월 정기결제 시작...');
  
  // 모든 활성 구독 조회
  const { data: subscriptions } = await supabase
    .from('user_subscriptions')
    .select('user_id')
    .eq('status', 'active');

  // 각 사용자별 자동결제 실행
  for (const sub of subscriptions) {
    try {
      await got.post('http://localhost:8080/api/subscription/recurring-payment', {
        json: { userId: sub.user_id },
        responseType: 'json',
      });
      console.log(`✅ ${sub.user_id} 결제 완료`);
    } catch (error) {
      console.error(`❌ ${sub.user_id} 결제 실패:`, error.message);
    }
  }
});
```

---

## 6. 라이브 환경 전환 (실제 서비스 오픈 시)

### 계약 진행
1. 토스페이먼츠 고객센터 연락: **1544-7772**
2. 사업자등록번호 입력 및 전자결제 계약
3. 자동결제(빌링) 사용 승인 요청
4. 리스크 검토 완료 후 라이브 키 발급

### 라이브 키 적용
`.env` 파일에서 테스트 키를 라이브 키로 교체:

```bash
# 라이브 환경
TOSS_CLIENT_KEY=live_ck_발급받은_라이브_클라이언트_키
TOSS_SECRET_KEY=live_sk_발급받은_라이브_시크릿_키
```

`views/subscription-payment.ejs`에서도 클라이언트 키를 라이브 키로 교체하세요.

---

## 7. 문제 해결

### "UNAUTHORIZED_KEY" 에러
- 시크릿 키가 잘못되었거나 콜론(`:`)이 누락됨
- `.env` 파일의 `TOSS_SECRET_KEY` 확인

### "NOT_FOUND_BILLING_KEY" 에러
- 빌링키가 만료되었거나 삭제됨
- 사용자에게 카드 재등록 요청

### "INVALID_CARD_INSTALLMENT" 에러
- 할부 개월수가 잘못됨
- 자동결제는 일시불만 가능 (`installmentPlanMonths: 0`)

### 개발자 문서
- 공식 문서: https://docs.tosspayments.com/guides/v2/billing
- GitHub 샘플: https://github.com/tosspayments/tosspayments-sample
- 기술 지원: techsupport@tosspayments.com

---

## 요약 체크리스트

- [ ] 토스페이먼츠 개발자센터에서 테스트 키 발급
- [ ] `.env` 파일에 `TOSS_SECRET_KEY` 입력
- [ ] `subscription-payment.ejs`에 `TOSS_CLIENT_KEY` 입력
- [ ] 서버 재시작 (`npm start`)
- [ ] 테스트 카드로 결제 테스트
- [ ] Supabase에서 빌링키 저장 확인
- [ ] (선택) 스케줄러 설정으로 자동결제 자동화

완료되었습니다! 🎉
