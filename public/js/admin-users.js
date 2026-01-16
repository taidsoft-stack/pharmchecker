// 전역 변수
let currentPage = 1;
let currentName = '';
let currentEmail = '';
let currentStartDate = '';
let currentEndDate = '';
let currentSubFilter = '';
let currentAccFilter = '';
let currentUserDetail = null;
let currentActiveTab = 'basic';

// 전역 Supabase 클라이언트 (세션 자동 복원)
const supabaseClient = window.supabase.createClient(
  'https://gitbtujexmsjfixgeoha.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpdGJ0dWpleG1zamZpeGdlb2hhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzA5MDIsImV4cCI6MjA4MjA0NjkwMn0.BNN8hauH8NdHZ4vopW_CQ_iK9CR55nfp3JQwuTjrG48'
);

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', async function() {
  await checkAuth();
  await fetchUsers();
});

// 로그인 확인 - Supabase 세션 사용
async function checkAuth() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (!session) {
      console.log('Supabase 세션 없음 - 로그인 페이지로 이동');
      window.location.href = '/admin/login';
      return;
    }
    
    // 세션 토큰을 localStorage에 저장
    localStorage.setItem('admin_session_token', session.access_token);
    
    console.log('Supabase 세션 확인 완료:', session.user.email);
    console.log('저장된 토큰 (처음 50자):', session.access_token.substring(0, 50) + '...');
    
    // 관리자 이름 표시
    if (session.user.email) {
      const adminNameEl = document.getElementById('adminName');
      if (adminNameEl) {
        adminNameEl.textContent = session.user.email;
      }
    }
  } catch (error) {
    console.error('세션 확인 실패:', error);
    window.location.href = '/admin/login';
  }
}

// 회원 검색
function searchUsers() {
  currentPage = 1;
  currentName = document.getElementById('nameSearch').value;
  currentEmail = document.getElementById('emailSearch').value;
  currentStartDate = document.getElementById('startDate').value;
  currentEndDate = document.getElementById('endDate').value;
  currentSubFilter = document.getElementById('subscriptionFilter').value;
  currentAccFilter = document.getElementById('accountFilter').value;
  fetchUsers();
}

// 회원 목록 조회
async function fetchUsers(page = 1) {
  currentPage = page;
  
  try {
    const params = new URLSearchParams({
      page: currentPage,
      limit: 20,
      name: currentName,
      email: currentEmail,
      startDate: currentStartDate,
      endDate: currentEndDate,
      subscriptionStatus: currentSubFilter,
      accountStatus: currentAccFilter
    });
    
    const response = await fetch('/admin/api/users?' + params, {
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('admin_session_token')
      }
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        alert('세션이 만료되었습니다. 다시 로그인해주세요.');
        window.location.href = '/admin/login';
        return;
      }
      throw new Error('회원 목록 조회 실패');
    }
    
    const data = await response.json();
    
    // 총 회원 수 표시
    document.getElementById('userCount').textContent = '회원 목록 (총 ' + data.total + '명)';
    
    // 테이블 렌더링
    const tbody = document.getElementById('usersTableBody');
    
    if (!data.users || data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="14" class="has-text-centered">회원이 없습니다</td></tr>';
      return;
    }
    
    tbody.innerHTML = data.users.map((user, index) => {
      const rowNumber = (currentPage - 1) * 20 + index + 1;
      
      const subscriptionTag = user.subscription 
        ? '<span class="tag ' + (user.subscription.status === 'active' ? 'is-success' : 'is-warning') + '">' + (user.subscription.status === 'active' ? '활성' : '취소됨') + '</span>'
        : '<span class="tag is-light">없음</span>';
      
      const accountTag = user.is_deleted 
        ? '<span class="tag is-danger">탈퇴</span>' 
        : (user.is_active ? '<span class="tag is-success">활성</span>' : '<span class="tag is-warning">비활성</span>');
      
      const currentPeriodStart = user.subscription?.current_period_start
        ? new Date(user.subscription.current_period_start).toLocaleDateString('ko-KR')
        : '-';
        
      const currentPeriodEnd = user.subscription?.current_period_end
        ? new Date(user.subscription.current_period_end).toLocaleDateString('ko-KR')
        : '-';
      
      let nextBillingDate = '-';
      if (user.subscription?.next_billing_at && 
          !user.is_deleted && 
          user.subscription.status === 'active' && 
          !user.subscription.cancel_at_period_end) {
        nextBillingDate = new Date(user.subscription.next_billing_at).toLocaleDateString('ko-KR');
      }
      
      let promotionInfo = '-';
      if (user.subscription?.promotion_id) {
        const expiresAt = user.subscription.promotion_expires_at 
          ? new Date(user.subscription.promotion_expires_at).toLocaleDateString('ko-KR')
          : '무기한';
        promotionInfo = '프로모션 적용중 (~ ' + expiresAt + ')';
      } else if (user.active_promotions && user.active_promotions.length > 0) {
        promotionInfo = user.active_promotions.map(p => {
          if (p.promotion_type === 'discount') {
            return p.discount_rate + '% 할인';
          } else if (p.promotion_type === 'free') {
            return p.free_months + '개월 무료';
          }
          return p.promotion_type;
        }).join(', ');
      }
      
      const memoText = user.latest_memo || '-';
      const remarksText = user.latest_remarks || '-';
      
      return '<tr>'+
        '<td>' + rowNumber + '</td>'+
        '<td><a href="#" onclick="viewUserDetail(\'' + user.user_id + '\'); return false;" class="has-text-link">' + user.email + '</a></td>'+
        '<td>' + user.pharmacist_name + '</td>'+
        '<td>' + user.pharmacy_name + '</td>'+
        '<td>' + (user.pharmacist_phone || '-') + '</td>'+
        '<td>' + subscriptionTag + '</td>'+
        '<td>' + (user.subscription?.plan_name || '-') + '</td>'+
        '<td>' + currentPeriodStart + '</td>'+
        '<td>' + currentPeriodEnd + '</td>'+
        '<td>' + nextBillingDate + '</td>'+
        '<td style="font-size: 0.75rem;">' + promotionInfo + '</td>'+
        '<td style="font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;" title="' + (user.latest_memo || '메모 없음') + '">' + memoText + '</td>'+
        '<td style="font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;" title="' + (user.latest_remarks || '비고 없음') + '">' + remarksText + '</td>'+
        '<td>' + accountTag + '</td>'+
      '</tr>';
    }).join('');
    
    // 페이지네이션 렌더링
    renderPagination(data.page, data.totalPages);
    
  } catch (error) {
    console.error('회원 목록 조회 실패:', error);
    document.getElementById('usersTableBody').innerHTML = 
      '<tr><td colspan="14" class="has-text-centered has-text-danger">오류가 발생했습니다</td></tr>';
  }
}

// 페이지네이션 렌더링
function renderPagination(currentPage, totalPages) {
  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');
  const pageNumbers = document.getElementById('pageNumbers');
  
  prevBtn.disabled = currentPage === 1;
  nextBtn.disabled = currentPage === totalPages;
  
  prevBtn.onclick = () => currentPage > 1 && fetchUsers(currentPage - 1);
  nextBtn.onclick = () => currentPage < totalPages && fetchUsers(currentPage + 1);
  
  let pages = [];
  const maxPages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxPages / 2));
  let endPage = Math.min(totalPages, startPage + maxPages - 1);
  
  if (endPage - startPage < maxPages - 1) {
    startPage = Math.max(1, endPage - maxPages + 1);
  }
  
  for (let i = startPage; i <= endPage; i++) {
    pages.push(
      '<li>' +
        '<a class="pagination-link ' + (i === currentPage ? 'is-current' : '') + '" ' +
           'onclick="fetchUsers(' + i + ')">' + i + '</a>' +
      '</li>'
    );
  }
  
  pageNumbers.innerHTML = pages.join('');
}

// 탭 전환
function switchTab(tabName) {
  currentActiveTab = tabName;
  
  document.querySelectorAll('.tabs li').forEach(li => li.classList.remove('is-active'));
  document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
  
  document.querySelector('.tabs li[data-tab="' + tabName + '"]').classList.add('is-active');
  document.getElementById('tab-' + tabName).style.display = 'block';
}

// 회원 상세 정보 모달 열기
async function viewUserDetail(userId) {
  try {
    const response = await fetch('/admin/api/users/' + userId, {
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('admin_session_token')
      }
    });
    
    if (!response.ok) throw new Error('회원 정보를 불러올 수 없습니다');
    
    const data = await response.json();
    currentUserDetail = data;
    
    document.getElementById('modalUserName').textContent = data.user.pharmacist_name + ' (' + data.user.email + ')';
    
    document.getElementById('detailPharmacyName').value = data.user.pharmacy_name;
    document.getElementById('detailCreatedAt').value = new Date(data.user.created_at).toLocaleString('ko-KR');
    
    const fullAddress = [
      data.user.postcode ? '[' + data.user.postcode + ']' : '',
      data.user.address || '',
      data.user.detail_address || ''
    ].filter(Boolean).join(' ');
    document.getElementById('detailAddress').value = fullAddress || '-';
    
    const accountStatusEl = document.getElementById('detailAccountStatus');
    if (data.user.is_deleted) {
      accountStatusEl.textContent = '탈퇴';
      accountStatusEl.className = 'tag is-danger is-medium';
    } else if (data.user.is_active) {
      accountStatusEl.textContent = '활성';
      accountStatusEl.className = 'tag is-success is-medium';
    } else {
      accountStatusEl.textContent = '비활성';
      accountStatusEl.className = 'tag is-warning is-medium';
    }
    
    renderMemos(data.memos);
    renderSubscriptions(data.subscriptions);
    renderPayments(data.payments);
    renderPromotions(data.promotions);
    renderActivityLogs(data.activity_logs);
    
    document.getElementById('userDetailModal').classList.add('is-active');
    
    if (currentActiveTab && currentActiveTab !== 'basic') {
      switchTab(currentActiveTab);
    }
    
  } catch (error) {
    console.error('회원 상세 정보 조회 실패:', error);
    alert('회원 정보를 불러오는데 실패했습니다.');
  }
}

// 모달 닫기
function closeUserDetailModal() {
  document.getElementById('userDetailModal').classList.remove('is-active');
  currentUserDetail = null;
  currentActiveTab = 'basic';
  
  document.getElementById('newMemoText').value = '';
  document.getElementById('newRemarksText').value = '';
  
  switchTab('basic');
  
  // 회원 목록 새로고침
  fetchUsers(currentPage);
}

// 구독 내역 렌더링
function renderSubscriptions(subscriptions) {
  const container = document.getElementById('subscriptionList');
  
  if (!subscriptions || subscriptions.length === 0) {
    container.innerHTML = '<p class="has-text-centered has-text-grey">구독 내역이 없습니다.</p>';
    return;
  }
  
  container.innerHTML = subscriptions.map((sub, index) => {
    const statusClass = sub.status === 'active' ? 'is-success' : 
                       sub.status === 'cancelled' ? 'is-warning' : 'is-light';
    const statusText = sub.status === 'active' ? '활성' : 
                      sub.status === 'cancelled' ? '취소됨' : sub.status;
    
    return '<div class="box">' +
      '<div class="level">' +
        '<div class="level-left">' +
          '<div class="level-item">' +
            '<div>' +
              '<p class="heading">플랜</p>' +
              '<p class="title is-5">' + (sub.subscription_plans?.plan_name || 'N/A') + '</p>' +
            '</div>' +
          '</div>' +
          '<div class="level-item">' +
            '<div>' +
              '<p class="heading">월 요금</p>' +
              '<p class="subtitle">' + (sub.subscription_plans?.monthly_price ? sub.subscription_plans.monthly_price.toLocaleString() + '원' : 'N/A') + '</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="level-right">' +
          '<div class="level-item">' +
            '<span class="tag ' + statusClass + ' is-medium">' + statusText + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="columns is-mobile">' +
        '<div class="column">' +
          '<p class="heading">구독 시작</p>' +
          '<p>' + (sub.current_period_start ? new Date(sub.current_period_start).toLocaleDateString('ko-KR') : '-') + '</p>' +
        '</div>' +
        '<div class="column">' +
          '<p class="heading">구독 종료</p>' +
          '<p>' + (sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('ko-KR') : '-') + '</p>' +
        '</div>' +
        '<div class="column">' +
          '<p class="heading">다음 결제일</p>' +
          '<p>' + (sub.next_billing_at ? new Date(sub.next_billing_at).toLocaleDateString('ko-KR') : '-') + '</p>' +
        '</div>' +
        '<div class="column">' +
          '<p class="heading">생성일</p>' +
          '<p>' + new Date(sub.created_at).toLocaleDateString('ko-KR') + '</p>' +
        '</div>' +
      '</div>' +
      (sub.cancelled_at ? '<p class="has-text-danger"><i class="fas fa-exclamation-triangle"></i> 취소일: ' + new Date(sub.cancelled_at).toLocaleString('ko-KR') + '</p>' : '') +
    '</div>';
  }).join('');
}

// 결제 내역 렌더링
function renderPayments(payments) {
  const tbody = document.getElementById('paymentList');
  
  if (!payments || payments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="has-text-centered has-text-grey">결제 내역이 없습니다.</td></tr>';
    return;
  }
  
  tbody.innerHTML = payments.map(payment => {
    const statusClass = payment.status === 'success' ? 'is-success' : 
                       payment.status === 'failed' ? 'is-danger' : 'is-warning';
    const statusText = payment.status === 'success' ? '성공' : 
                      payment.status === 'failed' ? '실패' : payment.status;
    
    return '<tr>' +
      '<td>' + new Date(payment.payment_date).toLocaleString('ko-KR') + '</td>' +
      '<td><strong>' + payment.amount.toLocaleString() + '원</strong></td>' +
      '<td>' + (payment.payment_method || '-') + '</td>' +
      '<td><span class="tag ' + statusClass + '">' + statusText + '</span></td>' +
      '<td style="font-size: 0.75rem;">' + (payment.toss_order_id || '-') + '</td>' +
      '<td style="font-size: 0.75rem; color: #f14668;">' + (payment.failure_message || '-') + '</td>' +
    '</tr>';
  }).join('');
}

// 프로모션 렌더링
function renderPromotions(promotions) {
  const tbody = document.getElementById('promotionList');
  
  if (!promotions || promotions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="has-text-centered has-text-grey">프로모션 내역이 없습니다.</td></tr>';
    return;
  }
  
  tbody.innerHTML = promotions.map(promo => {
    const typeText = promo.promotion_type === 'discount' ? '할인' : 
                    promo.promotion_type === 'free' ? '무료' : promo.promotion_type;
    const statusClass = promo.is_active ? 'is-success' : 'is-light';
    const statusText = promo.is_active ? '활성' : '만료';
    
    return '<tr>' +
      '<td>' + typeText + '</td>' +
      '<td>' + (promo.discount_rate ? promo.discount_rate + '%' : '-') + '</td>' +
      '<td>' + (promo.free_months ? promo.free_months + '개월' : '-') + '</td>' +
      '<td>' + (promo.start_date ? new Date(promo.start_date).toLocaleDateString('ko-KR') : '-') + '</td>' +
      '<td>' + (promo.expires_at ? new Date(promo.expires_at).toLocaleDateString('ko-KR') : '-') + '</td>' +
      '<td><span class="tag ' + statusClass + '">' + statusText + '</span></td>' +
    '</tr>';
  }).join('');
}

// 메모/비고 렌더링
function renderMemos(memos) {
  const container = document.getElementById('memoList');
  
  if (!memos || memos.length === 0) {
    container.innerHTML = '<p class="has-text-centered has-text-grey">메모가 없습니다.</p>';
    return;
  }
  
  container.innerHTML = '<div class="table-container"><table class="table is-fullwidth is-striped is-hoverable">' +
    '<thead>' +
      '<tr>' +
        '<th>작성자</th>' +
        '<th>작성일</th>' +
        '<th>비고</th>' +
        '<th>메모</th>' +
      '</tr>' +
    '</thead>' +
    '<tbody>' +
      memos.map(memo => {
        const adminEmail = memo.admin_email || '알 수 없음';
        const remarksText = memo.remarks && memo.remarks.trim() ? memo.remarks : '<span class="has-text-grey-light">(빈칸)</span>';
        const memoText = memo.memo && memo.memo.trim() ? memo.memo : '<span class="has-text-grey-light">(빈칸)</span>';
        
        return '<tr>' +
          '<td>' + adminEmail + '</td>' +
          '<td>' + new Date(memo.created_at).toLocaleString('ko-KR') + '</td>' +
          '<td>' + remarksText + '</td>' +
          '<td>' + memoText + '</td>' +
        '</tr>';
      }).join('') +
    '</tbody>' +
  '</table></div>';
}

// 활동 로그 렌더링
function renderActivityLogs(logs) {
  const tbody = document.getElementById('activityList');
  
  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="has-text-centered has-text-grey">활동 로그가 없습니다.</td></tr>';
    return;
  }
  
  tbody.innerHTML = logs.map(log => {
    const adminName = log.admins?.admin_name || '시스템';
    const detailsText = log.details ? JSON.stringify(log.details) : '-';
    
    return '<tr>' +
      '<td>' + new Date(log.created_at).toLocaleString('ko-KR') + '</td>' +
      '<td>' + log.action_type + '</td>' +
      '<td>' + adminName + '</td>' +
      '<td style="font-size: 0.75rem; max-width: 300px; overflow: hidden; text-overflow: ellipsis;" title="' + detailsText + '">' + detailsText + '</td>' +
    '</tr>';
  }).join('');
}

// 새 메모 저장
async function saveNewMemo() {
  if (!currentUserDetail) return;
  
  const memoText = document.getElementById('newMemoText').value.trim();
  const remarksText = document.getElementById('newRemarksText').value.trim();
  
  if (!memoText && !remarksText) {
    alert('메모 또는 비고를 입력해주세요.');
    return;
  }
  
  try {
    const response = await fetch('/admin/api/users/' + currentUserDetail.user.user_id + '/memos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + localStorage.getItem('admin_session_token')
      },
      body: JSON.stringify({
        memo: memoText,
        remarks: remarksText
      })
    });
    
    if (!response.ok) throw new Error('메모 저장 실패');
    
    alert('메모가 저장되었습니다.');
    
    document.getElementById('newMemoText').value = '';
    document.getElementById('newRemarksText').value = '';
    
    viewUserDetail(currentUserDetail.user.user_id);
    
  } catch (error) {
    console.error('메모 저장 실패:', error);
    alert('메모 저장에 실패했습니다.');
  }
}

// 로그아웃
async function logout() {
  if (!confirm('로그아웃 하시겠습니까?')) {
    return;
  }
  
  try {
    await fetch('/admin/api/logout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('admin_session_token')}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('로그아웃 로그 기록 실패:', error);
  }
  
  localStorage.removeItem('admin_session_token');
  
  const supabaseClient = window.supabase.createClient(
    'https://gitbtujexmsjfixgeoha.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpdGJ0dWpleG1zamZpeGdlb2hhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0NzA5MDIsImV4cCI6MjA4MjA0NjkwMn0.BNN8hauH8NdHZ4vopW_CQ_iK9CR55nfp3JQwuTjrG48'
  );
  
  await supabaseClient.auth.signOut();
  window.location.href = '/admin/login';
}
