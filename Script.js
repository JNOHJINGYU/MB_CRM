1
/* =====================================================
2
   노진규 고객관리 시스템 — script.js
3
   =====================================================
4
   주요 기능:
5
   1. 고객 데이터 LocalStorage 저장/불러오기
6
   2. Google Sheets 자동 저장 (Google Apps Script)
7
   3. 대시보드 통계 및 오늘 연락 예정 표시
8
   4. 고객 카드 렌더링, 검색/필터
9
   5. 고객 상세 모달, 수정, 삭제
10
   ===================================================== */
11
 
12
// ──────────────────────────────────────────────────────
13
// ① Google Apps Script 웹앱 URL 설정
14
//    👉 아래 SCRIPT_URL 에 본인의 Apps Script 배포 URL을 붙여넣으세요.
15
//    설정 방법은 README 또는 페이지 하단 설명을 참고하세요.
16
//    URL이 없으면 로컬 저장만 됩니다 (Google Sheets 저장 안 됨).
17
// ──────────────────────────────────────────────────────
18
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwuFoY-kpv29mkcd44PjUMxgPDig5HB6Q9UPi6XTWUDvUAbQSzaTVuTXmOIpu94TD-tZg/exec"; // 예: "https://script.google.com/macros/s/XXXXX/exec"
19
 
20
// ──────────────────────────────────────────────────────
21
// ② 상태 배지 색상 설정
22
//    ✏️ 새 상태 추가 방법:
23
//    STATUS_COLORS['새상태이름'] = '#hex색상코드';
24
//    index.html 의 <select id="f-status"> 와 필터 <select> 에도 <option> 추가 필요.
25
// ──────────────────────────────────────────────────────
26
const STATUS_COLORS = {
27
  '신규문의':  { bg: '#e8f0fe', text: '#2c5ecc' },
28
  '상담중':    { bg: '#fff3cd', text: '#856404' },
29
  '견적전달':  { bg: '#e2f0fb', text: '#1a6fa0' },
30
  '시승예정':  { bg: '#e8f5e9', text: '#2e7d32' },
31
  '계약유력':  { bg: '#fff8e1', text: '#b8913a' },
32
  '보류':      { bg: '#f3f3f3', text: '#666' },
33
  '출고완료':  { bg: '#1a1a1a', text: '#fff' },
34
};
35
 
36
// 현재 수정 중인 고객 ID (null이면 새 등록)
37
let editingId = null;
38
 
39
// 현재 모달에 표시 중인 고객 ID
40
let modalCustomerId = null;
41
 
42
// 현재 적용된 퀵필터 값
43
let currentQuickFilter = 'all';
44
 
45
// ══════════════════════════════════════════════════════
46
// 데이터 관리 (LocalStorage)
47
// ══════════════════════════════════════════════════════
48
 
49
/** LocalStorage에서 전체 고객 배열을 가져옵니다 */
50
function getCustomers() {
51
  try {
52
    return JSON.parse(localStorage.getItem('crm_customers') || '[]');
53
  } catch (e) {
54
    return [];
55
  }
56
}
57
 
58
/** 고객 배열을 LocalStorage에 저장합니다 */
59
function saveCustomers(customers) {
60
  localStorage.setItem('crm_customers', JSON.stringify(customers));
61
}
62
 
63
/** 고유 ID 생성 (타임스탬프 + 랜덤) */
64
function genId() {
65
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
66
}
67
 
68
// ══════════════════════════════════════════════════════
69
// 뷰 전환 (대시보드 / 고객등록 / 고객목록)
70
// ══════════════════════════════════════════════════════
71
 
72
/**
73
 * viewName: 'dashboard' | 'register' | 'list'
74
 * 해당 뷰를 표시하고 나머지를 숨깁니다.
75
 */
76
function showView(viewName) {
77
  // 모든 뷰 숨기기
78
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
79
  // 선택 뷰 표시
80
  document.getElementById('view-' + viewName).classList.add('active');
81
 
82
  // 네비 버튼 활성화
83
  document.querySelectorAll('.nav-btn').forEach(btn => {
84
    btn.classList.toggle('active', btn.dataset.view === viewName);
85
  });
86
 
87
  // 뷰별 초기화
88
  if (viewName === 'dashboard') renderDashboard();
89
  if (viewName === 'list')      renderCustomerList(getCustomers());
90
  if (viewName === 'register' && editingId === null) resetForm();
91
}
92
 
93
// ══════════════════════════════════════════════════════
94
// 대시보드 렌더링
95
// ══════════════════════════════════════════════════════
96
 
97
function renderDashboard() {
98
  const customers = getCustomers();
99
  const today = todayStr();
100
 
101
  // 통계
102
  document.getElementById('stat-total').textContent = customers.length;
103
  document.getElementById('stat-hot').textContent   = customers.filter(c => c.status === '계약유력').length;
104
  document.getElementById('stat-today').textContent = customers.filter(c => c.nextDate === today).length;
105
  document.getElementById('stat-done').textContent  = customers.filter(c => c.status === '출고완료').length;
106
 
107
  // 오늘 연락 예정
108
  const todayCustomers = customers.filter(c => c.nextDate === today);
109
  const todayEl = document.getElementById('today-contacts');
110
  const todayEmpty = document.getElementById('today-empty');
111
 
112
  // 기존 카드 제거 (empty 메시지는 유지)
113
  todayEl.querySelectorAll('.today-card').forEach(el => el.remove());
114
 
115
  if (todayCustomers.length === 0) {
116
    todayEmpty.classList.remove('hidden');
117
  } else {
118
    todayEmpty.classList.add('hidden');
119
    todayCustomers.forEach(c => {
120
      const card = document.createElement('div');
121
      card.className = 'today-card';
122
      card.innerHTML = `
123
        <div>
124
          <div class="today-name">${escHtml(c.name)}</div>
125
          <div class="today-model">${escHtml(c.model || '차종 미정')} · ${escHtml(c.status)}</div>
126
        </div>
127
        <button class="today-call" onclick="callCustomer('${escHtml(c.phone)}')">📞 연락</button>
128
      `;
129
      todayEl.appendChild(card);
130
    });
131
  }
132
 
133
  // 최근 등록 고객 (최대 5명, 최신순)
134
  const recentEl = document.getElementById('recent-list');
135
  recentEl.innerHTML = '';
136
  const recent = [...customers].reverse().slice(0, 5);
137
  if (recent.length === 0) {
138
    recentEl.innerHTML = '<p class="empty-msg">등록된 고객이 없습니다.</p>';
139
  } else {
140
    recent.forEach(c => recentEl.appendChild(buildCard(c)));
141
  }
142
}
143
 
144
// ══════════════════════════════════════════════════════
145
// 고객 카드 빌더
146
// ══════════════════════════════════════════════════════
147
 
148
/**
149
 * 고객 객체를 받아 DOM 카드 엘리먼트를 반환합니다.
150
 * ✏️ 카드에 표시할 필드를 추가하려면 이 함수 안을 수정하세요.
151
 */
152
function buildCard(c) {
153
  const card = document.createElement('div');
154
  card.className = 'customer-card' + (c.status === '계약유력' ? ' hot' : '');
155
  card.onclick = () => openDetailModal(c.id);
156
 
157
  // 상태 배지 색상
158
  const sc = STATUS_COLORS[c.status] || { bg: '#eee', text: '#333' };
159
 
160
  // 다음 연락일 색상 처리
161
  const today = todayStr();
162
  let dateClass = 'card-date';
163
  let dateLabel = c.nextDate ? formatDate(c.nextDate) : '';
164
  if (c.nextDate) {
165
    if (c.nextDate < today) dateClass += ' overdue';
166
    else if (c.nextDate === today) { dateClass += ' today'; dateLabel = '오늘'; }
167
  }
168
 
169
  card.innerHTML = `
170
    <div class="card-name">${escHtml(c.name)}</div>
171
    <div class="card-model">${escHtml(c.model || '—')} ${c.budget ? '· ' + escHtml(c.budget) : ''}</div>
172
    <div class="card-memo">${escHtml(c.memo || '상담 내용 없음')}</div>
173
    <div class="card-right">
174
      <span class="status-badge" style="background:${sc.bg};color:${sc.text}">${escHtml(c.status)}</span>
175
      ${dateLabel ? `<span class="${dateClass}">${dateLabel}</span>` : ''}
176
    </div>
177
  `;
178
  return card;
179
}
180
 
181
// ══════════════════════════════════════════════════════
182
// 고객 목록 렌더링 & 필터
183
// ══════════════════════════════════════════════════════
184
 
185
function renderCustomerList(customers) {
186
  const el = document.getElementById('customer-list');
187
  el.innerHTML = '';
188
  if (customers.length === 0) {
189
    el.innerHTML = '<p class="empty-msg">조건에 맞는 고객이 없습니다.</p>';
190
    return;
191
  }
192
  // 최신순 정렬
193
  [...customers].reverse().forEach(c => el.appendChild(buildCard(c)));
194
}
195
 
196
/** 검색어 + 상태 필터 + 퀵필터를 조합해 목록 갱신 */
197
function filterCustomers() {
198
  const keyword = (document.getElementById('search-input').value || '').trim().toLowerCase();
199
  const status  = document.getElementById('filter-status').value;
200
  let customers = getCustomers();
201
 
202
  if (keyword) {
203
    customers = customers.filter(c =>
204
      c.name.toLowerCase().includes(keyword) ||
205
      (c.model || '').toLowerCase().includes(keyword) ||
206
      (c.phone || '').includes(keyword)
207
    );
208
  }
209
  if (status) {
210
    customers = customers.filter(c => c.status === status);
211
  }
212
  if (currentQuickFilter !== 'all') {
213
    customers = customers.filter(c => c.status === currentQuickFilter);
214
  }
215
  renderCustomerList(customers);
216
}
217
 
218
/** 퀵 필터 버튼 클릭 */
219
function quickFilter(value, btn) {
220
  currentQuickFilter = value;
221
  document.querySelectorAll('.qbtn').forEach(b => b.classList.remove('active'));
222
  btn.classList.add('active');
223
  // 드롭다운 필터도 초기화
224
  document.getElementById('filter-status').value = '';
225
  filterCustomers();
226
}
227
 
228
// ══════════════════════════════════════════════════════
229
// 고객 등록 폼 처리
230
// ══════════════════════════════════════════════════════
231
 
232
/**
233
 * 폼 제출 시 실행됩니다.
234
 * 1. 로컬 저장
235
 * 2. Google Sheets 전송 (SCRIPT_URL 설정된 경우)
236
 */
237
async function handleFormSubmit(event) {
238
  event.preventDefault();
239
 
240
  // 폼 데이터 수집
241
  const customer = {
242
    id:       editingId || genId(),
243
    name:     v('f-name'),
244
    phone:    v('f-phone'),
245
    region:   v('f-region'),
246
    model:    v('f-model'),
247
    budget:   v('f-budget'),
248
    timing:   v('f-timing'),
249
    source:   v('f-source'),
250
    status:   v('f-status'),
251
    memo:     v('f-memo'),
252
    nextDate: v('f-nextdate'),
253
    createdAt: editingId ? undefined : new Date().toISOString(), // 수정 시 생성일 유지
254
    updatedAt: new Date().toISOString(),
255
  };
256
 
257
  // ── 로컬 저장 ──
258
  const customers = getCustomers();
259
  if (editingId) {
260
    // 기존 고객 업데이트 (생성일 유지)
261
    const idx = customers.findIndex(c => c.id === editingId);
262
    if (idx > -1) {
263
      customer.createdAt = customers[idx].createdAt;
264
      customers[idx] = customer;
265
    }
266
  } else {
267
    customers.push(customer);
268
  }
269
  saveCustomers(customers);
270
 
271
  // ── Google Sheets 전송 ──
272
  await sendToSheets(customer);
273
}
274
 
275
/** value() 헬퍼: input/select/textarea 값 가져오기 */
276
function v(id) {
277
  return (document.getElementById(id)?.value || '').trim();
278
}
279
 
280
/** 폼 초기화 */
281
function resetForm() {
282
  document.getElementById('customer-form').reset();
283
  editingId = null;
284
  document.querySelector('.form-title').textContent = '신규 고객 등록';
285
  hideAlert();
286
}
287
 
288
// ══════════════════════════════════════════════════════
289
// Google Sheets 연동
290
// ══════════════════════════════════════════════════════
291
 
292
/**
293
 * Google Apps Script 웹앱으로 고객 데이터를 전송합니다.
294
 *
295
 * 🔗 연결 방법:
296
 * 1. Google Sheets 열기 → 확장 프로그램 → Apps Script
297
 * 2. gas_script.gs 코드를 붙여넣고 저장
298
 * 3. 배포 → 새 배포 → 웹앱으로 배포
299
 *    - 다음 사용자로 실행: 나
300
 *    - 액세스 권한: 모든 사용자 (익명)
301
 * 4. 배포 URL을 복사해서 이 파일 상단의 SCRIPT_URL 에 붙여넣기
302
 */
303
async function sendToSheets(customer) {
304
  const submitBtn  = document.getElementById('submit-btn');
305
  const submitText = document.getElementById('submit-text');
306
  const submitLoad = document.getElementById('submit-loading');
307
 
308
  submitBtn.disabled = true;
309
  submitText.classList.add('hidden');
310
  submitLoad.classList.remove('hidden');
311
 
312
  // SCRIPT_URL이 없으면 로컬 저장만 성공 처리
313
  if (!SCRIPT_URL) {
314
    showAlert('고객정보가 저장되었습니다. (로컬 저장 완료)\n구글시트 연동은 SCRIPT_URL을 설정하세요.', 'success');
315
    submitBtn.disabled = false;
316
    submitText.classList.remove('hidden');
317
    submitLoad.classList.add('hidden');
318
    editingId = null;
319
    document.querySelector('.form-title').textContent = '신규 고객 등록';
320
    return;
321
  }
322
 
323
  try {
324
    // Google Apps Script는 GET 파라미터 방식도 지원하나
325
    // 데이터 양이 많으므로 POST + JSON 사용
326
    const res = await fetch(SCRIPT_URL, {
327
      method: 'POST',
328
      // no-cors로 보내야 Apps Script가 받습니다 (CORS 제한)
329
      mode: 'no-cors',
330
      headers: { 'Content-Type': 'application/json' },
331
      body: JSON.stringify(customer),
332
    });
333
 
334
    // no-cors 모드에서는 응답을 읽을 수 없으므로 성공으로 간주
335
    showAlert('고객정보가 저장되었습니다. ✓', 'success');
336
    editingId = null;
337
    document.querySelector('.form-title').textContent = '신규 고객 등록';
338
 
339
  } catch (err) {
340
    console.error('Sheets 전송 오류:', err);
341
    showAlert('로컬 저장은 완료되었으나 구글시트 전송에 실패했습니다.\n인터넷 연결을 확인하거나 SCRIPT_URL을 점검하세요.', 'error');
342
  } finally {
343
    submitBtn.disabled = false;
344
    submitText.classList.remove('hidden');
345
    submitLoad.classList.add('hidden');
346
  }
347
}
348
 
349
/** 알림 메시지 표시 */
350
function showAlert(msg, type) {
351
  const el = document.getElementById('form-alert');
352
  el.textContent = msg;
353
  el.className = 'form-alert ' + type;
354
  el.classList.remove('hidden');
355
  // 5초 후 자동으로 숨기기
356
  setTimeout(hideAlert, 5000);
357
}
358
function hideAlert() {
359
  document.getElementById('form-alert').classList.add('hidden');
360
}
361
 
362
// ══════════════════════════════════════════════════════
363
// 고객 상세 모달
364
// ══════════════════════════════════════════════════════
365
 
366
function openDetailModal(id) {
367
  const customers = getCustomers();
368
  const c = customers.find(x => x.id === id);
369
  if (!c) return;
370
  modalCustomerId = id;
371
 
372
  const sc = STATUS_COLORS[c.status] || { bg: '#eee', text: '#333' };
373
 
374
  document.getElementById('modal-content').innerHTML = `
375
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
376
      <div class="detail-name">${escHtml(c.name)}</div>
377
      <span class="status-badge" style="background:${sc.bg};color:${sc.text};margin-top:4px">${escHtml(c.status)}</span>
378
    </div>
379
    <div class="detail-phone">📞 <a href="tel:${escHtml(c.phone)}">${escHtml(c.phone)}</a></div>
380
    <div class="detail-grid">
381
      <div class="detail-item">
382
        <span class="detail-key">관심차종</span>
383
        <span class="detail-val">${escHtml(c.model || '—')}</span>
384
      </div>
385
      <div class="detail-item">
386
        <span class="detail-key">거주지역</span>
387
        <span class="detail-val">${escHtml(c.region || '—')}</span>
388
      </div>
389
      <div class="detail-item">
390
        <span class="detail-key">구매예산</span>
391
        <span class="detail-val">${escHtml(c.budget || '—')}</span>
392
      </div>
393
      <div class="detail-item">
394
        <span class="detail-key">구매예정시기</span>
395
        <span class="detail-val">${escHtml(c.timing || '—')}</span>
396
      </div>
397
      <div class="detail-item">
398
        <span class="detail-key">유입경로</span>
399
        <span class="detail-val">${escHtml(c.source || '—')}</span>
400
      </div>
401
      <div class="detail-item">
402
        <span class="detail-key">다음 연락일</span>
403
        <span class="detail-val">${c.nextDate ? formatDate(c.nextDate) : '—'}</span>
404
      </div>
405
    </div>
406
    <div class="detail-memo">
407
      <div class="detail-key">상담내용</div>
408
      <div class="detail-val">${escHtml(c.memo || '없음')}</div>
409
    </div>
410
    <div style="margin-top:12px;font-size:0.72rem;color:#aaa">
411
      등록일: ${c.createdAt ? new Date(c.createdAt).toLocaleDateString('ko-KR') : '—'}
412
    </div>
413
  `;
414
 
415
  document.getElementById('detail-modal').classList.remove('hidden');
416
  document.body.style.overflow = 'hidden';
417
}
418
 
419
function closeDetailModal() {
420
  document.getElementById('detail-modal').classList.add('hidden');
421
  document.body.style.overflow = '';
422
  modalCustomerId = null;
423
}
424
 
425
/** 모달 외부 클릭 시 닫기 */
426
function closeModal(event) {
427
  if (event.target === document.getElementById('detail-modal')) closeDetailModal();
428
}
429
 
430
// ══════════════════════════════════════════════════════
431
// 수정 & 삭제
432
// ══════════════════════════════════════════════════════
433
 
434
/** 모달에서 수정 버튼 클릭 → 등록 폼에 값 채우기 */
435
function editFromModal() {
436
  const customers = getCustomers();
437
  const c = customers.find(x => x.id === modalCustomerId);
438
  if (!c) return;
439
 
440
  closeDetailModal();
441
  showView('register');
442
 
443
  // 폼 필드에 기존 값 채우기
444
  setValue('f-name',     c.name);
445
  setValue('f-phone',    c.phone);
446
  setValue('f-region',   c.region);
447
  setValue('f-model',    c.model);
448
  setValue('f-budget',   c.budget);
449
  setValue('f-timing',   c.timing);
450
  setValue('f-source',   c.source);
451
  setValue('f-status',   c.status);
452
  setValue('f-memo',     c.memo);
453
  setValue('f-nextdate', c.nextDate);
454
 
455
  editingId = c.id;
456
  document.querySelector('.form-title').textContent = '고객 정보 수정';
457
 
458
  // 폼 상단으로 스크롤
459
  window.scrollTo({ top: 0, behavior: 'smooth' });
460
}
461
 
462
function setValue(id, val) {
463
  const el = document.getElementById(id);
464
  if (el) el.value = val || '';
465
}
466
 
467
/** 삭제 버튼 클릭 → 확인 다이얼로그 */
468
function deleteFromModal() {
469
  document.getElementById('confirm-msg').textContent = '이 고객 정보를 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.';
470
  document.getElementById('confirm-dialog').classList.remove('hidden');
471
 
472
  document.getElementById('confirm-ok').onclick = () => {
473
    const customers = getCustomers().filter(c => c.id !== modalCustomerId);
474
    saveCustomers(customers);
475
    closeConfirm();
476
    closeDetailModal();
477
    // 현재 뷰 갱신
478
    if (document.getElementById('view-list').classList.contains('active')) {
479
      renderCustomerList(getCustomers());
480
    } else {
481
      renderDashboard();
482
    }
483
  };
484
}
485
 
486
function closeConfirm() {
487
  document.getElementById('confirm-dialog').classList.add('hidden');
488
}
489
 
490
// ══════════════════════════════════════════════════════
491
// 유틸 함수
492
// ══════════════════════════════════════════════════════
493
 
494
/** 오늘 날짜를 YYYY-MM-DD 형식으로 반환 */
495
function todayStr() {
496
  const d = new Date();
497
  return d.toISOString().split('T')[0];
498
}
499
 
500
/** YYYY-MM-DD → M월 D일 형식 */
501
function formatDate(str) {
502
  if (!str) return '';
503
  const [y, m, d] = str.split('-');
504
  return `${parseInt(m)}월 ${parseInt(d)}일`;
505
}
506
 
507
/** XSS 방지용 HTML 이스케이프 */
508
function escHtml(str) {
509
  if (!str) return '';
510
  return String(str)
511
    .replace(/&/g, '&amp;')
512
    .replace(/</g, '&lt;')
513
    .replace(/>/g, '&gt;')
514
    .replace(/"/g, '&quot;');
515
}
516
 
517
/** tel: 링크로 전화 앱 열기 */
518
function callCustomer(phone) {
519
  window.location.href = 'tel:' + phone.replace(/[^0-9+]/g, '');
520
}
521
 
522
// ══════════════════════════════════════════════════════
523
// 초기 실행
524
// ══════════════════════════════════════════════════════
525
document.addEventListener('DOMContentLoaded', () => {
526
  renderDashboard(); // 대시보드 뷰가 기본
527
});
528
 