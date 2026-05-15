/* =====================================================
   노진규 고객관리 시스템 — script.js (구글시트 DB 버전)
   =====================================================
   - 고객 데이터를 구글시트에서 불러옵니다 (앱 시작 시)
   - 저장/수정/삭제도 구글시트에 즉시 반영됩니다
   - LocalStorage는 오프라인 캐시 용도로만 사용합니다
   ===================================================== */

// ──────────────────────────────────────────────────────
// ① Google Apps Script 웹앱 URL
//    👉 새 배포 후 받은 URL을 여기에 붙여넣으세요
// ──────────────────────────────────────────────────────
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbws7wXKTGHoZd7jlcYFnFCA5t2mdKQsg3iOOaga0o7Vq9_7yNH8ZW-52hmS4VEFRLxrBQ/exec"; // 예: "https://script.google.com/macros/s/XXXXX/exec"

// 상태 배지 색상
const STATUS_COLORS = {
  '신규문의':  { bg: '#e8f0fe', text: '#2c5ecc' },
  '상담중':    { bg: '#fff3cd', text: '#856404' },
  '견적전달':  { bg: '#e2f0fb', text: '#1a6fa0' },
  '시승예정':  { bg: '#e8f5e9', text: '#2e7d32' },
  '계약유력':  { bg: '#fff8e1', text: '#b8913a' },
  '보류':      { bg: '#f3f3f3', text: '#666' },
  '출고완료':  { bg: '#1a1a1a', text: '#fff' },
};

let editingId        = null;
let modalCustomerId  = null;
let currentQuickFilter = 'all';

// ══════════════════════════════════════════════════════
// 구글시트 API 호출 헬퍼
// ══════════════════════════════════════════════════════

async function sheetRequest(params) {
  if (!SCRIPT_URL) return null;
  const url = SCRIPT_URL + '?' + new URLSearchParams(params).toString();
  try {
    const res  = await fetch(url, { mode: 'no-cors' });
    return true; // no-cors 모드는 응답을 읽을 수 없으므로 성공 간주
  } catch (e) {
    console.error('시트 요청 오류:', e);
    return null;
  }
}

// no-cors 없이 데이터를 읽어야 하는 경우 (getAll)
async function sheetFetch(params) {
  if (!SCRIPT_URL) return null;
  const url = SCRIPT_URL + '?' + new URLSearchParams(params).toString();
  try {
    const res  = await fetch(url);
    const json = await res.json();
    return json;
  } catch (e) {
    console.error('시트 읽기 오류:', e);
    return null;
  }
}

// ══════════════════════════════════════════════════════
// 로컬 캐시 (LocalStorage)
// ══════════════════════════════════════════════════════

function getCustomers() {
  try { return JSON.parse(localStorage.getItem('crm_customers') || '[]'); }
  catch(e) { return []; }
}
function saveLocalCustomers(customers) {
  localStorage.setItem('crm_customers', JSON.stringify(customers));
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ══════════════════════════════════════════════════════
// 앱 시작 시 구글시트에서 고객 불러오기
// ══════════════════════════════════════════════════════

async function loadFromSheets() {
  if (!SCRIPT_URL) {
    renderDashboard();
    return;
  }

  // 로딩 표시
  showLoadingBanner(true);

  const result = await sheetFetch({ action: 'getAll' });

  if (result && result.result === 'success' && Array.isArray(result.customers)) {
    // 구글시트 데이터로 로컬 캐시 덮어쓰기
    saveLocalCustomers(result.customers);
    console.log('구글시트에서 ' + result.customers.length + '명 불러옴');
  } else {
    console.warn('구글시트 불러오기 실패 — 로컬 캐시 사용');
  }

  showLoadingBanner(false);
  renderDashboard();
}

function showLoadingBanner(show) {
  let el = document.getElementById('loading-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-banner';
    el.style.cssText = 'position:fixed;top:60px;left:0;right:0;background:#b8913a;color:white;text-align:center;padding:8px;font-size:0.82rem;z-index:150;';
    document.body.appendChild(el);
  }
  if (show) {
    el.textContent = '구글시트에서 고객 정보를 불러오는 중...';
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════
// 뷰 전환
// ══════════════════════════════════════════════════════

function showView(viewName) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + viewName).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  if (viewName === 'dashboard') renderDashboard();
  if (viewName === 'list')      renderCustomerList(getCustomers());
  if (viewName === 'register' && editingId === null) resetForm();
}

// ══════════════════════════════════════════════════════
// 대시보드
// ══════════════════════════════════════════════════════

function renderDashboard() {
  const customers = getCustomers();
  const today = todayStr();

  document.getElementById('stat-total').textContent = customers.length;
  document.getElementById('stat-hot').textContent   = customers.filter(c => c.status === '계약유력').length;
  document.getElementById('stat-today').textContent = customers.filter(c => c.nextDate === today).length;
  document.getElementById('stat-done').textContent  = customers.filter(c => c.status === '출고완료').length;

  const todayCustomers = customers.filter(c => c.nextDate === today);
  const todayEl    = document.getElementById('today-contacts');
  const todayEmpty = document.getElementById('today-empty');
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
// 고객 카드
// ══════════════════════════════════════════════════════

function buildCard(c) {
  const card = document.createElement('div');
  card.className = 'customer-card' + (c.status === '계약유력' ? ' hot' : '');
  card.onclick = () => openDetailModal(c.id);
  const sc = STATUS_COLORS[c.status] || { bg: '#eee', text: '#333' };
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
// 고객 목록 & 필터
// ══════════════════════════════════════════════════════

function renderCustomerList(customers) {
  const el = document.getElementById('customer-list');
  el.innerHTML = '';
  if (customers.length === 0) {
    el.innerHTML = '<p class="empty-msg">조건에 맞는 고객이 없습니다.</p>';
    return;
  }
  [...customers].reverse().forEach(c => el.appendChild(buildCard(c)));
}

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
  if (status) customers = customers.filter(c => c.status === status);
  if (currentQuickFilter !== 'all') customers = customers.filter(c => c.status === currentQuickFilter);
  renderCustomerList(customers);
}

function quickFilter(value, btn) {
  currentQuickFilter = value;
  document.querySelectorAll('.qbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('filter-status').value = '';
  filterCustomers();
}

// ══════════════════════════════════════════════════════
// 고객 등록/수정 폼
// ══════════════════════════════════════════════════════

async function handleFormSubmit(event) {
  event.preventDefault();

  const customer = {
    id:        editingId || genId(),
    name:      v('f-name'),
    phone:     v('f-phone'),
    region:    v('f-region'),
    model:     v('f-model'),
    budget:    v('f-budget'),
    timing:    v('f-timing'),
    source:    v('f-source'),
    status:    v('f-status'),
    memo:      v('f-memo'),
    nextDate:  v('f-nextdate'),
    createdAt: editingId ? '' : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 로컬 캐시 업데이트
  const customers = getCustomers();
  if (editingId) {
    const idx = customers.findIndex(c => c.id === editingId);
    if (idx > -1) {
      customer.createdAt = customers[idx].createdAt;
      customers[idx] = customer;
    }
  } else {
    customers.push(customer);
  }
  saveLocalCustomers(customers);

  // 구글시트 저장
  const submitBtn  = document.getElementById('submit-btn');
  const submitText = document.getElementById('submit-text');
  const submitLoad = document.getElementById('submit-loading');
  submitBtn.disabled = true;
  submitText.classList.add('hidden');
  submitLoad.classList.remove('hidden');

  try {
    const params = { action: 'save' };
    Object.keys(customer).forEach(k => params[k] = customer[k] || '');
    await sheetRequest(params);
    showAlert('고객정보가 저장되었습니다. ✓', 'success');
  } catch(e) {
    showAlert('로컬 저장 완료. 구글시트 전송을 확인하세요.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitText.classList.remove('hidden');
    submitLoad.classList.add('hidden');
    editingId = null;
    document.querySelector('.form-title').textContent = '신규 고객 등록';
  }
}

function v(id) { return (document.getElementById(id)?.value || '').trim(); }

function resetForm() {
  document.getElementById('customer-form').reset();
  editingId = null;
  document.querySelector('.form-title').textContent = '신규 고객 등록';
  hideAlert();
}

function showAlert(msg, type) {
  const el = document.getElementById('form-alert');
  el.textContent = msg;
  el.className = 'form-alert ' + type;
  el.classList.remove('hidden');
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
      <div class="detail-item"><span class="detail-key">관심차종</span><span class="detail-val">${escHtml(c.model||'—')}</span></div>
      <div class="detail-item"><span class="detail-key">거주지역</span><span class="detail-val">${escHtml(c.region||'—')}</span></div>
      <div class="detail-item"><span class="detail-key">구매예산</span><span class="detail-val">${escHtml(c.budget||'—')}</span></div>
      <div class="detail-item"><span class="detail-key">구매예정시기</span><span class="detail-val">${escHtml(c.timing||'—')}</span></div>
      <div class="detail-item"><span class="detail-key">유입경로</span><span class="detail-val">${escHtml(c.source||'—')}</span></div>
      <div class="detail-item"><span class="detail-key">다음 연락일</span><span class="detail-val">${c.nextDate ? formatDate(c.nextDate) : '—'}</span></div>
    </div>
    <div class="detail-memo">
      <div class="detail-key">상담내용</div>
      <div class="detail-val">${escHtml(c.memo||'없음')}</div>
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
function closeModal(event) {
  if (event.target === document.getElementById('detail-modal')) closeDetailModal();
}

// ══════════════════════════════════════════════════════
// 수정 & 삭제
// ══════════════════════════════════════════════════════

function editFromModal() {
  const c = getCustomers().find(x => x.id === modalCustomerId);
  if (!c) return;
  closeDetailModal();
  showView('register');
  setValue('f-name', c.name); setValue('f-phone', c.phone);
  setValue('f-region', c.region); setValue('f-model', c.model);
  setValue('f-budget', c.budget); setValue('f-timing', c.timing);
  setValue('f-source', c.source); setValue('f-status', c.status);
  setValue('f-memo', c.memo); setValue('f-nextdate', c.nextDate);
  editingId = c.id;
  document.querySelector('.form-title').textContent = '고객 정보 수정';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

function deleteFromModal() {
  document.getElementById('confirm-msg').textContent = '이 고객 정보를 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.';
  document.getElementById('confirm-dialog').classList.remove('hidden');
  document.getElementById('confirm-ok').onclick = async () => {
    // 로컬 삭제
    const customers = getCustomers().filter(c => c.id !== modalCustomerId);
    saveLocalCustomers(customers);
    // 구글시트 삭제
    await sheetRequest({ action: 'delete', id: modalCustomerId });
    closeConfirm();
    closeDetailModal();
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
// 유틸
// ══════════════════════════════════════════════════════

function todayStr() { return new Date().toISOString().split('T')[0]; }
function formatDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${parseInt(m)}월 ${parseInt(d)}일`;
}
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function callCustomer(phone) {
  window.location.href = 'tel:' + phone.replace(/[^0-9+]/g, '');
}

// ══════════════════════════════════════════════════════
// 초기 실행 — 구글시트에서 고객 불러오기
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  loadFromSheets(); // 시작 시 구글시트에서 자동 불러오기
});
