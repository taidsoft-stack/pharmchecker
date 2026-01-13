# Supabase Auth 마이그레이션 가이드

## 완료된 작업

### ✅ Frontend (Views)
1. **login.ejs** - Supabase Auth로 변경
2. **pharmchecker.ejs** - Supabase Auth로 변경
3. **join.ejs** - Supabase Auth + 가입 여부 체크, Authorization 헤더 추가
4. **admin-login.ejs** - Supabase Auth로 변경
5. **admin-main.ejs** - Supabase SDK 추가, Google SDK 제거

### ✅ Middleware
1. **middleware/auth.js** - requireAuth, optionalAuth 생성
2. **routes/admin.js** - requireAdmin 이미 Supabase Auth 사용

### ✅ Backend APIs (routes/index.js)
1. **POST /api/signup** - requireAuth 추가, req.supabase 사용
2. **POST /api/user/withdraw** - requireAuth 추가, req.supabase 사용
3. **POST /api/auth/check-existing-user** - requireAuth 추가, req.supabase 사용
4. **GET /subscription/payment** - optionalAuth 추가, req.supabase || supabase 사용

---

## 나머지 작업 가이드

### 패턴 1: 인증 필요 API - requireAuth 추가

**변경 전:**
```javascript
router.post('/api/some-endpoint', async function (req, res) {
  const userId = req.body.userId; // ❌ body에서 받음
  
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('user_id', userId);
  
  res.json({ data });
});
```

**변경 후:**
```javascript
router.post('/api/some-endpoint', requireAuth, async function (req, res) {
  const userId = req.user.id; // ✅ requireAuth에서 추출
  
  const { data } = await req.supabase // ✅ req.supabase 사용 (RLS 적용)
    .from('users')
    .select('*')
    .eq('user_id', userId);
  
  res.json({ data });
});
```

**핵심 변경:**
- `requireAuth` 미들웨어 추가
- `req.body.userId` → `req.user.id`
- `supabaseAdmin` → `req.supabase`

---

### 패턴 2: 선택적 인증 API - optionalAuth 사용

**변경 전:**
```javascript
router.get('/api/public-data', async function (req, res) {
  const { data } = await supabase
    .from('public_table')
    .select('*');
  
  res.json({ data });
});
```

**변경 후:**
```javascript
router.get('/api/public-data', optionalAuth, async function (req, res) {
  const client = req.supabase || supabase; // ✅ 인증 있으면 req.supabase, 없으면 supabase
  
  const { data } = await client
    .from('public_table')
    .select('*');
  
  res.json({ data });
});
```

**핵심 변경:**
- `optionalAuth` 미들웨어 추가
- `req.supabase || supabase` 패턴 사용

---

### 패턴 3: Admin API - requireAdmin 사용

**변경 전 (routes/admin.js):**
```javascript
router.get('/api/admin/users', async (req, res) => {
  // 인증 체크 없음 ❌
  
  const { data } = await supabaseAdmin
    .from('users')
    .select('*');
  
  res.json({ data });
});
```

**변경 후:**
```javascript
router.get('/api/admin/users', requireAdmin, async (req, res) => {
  // requireAdmin이 자동으로 관리자 확인 ✅
  
  const { data } = await req.supabase // ✅ req.supabase 사용 (is_admin() RLS)
    .from('users')
    .select('*');
  
  res.json({ data });
});
```

**핵심 변경:**
- `requireAdmin` 미들웨어 추가 (이미 대부분 추가되어 있음)
- `supabaseAdmin` → `req.supabase`

---

### 패턴 4: Auth Admin API는 유지

**유지해야 하는 경우:**
```javascript
// ✅ auth.admin.* API는 service_role 필요 - supabaseAdmin 유지
const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();

const { data } = await supabaseAdmin.auth.admin.createUser({...});
```

**이유:**
- Supabase Auth Admin API는 service_role 키 필요
- 사용자 삭제, 목록 조회 등 관리 작업

---

### 패턴 5: 구독/결제 API

**변경 전:**
```javascript
router.post('/api/subscription/create', async (req, res) => {
  const userId = req.body.userId;
  
  const { data } = await supabaseAdmin
    .from('user_subscriptions')
    .insert({
      user_id: userId,
      plan_id: req.body.planId
    });
  
  res.json({ data });
});
```

**변경 후:**
```javascript
router.post('/api/subscription/create', requireAuth, async (req, res) {
  const userId = req.user.id;
  
  const { data } = await req.supabase
    .from('user_subscriptions')
    .insert({
      user_id: userId,
      plan_id: req.body.planId
    });
  
  res.json({ data });
});
```

---

## routes/index.js 남은 작업 목록

### 🔴 완료된 작업
1. **GET /api/subscription/my** - 완료 ✅
2. **POST /api/subscription/cancel** - 완료 ✅
3. **GET /api/subscription/payment-history** - 완료 ✅
4. **POST /api/subscription/reactivate** - 완료 ✅
5. **POST /api/subscription/update-payment** - 완료 ✅
6. **GET /api/subscription/status** - requireAuth 추가, req.supabase 사용 ✅

### 🟡 레거시 API (사용 안 함)
7. **POST /api/auth/get-user-id** - 구글 SDK 기반, 더 이상 사용 안 함
8. **POST /api/login** - 구글 SDK 기반, 더 이상 사용 안 함 (views/login.ejs가 Supabase Auth 사용)

### 🟢 공개 API (인증 불필요)
9. **GET /api/subscription/plans** - 공개 API, supabase 그대로 사용 ✅
10. **GET /api/check-email/:email** - 회원가입 전 중복 확인, supabase 사용 ✅
11. **GET /api/check-business/:businessNumber** - 회원가입 전 중복 확인, supabase 사용 ✅

### 🔵 스케줄러/콜백 API (특수 처리)
12. **POST /api/subscription/recurring-payment** - 스케줄러 호출, supabase 유지
13. **GET /api/subscription/update-payment-success** - 토스페이먼츠 콜백, 내부 API 호출

---

## routes/admin.js 작업 목록

### 현재 상태
- ✅ requireAdmin 미들웨어는 이미 Supabase Auth 사용
- ✅ 대부분의 API가 requireAdmin 미들웨어 사용 중
- ✅ API 내부에서 supabaseAdmin 사용하지 않음 (이미 완료)

---

## routes/support.js 작업 목록

### 🔴 완료된 작업 ✅
1. **requireAuth 미들웨어 추가** - 완료
2. **GET /api/tickets** - requireAuth + req.supabase 적용
3. **GET /api/tickets/:id** - requireAuth + req.supabase 적용
4. **POST /api/tickets** - requireAuth + req.supabase 적용
5. **POST /api/remote/request** - requireAuth + req.supabase 적용
6. **POST /api/remote/simple** - requireAuth + req.supabase 적용
7. **모든 supabaseAdmin → req.supabase 변경 완료**

### 🟢 공개 API (인증 불필요)
8. **GET /api/faq** - 공개 API, supabase 그대로 사용 ✅

---

---

## 자동 변경 스크립트 (선택)

### VSCode 검색/치환 사용

**1단계: supabaseAdmin → req.supabase 변경**
```
검색 (정규식): await supabaseAdmin\n\s+\.from\(
치환: await req.supabase\n      .from(
```

**2단계: 수동 검토**
- auth.admin.* 호출은 유지
- requireAuth/requireAdmin 미들웨어 확인

---

## 테스트 체크리스트

### 로그인/회원가입
- [ ] Google 로그인 작동
- [ ] 회원가입 폼 제출
- [ ] 가입 여부 체크 (이미 가입한 계정 거부)
- [ ] 회원 탈퇴 기능

### 구독/결제
- [ ] 구독 플랜 목록 조회
- [ ] 결제 페이지 접근
- [ ] 프로모션 코드 적용
- [ ] 결제 완료 처리

### 관리자
- [ ] 관리자 로그인
- [ ] 사용자 목록 조회
- [ ] 대시보드 통계
- [ ] 지원 티켓 관리

---

## RLS 정책 검증

### 확인 방법
```sql
-- 모든 테이블의 RLS 상태 확인
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';

-- 특정 테이블의 정책 확인
SELECT * FROM pg_policies WHERE tablename = 'users';
```

### 필수 정책
- users: SELECT/UPDATE (자신만), ALL (관리자)
- user_subscriptions: SELECT (자신만), ALL (관리자)
- billing_payments: SELECT (자신만), ALL (관리자)
- support_tickets: SELECT/INSERT (자신만), ALL (관리자)

---

## 롤백 가이드

만약 문제 발생 시:

1. **임시로 supabaseAdmin 사용**
   ```javascript
   const client = req.supabase || supabaseAdmin;
   ```

2. **RLS 비활성화 (비상시만)**
   ```sql
   ALTER TABLE users DISABLE ROW LEVEL SECURITY;
   ```

3. **로그 확인**
   ```javascript
   console.log('User:', req.user);
   console.log('Supabase client:', req.supabase ? 'Authenticated' : 'Not authenticated');
   ```

---

## 마이그레이션 완료 후

1. **config/supabase.js에서 service_role 키 제거 (선택)**
   - ⚠️ auth.admin API 사용 중이면 유지 필요
   
2. **.env에서 SUPABASE_SERVICE_ROLE_KEY 제거 (선택)**
   - ⚠️ 백업 먼저!

3. **문서 업데이트**
   - API 명세서에 Authorization 헤더 요구사항 추가

4. **팀 공유**
   - WPF 개발자에게 변경사항 전달
   - 프론트엔드에서 Authorization 헤더 추가 필요
