/* =====================================================
   노진규 고객관리 시스템 — script.js
   =====================================================
   주요 기능:
   1. 고객 데이터 LocalStorage 저장/불러오기
   2. Google Sheets 자동 저장 (Google Apps Script)
   3. 대시보드 통계 및 오늘 연락 예정 표시
   4. 고객 카드 렌더링, 검색/필터
   5. 고객 상세 모달, 수정, 삭제
   ===================================================== */

// ──────────────────────────────────────────────────────
// ① Google Apps Script 웹앱 URL 설정
//    👉 아래 SCRIPT_URL 에 본인의 Apps Script 배포 URL을 붙여넣으세요.
//    설정 방법은 README 또는 페이지 하단 설명을 참고하세요.
//    URL이 없으면 로컬 저장만 됩니다 (Google Sheets 저장 안 됨).
// ──────────────────────────────────────────────────────
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxkwCEgouoN5Ym1PCTazoTyvk1l56UpKlAlM9SbDRjYzjaJHKCZY_wGddey5JNNZB_wfg/exec"; // 예: "https://script.google.com/macros/s/XXXXX/exec"

// ──────────────────────────────────────────────────────
// ② 상태 배지 색상 설정
//    ✏️ 새 상태 추가 방법:
//    STATUS_COLORS['새상태이름'] = '#hex색상코드';
//    index.html 의 <select id="f-status"> 와 필터 <select> 에도 <option> 추가 필요.
// ──────────────────────────────────────────────────────
const STATUS_COLORS = {
  '신규문의':  { bg: '#e8f0fe', text: '#2c5ecc' },
  '상담중':    { bg: '#fff3cd', text: '#856404' },
  '견적전달':  { bg: '#e2f0fb', text: '#1a6fa0' },
  '시승예정':  { bg: '#e8f5e9', text: '#2e7d32' },
  '계약유력':  { bg: '#fff8e1', text: '#b8913a' },
  '보류':      { bg: '#f3f3f3', text: '#666' },
  '출고완료':  { bg: '#1a1a1a', text: '#fff' },
};

// 현재 수정 중인 고객 ID (null이면 새 등록)
let editingId = null;

// 현재 모달에 표시 중인 고객 ID
let modalCustomerId = null;

// 현재 적용된 퀵필터 값
let currentQuickFilter = 'all';

// ══════════════════════════════════════════════════════
// 데이터 관리 (LocalStorage)
// ══════════════════════════════════════════════════════

/** LocalStorage에서 전체 고객 배열을 가져옵니다 */
function getCustomers() {
  try {
    return JSON.parse(localStorage.getItem('crm_customers') || '[]');
  } catch (e) {
    return [];
  }
}

/** 고객 배열을 LocalStorage에 저장합니다 */
function saveCustomers(customers) {
  localStorage.setItem('crm_customers', JSON.stringify(customers));
}

/** 고유 ID 생성 (타임스탬프 + 랜덤) */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ══════════════════════════════════════════════════════
// 뷰 전환 (대시보드 / 고객등록 / 고객목록)
// ══════════════════════════════════════════════════════

/**
 * viewName: 'dashboard' | 'register' | 'list'
 * 해당 뷰를 표시하고 나머지를 숨깁니다.
 */
function showView(viewName) {
  // 모든 뷰 숨기기
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  // 선택 뷰 표시
  document.getElementById('view-' + viewName).classList.add('active');

  // 네비 버튼 활성화
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  // 뷰별 초기화
  if (viewName === 'dashboard') renderDashboard();
  if (viewName === 'list')      renderCustomerList(getCustomers());
  if (viewName === 'register' && editingId === null) resetForm();
}

// ══════════════════════════════════════════════════════
// 대시보드 렌더링
// ══════════════════════════════════════════════════════

function renderDashboard() {
  const customers = getCustomers();
  const today = todayStr();

  // 통계
  document.getElementById('stat-total').textContent = customers.length;
  document.getElementById('stat-hot').textContent   = customers.filter(c => c.status === '계약유력').length;
  document.getElementById('stat-today').textContent = customers.filter(c => c.nextDate === today).length;
  document.getElementById('stat-done').textContent  = customers.filter(c => c.status === '출고완료').length;

  // 오늘 연락 예정
  const todayCustomers = customers.filter(c => c.nextDate === today);
  const todayEl = document.getElementById('today-contacts');
  const todayEmpty = document.getElementById('today-empty');

  // 기존 카드 제거 (empty 메시지는 유지)
  todayEl.querySelectorAll('.today-card').forEach(el => el.remove());

  if (todayCustomers.length === 0) {
    todayEmpty.classList.remove('hidden');
  } else {
    todayEmpty.classList.add('hidden');
    todayCustomers.forEach(c => {
      const card = document.createElement('div');
      card.className = 'today-card';
      card.innerHTML = `
        <div>
          <div class="today-name">${escHtml(c.name)}</div>
          <div class="today-model">${escHtml(c.model || '차종 미정')} · ${escHtml(c.status)}</div>
        </div>
        <button class="today-call" onclick="callCustomer('${escHtml(c.phone)}')">📞 연락</button>
      `;
      todayEl.appendChild(card);
    });
  }

  // 최근 등록 고객 (최대 5명, 최신순)
  const recentEl = document.getElementById('recent-list');
  recentEl.innerHTML = '';
  const recent = [...customers].reverse().slice(0, 5);
  if (recent.length === 0) {
    recentEl.innerHTML = '<p class="empty-msg">등록된 고객이 없습니다.</p>';
  } else {
    recent.forEach(c => recentEl.appendChild(buildCard(c)));
  }
}

// ══════════════════════════════════════════════════════
// 고객 카드 빌더
// ══════════════════════════════════════════════════════

/**
 * 고객 객체를 받아 DOM 카드 엘리먼트를 반환합니다.
 * ✏️ 카드에 표시할 필드를 추가하려면 이 함수 안을 수정하세요.
 */
function buildCard(c) {
  const card = document.createElement('div');
  card.className = 'customer-card' + (c.status === '계약유력' ? ' hot' : '');
  card.onclick = () => openDetailModal(c.id);

  // 상태 배지 색상
  const sc = STATUS_COLORS[c.status] || { bg: '#eee', text: '#333' };

  // 다음 연락일 색상 처리
  const today = todayStr();
  let dateClass = 'card-date';
  let dateLabel = c.nextDate ? formatDate(c.nextDate) : '';
  if (c.nextDate) {
    if (c.nextDate < today) dateClass += ' overdue';
    else if (c.nextDate === today) { dateClass += ' today'; dateLabel = '오늘'; }
  }

  card.innerHTML = `
    <div class="card-name">${escHtml(c.name)}</div>
    <div class="card-model">${escHtml(c.model || '—')} ${c.budget ? '· ' + escHtml(c.budget) : ''}</div>
    <div class="card-memo">${escHtml(c.memo || '상담 내용 없음')}</div>
    <div class="card-right">
      <span class="status-badge" style="background:${sc.bg};color:${sc.text}">${escHtml(c.status)}</span>
      ${dateLabel ? `<span class="${dateClass}">${dateLabel}</span>` : ''}
    </div>
  `;
  return card;
}

// ══════════════════════════════════════════════════════
// 고객 목록 렌더링 & 필터
// ══════════════════════════════════════════════════════

function renderCustomerList(customers) {
  const el = document.getElementById('customer-list');
  el.innerHTML = '';
  if (customers.length === 0) {
    el.innerHTML = '<p class="empty-msg">조건에 맞는 고객이 없습니다.</p>';
    return;
  }
  // 최신순 정렬
  [...customers].reverse().forEach(c => el.appendChild(buildCard(c)));
}

/** 검색어 + 상태 필터 + 퀵필터를 조합해 목록 갱신 */
function filterCustomers() {
  const keyword = (document.getElementById('search-input').value || '').trim().toLowerCase();
  const status  = document.getElementById('filter-status').value;
  let customers = getCustomers();

  if (keyword) {
    customers = customers.filter(c =>
      c.name.toLowerCase().includes(keyword) ||
      (c.model || '').toLowerCase().includes(keyword) ||
      (c.phone || '').includes(keyword)
    );
  }
  if (status) {
    customers = customers.filter(c => c.status === status);
  }
  if (currentQuickFilter !== 'all') {
    customers = customers.filter(c => c.status === currentQuickFilter);
  }
  renderCustomerList(customers);
}

/** 퀵 필터 버튼 클릭 */
function quickFilter(value, btn) {
  currentQuickFilter = value;
  document.querySelectorAll('.qbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // 드롭다운 필터도 초기화
  document.getElementById('filter-status').value = '';
  filterCustomers();
}

// ══════════════════════════════════════════════════════
// 고객 등록 폼 처리
// ══════════════════════════════════════════════════════

/**
 * 폼 제출 시 실행됩니다.
 * 1. 로컬 저장
 * 2. Google Sheets 전송 (SCRIPT_URL 설정된 경우)
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  // 폼 데이터 수집
  const customer = {
    id:       editingId || genId(),
    name:     v('f-name'),
    phone:    v('f-phone'),
    region:   v('f-region'),
    model:    v('f-model'),
    budget:   v('f-budget'),
    timing:   v('f-timing'),
    source:   v('f-source'),
    status:   v('f-status'),
    memo:     v('f-memo'),
    nextDate: v('f-nextdate'),
    createdAt: editingId ? undefined : new Date().toISOString(), // 수정 시 생성일 유지
    updatedAt: new Date().toISOString(),
  };

  // ── 로컬 저장 ──
  const customers = getCustomers();
  if (editingId) {
    // 기존 고객 업데이트 (생성일 유지)
    const idx = customers.findIndex(c => c.id === editingId);
    if (idx > -1) {
      customer.createdAt = customers[idx].createdAt;
      customers[idx] = customer;
    }
  } else {
    customers.push(customer);
  }
  saveCustomers(customers);

  // ── Google Sheets 전송 ──
  await sendToSheets(customer);
}

/** value() 헬퍼: input/select/textarea 값 가져오기 */
function v(id) {
  return (document.getElementById(id)?.value || '').trim();
}

/** 폼 초기화 */
function resetForm() {
  document.getElementById('customer-form').reset();
  editingId = null;
  document.querySelector('.form-title').textContent = '신규 고객 등록';
  hideAlert();
}

// ══════════════════════════════════════════════════════
// Google Sheets 연동
// ══════════════════════════════════════════════════════

/**
 * Google Apps Script 웹앱으로 고객 데이터를 전송합니다.
 *
 * 🔗 연결 방법:
 * 1. Google Sheets 열기 → 확장 프로그램 → Apps Script
 * 2. gas_script.gs 코드를 붙여넣고 저장
 * 3. 배포 → 새 배포 → 웹앱으로 배포
 *    - 다음 사용자로 실행: 나
 *    - 액세스 권한: 모든 사용자 (익명)
 * 4. 배포 URL을 복사해서 이 파일 상단의 SCRIPT_URL 에 붙여넣기
 */
async function sendToSheets(customer) {
  const submitBtn  = document.getElementById('submit-btn');
  const submitText = document.getElementById('submit-text');
  const submitLoad = document.getElementById('submit-loading');

  submitBtn.disabled = true;
  submitText.classList.add('hidden');
  submitLoad.classList.remove('hidden');

  // SCRIPT_URL이 없으면 로컬 저장만 성공 처리
  if (!SCRIPT_URL) {
    showAlert('고객정보가 저장되었습니다. (로컬 저장 완료)\n구글시트 연동은 SCRIPT_URL을 설정하세요.', 'success');
    submitBtn.disabled = false;
    submitText.classList.remove('hidden');
    submitLoad.classList.add('hidden');
    editingId = null;
    document.querySelector('.form-title').textContent = '신규 고객 등록';
    return;
  }

  try {
    // GET 파라미터 방식으로 전송 (Apps Script CORS 문제 우회)
    const params = new URLSearchParams();
    Object.keys(customer).forEach(key => {
      params.append(key, customer[key] || '');
    });

    await fetch(SCRIPT_URL + '?' + params.toString(), {
      method: 'GET',
      mode: 'no-cors',
    });

    // no-cors 모드에서는 응답을 읽을 수 없으므로 성공으로 간주
    showAlert('고객정보가 저장되었습니다. ✓', 'success');
    editingId = null;
    document.querySelector('.form-title').textContent = '신규 고객 등록';

  } catch (err) {
    console.error('Sheets 전송 오류:', err);
    showAlert('로컬 저장은 완료되었으나 구글시트 전송에 실패했습니다.\n인터넷 연결을 확인하거나 SCRIPT_URL을 점검하세요.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitText.classList.remove('hidden');
    submitLoad.classList.add('hidden');
  }
}

/** 알림 메시지 표시 */
function showAlert(msg, type) {
  const el = document.getElementById('form-alert');
  el.textContent = msg;
  el.className = 'form-alert ' + type;
  el.classList.remove('hidden');
  // 5초 후 자동으로 숨기기
  setTimeout(hideAlert, 5000);
}
function hideAlert() {
  document.getElementById('form-alert').classList.add('hidden');
}

// ══════════════════════════════════════════════════════
// 고객 상세 모달
// ══════════════════════════════════════════════════════

function openDetailModal(id) {
  const customers = getCustomers();
  const c = customers.find(x => x.id === id);
  if (!c) return;
  modalCustomerId = id;

  const sc = STATUS_COLORS[c.status] || { bg: '#eee', text: '#333' };

  document.getElementById('modal-content').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <div class="detail-name">${escHtml(c.name)}</div>
      <span class="status-badge" style="background:${sc.bg};color:${sc.text};margin-top:4px">${escHtml(c.status)}</span>
    </div>
    <div class="detail-phone">📞 <a href="tel:${escHtml(c.phone)}">${escHtml(c.phone)}</a></div>
    <div class="detail-grid">
      <div class="detail-item">
        <span class="detail-key">관심차종</span>
        <span class="detail-val">${escHtml(c.model || '—')}</span>
      </div>
      <div class="detail-item">
        <span class="detail-key">거주지역</span>
        <span class="detail-val">${escHtml(c.region || '—')}</span>
      </div>
      <div class="detail-item">
        <span class="detail-key">구매예산</span>
        <span class="detail-val">${escHtml(c.budget || '—')}</span>
      </div>
      <div class="detail-item">
        <span class="detail-key">구매예정시기</span>
        <span class="detail-val">${escHtml(c.timing || '—')}</span>
      </div>
      <div class="detail-item">
        <span class="detail-key">유입경로</span>
        <span class="detail-val">${escHtml(c.source || '—')}</span>
      </div>
      <div class="detail-item">
        <span class="detail-key">다음 연락일</span>
        <span class="detail-val">${c.nextDate ? formatDate(c.nextDate) : '—'}</span>
      </div>
    </div>
    <div class="detail-memo">
      <div class="detail-key">상담내용</div>
      <div class="detail-val">${escHtml(c.memo || '없음')}</div>
    </div>
    <div style="margin-top:12px;font-size:0.72rem;color:#aaa">
      등록일: ${c.createdAt ? new Date(c.createdAt).toLocaleDateString('ko-KR') : '—'}
    </div>
  `;

  document.getElementById('detail-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
  document.body.style.overflow = '';
  modalCustomerId = null;
}

/** 모달 외부 클릭 시 닫기 */
function closeModal(event) {
  if (event.target === document.getElementById('detail-modal')) closeDetailModal();
}

// ══════════════════════════════════════════════════════
// 수정 & 삭제
// ══════════════════════════════════════════════════════

/** 모달에서 수정 버튼 클릭 → 등록 폼에 값 채우기 */
function editFromModal() {
  const customers = getCustomers();
  const c = customers.find(x => x.id === modalCustomerId);
  if (!c) return;

  closeDetailModal();
  showView('register');

  // 폼 필드에 기존 값 채우기
  setValue('f-name',     c.name);
  setValue('f-phone',    c.phone);
  setValue('f-region',   c.region);
  setValue('f-model',    c.model);
  setValue('f-budget',   c.budget);
  setValue('f-timing',   c.timing);
  setValue('f-source',   c.source);
  setValue('f-status',   c.status);
  setValue('f-memo',     c.memo);
  setValue('f-nextdate', c.nextDate);

  editingId = c.id;
  document.querySelector('.form-title').textContent = '고객 정보 수정';

  // 폼 상단으로 스크롤
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

/** 삭제 버튼 클릭 → 확인 다이얼로그 */
function deleteFromModal() {
  document.getElementById('confirm-msg').textContent = '이 고객 정보를 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.';
  document.getElementById('confirm-dialog').classList.remove('hidden');

  document.getElementById('confirm-ok').onclick = () => {
    const customers = getCustomers().filter(c => c.id !== modalCustomerId);
    saveCustomers(customers);
    closeConfirm();
    closeDetailModal();
    // 현재 뷰 갱신
    if (document.getElementById('view-list').classList.contains('active')) {
      renderCustomerList(getCustomers());
    } else {
      renderDashboard();
    }
  };
}

function closeConfirm() {
  document.getElementById('confirm-dialog').classList.add('hidden');
}

// ══════════════════════════════════════════════════════
// 유틸 함수
// ══════════════════════════════════════════════════════

/** 오늘 날짜를 YYYY-MM-DD 형식으로 반환 */
function todayStr() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

/** YYYY-MM-DD → M월 D일 형식 */
function formatDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${parseInt(m)}월 ${parseInt(d)}일`;
}

/** XSS 방지용 HTML 이스케이프 */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** tel: 링크로 전화 앱 열기 */
function callCustomer(phone) {
  window.location.href = 'tel:' + phone.replace(/[^0-9+]/g, '');
}

// ══════════════════════════════════════════════════════
// 초기 실행
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  renderDashboard(); // 대시보드 뷰가 기본
});
