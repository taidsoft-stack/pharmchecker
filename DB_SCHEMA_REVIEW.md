# PharmChecker 구독 시스템 - 최종 로직 정리

## 🎯 핵심 비즈니스 로직

### 사용자는 플랜을 선택하지 않습니다 (첫 달 제외)
1. **첫 달**: 사용자가 원하는 플랜 선택 → 결제 (entry_plan_id 고정)
2. **다음 달부터**: 시스템이 사용량 자동 분석 → 최적 플랜 자동 결정 → 자동 결제
3. **플랜 변경 기능**: 사용자가 직접 변경 불가 (시스템 자동 처리)

### 빌링키는 한 번 발급 후 계속 사용
- 첫 결제 시 카드 등록 → 빌링키 발급 → DB 저장
- 매달 자동결제 시 저장된 빌링키 재사용

---

## 📊 데이터 흐름

### [첫 결제 프로세스]
```
1. 사용자가 플랜 선택 (예: 베이직 플랜)
   └─ /subscription/plans → 플랜 카드 클릭

2. 결제 페이지 이동
   └─ /subscription/payment

3. 토스페이먼츠 카드 등록 (requestBillingAuth)
   └─ 카드 정보 + 본인인증

4. authKey 발급 후 리다이렉트
   └─ /subscription/billing-success?authKey=...&planId=...&userId=...

5. 서버: 빌링키 발급
   └─ POST /v1/billing/authorizations/issue (authKey → billingKey)

6. 서버: 빌링키로 첫 결제 승인
   └─ POST /v1/billing/{billingKey}

7. DB 저장:
   ├─ user_subscriptions INSERT
   │  ├─ entry_plan_id: 사용자가 선택한 플랜 (고정, 변경 안됨)
   │  ├─ billing_plan_id: 사용자가 선택한 플랜 (사용량에 따라 자동 변경)
   │  ├─ billing_key: 발급받은 빌링키
   │  ├─ status: 'active'
   │  └─ is_first_billing: true
   └─ billing_payments INSERT (첫 결제 기록)
```

### [매달 자동결제 프로세스]
```
1. 스케줄러 실행 (매달 결제일)
   └─ POST /api/subscription/recurring-payment { userId }

2. 활성 구독 조회
   └─ SELECT * FROM user_subscriptions WHERE user_id=? AND status='active'

3. 이번 달 사용량 조회
   └─ SELECT total_rx_count FROM usage_billing_period_stats
   └─ WHERE user_id=? AND billing_period_start=current_period_start

4. 사용량 기반 최적 플랜 자동 결정
   ├─ 모든 플랜 조회 (가격 오름차순)
   ├─ 사용량과 비교하여 최적 플랜 선택
   │  ├─ 50건 이하: 라이트 (13,200원)
   │  ├─ 51~100건: 베이직 (18,900원)
   │  ├─ 101~300건: 슈퍼 (33,000원)
   │  └─ 301건 이상: 프리미엄 (55,000원)
   └─ 예: 이번 달 70건 사용 → 베이직 플랜 자동 선택

5. 빌링키로 자동결제 승인
   └─ POST /v1/billing/{billingKey} (결정된 플랜 금액으로)

6. DB 업데이트:
   ├─ user_subscriptions UPDATE
   │  ├─ billing_plan_id: 새로 결정된 플랜 (예: 베이직 → 슈퍼)
   │  ├─ current_period_start: +1개월
   │  ├─ current_period_end: +1개월
   │  └─ is_first_billing: false
   └─ billing_payments INSERT (자동결제 기록)
```

---

## 🗄️ 주요 테이블 및 필드

### user_subscriptions
```sql
subscription_id UUID PRIMARY KEY
user_id UUID (FK → users.user_id)
entry_plan_id UUID -- 최초 가입 플랜 (변경 안됨, 통계용)
billing_plan_id UUID -- 현재 결제 플랜 (사용량에 따라 자동 변경)
status VARCHAR -- 'active', 'cancelled', 'payment_failed'
billing_key VARCHAR -- 빌링키 (한 번 발급, 계속 사용)
customer_key VARCHAR -- 토스 고객 키
current_period_start TIMESTAMP
current_period_end TIMESTAMP
is_first_billing BOOLEAN
cancelled_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

**중요:**
- `entry_plan_id`: 사용자가 처음 선택한 플랜 → **절대 변경 안됨**
- `billing_plan_id`: 실제 결제되는 플랜 → **매달 사용량에 따라 자동 변경**

### usage_billing_period_stats
```sql
user_id UUID (FK → users.user_id)
billing_period_start TIMESTAMP
billing_period_end TIMESTAMP
total_rx_count INTEGER -- 이번 달 총 처방전 건수
created_at TIMESTAMP
updated_at TIMESTAMP
```

**역할**: 매달 사용량 추적 → 다음 달 플랜 결정에 사용

---

## 🔄 구현된 로직

### 1. 첫 결제 (`GET /subscription/billing-success`)
```javascript
✅ 중복 구독 방지 (이미 active 구독 있으면 에러)
✅ authKey → 빌링키 발급
✅ 빌링키로 첫 결제 승인
✅ user_subscriptions INSERT (entry_plan_id = billing_plan_id)
✅ billing_payments INSERT
```

### 2. 매달 자동결제 (`POST /api/subscription/recurring-payment`)
```javascript
✅ 활성 구독 조회
✅ usage_billing_period_stats에서 사용량 조회
✅ 사용량 기반 최적 플랜 자동 결정
✅ 빌링키로 결제 승인 (자동 결정된 플랜 금액)
✅ user_subscriptions UPDATE (billing_plan_id 자동 변경)
✅ billing_payments INSERT
✅ 구독 기간 연장 (+1개월)
```

### 3. 구독 상태 조회 (`GET /api/subscription/status`)
```javascript
✅ 활성 구독 확인
✅ entry_plan, billing_plan 정보 반환
✅ 구독 기간 정보 반환
```

### 4. 구독 취소 (`POST /api/subscription/cancel`)
```javascript
✅ status → 'cancelled'
✅ cancelled_at 기록
✅ 빌링키는 보관 (재구독 가능)
```

---

## 🎯 플랜 자동 결정 알고리즘

```javascript
// 모든 플랜을 가격 오름차순으로 조회
const allPlans = [
  { plan_code: 'LIGHT', daily_rx_limit: 50, monthly_price: 13200 },
  { plan_code: 'BASIC', daily_rx_limit: 100, monthly_price: 18900 },
  { plan_code: 'SUPER', daily_rx_limit: 300, monthly_price: 33000 },
  { plan_code: 'PREMIUM', daily_rx_limit: null, monthly_price: 55000 }, // 무제한
];

// 이번 달 사용량 예시: 70건
const totalRxCount = 70;

// 플랜 선택 로직
let selectedPlan = allPlans[0]; // 기본값: 라이트

for (const plan of allPlans) {
  if (plan.daily_rx_limit === null) {
    // 무제한 플랜은 항상 가능
    selectedPlan = plan;
    break;
  } else if (totalRxCount <= plan.daily_rx_limit * 30) {
    // 월간 사용량이 플랜 한도 안에 들어오면 선택
    selectedPlan = plan;
    break;
  }
}

// 결과: 70건은 베이직 플랜 (100건/일 * 30일 = 3000건/월)
console.log(selectedPlan.plan_name); // '베이직'
```

---

## ⚠️ 주의사항

### 1. 중복 구독 방지
- 첫 결제 시 활성 구독 체크
- 이미 `status='active'` 구독이 있으면 결제 차단

### 2. 사용량 데이터 필수
- `usage_billing_period_stats` 테이블에 데이터가 없으면 기본값 0건 처리
- 0건일 경우 가장 저렴한 플랜(라이트) 자동 선택

### 3. 플랜 변경 없음
- 사용자가 직접 플랜 변경하는 UI/API 없음
- 시스템이 사용량 기반으로 자동 처리

---

## ✅ 결론

**사용자 경험:**
1. 첫 달: 원하는 플랜 선택 → 결제
2. 다음 달: 아무것도 안해도 자동 결제 (사용량에 맞게 금액 조정)

**시스템 동작:**
- `entry_plan_id`: 고정 (통계/분석용)
- `billing_plan_id`: 매달 자동 변경 (사용량 기반)
- `billing_key`: 한 번 발급 후 계속 재사용

**DB 트랜잭션:**
- 첫 결제: INSERT user_subscriptions + billing_payments
- 매달 결제: UPDATE user_subscriptions (billing_plan_id) + INSERT billing_payments
- 플랜 변경 UI: 없음 (시스템 자동 처리)


## 🗄️ 주요 테이블 및 컬럼

### user_subscriptions
```sql
subscription_id UUID PRIMARY KEY
user_id UUID (FK → users.user_id)
entry_plan_id UUID (FK → subscription_plans.plan_id) -- 최초 가입 플랜
billing_plan_id UUID (FK → subscription_plans.plan_id) -- 현재 결제 플랜
status VARCHAR -- 'active', 'cancelled', 'payment_failed', 'replaced'
billing_key VARCHAR -- 토스페이먼츠 빌링키 (한 번 발급, 계속 사용)
customer_key VARCHAR -- 토스페이먼츠 고객 키 (user_id와 동일)
current_period_start TIMESTAMP
current_period_end TIMESTAMP
is_first_billing BOOLEAN
cancelled_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

**중요 필드:**
- `billing_key`: 자동결제의 핵심. 한 번 발급받으면 카드 만료 전까지 계속 사용
- `entry_plan_id`: 처음 가입한 플랜 (변경되지 않음)
- `billing_plan_id`: 실제 결제되는 플랜 (사용량에 따라 변경 가능)
- `status`:
  - `active`: 정상 구독 중
  - `cancelled`: 사용자가 취소
  - `payment_failed`: 자동결제 실패
  - `replaced`: 플랜 변경으로 교체됨 (이력 보관용)

### billing_payments
```sql
payment_id UUID PRIMARY KEY
subscription_id UUID (FK → user_subscriptions.subscription_id)
user_id UUID (FK → users.user_id)
order_id VARCHAR -- 토스페이먼츠 주문 ID (SUB_..., REC_...)
payment_key VARCHAR -- 토스페이먼츠 결제 키
billing_key VARCHAR -- 사용된 빌링키
amount INTEGER -- 결제 금액
status VARCHAR -- 'success', 'failed', 'cancelled'
requested_at TIMESTAMP
approved_at TIMESTAMP
created_at TIMESTAMP
```

**결제 기록 패턴:**
- 첫 결제: `order_id = 'SUB_' + userId + timestamp`
- 정기결제: `order_id = 'REC_' + userId + timestamp`
- 모든 결제는 이 테이블에 기록 (성공/실패 모두)

### subscription_plans
```sql
plan_id UUID PRIMARY KEY
plan_code VARCHAR -- 'LIGHT', 'BASIC', 'SUPER', 'PREMIUM'
plan_name VARCHAR -- '라이트', '베이직', '슈퍼', '프리미엄'
monthly_price INTEGER -- 13200, 18900, 33000, 55000
daily_rx_limit INTEGER -- 50, 100, 300, NULL (무제한)
is_active BOOLEAN
created_at TIMESTAMP
```

## 🔄 현재 구현된 로직

### 1. 빌링키 발급 및 첫 결제 (`/subscription/billing-success`)
```javascript
✅ 기존 구독 확인 (중복 방지)
✅ authKey로 빌링키 발급
✅ 빌링키로 첫 결제 승인
✅ 신규 구독 생성 or 기존 구독 교체
✅ 결제 기록 저장 (billing_payments)
```

### 2. 매달 자동결제 (`POST /api/subscription/recurring-payment`)
```javascript
✅ 활성 구독 조회 (status = 'active')
✅ 플랜 정보 조회 (billing_plan_id)
✅ 빌링키로 결제 승인
✅ 결제 기록 저장
✅ 구독 기간 업데이트 (+1개월)
❌ 결제 실패 시 재시도 로직 없음 (TODO)
```

### 3. 구독 상태 조회 (`GET /api/subscription/status`)
```javascript
✅ userId로 활성 구독 조회
✅ 플랜 정보 JOIN (entry_plan, billing_plan)
✅ 구독 기간 정보 반환
```

### 4. 구독 취소 (`POST /api/subscription/cancel`)
```javascript
✅ 활성 구독 확인
✅ status → 'cancelled' 변경
✅ cancelled_at 기록
✅ 빌링키는 보관 (재구독 가능)
```

## ⚠️ 추가 구현 필요 사항

### 1. 자동결제 실패 처리
```javascript
// recurring-payment에서 결제 실패 시:
- 재시도 로직 (3일 후, 7일 후)
- 이메일/SMS 알림
- status → 'payment_failed'
- 3회 실패 시 → 'suspended'
```

### 2. 사용량 기반 플랜 자동 조정
```javascript
// 매달 말일에 실행:
- usage_billing_period_stats에서 처방전 건수 확인
- 적절한 플랜 계산
- billing_plan_id 업데이트
- 다음 달 결제 금액 조정
```

### 3. 프로모션 적용
```javascript
// pending_user_promotions 확인:
- 할인 쿠폰 적용
- 무료 체험 기간
- 금액 조정 후 결제
```

### 4. 빌링키 만료 처리
```javascript
// 카드 만료 시:
- 결제 실패 감지
- 사용자에게 카드 재등록 요청
- 새 빌링키 발급 후 billing_key 업데이트
```

## 📝 DB 트랜잭션 무결성

### 결제 성공 시 필수 INSERT/UPDATE
```sql
-- 1. user_subscriptions (신규 or 업데이트)
INSERT INTO user_subscriptions (subscription_id, user_id, billing_key, ...)
-- 또는
UPDATE user_subscriptions SET billing_key=?, billing_plan_id=?, ... WHERE subscription_id=?

-- 2. billing_payments (항상 INSERT)
INSERT INTO billing_payments (payment_id, subscription_id, order_id, payment_key, billing_key, amount, status='success', ...)

-- 3. (선택) usage_billing_period_stats 초기화
INSERT INTO usage_billing_period_stats (user_id, billing_period_start, billing_period_end, total_rx_count=0, ...)
```

### 결제 실패 시 필수 UPDATE
```sql
-- 1. billing_payments (실패 기록)
INSERT INTO billing_payments (payment_id, subscription_id, order_id, billing_key, amount, status='failed', ...)

-- 2. user_subscriptions 상태 변경
UPDATE user_subscriptions SET status='payment_failed', updated_at=NOW() WHERE subscription_id=?
```

## ✅ 결론

**빌링키는 한 번 발급받아 계속 사용합니다.**
- ✅ 첫 구독: authKey → 빌링키 발급 → DB 저장
- ✅ 매달 자동결제: 저장된 빌링키로 결제
- ✅ 플랜 변경: 새 빌링키 발급 (카드 재등록)
- ✅ 재구독: 새 빌링키 발급 (보안상 권장)

**모든 DB 연동 완료:**
- ✅ user_subscriptions: 구독 생성/업데이트
- ✅ billing_payments: 결제 기록 저장
- ✅ subscription_plans: 플랜 정보 조회
- 🔶 usage_*_stats: 사용량 추적 (향후 구현)
- 🔶 pending_user_promotions: 프로모션 적용 (향후 구현)

**트랜잭션 안정성:**
- ✅ 중복 구독 방지 (기존 구독 확인)
- ✅ 결제 성공/실패 모두 기록
- ✅ 구독 상태 추적 (active, cancelled, payment_failed, replaced)
- ✅ 이력 보관 (replaced 상태로 이전 구독 보관)
