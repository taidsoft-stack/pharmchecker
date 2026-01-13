# PharmChecker WPF 인증 시스템 통합 가이드

## 📋 목차
1. [시스템 개요](#시스템-개요)
2. [Supabase 인증 구조](#supabase-인증-구조)
3. [데이터베이스 테이블](#데이터베이스-테이블)
4. [API 엔드포인트](#api-엔드포인트)
5. [인증 플로우](#인증-플로우)
6. [WPF 구현 가이드](#wpf-구현-가이드)
7. [보안 고려사항](#보안-고려사항)

---

## 시스템 개요

PharmChecker는 **Supabase Auth + Google OAuth 2.0**을 사용하는 인증 시스템입니다.

### 핵심 특징
- **Google OAuth 기반 로그인** - 사용자는 Google 계정으로만 로그인
- **Supabase Auth** - JWT 토큰 기반 인증
- **RLS (Row Level Security)** - 데이터베이스 레벨 권한 제어
- **이중 사용자 테이블** - `auth.users` (Supabase 관리) + `public.users` (앱 데이터)

---

## Supabase 인증 구조

### Supabase 프로젝트 정보
```
URL: https://gitbtujexmsjfixgeoha.supabase.co
Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpdGJ0dWpleG1zamZpeGdlb2hhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzA5MDIsImV4cCI6MjA4MjA0NjkwMn0.BNN8hauH8NdHZ4vopW_CQ_iK9CR55nfp3JQwuTjrG48
```

### Google OAuth 설정
```
Client ID: 506078799522-9ul40knlju9485bp654m76l2c0u76cbf.apps.googleusercontent.com
Provider: google
Redirect URL: {YOUR_APP_URL}/auth/callback
```

### 인증 방식
1. **Web/Mobile**: Supabase Auth SDK의 `signInWithOAuth()`
2. **WPF**: 웹 브라우저 팝업 → OAuth callback → JWT 토큰 추출

---

## 데이터베이스 테이블

### 1. auth.users (Supabase 시스템 테이블)
**설명**: Supabase가 자동 관리하는 인증 사용자 테이블

```sql
-- 주요 컬럼
id UUID PRIMARY KEY              -- 사용자 고유 ID (public.users.user_id와 동일)
email TEXT                        -- Google 계정 이메일
encrypted_password TEXT           -- (OAuth는 비밀번호 없음)
email_confirmed_at TIMESTAMP      -- 이메일 인증 시각
created_at TIMESTAMP
updated_at TIMESTAMP
user_metadata JSONB               -- { name, picture, ... } Google 프로필 정보
```

**접근**: Service Role Key로만 직접 접근 가능 (일반적으로 접근 불필요)

---

### 2. public.users (앱 사용자 정보 테이블)
**설명**: 약사/약국 정보를 저장하는 메인 테이블

```sql
CREATE TABLE users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  pharmacist_name TEXT NOT NULL,         -- 약사 이름
  pharmacist_phone TEXT NOT NULL,        -- 약사 연락처
  business_number TEXT NOT NULL UNIQUE,  -- 사업자번호
  pharmacy_name TEXT NOT NULL,           -- 약국명
  pharmacy_phone TEXT NOT NULL,          -- 약국 전화번호
  postcode TEXT NOT NULL,                -- 우편번호
  address TEXT NOT NULL,                 -- 주소
  detail_address TEXT,                   -- 상세주소
  google_picture TEXT,                   -- Google 프로필 사진 URL
  is_active BOOLEAN DEFAULT true,        -- 활성 상태
  is_deleted BOOLEAN DEFAULT false,      -- 탈퇴 여부
  deleted_at TIMESTAMP,                  -- 탈퇴 시각
  deleted_reason TEXT,                   -- 탈퇴 사유
  deleted_by UUID,                       -- 탈퇴 처리자 (NULL = 본인)
  is_returning_customer BOOLEAN DEFAULT false,  -- 재가입 여부
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- RLS 정책
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 데이터만 조회/수정 가능
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (auth.uid() = user_id);

-- 관리자는 모든 데이터 접근 가능
CREATE POLICY "admin_full_access" ON users
  FOR ALL USING (is_admin());
```

---

### 3. user_subscriptions (구독 정보)
**설명**: 사용자의 구독 상태 추적

```sql
CREATE TABLE user_subscriptions (
  subscription_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  plan_id UUID REFERENCES subscription_plans(plan_id),
  status TEXT CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  next_billing_at TIMESTAMP,
  billing_cycle TEXT DEFAULT 'monthly',
  auto_renew BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- RLS: 사용자는 자신의 구독만 조회
CREATE POLICY "subscriptions_select_own" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
```

---

### 4. billing_payments (결제 내역)
**설명**: 토스페이먼츠 결제 기록

```sql
CREATE TABLE billing_payments (
  payment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES user_subscriptions(subscription_id),
  amount INTEGER NOT NULL,               -- 결제 금액
  status TEXT,                           -- 'pending', 'paid', 'failed', 'refunded'
  payment_method TEXT,                   -- '카드', '계좌이체', etc.
  toss_payment_key TEXT,                 -- 토스 결제 고유키
  toss_order_id TEXT,                    -- 주문 ID
  created_at TIMESTAMP DEFAULT NOW()
);

-- RLS: 사용자는 자신의 결제만 조회
CREATE POLICY "payments_select_own" ON billing_payments
  FOR SELECT USING (auth.uid() = user_id);
```

---

### 5. admins (관리자 테이블)
**설명**: 관리자 권한 관리

```sql
CREATE TABLE admins (
  admin_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- RLS: 관리자는 자신의 정보만 조회
CREATE POLICY "admins_select_own" ON admins
  FOR SELECT USING (auth.uid() = admin_id);
```

---

### 6. user_deletion_logs (탈퇴 로그)
**설명**: 회원 탈퇴 기록 (법적 요구사항)

```sql
CREATE TABLE user_deletion_logs (
  log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,                 -- 탈퇴한 user_id
  deleted_by UUID,                       -- 관리자 ID (NULL = 본인)
  reason TEXT,                           -- 탈퇴 사유
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

### 7. RLS 헬퍼 함수

```sql
-- 현재 로그인한 사용자의 UUID 반환
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$ LANGUAGE sql STABLE;

-- 현재 사용자가 관리자인지 확인
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM admins
    WHERE admin_id = auth.uid()
    AND is_active = true
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

---

## API 엔드포인트

### 기본 URL
```
Production: https://your-domain.com
Development: http://localhost:8080
```

### 인증 헤더 형식
모든 인증 필요 API는 다음 헤더 포함:
```http
Authorization: Bearer {access_token}
```

---

### 1. 로그인

#### Google OAuth 로그인 (Web/WPF)
```
Method: OAuth 2.0 Flow
Provider: Supabase Auth

// 웹에서
supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: 'http://localhost:8080/pharmchecker'
  }
})

// WPF에서는 웹뷰 또는 브라우저 팝업 사용
// Callback에서 access_token 추출
```

#### 세션 확인
```http
GET /api/auth/session
Authorization: Bearer {access_token}

Response 200:
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "user_metadata": {
      "full_name": "홍길동",
      "avatar_url": "https://..."
    }
  }
}
```

---

### 2. 회원가입

#### 가입 여부 확인
```http
POST /api/auth/check-existing-user
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "userId": "uuid"
}

Response 200:
{
  "success": true,
  "isExistingUser": false  // false면 회원가입 필요
}
```

#### 회원가입
```http
POST /api/signup
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "pharmacistName": "홍길동",
  "pharmacistPhone": "010-1234-5678",
  "businessNumber": "123-45-67890",
  "pharmacyName": "행복약국",
  "pharmacyPhone": "02-1234-5678",
  "postcode": "12345",
  "address": "서울시 강남구 테헤란로 123",
  "detailAddress": "4층",
  "referralCode": "FRIEND2024",  // 선택
  "googlePicture": "https://..."  // 선택
}

Response 201:
{
  "success": true,
  "message": "회원가입이 완료되었습니다.",
  "data": {
    "userId": "uuid",
    "email": "user@example.com"
  }
}
```

---

### 3. 회원 정보 조회

#### 내 정보 조회
```http
GET /api/user/me
Authorization: Bearer {access_token}

Response 200:
{
  "user_id": "uuid",
  "email": "user@example.com",
  "pharmacist_name": "홍길동",
  "pharmacy_name": "행복약국",
  "business_number": "123-45-67890",
  ...
}
```

---

### 4. 구독 정보 조회

#### 내 구독 조회
```http
GET /api/subscription/my
Authorization: Bearer {access_token}

Response 200:
{
  "subscription": {
    "subscription_id": "uuid",
    "status": "active",
    "current_period_end": "2026-02-12T00:00:00Z",
    "plan_name": "기본 플랜"
  }
}
```

---

### 5. 회원 탈퇴

```http
POST /api/user/withdraw
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "reason": "서비스가 필요없어서"  // 선택
}

Response 200:
{
  "success": true,
  "message": "회원 탈퇴가 완료되었습니다."
}
```

**탈퇴 처리 내용:**
1. public.users 개인정보 익명화 (`is_deleted = true`)
2. 활성 구독 취소 (`status = 'cancelled'`)
3. user_deletion_logs 기록
4. auth.users 삭제 (Supabase Auth에서 사용자 완전 삭제)

---

## 인증 플로우

### 1. 로그인 플로우

```mermaid
sequenceDiagram
    WPF->>Supabase: signInWithOAuth(google)
    Supabase->>Google: OAuth 요청
    Google->>User: 로그인 화면
    User->>Google: 계정 선택/승인
    Google->>Supabase: Authorization Code
    Supabase->>Supabase: JWT 토큰 생성
    Supabase->>WPF: Redirect + access_token
    WPF->>Backend: GET /api/auth/check-existing-user
    Backend->>WPF: { isExistingUser: true/false }
    
    alt 기존 회원
        WPF->>Backend: GET /api/user/me
        Backend->>WPF: 사용자 정보
        WPF->>WPF: 메인 화면 표시
    else 신규 회원
        WPF->>WPF: 회원가입 폼 표시
        User->>WPF: 정보 입력
        WPF->>Backend: POST /api/signup
        Backend->>DB: INSERT users
        Backend->>WPF: 회원가입 성공
        WPF->>WPF: 메인 화면 표시
    end
```

### 2. 회원가입 플로우

```
1. Google OAuth 로그인 (access_token 획득)
2. /api/auth/check-existing-user 호출
   - isExistingUser = true → 로그인 페이지로
   - isExistingUser = false → 계속 진행
3. 회원가입 폼 입력 (약사/약국 정보)
4. /api/signup 호출
5. public.users 테이블에 INSERT
6. 추천인 코드 있으면 pending_user_promotions 저장
7. 회원가입 완료
```

### 3. 회원 탈퇴 플로우

```
1. /api/user/withdraw 호출 (access_token 포함)
2. Backend:
   - 활성 구독 조회 및 취소
   - public.users 개인정보 익명화
   - user_deletion_logs 기록
   - auth.users 삭제 (Supabase Admin API)
3. WPF: 로그아웃 처리, 로그인 화면으로
```

---

## WPF 구현 가이드

### 1. Supabase Client 초기화

**NuGet 패키지 설치:**
```powershell
Install-Package supabase-csharp
```

**초기화 코드:**
```csharp
using Supabase;
using Supabase.Gotrue;

public class SupabaseService
{
    private static Supabase.Client _client;
    
    public static async Task Initialize()
    {
        var options = new SupabaseOptions
        {
            AutoConnectRealtime = false
        };
        
        _client = new Supabase.Client(
            "https://gitbtujexmsjfixgeoha.supabase.co",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpdGJ0dWpleG1zamZpeGdlb2hhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzA5MDIsImV4cCI6MjA4MjA0NjkwMn0.BNN8hauH8NdHZ4vopW_CQ_iK9CR55nfp3JQwuTjrG48",
            options
        );
        
        await _client.InitializeAsync();
    }
    
    public static Supabase.Client Client => _client;
}
```

---

### 2. Google OAuth 로그인 (WPF)

**방법 1: WebView2 사용**
```csharp
using Microsoft.Web.WebView2.Core;

public async Task<string> SignInWithGoogle()
{
    var authUrl = await SupabaseService.Client.Auth.SignIn(
        Provider.Google,
        new SignInOptions
        {
            RedirectTo = "http://localhost:8080/auth/callback"
        }
    );
    
    // WebView2로 authUrl 열기
    var webView = new WebView2();
    await webView.EnsureCoreWebView2Async();
    webView.CoreWebView2.Navigate(authUrl);
    
    // Callback URL에서 access_token 추출
    string accessToken = null;
    webView.CoreWebView2.NavigationCompleted += (s, e) =>
    {
        var uri = new Uri(webView.CoreWebView2.Source);
        if (uri.AbsolutePath.Contains("/auth/callback"))
        {
            var fragment = uri.Fragment.TrimStart('#');
            var query = System.Web.HttpUtility.ParseQueryString(fragment);
            accessToken = query["access_token"];
        }
    };
    
    // accessToken을 받을 때까지 대기
    while (accessToken == null)
    {
        await Task.Delay(100);
    }
    
    return accessToken;
}
```

**방법 2: 시스템 브라우저 + Localhost Listener**
```csharp
using System.Net;

public async Task<string> SignInWithGoogleBrowser()
{
    // Localhost listener 시작
    var listener = new HttpListener();
    listener.Prefixes.Add("http://localhost:8888/");
    listener.Start();
    
    // OAuth URL 생성 및 브라우저 열기
    var authUrl = await SupabaseService.Client.Auth.SignIn(
        Provider.Google,
        new SignInOptions
        {
            RedirectTo = "http://localhost:8888/callback"
        }
    );
    
    Process.Start(new ProcessStartInfo
    {
        FileName = authUrl,
        UseShellExecute = true
    });
    
    // Callback 대기
    var context = await listener.GetContextAsync();
    var query = context.Request.QueryString;
    var accessToken = query["access_token"];
    
    listener.Stop();
    return accessToken;
}
```

---

### 3. 세션 관리

```csharp
public class SessionManager
{
    private static Session _currentSession;
    
    public static async Task<bool> SetSession(string accessToken)
    {
        var session = await SupabaseService.Client.Auth.SetSession(
            accessToken,
            refreshToken: null  // OAuth에서는 refresh token도 같이 옴
        );
        
        _currentSession = session;
        return session != null;
    }
    
    public static Session CurrentSession => _currentSession;
    
    public static string AccessToken => _currentSession?.AccessToken;
    
    public static async Task<bool> RefreshSession()
    {
        var session = await SupabaseService.Client.Auth.RefreshSession();
        _currentSession = session;
        return session != null;
    }
    
    public static async Task SignOut()
    {
        await SupabaseService.Client.Auth.SignOut();
        _currentSession = null;
    }
}
```

---

### 4. API 호출 (HttpClient)

```csharp
public class ApiClient
{
    private static readonly HttpClient _httpClient = new HttpClient
    {
        BaseAddress = new Uri("http://localhost:8080")
    };
    
    public static async Task<T> GetAsync<T>(string endpoint)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            SessionManager.AccessToken
        );
        
        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();
        
        var json = await response.Content.ReadAsStringAsync();
        return JsonConvert.DeserializeObject<T>(json);
    }
    
    public static async Task<T> PostAsync<T>(string endpoint, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            SessionManager.AccessToken
        );
        request.Content = new StringContent(
            JsonConvert.SerializeObject(body),
            Encoding.UTF8,
            "application/json"
        );
        
        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();
        
        var json = await response.Content.ReadAsStringAsync();
        return JsonConvert.DeserializeObject<T>(json);
    }
}
```

---

### 5. 로그인 화면 예제

```csharp
public partial class LoginWindow : Window
{
    public LoginWindow()
    {
        InitializeComponent();
    }
    
    private async void BtnGoogleLogin_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            // Google OAuth 로그인
            var accessToken = await SignInWithGoogle();
            
            // 세션 설정
            await SessionManager.SetSession(accessToken);
            
            // 가입 여부 확인
            var result = await ApiClient.PostAsync<CheckExistingUserResponse>(
                "/api/auth/check-existing-user",
                new { userId = SessionManager.CurrentSession.User.Id }
            );
            
            if (result.IsExistingUser)
            {
                // 기존 회원 - 메인 화면으로
                var mainWindow = new MainWindow();
                mainWindow.Show();
                this.Close();
            }
            else
            {
                // 신규 회원 - 회원가입 화면으로
                var signupWindow = new SignupWindow();
                signupWindow.Show();
                this.Close();
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"로그인 실패: {ex.Message}");
        }
    }
}
```

---

### 6. 회원가입 화면 예제

```csharp
public partial class SignupWindow : Window
{
    public SignupWindow()
    {
        InitializeComponent();
        
        // Google 프로필 정보 자동 입력
        var user = SessionManager.CurrentSession.User;
        TxtEmail.Text = user.Email;
    }
    
    private async void BtnSignup_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var signupData = new
            {
                pharmacistName = TxtPharmacistName.Text,
                pharmacistPhone = TxtPharmacistPhone.Text,
                businessNumber = TxtBusinessNumber.Text,
                pharmacyName = TxtPharmacyName.Text,
                pharmacyPhone = TxtPharmacyPhone.Text,
                postcode = TxtPostcode.Text,
                address = TxtAddress.Text,
                detailAddress = TxtDetailAddress.Text,
                referralCode = TxtReferralCode.Text,  // 선택
                googlePicture = SessionManager.CurrentSession.User.UserMetadata["avatar_url"]
            };
            
            var result = await ApiClient.PostAsync<SignupResponse>(
                "/api/signup",
                signupData
            );
            
            if (result.Success)
            {
                MessageBox.Show("회원가입이 완료되었습니다!");
                var mainWindow = new MainWindow();
                mainWindow.Show();
                this.Close();
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"회원가입 실패: {ex.Message}");
        }
    }
}
```

---

## 보안 고려사항

### 1. Access Token 저장
```csharp
// ❌ 나쁜 예: 평문 저장
File.WriteAllText("token.txt", accessToken);

// ✅ 좋은 예: Windows Credential Manager 사용
using System.Security.Cryptography;

public static void SaveToken(string token)
{
    var entropy = new byte[20];
    using (var rng = new RNGCryptoServiceProvider())
    {
        rng.GetBytes(entropy);
    }
    
    var encryptedData = ProtectedData.Protect(
        Encoding.UTF8.GetBytes(token),
        entropy,
        DataProtectionScope.CurrentUser
    );
    
    // Registry 또는 파일에 저장
}
```

### 2. HTTPS 사용
```csharp
// Production에서는 반드시 HTTPS
_httpClient.BaseAddress = new Uri("https://your-domain.com");
```

### 3. Token 만료 처리
```csharp
public static async Task<T> GetWithRetryAsync<T>(string endpoint)
{
    try
    {
        return await GetAsync<T>(endpoint);
    }
    catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.Unauthorized)
    {
        // Token 만료 - 재인증 필요
        await SessionManager.RefreshSession();
        return await GetAsync<T>(endpoint);
    }
}
```

### 4. RLS 의존
- **모든 데이터 접근은 RLS 정책을 통과해야 함**
- Backend API가 `req.supabase` (인증된 클라이언트) 사용
- `supabaseAdmin` 사용 최소화 (관리자 작업만)

---

## 요약 체크리스트

### WPF 개발자가 구현해야 할 것:

- [ ] Supabase C# SDK 설치 및 초기화
- [ ] Google OAuth 로그인 (WebView2 또는 브라우저)
- [ ] Access Token 추출 및 저장
- [ ] HttpClient로 Backend API 호출
  - [ ] Authorization: Bearer {token} 헤더 추가
  - [ ] /api/auth/check-existing-user
  - [ ] /api/signup
  - [ ] /api/user/me
  - [ ] /api/subscription/my
  - [ ] /api/user/withdraw
- [ ] 세션 관리 (로그인/로그아웃)
- [ ] Token 만료 시 재인증 처리

### Backend에서 제공하는 것:

- ✅ Supabase Auth 설정 (Google OAuth)
- ✅ RLS 정책 (데이터베이스 보안)
- ✅ API 엔드포인트 (JWT 인증 필요)
- ✅ 회원가입/탈퇴 로직
- ✅ 구독/결제 관리

---

## 문의사항

**Backend 개발자**: [연락처]
**Supabase 프로젝트**: https://supabase.com/dashboard/project/gitbtujexmsjfixgeoha
**API Docs**: http://localhost:8080/api-docs (개발 중)
