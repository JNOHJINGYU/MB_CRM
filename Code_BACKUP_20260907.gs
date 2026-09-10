// ============================================================
// Mercedes-Benz 영업 CRM — Google Apps Script (Code.gs)
// v38 대비 변경점 (v38 — 고객ID 중복 방지 및 연결 무결성 강화):
//   1. SERVER_VERSION 갱신 (code101-customerid-dedup)
//   2. genCustomerId()를 행번호 기반("CUST-"+행번호)에서 UUID 기반으로
//      변경 — 신규 고객ID 생성 시 행이 삭제/재정렬되어도 예전 ID와
//      절대 충돌하지 않는다. 기존에 이미 저장된 CUST-0197 같은 행번호
//      기반 ID는 전혀 건드리지 않는다.
//   3. customerIdExists() / generateUniqueCustomerId() 추가 — 신규 ID를
//      발급하는 모든 지점(handleNew, handleEdit의 빈 ID 보정,
//      migrateLegacyCustomersToVehicles)이 반드시 이 함수를 통해서만
//      ID를 받도록 통일. UUID라도 저장 전 시트 전체를 다시 스캔해
//      방어적으로 중복을 재확인한다.
//   4. legacyRowBasedCustomerId() 추가 — handleList()/readCustomersForDiagnosis()의
//      "customerId가 비어있는 구형 행을 화면에 표시만 하는" 용도로만 남겨둔
//      기존 로직(행번호 기반). 시트에 절대 기록되지 않는다.
//   5. countCustomerIdOccurrences() / findOtherRowsWithCustomerId() 추가 —
//      handleNew/handleEdit에서 구매차량을 저장하기 직전 해당 customerId가
//      고객관리 시트에서 정확히 1행에만 연결되는지 확인하고, handleEdit
//      저장 시작 시점에는 다른 행이 같은 customerId를 이미 쓰고 있는지
//      확인한다. 중복이 발견되면 고객 정보/구매차량 어느 쪽도 수정·삭제하지
//      않고 즉시 명확한 오류 메시지와 함께 저장을 중단한다.
//   6. handleNew()의 시트 append + ID 발급/기록 구간을 LockService로 감싸
//      동시 저장 요청에서도 같은 ID가 중복 발급되지 않도록 강화.
//   7. diagnoseDuplicateCustomerIds() 추가 — 중복 고객ID/행번호/고객명/
//      연락처/법인명/연결된 구매차량 행을 읽기 전용으로 진단(데이터 수정 없음).
//   8. repairKnownDuplicateCustomerIds() 추가 — 이번에 실제로 확인된
//      서민수(CUST-0197 공유)/정정희(CUST-0198 공유) 건만 고객명+연락처
//      완전일치 확인 후 새 고유 ID로 교체. 서경원/심흥섭과 구매차량 시트는
//      전혀 건드리지 않으며, 재실행해도 안전하다(멱등성). 관리자가
//      Apps Script 편집기에서 직접 실행해야 하며 자동실행되지 않는다.
//   9. 기존 new / editCustomer / update / deleteCustomer / 구매차량 저장·
//      삭제·다중차량·차량별 메모/수량, 계약·출고 통계, Google Calendar 연동
//      로직은 순서와 동작을 전혀 변경하지 않았다 — 이번 변경은 고객ID
//      생성·검증 부분에만 최소 범위로 추가되었다.
//
// v36 : 다음연락일 ↔ Google Calendar 자동 동기화 추가
//
// v35 대비 변경점:
//   1. SERVER_VERSION 갱신 (code99-next-contact-calendar-sync)
//   2. syncNextContactCalendarEvent(customer) 추가 — 고객별 "다음연락일"을
//      Google Calendar 일정([연락]고객명, 해당일 08:00~08:30, Asia/Seoul)과
//      1:1로 동기화한다. customerId를 우선 키로 사용해 PropertiesService에
//      이벤트ID를 저장하고, 같은 고객은 항상 같은 이벤트를 재사용/수정한다
//      (신규 생성 X → 중복 방지). customerId가 없는 예외 상황에서만
//      rowNumber → 정규화된 전화번호 순으로 보조 키를 사용한다.
//   3. getCalendarEventPropKey(), buildSeoulDate(), buildNextContactDescription(),
//      setPreciseReminderViaAdvancedService() 헬퍼 추가.
//   4. handleNew() / handleEdit() / handleUpdate() / handleDeleteCustomer()
//      에서 각각 독립된 try/catch로 syncNextContactCalendarEvent()를 호출.
//      캘린더 연동이 실패해도 구글시트 저장/수정/삭제 자체는 절대 실패하지
//      않는다 (모든 캘린더 호출은 별도 try/catch로 감싸져 있음).
//   5. 기존 upsertCalEvent()(계약일/출고일용)는 전혀 수정하지 않고 그대로
//      유지 — 새 기능은 완전히 별개의 PropertiesService 키 네임스페이스
//      ("NEXT_CONTACT_EVENT_...")를 사용하므로 서로 충돌하지 않는다.
//   6. 기존 new / editCustomer / update / deleteCustomer 로직 및 구매차량
//      저장/삭제 로직은 순서와 동작을 전혀 변경하지 않음 — 캘린더 동기화는
//      전부 "기존 처리가 끝난 뒤" 추가로 호출되는 마지막 단계일 뿐이다.
//
// v37 대비 변경점 (v37 — 구매차량 "메모" 필드 추가):
//   1. SERVER_VERSION 갱신 (code100-vehicle-memo)
//   2. 구매차량 시트에 "메모" 컬럼 추가 — 기존 14개 컬럼(차량ID~수정일)은
//      순서/위치를 전혀 바꾸지 않고, "메모"는 항상 그 뒤에 별도 컬럼으로
//      추가된다(기존 시트: 15번째 컬럼에 자동 추가 / 신규 시트: 생성 시
//      마지막 컬럼으로 포함). 기존 컬럼을 중간에 끼워넣지 않는 이유는,
//      실제 서비스 중인 시트의 열을 중간에 삽입하면 이미 저장된 행들의
//      값과 위치가 어긋날 위험이 있기 때문이다 — 항상 "끝에 추가"만
//      허용해 기존 데이터를 절대 건드리지 않는다.
//   3. ensureVehicleMemoColumn(vs) 추가 — ensureColumn()을 재사용해 메모
//      컬럼 인덱스를 안전하게 확보(없으면 생성, 있으면 그 위치 재사용).
//   4. saveVehiclesToSheet() / getVehiclesByCustomerId() / readAllVehicles() /
//      handleList()의 구매차량 매핑 로직에 memo 필드 추가. 기존 14개 컬럼의
//      위치 기반 읽기/쓰기는 전혀 수정하지 않고, memo만 별도로
//      추가/조회한다.
//   5. 메모가 없는 기존 차량 데이터는 오류 없이 빈 문자열("")로 처리된다.
//   6. handleNew() / handleEdit() / handleDeleteCustomer() 등 기존 로직은
//      전혀 변경하지 않음 — saveVehiclesToSheet()가 내부적으로 메모까지
//      함께 저장하도록 확장되었을 뿐, 호출부는 그대로다.
//
// v34 대비 변경점 (v35):
//   1. SERVER_VERSION 갱신 (code98-customer-delete)
//   2. doPost()에 action:"deleteCustomer" 분기 추가
//   3. handleDeleteCustomer(p) 추가 — LockService로 동시 저장/수정/삭제
//      충돌을 막고, findCustomerRow()로 rowNumber → customerId →
//      originalPhone 순서로 고객을 찾아 고객 시트 행 1개와 구매차량 시트의
//      연결된 차량 행을 모두 삭제한다.
//   4. deleteVehiclesByCustomerIdSafe() 추가 — 구매차량 시트를 마지막 행부터
//      위쪽으로 순회하며 customerId가 정확히 일치하는 행만 삭제 (헤더 보호).
//   5. deleteVehiclesByNameAndPhoneSafe() 추가 — customerId가 없는 구형
//      데이터의 경우 고객명+연락처가 모두 일치하는 차량만 삭제하고, 그마저
//      불충분하면 차량 삭제를 생략하고 응답에 경고를 포함한다.
//   6. 기존 new / editCustomer / update 액션과 관련 함수는 전혀 수정하지
//      않음 (요청 사항에 따라 최소 변경 원칙 적용).
//
// v33 대비 변경점 (v34):
//   1. SERVER_VERSION 갱신
//   2. diagnoseSalesData2026() 추가 — 기존 고객 필드 vs 구매차량 시트의
//      2026년 계약/출고 수량을 비교 진단 (읽기 전용, 데이터 수정 없음)
//   3. migrateLegacyCustomersToVehicles() 추가 — 구매차량 행이 없는 기존
//      고객의 단일차량 데이터를 구매차량 시트로 1회성 이관 (관리자가
//      Apps Script 편집기에서 직접 실행해야 함, 페이지 로드 시 자동실행 금지)
//   4. makeVehicleMigrationKey()로 중복 생성 방지
//
// ── 이 버전을 배포하기 전에 반드시 확인할 것 ──────────────────
//   ・ Apps Script 편집기 좌측 [프로젝트 설정] → 시간대가 "Asia/Seoul"인지 확인.
//     (아니라면 buildSeoulDate()로 만든 시각이 실제 서울시간과 어긋난다.)
//   ・ 0분 전(정확히 오전 8시) 알림까지 필요하면 [서비스(+)] →
//     "Google Calendar API"(Advanced Service)를 추가해야 한다. 추가하지
//     않아도 시트 저장/캘린더 일정 생성 자체는 정상 동작하며, 이 경우
//     알림만 설정되지 않고 결과에 reminderWarning으로 안내된다.
//   ・ 최초 실행 시 Calendar 권한(및 Advanced Service 사용 시 별도 승인)
//     동의 팝업이 뜬다 — 아래 testNextContactCalendarSync() 함수를 편집기
//     에서 직접 한 번 실행해 승인을 받아두는 것을 권장한다.
//
// ★ Google Drive 고객·구매차량 문서관리 추가 (code102-drive-document-management)
//   v38 대비 변경점 — 아래 "DRIVE DOCUMENT MANAGEMENT" 구역 전체가 신규 추가.
//   기존 함수는 doGet()/doPost()의 라우팅 분기 추가를 제외하고는
//   일체 수정하지 않았다. 자세한 내용은 하단 구역 상단 주석 참조.
//
// ★ 구매차량 계약일·출고일 Google Calendar 자동 동기화 추가 (code105)
//   code103(vehicle-document-link-fix) 대비 변경점 — 아래 "VEHICLE CONTRACT/
//   DELIVERY CALENDAR SYNC" 구역 전체가 신규 추가. 기존 함수는 handleNew() /
//   handleEdit() / handleDeleteCustomer()에 "저장이 이미 끝난 뒤" 별도
//   try/catch로 캘린더 동기화 호출을 추가한 것 외에는 순서와 동작을 전혀
//   바꾸지 않았다. 자세한 내용은 하단 구역 상단 주석 참조.
//
// ★★★ 고객 저장속도 최적화 추가 (code107-save-speed-optimization) ★★★
//   code106(legacy-vehicle-document-link) 대비 변경점:
//   1. doGet()에 저장확인 전용 action 2개 추가
//      ("getCustomerByRequestToken","getCustomerById") — 둘 다 handleList()를
//      호출하지 않고 고객 1명(+필요시 vehicles)만 반환하는 경량 함수를 쓴다.
//   2. generateUniqueCustomerId()가 UUID 재시도 루프마다 시트를 다시 읽지
//      않도록, 시트를 한 번만 읽어 만든 Set을 재사용하게 바꿨다(호출부
//      시그니처는 그대로 유지되어 다른 호출부는 전혀 영향받지 않는다).
//   3. handleNew()/handleEdit()에 Date.now() 기준 성능 로그를 추가했다.
//   4. 읽기 전용 diagnoseSavePerformance()를 추가했다.
//   기존 검증(customerId 중복검사/vehicleId 누락검사/연결 무결성/
//   LockService/requestToken 중복방지/UUID 고객ID/기존 차량ID 유지)은
//   전혀 제거하지 않았고 순서도 바꾸지 않았다 — 오직 "같은 시트를 여러 번
//   중복해서 읽는 부분"만 줄였다.
// ============================================================

// ★★★ 저장확인 API 404 오판정 수정 추가 (code108-save-confirmation-404-fix) ★★★
//   code107(save-speed-optimization) 대비 변경점:
//   1. doGet()에 ?action=serverInfo 추가 — 현재 배포가 저장확인 API
//      (getCustomerByRequestToken/getCustomerById)를 지원하는지 프론트가
//      확인할 수 있게 한다. 읽기 전용, 데이터 조회 없음.
//   2. 읽기 전용 diagnoseRecentNewCustomers(minutes) 추가 — 최근 N분 안에
//      등록된 고객(고객명/연락처/customerId/requestToken/저장시간)을 조회한다.
//      "화면은 실패로 표시됐지만 실제로는 저장된 고객"을 관리자가 직접
//      확인할 수 있게 하기 위함이다.
//   handleNew()/handleEdit()/doGet의 기존 라우팅/저장 로직은 전혀 수정하지
//   않았다 — 이번 문제는 서버 저장 자체가 아니라 "저장 후 확인 단계"에서만
//   발생했기 때문이다(POST 저장은 정상 성공, 이후 GET 확인만 HTTP 404).
// ============================================================

// ★★★ 고객 입력 자동저장(Draft) + 최종확인 저장 최적화 (code109) ★★★
//   code108(save-confirmation-404-fix) 대비 변경점:
//   1. 새 시트 "자동저장" 추가 — 신규등록/고객수정/추가상담 화면에서
//      사용자가 입력하는 동안 debounce(프론트 1.2초)로 저장되는 draft를
//      보관한다. 고객관리/구매차량/문서관리/문서폴더 시트는 전혀 건드리지
//      않는다.
//   2. doPost에 autosaveDraft / deleteDraft / setDraftStatus 3개 액션 추가.
//      doGet에 getAutosaveStatus / getEditDraft 2개 액션 추가.
//      전부 "자동저장" 시트 1개 행만 다루는 가벼운 작업이며, revision이
//      더 오래된 요청은 무시한다(순서 역전 방지).
//   3. ★ 설계상 중요한 결정: draft는 "실제 CRM 데이터에 반영되기 전 임시
//      보관소"일 뿐이다. 실제 고객/차량 저장은 지금까지와 동일하게 오직
//      handleNew()/handleEdit()/handleUpdate()만 수행한다 — 이 함수들의
//      로직은 이번 변경에서 한 글자도 수정하지 않았다. draft를 기준으로
//      하는 별도의 "실제 저장" 경로(finalizeNewCustomer 등)를 새로
//      만들지 않은 이유는, 검증된 저장 로직을 그대로 재사용하는 것이
//      두 개의 서로 다른 저장 경로가 갈라져 나중에 어긋나는 위험보다
//      훨씬 안전하기 때문이다. 즉 draft 저장은 "입력 중 안전망 + 이어쓰기
//      복구용"이고, 실제 확정 저장은 기존 action:"new"/"editCustomer"를
//      그대로 사용한다(브라우저 쪽에서 draft를 최종 payload로 flush한 뒤
//      기존 흐름을 호출).
//   4. Google Calendar/Drive/문서관리/전체목록조회/customerId·vehicleId
//      재생성 등은 draft 저장 경로에서 절대 실행하지 않는다.
//   5. diagnoseAutosaveSystem() / diagnoseAutosaveDraft() /
//      cleanupCompletedAutosaveDrafts() 읽기 전용(또는 dryRun 기본) 진단
//      함수 추가.
//   6. handleServerInfo()의 features에 autosave 관련 플래그 추가 — 구버전
//      배포와 신버전 HTML이 섞여도 클라이언트가 감지해 자동저장을 안전하게
//      끌 수 있게 한다.
// ============================================================

// ★★★ 자동저장 안정화 수정 (code110-autosave-stability-fix) ★★★
//   code109(draft-autosave-final-confirm) 대비 변경점 — 새 기능 추가가
//   아니라 v113/code109에서 발견된 문제 4가지만 최소 수정했다:
//   1. handleAutosaveDraft()의 ACTIVE-only 검사를 COMPLETED뿐 아니라
//      DISCARDED에도 적용 — 종료 상태(COMPLETED/DISCARDED)는 절대 다시
//      ACTIVE로 되돌아가지 않는다는 불변조건을 명확히 했다.
//   2. handleDeleteDraft() / handleSetDraftStatus()에 handleAutosaveDraft와
//      동일한 짧은 LockService(tryLock 3000ms)를 추가해 "autosave가 ACTIVE
//      값을 읽은 직후 상태가 COMPLETED로 바뀌고, autosave가 뒤늦게 그 오래된
//      ACTIVE 값을 통째로 다시 써서 COMPLETED가 ACTIVE로 되돌아가는" race
//      condition을 제거했다.
//   3. handleSetDraftStatus()의 허용 status 값에서 "ACTIVE"를 제거했다 —
//      현재 운영 UI에는 COMPLETED/DISCARDED에서 ACTIVE로 되돌리는 기능이
//      필요 없다. 이미 종료 상태인 draft에 대한 재요청은 멱등하게 무시한다.
//   4. getAutosaveSheet()가 헤더를 한 번만 읽어 부족한 컬럼만 한 번에
//      추가하도록 최적화했다(기존에는 ensureColumn()을 11번 반복 호출해
//      매번 헤더 행을 다시 읽었다).
//   5. findAutosaveDraftRow()가 draftId 컬럼(A열)만 먼저 읽어 행을 찾고,
//      그 행 하나만 다시 읽도록 최적화했다(기존에는 매번 전체 데이터
//      범위를 통째로 읽었다). CacheService 등 캐시는 도입하지 않았다 —
//      정확도가 우선이라는 원칙에 따라 항상 시트를 직접 조회한다.
//   handleNew()/handleEdit()/handleUpdate()는 이번에도 한 글자도 수정하지
//   않았다.
// ============================================================

var AUTOSAVE_SHEET_NAME = "자동저장";
var AUTOSAVE_HEADERS = [
  "draftId","draftType","customerId","customerName","phone",
  "payloadJson","createdAt","updatedAt","deviceId","revision","status"
];

// ── 자동저장 시트 (없으면 생성, 있으면 재사용 — 기존 시트는 전혀 건드리지 않음) ──
//   ★ v114 최적화(요청사항 8): 헤더를 한 번만 읽어 부족한 컬럼만 계산한 뒤
//   한 번에 추가한다. 정상 헤더가 이미 있으면 읽기 1회로 끝난다(기존에는
//   ensureColumn()을 헤더 개수만큼 반복 호출해 매번 헤더 행을 다시 읽었다).
function getAutosaveSheet() {
  var sh = SS.getSheetByName(AUTOSAVE_SHEET_NAME);
  if (!sh) {
    sh = SS.insertSheet(AUTOSAVE_SHEET_NAME);
    sh.appendRow(AUTOSAVE_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange("1:1").setFontWeight("bold");
    return sh;
  }
  var lastCol = sh.getLastColumn();
  var existingHeaders = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  var existingSet = {};
  existingHeaders.forEach(function(h){ existingSet[String(h||"").trim()] = true; });
  var missing = AUTOSAVE_HEADERS.filter(function(h){ return !existingSet[h]; });
  if (missing.length > 0) {
    sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}

// ── draftId로 자동저장 시트에서 행을 찾는다 ────────────────────
//   ★ v114 최적화(요청사항 9): 매번 전체 행 범위를 통째로 읽지 않고,
//   먼저 draftId 컬럼(A열) 1개만 읽어 일치하는 행 번호를 찾은 뒤, 그
//   행 하나만 다시 읽는다. Draft가 수백~수천 개로 늘어나도 한 번에
//   읽는 데이터량은 "1개 열 전체 + 행 1개"로 유지된다. CacheService는
//   쓰지 않았다 — 사용자님 지적대로 정확도가 캐시 신선도보다 우선이다.
function findAutosaveDraftRow(sh, draftId) {
  var did = String(draftId || "").trim();
  if (!did) return null;
  var lastRow = sh.getLastRow();
  if (lastRow <= 1) return null;
  var idCol = sh.getRange(2, 1, lastRow - 1, 1).getValues(); // A열(draftId)만
  for (var i = 0; i < idCol.length; i++) {
    if (String(idCol[i][0] || "").trim() === did) {
      var rowNum = i + 2;
      var row = sh.getRange(rowNum, 1, 1, AUTOSAVE_HEADERS.length).getValues()[0];
      return { rowNum: rowNum, row: row };
    }
  }
  return null;
}

function autosaveRowToObject(row, rowNum) {
  var obj = {};
  AUTOSAVE_HEADERS.forEach(function(h, i){ obj[h] = row[i] === undefined || row[i] === null ? "" : row[i]; });
  obj.revision = parseInt(obj.revision, 10) || 0;
  obj._rowNumber = rowNum;
  return obj;
}

// draft 상태가 종료 상태(COMPLETED/DISCARDED)인지 — 이 두 상태는 절대
// ACTIVE로(또는 서로 간에도) 되돌아가지 않는다(요청사항 6).
function isTerminalDraftStatus(status) {
  return status === "COMPLETED" || status === "DISCARDED";
}

// ── 신규/수정/추가상담 draft 자동저장 (요청사항 8, 10, 79-80) ──────────
//   POST action:"autosaveDraft"
//   {draftId, draftType(NEW|EDIT|CONSULT), customerId, customerName, phone,
//    payload, revision, deviceId}
//   같은 draftId의 행이 있으면 UPDATE, 없으면 APPEND. 절대 매번 새 행을
//   추가하지 않는다. revision이 기존보다 낮거나 같으면 무시한다(요청사항 9).
//   짧은 LockService만 사용 — draftId 한 행만 다루므로 오래 잡지 않는다.
function handleAutosaveDraft(p) {
  var t0 = Date.now();
  var draftId = String(p.draftId || "").trim();
  var draftType = String(p.draftType || "").trim().toUpperCase();
  if (!draftId) return jsonResp({ success:false, message:"draftId가 필요합니다.", serverVersion: SERVER_VERSION });
  if (["NEW","EDIT","CONSULT"].indexOf(draftType) < 0) {
    return jsonResp({ success:false, message:"draftType은 NEW/EDIT/CONSULT 중 하나여야 합니다.", serverVersion: SERVER_VERSION });
  }
  var incomingRevision = parseInt(p.revision, 10) || 0;

  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(3000); // ★ 짧게만 대기 — draft 저장이 다른 저장을 막으면 안 된다.
  if (!gotLock) {
    // 자동저장은 실패해도 사용자 입력을 막지 않는다 — 그냥 실패 응답만 반환.
    return jsonResp({ success:false, message:"다른 자동저장이 진행 중입니다.", serverVersion: SERVER_VERSION });
  }
  try {
    var sh = getAutosaveSheet();
    var existing = findAutosaveDraftRow(sh, draftId);
    var nowStr = nowIsoLike();
    var payloadJson = JSON.stringify(p.payload || {});

    if (existing) {
      var existingObj = autosaveRowToObject(existing.row, existing.rowNum);
      // ★ v114(요청사항 4, 6): COMPLETED/DISCARDED는 종료 상태다 — 이 Lock
      //   안에서 방금 다시 읽은 최신 상태를 기준으로 판단하므로, markCompleted가
      //   먼저 커밋된 경우 이 autosave는 반드시 거부되고 ACTIVE로 되돌아가지 않는다.
      if (isTerminalDraftStatus(existingObj.status)) {
        return jsonResp({ success:true, ignored:true, reason:"draft_"+String(existingObj.status).toLowerCase(), revision: existingObj.revision, serverVersion: SERVER_VERSION });
      }
      if (incomingRevision <= existingObj.revision) {
        // ★ 요청사항 9: 오래된 revision은 무시 — 최신 내용이 과거 요청으로 덮어써지지 않는다.
        return jsonResp({ success:true, ignored:true, reason:"older_revision", revision: existingObj.revision, serverVersion: SERVER_VERSION });
      }
      sh.getRange(existing.rowNum, 1, 1, AUTOSAVE_HEADERS.length).setValues([[
        draftId, draftType,
        p.customerId || existingObj.customerId || "",
        p.customerName || "", p.phone || "",
        payloadJson,
        existingObj.createdAt || nowStr, nowStr,
        p.deviceId || existingObj.deviceId || "",
        incomingRevision,
        "ACTIVE" // ★ 여기 도달했다는 것은 위에서 이미 ACTIVE임을 확인했다는 뜻
      ]]);
    } else {
      sh.appendRow([
        draftId, draftType,
        p.customerId || "", p.customerName || "", p.phone || "",
        payloadJson, nowStr, nowStr,
        p.deviceId || "", incomingRevision, "ACTIVE"
      ]);
    }
    console.log("[autosaveDraft] " + (Date.now()-t0) + "ms draftId=" + draftId + " type=" + draftType + " rev=" + incomingRevision);
    return jsonResp({ success:true, ignored:false, revision: incomingRevision, serverVersion: SERVER_VERSION });
  } catch (err) {
    console.error("[handleAutosaveDraft 오류]", err.message);
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

// ── draft 삭제(사용자가 "삭제" 선택) — 물리 삭제 대신 DISCARDED로 표시 ──
//   POST action:"deleteDraft" {draftId}
//   ★ v114(요청사항 5): handleAutosaveDraft와 동일한 짧은 Lock을 사용해
//   "autosave가 ACTIVE 값을 읽은 직후 여기서 상태를 바꾸고, autosave가 뒤늦게
//   그 ACTIVE 값을 통째로 다시 써버리는" race를 제거한다.
function handleDeleteDraft(p) {
  var draftId = String(p.draftId || "").trim();
  if (!draftId) return jsonResp({ success:false, message:"draftId가 필요합니다.", serverVersion: SERVER_VERSION });

  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(3000);
  if (!gotLock) {
    return jsonResp({ success:false, message:"다른 자동저장 작업이 진행 중입니다.", serverVersion: SERVER_VERSION });
  }
  try {
    var sh = getAutosaveSheet();
    var existing = findAutosaveDraftRow(sh, draftId);
    if (!existing) return jsonResp({ success:true, found:false, serverVersion: SERVER_VERSION });
    var existingObj = autosaveRowToObject(existing.row, existing.rowNum);
    if (isTerminalDraftStatus(existingObj.status)) {
      // ★ 요청사항 6: 이미 종료 상태면 그대로 둔다(멱등성 — 재요청해도 안전).
      return jsonResp({ success:true, found:true, ignored:true, reason:"already_"+String(existingObj.status).toLowerCase(), serverVersion: SERVER_VERSION });
    }
    var statusCol = AUTOSAVE_HEADERS.indexOf("status") + 1;
    var updCol = AUTOSAVE_HEADERS.indexOf("updatedAt") + 1;
    sh.getRange(existing.rowNum, statusCol).setValue("DISCARDED");
    sh.getRange(existing.rowNum, updCol).setValue(nowIsoLike());
    return jsonResp({ success:true, found:true, serverVersion: SERVER_VERSION });
  } catch (err) {
    console.error("[handleDeleteDraft 오류]", err.message);
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

// ── 최종 저장 성공 후 draft를 COMPLETED로 표시 (요청사항 49) ───────────
//   POST action:"setDraftStatus" {draftId, status:"COMPLETED"}
//   COMPLETED로 표시된 draft는 이후 autosaveDraft 요청을 거부한다(위 참고).
//   ★ v114(요청사항 4, 5, 6):
//   - handleAutosaveDraft와 동일한 짧은 Lock으로 감싸 race condition을 제거한다.
//   - status는 이제 COMPLETED/DISCARDED만 허용한다. 현재 운영 UI에는
//     ACTIVE로 되돌리는 기능이 필요 없으므로 제거했다(요청사항 6) — 필요해지면
//     그때 별도 관리자 전용 경로로 다시 검토한다.
//   - 이미 종료 상태(COMPLETED/DISCARDED)인 draft는 다시 바꾸지 않는다(멱등성).
function handleSetDraftStatus(p) {
  var draftId = String(p.draftId || "").trim();
  var status = String(p.status || "").trim().toUpperCase();
  if (!draftId) return jsonResp({ success:false, message:"draftId가 필요합니다.", serverVersion: SERVER_VERSION });
  if (["COMPLETED","DISCARDED"].indexOf(status) < 0) {
    return jsonResp({ success:false, message:"status는 COMPLETED/DISCARDED 중 하나여야 합니다.", serverVersion: SERVER_VERSION });
  }

  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(3000);
  if (!gotLock) {
    return jsonResp({ success:false, message:"다른 자동저장 작업이 진행 중입니다.", serverVersion: SERVER_VERSION });
  }
  try {
    var sh = getAutosaveSheet();
    var existing = findAutosaveDraftRow(sh, draftId);
    if (!existing) return jsonResp({ success:true, found:false, serverVersion: SERVER_VERSION });
    var existingObj = autosaveRowToObject(existing.row, existing.rowNum);
    if (isTerminalDraftStatus(existingObj.status)) {
      // 이미 COMPLETED/DISCARDED — 그대로 둔다(멱등성, 요청사항 6).
      return jsonResp({ success:true, found:true, ignored:true, reason:"already_"+String(existingObj.status).toLowerCase(), serverVersion: SERVER_VERSION });
    }
    var statusCol = AUTOSAVE_HEADERS.indexOf("status") + 1;
    var updCol = AUTOSAVE_HEADERS.indexOf("updatedAt") + 1;
    sh.getRange(existing.rowNum, statusCol).setValue(status);
    sh.getRange(existing.rowNum, updCol).setValue(nowIsoLike());
    return jsonResp({ success:true, found:true, serverVersion: SERVER_VERSION });
  } catch (err) {
    console.error("[handleSetDraftStatus 오류]", err.message);
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

// ── 자동저장 상태 경량 조회 — GET ?action=getAutosaveStatus&draftId=... ──
//   전체 payload를 반환하지 않는다. revision/updatedAt/status만 반환한다.
function handleGetAutosaveStatus(p) {
  var draftId = String((p && p.draftId) || "").trim();
  if (!draftId) return jsonResp({ success:false, message:"draftId가 필요합니다.", serverVersion: SERVER_VERSION });
  var sh = getAutosaveSheet();
  var existing = findAutosaveDraftRow(sh, draftId);
  if (!existing) return jsonResp({ success:true, found:false, serverVersion: SERVER_VERSION });
  var obj = autosaveRowToObject(existing.row, existing.rowNum);
  return jsonResp({
    success:true, found:true,
    revision: obj.revision, updatedAt: obj.updatedAt, status: obj.status,
    serverVersion: SERVER_VERSION
  });
}

// ── 기존고객 수정 draft 복구용 — GET ?action=getEditDraft&customerId=... ──
//   해당 customerId의 가장 최근 ACTIVE EDIT draft 1개(payload 포함)를 반환한다.
//   다른 기기/브라우저에서 이어쓰기할 때 사용 — 같은 세션이면 localStorage로 충분하다.
function handleGetEditDraft(p) {
  var customerId = String((p && p.customerId) || "").trim();
  if (!customerId) return jsonResp({ success:false, message:"customerId가 필요합니다.", serverVersion: SERVER_VERSION });
  var sh = getAutosaveSheet();
  var data = sh.getDataRange().getValues();
  var best = null;
  for (var i = 1; i < data.length; i++) {
    var obj = autosaveRowToObject(data[i], i + 1);
    if (obj.draftType !== "EDIT") continue;
    if (obj.customerId !== customerId) continue;
    if (obj.status !== "ACTIVE") continue;
    if (!best || obj.revision > best.revision) best = obj;
  }
  if (!best) return jsonResp({ success:true, found:false, serverVersion: SERVER_VERSION });
  var payload = {};
  try { payload = JSON.parse(best.payloadJson || "{}"); } catch (e) { payload = {}; }
  return jsonResp({
    success:true, found:true,
    draftId: best.draftId, revision: best.revision, updatedAt: best.updatedAt,
    payload: payload, serverVersion: SERVER_VERSION
  });
}

// ============================================================
// ★ 관리자 진단 — 자동저장 시스템 전체 상태 (읽기 전용, 요청사항 59)
// ============================================================
function diagnoseAutosaveSystem() {
  var sh = getAutosaveSheet();
  var data = sh.getDataRange().getValues();
  var result = {
    totalCount:0, activeCount:0, completedCount:0, discardedCount:0,
    activeOver24h:0, duplicateDraftIds:[], revisionAnomalies:[],
    editDraftsWithoutCustomerId:0, lastAutosaveAt:""
  };
  if (data.length <= 1) {
    console.log("[diagnoseAutosaveSystem] 자동저장 데이터가 없습니다.");
    return result;
  }

  var seenIds = {};
  var latestUpdatedAt = "";
  var now = new Date();

  for (var i = 1; i < data.length; i++) {
    var obj = autosaveRowToObject(data[i], i + 1);
    var did = obj.draftId;
    if (did) {
      result.totalCount++;
      seenIds[did] = (seenIds[did] || 0) + 1;
    }
    if (obj.status === "ACTIVE") {
      result.activeCount++;
      // updatedAt은 "YYYY-MM-DD HH:MM:SS" 형태(nowIsoLike) — 24시간 경과 근사 판정.
      var updated = new Date(String(obj.updatedAt).replace(" ", "T"));
      if (!isNaN(updated.getTime()) && (now.getTime() - updated.getTime()) > 24*60*60*1000) {
        result.activeOver24h++;
      }
      if (obj.draftType === "EDIT" && !obj.customerId) {
        result.editDraftsWithoutCustomerId++;
      }
    } else if (obj.status === "COMPLETED") {
      result.completedCount++;
    } else if (obj.status === "DISCARDED") {
      result.discardedCount++;
    }
    if (String(obj.updatedAt) > latestUpdatedAt) latestUpdatedAt = String(obj.updatedAt);
  }

  Object.keys(seenIds).forEach(function(id){
    if (seenIds[id] > 1) result.duplicateDraftIds.push(id);
  });

  result.lastAutosaveAt = latestUpdatedAt;
  console.log("[diagnoseAutosaveSystem]", JSON.stringify(result));
  return result;
}

// ── 특정 draft 진단 (읽기 전용, 요청사항 60) — payload 내용은 로그에 남기지 않는다 ──
function diagnoseAutosaveDraft(draftId) {
  var sh = getAutosaveSheet();
  var existing = findAutosaveDraftRow(sh, draftId);
  if (!existing) {
    console.log("[diagnoseAutosaveDraft] draftId를 찾을 수 없습니다:", draftId);
    return { found:false };
  }
  var obj = autosaveRowToObject(existing.row, existing.rowNum);
  var result = {
    found:true,
    draftType: obj.draftType,
    customerId: obj.customerId,
    revision: obj.revision,
    status: obj.status,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
    // ★ payload(고객 개인정보 포함) 전체는 의도적으로 로그/반환하지 않는다.
  };
  console.log("[diagnoseAutosaveDraft]", JSON.stringify(result));
  return result;
}

// ── 완료/폐기된 draft 정리 (기본 dryRun:true, 요청사항 58, 89) ──────────
//   사용 예:
//     cleanupCompletedAutosaveDrafts({ dryRun:true });                 // 미리보기
//     cleanupCompletedAutosaveDrafts({ dryRun:false, olderThanDays:30 }); // 실제 삭제
function cleanupCompletedAutosaveDrafts(options) {
  options = options || {};
  var dryRun = options.dryRun !== false; // 기본값 true
  var olderThanDays = options.olderThanDays || 30;
  var cutoff = new Date(Date.now() - olderThanDays*24*60*60*1000);

  var sh = getAutosaveSheet();
  var data = sh.getDataRange().getValues();
  var toDelete = [];

  for (var i = 1; i < data.length; i++) {
    var obj = autosaveRowToObject(data[i], i + 1);
    if (obj.status !== "COMPLETED" && obj.status !== "DISCARDED") continue;
    var updated = new Date(String(obj.updatedAt).replace(" ", "T"));
    if (isNaN(updated.getTime()) || updated.getTime() > cutoff.getTime()) continue;
    toDelete.push({ rowNum: obj._rowNumber, draftId: obj.draftId, status: obj.status, updatedAt: obj.updatedAt });
  }

  if (dryRun) {
    console.log("[cleanupCompletedAutosaveDrafts - dryRun:true] 삭제 대상 " + toDelete.length + "건", JSON.stringify(toDelete));
    return { success:true, dryRun:true, targetCount: toDelete.length, targets: toDelete };
  }

  // 뒤에서부터 삭제해 행번호가 밀리지 않게 한다.
  toDelete.sort(function(a,b){ return b.rowNum - a.rowNum; });
  toDelete.forEach(function(t){ sh.deleteRow(t.rowNum); });
  console.log("[cleanupCompletedAutosaveDrafts - dryRun:false] " + toDelete.length + "건 삭제 완료");
  return { success:true, dryRun:false, deletedCount: toDelete.length, targets: toDelete };
}

var VEH_SHEET_NAME = "구매차량";
var SS = SpreadsheetApp.getActiveSpreadsheet();
var SERVER_VERSION = "2026-09-07-code113-manual-created-date";

// ── 한글/영문 헤더 매핑 ────────────────────────────────────
var HEADER_MAP = {
  "customerId":   "customerId",   "고객ID":    "customerId",
  "customerName": "customerName", "고객명":    "customerName",
  "companyName":  "companyName",  "법인명":    "companyName",
  "phone":        "phone",        "연락처":    "phone",   "전화번호": "phone",
  "region":       "region",       "거주지역":  "region",
  "modelName":    "modelName",    "모델명":    "modelName",
  "detailModel":  "detailModel",  "세부모델":  "detailModel",
  "purchaseMethod":"purchaseMethod","구매방식": "purchaseMethod",
  "budget":       "budget",       "구매예산":  "budget",
  "purchaseTiming":"purchaseTiming","구매예정시기":"purchaseTiming",
  "leadSource":   "leadSource",   "유입경로":  "leadSource",
  "status":       "status",       "현재상태":  "status",
  "consultation": "consultation", "상담내용":  "consultation",
  "memo":         "memo",         "고객메모":  "memo",
  "nextContact":  "nextContact",  "다음연락일":"nextContact",
  "contractDate": "contractDate", "계약일":    "contractDate",
  "deliveryDate": "deliveryDate", "출고일":    "deliveryDate",
  "deliveryMonth":"deliveryMonth","출고월":    "deliveryMonth",
  "tags":         "tags",         "태그":      "tags",
  "birthDate":    "birthDate",    "생년월일":  "birthDate",
  "insuranceStartDate":  "insuranceStartDate",  "보험가입일":            "insuranceStartDate",
  "insuranceExpireDate": "insuranceExpireDate", "보험만기일":            "insuranceExpireDate",
  "inspectionDueDate":   "inspectionDueDate",   "자동차검사일":          "inspectionDueDate",
  "financeStartDate":    "financeStartDate",     "금융시작일":            "financeStartDate",
  "financeEndDate":      "financeEndDate",       "금융종료일":            "financeEndDate",
  "lastServiceDate":     "lastServiceDate",      "최근서비스점검일":      "lastServiceDate",
  "lastServiceMileage":  "lastServiceMileage",   "최근점검주행거리":      "lastServiceMileage",
  "currentMileageDate":  "currentMileageDate",   "현재주행거리확인일":    "currentMileageDate",
  "currentMileage":      "currentMileage",       "현재주행거리":          "currentMileage",
  "nextServiceDate":     "nextServiceDate",       "다음무상점검예정일":    "nextServiceDate",
  "nextServiceMileage":  "nextServiceMileage",    "다음무상점검예정주행거리":"nextServiceMileage",
  "_savedAt":     "_savedAt",     "_rowNumber": "_rowNumber",
"등록일시":      "_savedAt",

"_updatedAt":   "_updatedAt",
"수정일시":      "_updatedAt",

"requestToken": "requestToken", "요청토큰":  "requestToken",

  // ★ 등록일 미확인 고객 수동 입력 기능 추가
  "manualCreatedDate": "manualCreatedDate", "수동등록일": "manualCreatedDate"
};

// 날짜 필드 집합
var DATE_FIELDS = {
  "nextContact":1,"insuranceStartDate":1,"insuranceExpireDate":1,
  "inspectionDueDate":1,"financeStartDate":1,"financeEndDate":1,
  "contractDate":1,"deliveryDate":1,"lastServiceDate":1,
  "currentMileageDate":1,"nextServiceDate":1,"birthDate":1,
  "manualCreatedDate":1
};

// ── 날짜 정규화 ────────────────────────────────────────────
function fmtDate(v) {
  if (!v && v !== 0) return "";
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return "";
    var y = v.getFullYear();
    var m = String(v.getMonth() + 1).padStart(2, "0");
    var d = String(v.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }
  var s = String(v).trim();
  if (!s || s === "0" || s.toLowerCase() === "false") return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var parts = s.match(/(\d+)/g);
  if (!parts || parts.length < 3) return s;
  var yr = parts[0].length <= 2 ? "20" + parts[0] : parts[0];
  var mo = String(parseInt(parts[1])).padStart(2, "0");
  var dy = String(parseInt(parts[2])).padStart(2, "0");
  return yr + "-" + mo + "-" + dy;
}

// ── 고객 데이터 시트 탐색 (빈 시트 생성 금지) ─────────────
function isCustomerSheet(sheet) {
  if (!sheet) return false;
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return false;
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v){ return String(v||"").trim(); });
  var hasName  = header.some(function(h){ return h==="customerName"||h==="고객명"; });
  var hasPhone = header.some(function(h){ return h==="phone"||h==="연락처"||h==="전화번호"; });
  return hasName && hasPhone;
}

function getCustomerSheet() {
  var candidates = ["고객목록","고객관리","CRM","시트1","Sheet1"];
  for (var i = 0; i < candidates.length; i++) {
    var sh = SS.getSheetByName(candidates[i]);
    if (sh && sh.getName() !== VEH_SHEET_NAME && isCustomerSheet(sh)) return sh;
  }
  var sheets = SS.getSheets();
  for (var j = 0; j < sheets.length; j++) {
    if (sheets[j].getName() === VEH_SHEET_NAME) continue;
    if (isCustomerSheet(sheets[j])) return sheets[j];
  }
  var allNames = sheets.map(function(s){ return s.getName(); }).join(", ");
  throw new Error("고객 데이터 시트를 찾을 수 없습니다. 전체 시트: [" + allNames + "]");
}

// ── 구매차량 시트 (없으면 생성 허용) ──────────────────────
function getVehicleSheet() {
  var sh = SS.getSheetByName(VEH_SHEET_NAME);
  if (!sh) {
    sh = SS.insertSheet(VEH_SHEET_NAME);
    // ★ v37: "메모"는 항상 기존 14개 컬럼 뒤에 15번째 컬럼으로 추가한다.
    //   (신규 시트라도 기존 시트와 동일한 컬럼 순서를 유지해, 이후 로직이
    //   "메모는 항상 끝에서 ensureColumn으로 찾는다"는 가정 하나로 통일된다.)
    sh.appendRow(["차량ID","고객ID","고객명","연락처",
      "모델명","세부모델","구매방식","차량상태",
      "계약일","출고일","출고월","수량","등록일","수정일","메모"]);
    sh.setFrozenRows(1);
    sh.getRange("1:1").setFontWeight("bold");
  }
  return sh;
}

// ── customerId 컬럼 위치 확인/추가 (기존 열 절대 덮어쓰기 금지) ──
function ensureCustomerIdColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var idx = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]||"").trim();
    if (h === "customerId" || h === "고객ID") { idx = i; break; }
  }
  if (idx >= 0) return idx + 1;
  var newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue("customerId");
  return newCol;
}

// ── 임의 헤더 컬럼 확인/추가 (없으면 마지막 열 오른쪽에 추가) ──
function ensureColumn(sheet, headerName) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]||"").trim() === headerName) return i + 1;
  }
  var newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue(headerName);
  return newCol;
}

// ── 구매차량 시트 "메모" 컬럼 확인/추가 (v37, 항상 끝에 추가) ──
// ensureColumn()을 그대로 재사용한다 — 이미 있으면 그 위치를, 없으면
// 새로 마지막 열에 추가한다. 기존 14개 컬럼의 위치는 절대 바꾸지 않는다.
function ensureVehicleMemoColumn(vs) {
  return ensureColumn(vs, "메모");
}

// ── 고객ID 생성 ───────────────────────────────────────────
// ★ 고객ID 중복 방지 및 연결 무결성 강화 ─────────────────────
// 신규 고객ID는 더 이상 행번호/고객 수 기반(CUST-0197 형식의 순번)으로
// 만들지 않는다. 행이 삭제되거나 시트가 재정렬되면 예전에 이미 사용된
// 행번호가 재사용되어 서로 다른 고객이 같은 ID를 갖게 되는 사고가
// 실제로 발생했다(서경원/서민수가 둘 다 CUST-0197). 대신 UUID 기반으로
// 생성해 원천적으로 충돌 가능성을 없앤다.
// 기존에 이미 저장되어 있는 CUST-0197 같은 행번호 기반 ID는 절대
// 건드리지 않는다 — 이 함수는 "새로 생성하는" ID에만 적용된다.
function genCustomerId() {
  return "CUST-" + Utilities.getUuid();
}

// ★ 고객ID 중복 방지 및 연결 무결성 강화 — 고객관리 시트에 이미 존재하는
//   고객ID인지 완전일치로 확인한다. UUID라 해도 방어적으로 검사한다.
function customerIdExists(sheet, customerId) {
  var cid = String(customerId || "").trim();
  if (!cid) return false;
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return false;
  var header = data[0].map(function(h){ return String(h||"").trim(); });
  var cidCol = -1;
  for (var i = 0; i < header.length; i++) {
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (mapped === "customerId") { cidCol = i; break; }
  }
  if (cidCol < 0) return false;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][cidCol] || "").trim() === cid) return true;
  }
  return false;
}

// ★ code107 저장속도 최적화 — UUID 생성 재시도 루프가 매 회 시트를
//   다시 읽지 않도록, 시트를 한 번만 읽어 만든 Set을 재사용한다.
function buildCustomerIdSet(sheet) {
  var data = sheet.getDataRange().getValues();
  var idSet = {};
  if (data.length <= 1) return idSet;
  var header = data[0].map(function(h){ return String(h||"").trim(); });
  var cidCol = -1;
  for (var i = 0; i < header.length; i++) {
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (mapped === "customerId") { cidCol = i; break; }
  }
  if (cidCol < 0) return idSet;
  for (var r = 1; r < data.length; r++) {
    var v = String(data[r][cidCol] || "").trim();
    if (v) idSet[v] = true;
  }
  return idSet;
}

// ★ 고객ID 중복 방지 및 연결 무결성 강화 — 중복이 없을 때까지 재생성한다.
//   실제로 신규 고객ID가 필요한 모든 지점(handleNew/handleEdit의 빈 ID
//   보정/migrateLegacyCustomersToVehicles)은 반드시 이 함수를 통해서만
//   ID를 발급받아야 한다.
//   ★ code107: preloadedIdSet(선택)을 전달하면 시트를 다시 읽지 않고 그
//     Set만 사용한다. 생략하면 이 함수 안에서 한 번 읽으므로, 기존 호출부는
//     코드를 전혀 바꿀 필요 없이 지금까지와 완전히 동일하게 동작한다.
function generateUniqueCustomerId(sheet, preloadedIdSet) {
  var idSet = preloadedIdSet || buildCustomerIdSet(sheet);
  var id, guard = 0;
  do {
    id = genCustomerId();
    guard++;
    if (guard > 20) {
      throw new Error("고유한 고객ID 생성에 반복적으로 실패했습니다. 잠시 후 다시 시도해주세요.");
    }
  } while (idSet[id]);
  idSet[id] = true; // 같은 요청 안에서 두 번 호출돼도 재충돌하지 않도록 즉시 반영
  return id;
}

// ★ 고객ID 중복 방지 및 연결 무결성 강화 — 고객관리 시트에 customerId가
//   비어있는 구형 행을 "목록 조회 화면에 표시만" 할 때 쓰는 임시 값이다.
//   시트에 절대 기록하지 않는다(읽기 전용/표시 전용). 예전 genCustomerId(rowNumber)
//   와 동일한 로직이지만, 실제 저장이 필요한 곳에서는 절대 사용하면 안 되므로
//   이름을 명확히 구분했다 — 저장이 필요하면 반드시 generateUniqueCustomerId()를 쓴다.
function legacyRowBasedCustomerId(rowNumber) {
  return "CUST-" + String(rowNumber).padStart(4, "0");
}

// ★ 고객ID 중복 방지 및 연결 무결성 강화 — 고객관리 시트에서 특정
//   customerId가 정확히 몇 행에 존재하는지 센다. 구매차량을 저장하기
//   직전에 "정확히 1행"인지 확인하는 용도로 사용한다.
function countCustomerIdOccurrences(cs, customerId) {
  var cid = String(customerId || "").trim();
  if (!cid) return 0;
  var data = cs.getDataRange().getValues();
  if (data.length <= 1) return 0;
  var header = data[0].map(function(h){ return String(h||"").trim(); });
  var cidCol = -1;
  for (var i = 0; i < header.length; i++) {
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (mapped === "customerId") { cidCol = i; break; }
  }
  if (cidCol < 0) return 0;
  var count = 0;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][cidCol] || "").trim() === cid) count++;
  }
  return count;
}

// ★ 고객ID 중복 방지 및 연결 무결성 강화 — 특정 customerId를 가진 다른
//   행들을 찾는다(자기 자신의 행은 제외). 고객 수정 저장 직전 "이 ID를
//   다른 고객이 이미 쓰고 있는지"를 확인해 저장을 막을지 판단하는 용도.
function findOtherRowsWithCustomerId(cs, customerId, excludeRowNum) {
  var result = [];
  var cid = String(customerId || "").trim();
  if (!cid) return result;
  var data = cs.getDataRange().getValues();
  if (data.length <= 1) return result;
  var header = data[0].map(function(h){ return String(h||"").trim(); });
  var cidCol = -1, nameCol = -1, phoneCol = -1;
  for (var i = 0; i < header.length; i++) {
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (mapped === "customerId")   cidCol = i;
    if (mapped === "customerName") nameCol = i;
    if (mapped === "phone")        phoneCol = i;
  }
  if (cidCol < 0) return result;
  for (var r = 1; r < data.length; r++) {
    var rowNum = r + 1;
    if (rowNum === excludeRowNum) continue;
    if (String(data[r][cidCol] || "").trim() === cid) {
      result.push({
        row: rowNum,
        name: nameCol  >= 0 ? String(data[r][nameCol]  || "") : "",
        phone: phoneCol >= 0 ? String(data[r][phoneCol] || "") : ""
      });
    }
  }
  return result;
}

function genVehicleId() {
  return "VEH-" + new Date().getTime() + "-" + Math.floor(Math.random()*1000);
}

// ============================================================
// ★★★ 다음연락일 ↔ Google Calendar 동기화 (신규, v36) ★★★
// ============================================================

// ── 고객별 캘린더 이벤트를 식별하는 PropertiesService 키 ──
// customerId를 최우선으로 사용한다. customerId가 없는 예외적인 경우에만
// rowNumber → 정규화된 전화번호 순서로 보조 키를 사용해, 동명이인이어도
// 서로 다른 고객의 일정이 충돌하지 않게 한다.
function getCalendarEventPropKey(customer) {
  var cid = String((customer && customer.customerId) || "").trim();
  if (cid) return "NEXT_CONTACT_EVENT_" + cid;

  var rn = String((customer && customer.rowNumber) || "").trim();
  if (rn) return "NEXT_CONTACT_EVENT_ROW_" + rn;

  var ph = String((customer && customer.phone) || "").replace(/\D/g, "");
  if (ph) return "NEXT_CONTACT_EVENT_PHONE_" + ph;

  return null;
}

// ── "YYYY-MM-DD" 문자열을 연/월/일을 직접 분해해 로컬(Asia/Seoul) 시각으로 변환 ──
// new Date("YYYY-MM-DD") 형태의 문자열 파싱은 실행 환경에 따라 UTC로
// 해석되어 날짜가 하루 밀릴 수 있으므로 사용하지 않는다.
// 주의: 이 함수가 만드는 시각이 실제로 서울시간이 되려면 Apps Script
// 프로젝트의 시간대 설정이 Asia/Seoul이어야 한다 (프로젝트 설정에서 확인).
function buildSeoulDate(dateStr, hour, minute) {
  var parts = String(dateStr || "").trim().split("-");
  if (parts.length < 3) return null;
  var y = Number(parts[0]);
  var m = Number(parts[1]) - 1;
  var d = Number(parts[2]);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  return new Date(y, m, d, hour, minute, 0);
}

// ── 캘린더 일정 설명 텍스트 생성 (값이 없는 항목은 제외) ──
function buildNextContactDescription(customer) {
  var lines = [];
  if (customer.customerName) lines.push("고객명: " + customer.customerName);
  if (customer.phone)        lines.push("연락처: " + customer.phone);
  if (customer.companyName)  lines.push("법인명: " + customer.companyName);
  if (customer.nextContact)  lines.push("다음연락일: " + customer.nextContact);
  if (customer.consultation) lines.push("상담내용: " + customer.consultation);
  if (customer.memo)         lines.push("고객메모: " + customer.memo);
  lines.push("CRM 자동등록 일정");
  return lines.join("\n");
}

// ── (선택) Calendar Advanced Service로 "0분 전(정시)" 알림 설정 ──
// CalendarApp.addPopupReminder()는 최소 5분 전부터만 허용하므로, 정확히
// 이벤트 시작 시각(오전 8시)에 알림을 받으려면 Calendar API Advanced
// Service가 필요하다. Apps Script 편집기 좌측 [서비스(+)] → "Google
// Calendar API" 추가 시에만 동작하며, 추가하지 않았다면 조용히
// { success:false }를 반환한다 (예외를 던지지 않음 — 시트 저장에 영향 없음).
function setPreciseReminderViaAdvancedService(calendarEventId) {
  if (typeof Calendar === "undefined" || !Calendar.Events) {
    return { success:false, reason:"advanced_service_not_enabled" };
  }
  try {
    var calendarId = Session.getActiveUser().getEmail() || "primary";
    // CalendarApp가 반환하는 이벤트ID는 보통 "xxxxxxxx@google.com" 형식이며,
    // Calendar Advanced Service(Events.patch)에는 '@' 앞부분만 사용한다.
    var advId = String(calendarEventId).split("@")[0];
    Calendar.Events.patch(
      { reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] } },
      calendarId,
      advId
    );
    return { success:true };
  } catch (err) {
    console.warn("[Advanced Calendar 알림 설정 실패]", err.message);
    return { success:false, reason: err.message };
  }
}

// ============================================================
// ★ 다음연락일 캘린더 동기화 메인 함수
//
//   customer = {
//     customerId, customerName, phone, companyName,
//     nextContact, consultation, memo, rowNumber
//   }
//
//   규칙:
//   - nextContact가 있으면: 같은 고객의 기존 이벤트가 있으면 "수정"
//     (제목/시간/설명 갱신), 없으면 "새로 생성" 후 이벤트ID를
//     PropertiesService에 저장. 고객마다 이벤트는 최대 1개만 유지된다.
//   - nextContact가 빈 값이면: 기존 이벤트가 있으면 삭제하고
//     PropertiesService 키도 제거. 없으면 아무 것도 하지 않는다.
//   - 이 함수는 자체적으로 예외를 던질 수 있으므로, 호출하는 쪽
//     (handleNew/handleEdit/handleUpdate/handleDeleteCustomer)에서
//     반드시 try/catch로 감싸 호출해야 한다 (시트 저장을 막지 않기 위함).
// ============================================================
function syncNextContactCalendarEvent(customer) {
  customer = customer || {};

  var propKey = getCalendarEventPropKey(customer);
  if (!propKey) {
    console.warn("[캘린더 동기화 건너뜀] customerId/rowNumber/phone이 모두 없습니다.");
    return { success:false, message:"고유 식별자가 없어 캘린더 동기화를 건너뛰었습니다." };
  }

  var props = PropertiesService.getScriptProperties();
  var existingEventId = props.getProperty(propKey);
  var cal = CalendarApp.getDefaultCalendar();
  var nextContact = String(customer.nextContact || "").trim();

  // ── 다음연락일이 빈 값 → 기존 일정 삭제 후 종료 ──────────
  if (!nextContact) {
    if (existingEventId) {
      try {
        var evToDelete = cal.getEventById(existingEventId);
        if (evToDelete) evToDelete.deleteEvent();
      } catch (delErr) {
        console.warn("[캘린더 이벤트 삭제 실패]", propKey, delErr.message);
      }
      props.deleteProperty(propKey);
      return { success:true, deleted:true, message:"다음연락일이 삭제되어 캘린더 일정도 삭제했습니다." };
    }
    return { success:true, deleted:false, message:"다음연락일이 없어 캘린더 작업이 필요하지 않습니다." };
  }

  var startTime = buildSeoulDate(nextContact, 8, 0);
  var endTime   = buildSeoulDate(nextContact, 8, 30);
  if (!startTime || !endTime) {
    console.warn("[캘린더 동기화] 다음연락일 형식 오류:", nextContact);
    return { success:false, message:"다음연락일(" + nextContact + ") 형식이 올바르지 않아 캘린더 동기화를 건너뛰었습니다." };
  }

  var title = "[연락]" + (customer.customerName || "");
  var description = buildNextContactDescription(customer);

  var event = null;
  if (existingEventId) {
    try { event = cal.getEventById(existingEventId); } catch (getErr) { event = null; }
  }

  var isNewEvent = false;
  if (event) {
    // ── 기존 이벤트 재사용: 제목/시간/설명만 갱신 (신규 생성 X → 중복 방지) ──
    event.setTitle(title);
    event.setTime(startTime, endTime);
    event.setDescription(description);
  } else {
    // ── 기존 이벤트가 없거나(최초) 캘린더에서 삭제된 상태 → 새로 생성 ──
    event = cal.createEvent(title, startTime, endTime, { description: description });
    isNewEvent = true;
    props.setProperty(propKey, event.getId());
  }

  // ── 알림 재설정: 누적 방지를 위해 기존 알림을 모두 지운 뒤 다시 설정 ──
  var reminderWarning = "";
  try {
    event.removeAllReminders();
    try {
      // 요청사항은 "정확히 오전 8시(0분 전) 알림"이지만, CalendarApp 기본
      // 기능은 최소 5분 전부터만 허용한다. 우선 0분을 시도한다.
      event.addPopupReminder(0);
    } catch (zeroErr) {
      // 0분 알림이 불가능한 환경 → Advanced Service로 재시도
      var adv = setPreciseReminderViaAdvancedService(event.getId());
      if (!adv.success) {
        // 임의로 7:55 등으로 대체하지 않는다 — 제한사항만 명확히 안내.
        reminderWarning =
          "정확히 이벤트 시작 시각(오전 8시) 알림은 Apps Script 기본 CalendarApp " +
          "기능으로는 설정할 수 없습니다(최소 5분 전부터 지원). Apps Script 편집기 " +
          "[서비스(+)]에서 'Google Calendar API'(Advanced Service)를 추가하면 " +
          "0분 전 알림이 가능합니다. 현재 이 일정에는 알림이 설정되지 않았습니다.";
        console.warn("[캘린더 알림 제한]", propKey, reminderWarning);
      }
    }
  } catch (remErr) {
    reminderWarning = "알림 설정 중 오류가 발생했습니다: " + remErr.message;
    console.warn("[캘린더 알림 오류]", propKey, remErr.message);
  }

  var result = {
    success: true,
    isNewEvent: isNewEvent,
    eventId: event.getId(),
    message: isNewEvent ? "캘린더 일정을 새로 생성했습니다." : "캘린더 일정을 갱신했습니다."
  };
  if (reminderWarning) result.reminderWarning = reminderWarning;
  console.log("[캘린더 동기화 완료]", propKey, result);
  return result;
}

// ============================================================
// ★ 테스트 전용 함수 — Apps Script 편집기에서 직접 실행:
//   testNextContactCalendarSync()
//
//   실제 고객 데이터/구글시트는 전혀 건드리지 않고, 테스트용 캘린더
//   일정만 생성 → 수정 → 삭제까지 한 번씩 실행해 정상 동작을 확인한다.
//   (customerId를 "TEST-..."로 매번 다르게 써서 실제 고객 키와 절대
//    충돌하지 않도록 한다.)
// ============================================================
function testNextContactCalendarSync() {
  var testId = "TEST-" + new Date().getTime();
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var dateStr = fmtDate(tomorrow);

  console.log("[테스트 1] 신규 생성 →", dateStr);
  var r1 = syncNextContactCalendarEvent({
    customerId: testId,
    customerName: "테스트고객",
    phone: "010-0000-0000",
    companyName: "",
    nextContact: dateStr,
    consultation: "캘린더 연동 테스트",
    memo: "",
    rowNumber: 99999
  });
  console.log(r1);

  console.log("[테스트 2] 같은 고객 재저장(같은 날짜) → 중복 생성되면 안 됨");
  var r2 = syncNextContactCalendarEvent({
    customerId: testId,
    customerName: "테스트고객",
    phone: "010-0000-0000",
    nextContact: dateStr,
    rowNumber: 99999
  });
  console.log(r2, "eventId 동일해야 정상:", r1.eventId === r2.eventId);

  var dayAfter = new Date();
  dayAfter.setDate(dayAfter.getDate() + 2);
  var dateStr2 = fmtDate(dayAfter);
  console.log("[테스트 3] 날짜 변경 →", dateStr2);
  var r3 = syncNextContactCalendarEvent({
    customerId: testId,
    customerName: "테스트고객(수정됨)",
    phone: "010-0000-0000",
    nextContact: dateStr2,
    rowNumber: 99999
  });
  console.log(r3);

  console.log("[테스트 4] 다음연락일 삭제 → 일정도 삭제되어야 함");
  var r4 = syncNextContactCalendarEvent({
    customerId: testId,
    customerName: "테스트고객(수정됨)",
    phone: "010-0000-0000",
    nextContact: "",
    rowNumber: 99999
  });
  console.log(r4);

  // 혹시 남아있을 수 있는 테스트 Script Property 정리
  PropertiesService.getScriptProperties().deleteProperty("NEXT_CONTACT_EVENT_" + testId);
  console.log("[테스트 완료] 결과를 위 로그에서 확인하세요.");
}

// ============================================================
// ★★★ 구매차량 계약일·출고일 Google Calendar 자동 동기화 (신규, code105) ★★★
//
//   배경:
//   - 기존 upsertCalEvent(propKey, title, date, desc)는 날짜가 바뀌어도
//     기존 이벤트의 제목/설명만 갱신하고 "날짜 이동"을 하지 않는 문제가
//     있었다. 또한 계약일/출고일은 고객관리 시트가 아니라 "구매차량" 시트의
//     각 행(vehicleId 기준)에 저장되므로, 고객 단위 키만으로는 같은 고객이
//     여러 대를 구매했을 때(예: 정우이앤씨) 차량별 일정을 구분할 수 없었다.
//   - 아래 함수들은 upsertCalEvent()를 확장하는 대신, vehicleId 기준의
//     완전히 별도인 함수 세트로 새로 만들었다. upsertCalEvent() 자체는
//     이번 변경에서 전혀 수정하지 않았다(현재 이 파일 안에서는 실제로
//     호출하는 곳이 없다 — 죽은 코드로 남아있을 뿐이며, 혹시 다른 곳에서
//     쓰고 있었더라도 이번 변경으로 동작이 바뀌지 않는다).
//
//   PropertiesService 키 규칙 (다음연락일과 절대 겹치지 않음):
//     계약 일정: "VEHICLE_CONTRACT_EVENT_" + vehicleId
//     출고 일정: "VEHICLE_DELIVERY_EVENT_" + vehicleId
//
//   일정 형태: CalendarApp.createAllDayEvent()를 사용한 종일 일정.
//   날짜 생성: 기존 buildSeoulDate(dateStr, 0, 0)을 그대로 재사용해
//   "new Date(dateStr+'T00:00:00')"의 UTC 파싱 문제를 피한다.
//
//   신규/수정/이동/삭제 규칙:
//     A. 날짜가 처음 입력됨            → 신규 종일 일정 생성
//     B. 같은 날짜로 재저장             → 기존 이벤트 제목/설명만 갱신(신규 생성 X)
//     C. 날짜가 변경됨                  → 새 날짜에 새 이벤트를 먼저 생성해
//                                         성공을 확인한 뒤에만 기존 이벤트를
//                                         삭제(순서 반대로 하지 않음)
//     D. 날짜가 삭제됨(공란)            → 기존 이벤트 삭제 + Property 삭제
//
//   호출 지점: handleNew() / handleEdit()에서 "구매차량 저장이 완전히 끝나고
//   getVehiclesByCustomerId()로 최종 결과를 다시 읽은 뒤" 별도 try/catch로
//   호출한다. handleDeleteCustomer()에서는 차량 행을 삭제하기 전에 해당
//   고객의 모든 차량 계약/출고 일정을 먼저 정리한다. handleEdit()에서
//   구매차량이 명시적으로 삭제된 경우(기존 vehicleId 손실 검증을 통과한
//   뒤)에만 해당 vehicleId의 계약/출고 일정을 정리한다.
// ============================================================

// 기본은 현재 사용 중인 기본 캘린더를 그대로 사용한다. 값을 채우면 해당
// 캘린더ID를 사용하고, 비어 있으면 CalendarApp.getDefaultCalendar()를 쓴다.
var SALES_CALENDAR_ID = "";

// 알림 분(minutes) — null이면 별도 알림을 강제하지 않고 Google Calendar
// 기본 알림 설정을 그대로 따른다. Advanced Service를 요구하지 않는다.
var CONTRACT_EVENT_REMINDER_MINUTES = null;
var DELIVERY_EVENT_REMINDER_MINUTES = null;

// ── 계약·출고 일정에 사용할 캘린더 가져오기 ──────────────────
function getSalesCalendar() {
  if (SALES_CALENDAR_ID) {
    try {
      var cal = CalendarApp.getCalendarById(SALES_CALENDAR_ID);
      if (cal) return cal;
    } catch (err) {
      console.warn("[차량 캘린더] SALES_CALENDAR_ID 접근 실패, 기본 캘린더로 대체:", err.message);
    }
  }
  return CalendarApp.getDefaultCalendar();
}

// ── vehicleId + eventType("CONTRACT"|"DELIVERY") 기준 Property 키 ──
// 절대 고객명이나 customerId 하나만으로 이벤트를 찾지 않는다 — 반드시
// vehicleId를 포함해야 같은 고객의 여러 차량 일정이 서로 덮어쓰이지 않는다.
function getVehicleCalendarPropKey(vehicleId, eventType) {
  var vid = String(vehicleId || "").trim();
  if (!vid) return null;
  if (eventType === "CONTRACT") return "VEHICLE_CONTRACT_EVENT_" + vid;
  if (eventType === "DELIVERY") return "VEHICLE_DELIVERY_EVENT_" + vid;
  return null;
}

// ── 일정 제목: [계약]고객명 / [출고]고객명 ─────────────────────
// 고객명이 비어있고 법인명만 있으면 법인명을, 둘 다 없으면 "고객명 미등록"을 사용한다.
function buildVehicleCalendarTitle(vehicle, eventType) {
  var label = (vehicle && vehicle.customerName) ? vehicle.customerName
            : (vehicle && vehicle.companyName) ? vehicle.companyName
            : "고객명 미등록";
  var prefix = eventType === "CONTRACT" ? "[계약]" : "[출고]";
  return prefix + label;
}

// ── 일정 설명: 모델명/세부모델 등 상세정보는 전부 설명에 넣는다 ──
function buildVehicleCalendarDescription(vehicle, eventType) {
  function s(v) { return (v === null || v === undefined) ? "" : String(v); }
  var lines = [];
  lines.push("고객명: " + s(vehicle.customerName));
  lines.push("법인명: " + s(vehicle.companyName));
  lines.push("연락처: " + s(vehicle.phone));
  lines.push("구분: " + (eventType === "CONTRACT" ? "계약" : "출고"));
  lines.push("모델명: " + s(vehicle.modelName));
  lines.push("세부모델: " + s(vehicle.detailModel));
  lines.push("구매방식: " + s(vehicle.purchaseMethod));
  lines.push("차량상태: " + s(vehicle.vehicleStatus));
  lines.push("계약일: " + s(vehicle.contractDate));
  lines.push("출고일: " + s(vehicle.deliveryDate));
  lines.push("수량: " + s(vehicle.quantity || 1));
  lines.push("차량ID: " + s(vehicle.vehicleId));
  lines.push("고객ID: " + s(vehicle.customerId));
  lines.push("메모: " + s(vehicle.memo));
  return lines.join("\n");
}

// ── (선택) 계약/출고 이벤트에 알림 적용 — 기본은 아무 것도 하지 않음 ──
function applyVehicleEventReminder(event, eventType) {
  var minutes = eventType === "CONTRACT" ? CONTRACT_EVENT_REMINDER_MINUTES : DELIVERY_EVENT_REMINDER_MINUTES;
  if (minutes === null || minutes === undefined) return;
  try {
    event.removeAllReminders();
    event.addPopupReminder(minutes);
  } catch (err) {
    console.warn("[차량 캘린더 알림 설정 실패]", err.message);
  }
}

// ── 차량 1건 + 이벤트 종류(CONTRACT|DELIVERY) 1개에 대한 동기화 ──
// 이 함수 자체는 예외를 던지지 않고 { success, ... } 형태로 결과를 반환한다.
// 호출부(syncVehicleContractDeliveryEvents)에서 각각 독립적인 try/catch로
// 감싸므로, 계약 일정 처리 오류가 출고 일정 처리를 막지 않는다.
function syncSingleVehicleCalendarEvent(vehicle, eventType) {
  var propKey = getVehicleCalendarPropKey(vehicle && vehicle.vehicleId, eventType);
  if (!propKey) {
    return { success:false, message:"vehicleId가 없어 캘린더 동기화를 건너뛰었습니다." };
  }

  var dateStr = String((eventType === "CONTRACT" ? vehicle.contractDate : vehicle.deliveryDate) || "").trim();
  var props = PropertiesService.getScriptProperties();
  var existingEventId = props.getProperty(propKey);
  var cal = getSalesCalendar();

  // ── D. 날짜가 빈 값 → 기존 일정 삭제 후 종료 ──────────────
  if (!dateStr) {
    if (existingEventId) {
      try {
        var evToDelete = cal.getEventById(existingEventId);
        if (evToDelete) evToDelete.deleteEvent();
      } catch (delErr) {
        console.warn("[차량 캘린더 삭제 실패]", propKey, delErr.message);
      }
      props.deleteProperty(propKey);
      return { success:true, deleted:true, eventType:eventType, vehicleId:vehicle.vehicleId };
    }
    return { success:true, deleted:false, eventType:eventType, vehicleId:vehicle.vehicleId };
  }

  var startDate = buildSeoulDate(dateStr, 0, 0);
  if (!startDate) {
    console.warn("[차량 캘린더] 날짜 형식 오류:", propKey, dateStr);
    return { success:false, message:"날짜(" + dateStr + ") 형식이 올바르지 않아 캘린더 동기화를 건너뛰었습니다." };
  }

  var title = buildVehicleCalendarTitle(vehicle, eventType);
  var description = buildVehicleCalendarDescription(vehicle, eventType);

  var existingEvent = null;
  if (existingEventId) {
    try { existingEvent = cal.getEventById(existingEventId); } catch (getErr) { existingEvent = null; }
  }

  // ── 기존 이벤트가 없음(최초 생성이거나, 캘린더에서 직접 삭제된 상태) → A. 신규 생성 ──
  if (!existingEvent) {
    var created;
    try {
      created = cal.createAllDayEvent(title, startDate, { description: description });
    } catch (createErr) {
      console.error("[차량 캘린더 신규 생성 실패]", propKey, createErr.message);
      return { success:false, message:"일정 생성 실패: " + createErr.message };
    }
    props.setProperty(propKey, created.getId());
    applyVehicleEventReminder(created, eventType);
    return { success:true, isNewEvent:true, moved:false, eventId:created.getId(), eventType:eventType, vehicleId:vehicle.vehicleId };
  }

  // ── 기존 이벤트가 있음 → 날짜가 같은지 확인 ────────────────
  var existingDateStr = "";
  try {
    var existingStart = existingEvent.getAllDayStartDate();
    existingDateStr = existingStart ? fmtDate(existingStart) : "";
  } catch (dateErr) {
    existingDateStr = "";
  }

  if (existingDateStr === dateStr) {
    // ── B. 같은 날짜 재저장 → 제목/설명만 갱신 (신규 생성 X) ──
    try {
      existingEvent.setTitle(title);
      existingEvent.setDescription(description);
    } catch (updErr) {
      console.error("[차량 캘린더 갱신 실패]", propKey, updErr.message);
      return { success:false, message:"일정 갱신 실패: " + updErr.message };
    }
    return { success:true, isNewEvent:false, moved:false, eventId:existingEvent.getId(), eventType:eventType, vehicleId:vehicle.vehicleId };
  }

  // ── C. 날짜가 변경됨 → 새 날짜에 새 이벤트를 먼저 생성해 성공을
  //      확인한 뒤에만 기존 이벤트를 삭제한다(순서를 절대 반대로 하지 않음). ──
  var movedEvent;
  try {
    movedEvent = cal.createAllDayEvent(title, startDate, { description: description });
  } catch (createErr2) {
    console.error("[차량 캘린더 날짜이동 - 신규 생성 실패]", propKey, createErr2.message);
    return { success:false, message:"날짜 이동을 위한 새 일정 생성 실패: " + createErr2.message };
  }
  props.setProperty(propKey, movedEvent.getId());
  applyVehicleEventReminder(movedEvent, eventType);
  try {
    existingEvent.deleteEvent();
  } catch (delErr2) {
    // 새 일정은 이미 생성/저장되었으므로 여기서 실패해도 데이터 정합성에는
    // 문제가 없다(과거 날짜에 이벤트가 하나 남을 뿐) — 경고만 로그로 남긴다.
    console.warn("[차량 캘린더 날짜이동 - 기존 일정 삭제 실패]", propKey, delErr2.message);
  }
  return { success:true, isNewEvent:true, moved:true, eventId:movedEvent.getId(), eventType:eventType, vehicleId:vehicle.vehicleId };
}

// ── 차량 1건에 대해 계약/출고 일정을 각각 독립적으로 동기화 ──
// 계약 일정 처리 중 오류가 나도 출고 일정 처리는 계속 진행된다(요청사항 8).
function syncVehicleContractDeliveryEvents(vehicle) {
  vehicle = vehicle || {};
  var result = { vehicleId: vehicle.vehicleId, contract: null, delivery: null };

  try {
    result.contract = syncSingleVehicleCalendarEvent(vehicle, "CONTRACT");
  } catch (err) {
    console.error("[차량 계약 캘린더 동기화 오류]", vehicle.vehicleId, err.message);
    result.contract = { success:false, message: err.message };
  }

  try {
    result.delivery = syncSingleVehicleCalendarEvent(vehicle, "DELIVERY");
  } catch (err) {
    console.error("[차량 출고 캘린더 동기화 오류]", vehicle.vehicleId, err.message);
    result.delivery = { success:false, message: err.message };
  }

  return result;
}

// ── 고객명/법인명/연락처를 캘린더 설명용으로 조회 (읽기 전용) ──
// 기존 getCustomerBasicInfo()는 고객명/법인명만 반환하므로, 캘린더 설명에
// 필요한 연락처까지 포함한 별도 헬퍼를 새로 만든다(기존 함수는 수정하지 않음).
function getCustomerFullInfoForCalendar(customerId) {
  var cs = getCustomerSheet();
  var data = cs.getDataRange().getValues();
  if (data.length <= 1) return { customerName:"", companyName:"", phone:"" };
  var header = data[0].map(function(h){ return String(h||"").trim(); });
  var cidCol=-1, nameCol=-1, companyCol=-1, phoneCol=-1;
  for (var i=0;i<header.length;i++) {
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (mapped==="customerId")   cidCol=i;
    if (mapped==="customerName") nameCol=i;
    if (mapped==="companyName")  companyCol=i;
    if (mapped==="phone")        phoneCol=i;
  }
  for (var r=1;r<data.length;r++) {
    if (cidCol>=0 && String(data[r][cidCol]||"").trim()===String(customerId).trim()) {
      return {
        customerName: nameCol>=0    ? String(data[r][nameCol]||"")    : "",
        companyName:  companyCol>=0 ? String(data[r][companyCol]||"") : "",
        phone:        phoneCol>=0   ? String(data[r][phoneCol]||"")   : ""
      };
    }
  }
  return { customerName:"", companyName:"", phone:"" };
}

// ── getVehiclesByCustomerId()가 반환하는 차량 객체(customerId/customerName/
//   phone/companyName이 빠져 있음)에 캘린더 동기화에 필요한 정보를 채워넣는다.
function enrichVehicleForCalendar(v, customerId, custInfo) {
  return {
    vehicleId:      v.vehicleId,
    customerId:     customerId,
    customerName:   (custInfo && custInfo.customerName) || "",
    companyName:    (custInfo && custInfo.companyName) || "",
    phone:          (custInfo && custInfo.phone) || "",
    modelName:      v.modelName,
    detailModel:    v.detailModel,
    purchaseMethod: v.purchaseMethod,
    vehicleStatus:  v.vehicleStatus,
    contractDate:   v.contractDate,
    deliveryDate:   v.deliveryDate,
    quantity:       v.quantity,
    memo:           v.memo
  };
}

// ── 특정 고객의 "현재 저장된" 구매차량 전체를 다시 읽어 계약/출고 일정을
//   일괄 동기화한다. handleNew()/handleEdit()에서 저장이 완전히 끝난 뒤
//   호출한다. 반환값은 응답에 그대로 담을 수 있는 요약 형태다.
function syncAllCustomerVehicleCalendarEvents(customerId) {
  var summary = { successCount:0, warningCount:0, errors:[] };
  var cid = String(customerId || "").trim();
  if (!cid) {
    summary.errors.push("customerId가 없어 차량 계약/출고 캘린더 동기화를 건너뛰었습니다.");
    return summary;
  }

  var vs = getVehicleSheet();
  var custInfo = getCustomerFullInfoForCalendar(cid);
  var vehicles = getVehiclesByCustomerId(vs, cid);

  vehicles.forEach(function(v) {
    var enriched = enrichVehicleForCalendar(v, cid, custInfo);
    try {
      var r = syncVehicleContractDeliveryEvents(enriched);
      if (r.contract) {
        if (r.contract.success) summary.successCount++;
        else { summary.warningCount++; summary.errors.push("계약(" + v.vehicleId + "): " + (r.contract.message||"")); }
      }
      if (r.delivery) {
        if (r.delivery.success) summary.successCount++;
        else { summary.warningCount++; summary.errors.push("출고(" + v.vehicleId + "): " + (r.delivery.message||"")); }
      }
    } catch (err) {
      summary.warningCount++;
      summary.errors.push(v.vehicleId + ": " + err.message);
      console.error("[차량 캘린더 일괄 동기화 오류]", cid, v.vehicleId, err.message);
    }
  });

  return summary;
}

// ── 특정 vehicleId의 계약/출고 일정과 Property를 모두 정리한다 ──
// 구매차량이 명시적으로 삭제되었을 때(handleEdit) 또는 고객 자체가
// 삭제될 때(handleDeleteCustomer) 사용한다. 문서관리/Drive 파일은
// 기존 정책대로 절대 건드리지 않는다.
function deleteVehicleCalendarEvents(vehicleId) {
  var vid = String(vehicleId || "").trim();
  if (!vid) return { success:false, message:"vehicleId가 없습니다." };
  var cal = getSalesCalendar();
  var props = PropertiesService.getScriptProperties();
  var result = { contractDeleted:false, deliveryDeleted:false };

  ["CONTRACT","DELIVERY"].forEach(function(eventType) {
    var propKey = getVehicleCalendarPropKey(vid, eventType);
    if (!propKey) return;
    var eventId = props.getProperty(propKey);
    if (!eventId) return;
    try {
      var ev = cal.getEventById(eventId);
      if (ev) ev.deleteEvent();
      if (eventType === "CONTRACT") result.contractDeleted = true; else result.deliveryDeleted = true;
    } catch (err) {
      console.warn("[차량 캘린더 삭제 실패]", propKey, err.message);
    }
    props.deleteProperty(propKey);
  });

  return result;
}

// ============================================================
// ★ 관리자용: 특정 고객의 차량별 계약/출고 캘린더 상태 진단 (읽기 전용)
//   사용 예: diagnoseVehicleCalendarEvents("정우이앤씨");
//   캘린더/시트 어느 쪽도 수정하지 않는다.
// ============================================================
function diagnoseVehicleCalendarEvents(customerSearch) {
  var customerRows = _findCustomerRowsByNameOrCompany(customerSearch);
  if (customerRows.length !== 1) {
    var msg = customerRows.length === 0
      ? "일치하는 고객이 없습니다."
      : "고객명/법인명이 여러 행과 일치해 customerId를 하나로 특정할 수 없습니다.";
    console.log("[차량 캘린더 진단]", msg, JSON.stringify(customerRows));
    return { success:false, message:msg, matches:customerRows };
  }

  var customerId = customerRows[0].customerId;
  if (!customerId) {
    console.log("[차량 캘린더 진단] customerId가 비어 있습니다(구형 행).");
    return { success:false, message:"customerId가 비어 있습니다(구형 행). 고객을 한 번 수정 저장해 customerId를 발급받아주세요." };
  }

  var custInfo = getCustomerFullInfoForCalendar(customerId);
  var vs = getVehicleSheet();
  var vehicles = getVehiclesByCustomerId(vs, customerId);
  var props = PropertiesService.getScriptProperties();
  var cal = getSalesCalendar();

  var seenEventIds = {};
  var duplicateEventSuspect = false;
  var rows = [];

  vehicles.forEach(function(v) {
    var row = {
      customerId: customerId,
      customerName: custInfo.customerName,
      companyName: custInfo.companyName,
      vehicleId: v.vehicleId,
      modelName: v.modelName,
      detailModel: v.detailModel,
      contractDate: v.contractDate,
      deliveryDate: v.deliveryDate
    };

    ["CONTRACT","DELIVERY"].forEach(function(eventType) {
      var propKey = getVehicleCalendarPropKey(v.vehicleId, eventType);
      var eventId = propKey ? props.getProperty(propKey) : null;
      var exists = false, evDate = "", evTitle = "";

      if (eventId) {
        try {
          var ev = cal.getEventById(eventId);
          if (ev) {
            exists = true;
            evTitle = ev.getTitle();
            var startD = ev.getAllDayStartDate();
            evDate = startD ? fmtDate(startD) : "";
          }
        } catch (e) { exists = false; }
        if (seenEventIds[eventId]) duplicateEventSuspect = true;
        seenEventIds[eventId] = true;
      }

      var prefix = eventType === "CONTRACT" ? "contract" : "delivery";
      var expectedDate = eventType === "CONTRACT" ? v.contractDate : v.deliveryDate;
      row[prefix + "PropKey"] = propKey;
      row[prefix + "EventId"] = eventId || "";
      row[prefix + "EventExists"] = exists;
      row[prefix + "EventDate"] = evDate;
      row[prefix + "EventTitle"] = evTitle;
      row[prefix + "DateMismatch"] = !!(expectedDate && exists && evDate && evDate !== expectedDate);
      row[prefix + "OrphanProperty"] = !!(eventId && !exists);
    });

    rows.push(row);
  });

  var report = {
    success: true,
    customerId: customerId,
    customerName: custInfo.customerName,
    companyName: custInfo.companyName,
    vehicleCount: vehicles.length,
    vehicles: rows,
    duplicateEventSuspect: duplicateEventSuspect
  };
  console.log("[차량 캘린더 진단 완료]", JSON.stringify(report));
  return report;
}

// ============================================================
// ★ 관리자용: 기존에 이미 계약일·출고일이 입력된 구매차량을 일괄 동기화.
//   기본값은 반드시 dryRun:true — 실제 캘린더는 dryRun:false를 명시적으로
//   전달했을 때만 수정된다. customerSearch를 지정하면 해당 고객만, 생략하면
//   전체 고객을 대상으로 한다.
//
//   사용 예:
//     syncExistingVehicleCalendarEvents({ dryRun:true, customerSearch:"정우이앤씨" });
//     syncExistingVehicleCalendarEvents({ dryRun:false, customerSearch:"정우이앤씨" });
// ============================================================
function syncExistingVehicleCalendarEvents(options) {
  options = options || {};
  var dryRun = options.dryRun !== false; // 기본값 true
  var customerSearch = options.customerSearch || "";

  var vs = getVehicleSheet();
  var props = PropertiesService.getScriptProperties();
  var cal = getSalesCalendar();

  var targetCustomerIds = null; // null = 전체 고객 대상
  if (customerSearch) {
    var rows = _findCustomerRowsByNameOrCompany(customerSearch);
    var ids = {};
    rows.forEach(function(r){ if (r.customerId) ids[r.customerId] = true; });
    if (Object.keys(ids).length === 0) {
      console.log("[기존 차량 캘린더 일괄동기화] 검색어와 일치하는 고객이 없습니다:", customerSearch);
      return { success:false, message:"검색어와 일치하는 고객이 없습니다." };
    }
    targetCustomerIds = ids;
  }

  var allVehicles = readAllVehicles(vs);
  var toProcess = allVehicles.filter(function(v) {
    if (!v.customerId) return false;
    if (targetCustomerIds && !targetCustomerIds[v.customerId]) return false;
    return true;
  });

  var custInfoCache = {};
  function getCustInfoCached(cid) {
    if (!custInfoCache[cid]) custInfoCache[cid] = getCustomerFullInfoForCalendar(cid);
    return custInfoCache[cid];
  }

  var plan = { willCreate:[], willUpdate:[], willMove:[], willDelete:[], skipped:[], errors:[] };
  var actualResult = { successCount:0, warningCount:0, errors:[] };

  toProcess.forEach(function(v) {
    var custInfo = getCustInfoCached(v.customerId);
    var enriched = enrichVehicleForCalendar(v, v.customerId, custInfo);

    ["CONTRACT","DELIVERY"].forEach(function(eventType) {
      var dateStr = String((eventType === "CONTRACT" ? v.contractDate : v.deliveryDate) || "").trim();
      var propKey = getVehicleCalendarPropKey(v.vehicleId, eventType);
      if (!propKey) { plan.skipped.push({ vehicleId:v.vehicleId, eventType:eventType, reason:"vehicleId 없음" }); return; }

      var existingEventId = props.getProperty(propKey);
      var existingEvent = null;
      if (existingEventId) {
        try { existingEvent = cal.getEventById(existingEventId); } catch (e) { existingEvent = null; }
      }

      if (!dateStr) {
        if (existingEvent) plan.willDelete.push({ vehicleId:v.vehicleId, eventType:eventType, propKey:propKey });
        return;
      }

      if (!existingEvent) {
        plan.willCreate.push({
          vehicleId:v.vehicleId, eventType:eventType, date:dateStr,
          title: buildVehicleCalendarTitle(enriched, eventType)
        });
      } else {
        var existingDateStr = "";
        try { existingDateStr = fmtDate(existingEvent.getAllDayStartDate()); } catch (e) { existingDateStr = ""; }
        if (existingDateStr === dateStr) {
          plan.willUpdate.push({ vehicleId:v.vehicleId, eventType:eventType, date:dateStr });
        } else {
          plan.willMove.push({ vehicleId:v.vehicleId, eventType:eventType, fromDate:existingDateStr, toDate:dateStr });
        }
      }
    });

    if (!dryRun) {
      try {
        var r = syncVehicleContractDeliveryEvents(enriched);
        if (r.contract) {
          if (r.contract.success) actualResult.successCount++;
          else { actualResult.warningCount++; actualResult.errors.push("계약(" + v.vehicleId + "): " + (r.contract.message||"")); }
        }
        if (r.delivery) {
          if (r.delivery.success) actualResult.successCount++;
          else { actualResult.warningCount++; actualResult.errors.push("출고(" + v.vehicleId + "): " + (r.delivery.message||"")); }
        }
      } catch (err) {
        actualResult.warningCount++;
        actualResult.errors.push(v.vehicleId + ": " + err.message);
        plan.errors.push({ vehicleId:v.vehicleId, error: err.message });
      }
    }
  });

  if (dryRun) {
    console.log("[기존 차량 캘린더 일괄동기화 - dryRun:true, 실제 변경 없음]", JSON.stringify(plan));
    return { success:true, dryRun:true, processedVehicleCount: toProcess.length, plan: plan };
  }

  console.log("[기존 차량 캘린더 일괄동기화 완료 - dryRun:false]", JSON.stringify(actualResult));
  return { success:true, dryRun:false, processedVehicleCount: toProcess.length, result: actualResult };
}

// ============================================================
// ★ 테스트 전용 함수 — Apps Script 편집기에서 직접 실행:
//   testVehicleContractDeliveryCalendarSync()
//
//   실제 고객/차량 데이터는 전혀 건드리지 않고, "TEST-VEH-..." 전용
//   vehicleId로 계약/출고 일정을 생성 → 재저장(중복 확인) → 날짜 이동 →
//   고객명 변경 → 공란 삭제까지 검증한 뒤 모든 테스트 흔적을 정리한다.
//   테스트 일정 제목은 반드시 "[TEST 계약]" / "[TEST 출고]"를 사용한다.
// ============================================================
function testVehicleContractDeliveryCalendarSync() {
  var testVehicleId = "TEST-VEH-" + new Date().getTime();
  var contractKey = getVehicleCalendarPropKey(testVehicleId, "CONTRACT");
  var deliveryKey = getVehicleCalendarPropKey(testVehicleId, "DELIVERY");
  var props = PropertiesService.getScriptProperties();
  var cal = getSalesCalendar();

  function testTitle(kind, name) { return "[TEST " + kind + "]" + name; }

  // upsertCalEvent()나 syncSingleVehicleCalendarEvent()를 그대로 쓰면 제목이
  // "[계약]"/"[출고]"로 고정되므로, 테스트 전용 제목("[TEST 계약]" 등)을
  // 검증하기 위해 동일한 A/B/C/D 규칙을 테스트 안에서 재구현한다.
  function upsertTestEvent(propKey, title, dateStr) {
    var existingId = props.getProperty(propKey);
    var existing = null;
    if (existingId) { try { existing = cal.getEventById(existingId); } catch (e) { existing = null; } }

    if (!dateStr) {
      if (existing) { try { existing.deleteEvent(); } catch (e) {} }
      props.deleteProperty(propKey);
      return null;
    }

    var startDate = buildSeoulDate(dateStr, 0, 0);
    if (existing) {
      var existingDateStr = "";
      try { existingDateStr = fmtDate(existing.getAllDayStartDate()); } catch (e) {}
      if (existingDateStr === dateStr) {
        existing.setTitle(title);
        return existing.getId();
      }
      var created = cal.createAllDayEvent(title, startDate);
      props.setProperty(propKey, created.getId());
      try { existing.deleteEvent(); } catch (e) {}
      return created.getId();
    }

    var created2 = cal.createAllDayEvent(title, startDate);
    props.setProperty(propKey, created2.getId());
    return created2.getId();
  }

  var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  var dateStr1 = fmtDate(tomorrow);
  var dayAfter = new Date(); dayAfter.setDate(dayAfter.getDate() + 2);
  var dateStr2 = fmtDate(dayAfter);

  console.log("[테스트1] 계약 일정 신규 생성 →", dateStr1);
  var id1 = upsertTestEvent(contractKey, testTitle("계약", "테스트고객"), dateStr1);
  console.log("계약 이벤트ID", id1);

  console.log("[테스트2] 출고 일정 신규 생성 →", dateStr2);
  var id2 = upsertTestEvent(deliveryKey, testTitle("출고", "테스트고객"), dateStr2);
  console.log("출고 이벤트ID", id2);

  console.log("[테스트3] 같은 데이터로 재실행 → 중복 생성되면 안 됨");
  var id1b = upsertTestEvent(contractKey, testTitle("계약", "테스트고객"), dateStr1);
  console.log("계약 이벤트ID 동일해야 정상:", id1 === id1b);

  console.log("[테스트4] 계약일을 하루 뒤로 변경 → 기존 일정이 이동해야 함");
  var movedDate = new Date(tomorrow); movedDate.setDate(movedDate.getDate() + 1);
  var movedDateStr = fmtDate(movedDate);
  var id1c = upsertTestEvent(contractKey, testTitle("계약", "테스트고객"), movedDateStr);
  console.log("이동 후 계약 이벤트ID(달라질 수 있음):", id1c);

  console.log("[테스트5] 고객명 변경 → 일정 제목이 변경돼야 함");
  var id1d = upsertTestEvent(contractKey, testTitle("계약", "테스트고객(수정됨)"), movedDateStr);
  console.log("제목 변경 완료, 이벤트ID:", id1d);

  console.log("[테스트6] 계약일 공란 처리 → 계약 일정만 삭제, 출고 일정은 유지돼야 함");
  upsertTestEvent(contractKey, "", "");
  console.log("계약 Property 삭제됨:", !props.getProperty(contractKey));
  console.log("출고 Property 유지됨:", !!props.getProperty(deliveryKey));

  console.log("[테스트7] 출고일 공란 처리 → 출고 일정도 삭제돼야 함");
  upsertTestEvent(deliveryKey, "", "");
  console.log("출고 Property 삭제됨:", !props.getProperty(deliveryKey));

  // 혹시 남아있을 수 있는 테스트 Property 정리(안전망)
  props.deleteProperty(contractKey);
  props.deleteProperty(deliveryKey);
  console.log("[테스트 완료] 위 로그를 확인하세요. 실제 고객/차량 데이터는 변경되지 않았습니다.");
}

function debugCustomerVehicles(searchText) {
  var cs = getCustomerSheet();
  var vs = getVehicleSheet();
  var customerData = cs.getDataRange().getDisplayValues();
  var vehicleData  = vs.getDataRange().getDisplayValues();

  console.log("[검색어]", searchText);
  console.log("[고객 시트 헤더]", JSON.stringify(customerData[0]));
  console.log("[구매차량 시트 헤더]", JSON.stringify(vehicleData[0]));

  var custMatches = 0, vehMatches = 0;

  customerData.forEach(function(row, index) {
    if (row.join(" ").indexOf(searchText) >= 0) {
      custMatches++;
      console.log("[고객 시트 행] " + (index + 1), row);
    }
  });

  vehicleData.forEach(function(row, index) {
    if (row.join(" ").indexOf(searchText) >= 0) {
      vehMatches++;
      console.log("[구매차량 시트 행] " + (index + 1), row);
    }
  });

  console.log("[검색 결과 요약]", {
    searchText: searchText,
    customerRowsFound: custMatches,
    vehicleRowsFound: vehMatches
  });
}

function readCustomersForDiagnosis(cs) {
  var data = cs.getDataRange().getValues();
  if (data.length <= 1) return [];
  var rawHeader = data[0].map(function(h){ return String(h||"").trim(); });
  var mappedCols = rawHeader.map(function(h){ return HEADER_MAP[h] || null; });

  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    for (var j = 0; j < mappedCols.length; j++) {
      var key = mappedCols[j];
      if (!key) continue;
      var val = row[j];
      obj[key] = (val === null || val === undefined) ? "" : (DATE_FIELDS[key] ? fmtDate(val) : String(val));
    }
    obj._rowNumber = i + 1;
    obj._suggestedCustomerId = obj.customerId || legacyRowBasedCustomerId(i + 1); // ★ 고객ID 중복 방지 및 연결 무결성 강화 — 표시/그룹핑 전용, 시트에 기록하지 않음
    if (!obj.customerName && !obj.phone) continue;
    result.push(obj);
  }
  return result;
}

function readAllVehicles(vs) {
  var memoCol = ensureVehicleMemoColumn(vs); // ★ v37: 메모 컬럼 위치(1-based)
  var data = vs.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0] && !row[1]) continue;
    result.push({
      vehicleId:      String(row[0]||"").trim(),
      customerId:     String(row[1]||"").trim(),
      customerName:   String(row[2]||"").trim(),
      phone:          String(row[3]||"").trim(),
      modelName:      String(row[4]||"").trim(),
      detailModel:    String(row[5]||"").trim(),
      purchaseMethod: String(row[6]||"").trim(),
      vehicleStatus:  String(row[7]||"").trim(),
      contractDate:   fmtDate(row[8]),
      deliveryDate:   fmtDate(row[9]),
      deliveryMonth:  String(row[10]||"").trim(),
      quantity:       Math.max(1, parseInt(row[11],10)||1),
      memo:           String(row[memoCol-1]||"").trim(), // ★ v37
      _rowNumber:     i + 1
    });
  }
  return result;
}

function diagnoseSalesData2026() {
  var cs = getCustomerSheet();
  var vs = getVehicleSheet();

  var customers = readCustomersForDiagnosis(cs);
  var vehicles  = readAllVehicles(vs);

  var legacyContract = 0;
  var legacyDelivery = 0;
  var vehicleContractQty = 0;
  var vehicleDeliveryQty = 0;
  var missingContractMigration = [];
  var missingDeliveryMigration = [];

  var vehCountByCustomer = {};
  vehicles.forEach(function(v){
    if (!v.customerId) return;
    vehCountByCustomer[v.customerId] = (vehCountByCustomer[v.customerId]||0) + 1;
  });

  customers.forEach(function(c){
    var contractDate = fmtDate(c.contractDate || "");
    var deliveryDate = fmtDate(c.deliveryDate || "");
    var cid = c.customerId || c._suggestedCustomerId;
    var vehCount = vehCountByCustomer[cid] || 0;

    if (contractDate && contractDate.substring(0,4) === "2026") legacyContract++;
    if (deliveryDate && deliveryDate.substring(0,4) === "2026") legacyDelivery++;

    if (contractDate && contractDate.substring(0,4) === "2026" && vehCount === 0) {
      missingContractMigration.push({
        customerId: cid, customerName: c.customerName,
        modelName: c.modelName, contractDate: contractDate
      });
    }
    if (deliveryDate && deliveryDate.substring(0,4) === "2026" && vehCount === 0) {
      missingDeliveryMigration.push({
        customerId: cid, customerName: c.customerName,
        modelName: c.modelName, deliveryDate: deliveryDate
      });
    }
  });

  vehicles.forEach(function(v){
    var qty = Math.max(1, parseInt(v.quantity,10)||1);
    if (v.contractDate && v.contractDate.substring(0,4) === "2026") vehicleContractQty += qty;
    if (v.deliveryDate && v.deliveryDate.substring(0,4) === "2026") vehicleDeliveryQty += qty;
  });

  var result = {
    customerCount: customers.length,
    vehicleRowCount: vehicles.length,
    legacyContract2026: legacyContract,
    legacyDelivery2026: legacyDelivery,
    vehicleContractQty2026: vehicleContractQty,
    vehicleDeliveryQty2026: vehicleDeliveryQty,
    missingContractMigrationCount: missingContractMigration.length,
    missingDeliveryMigrationCount: missingDeliveryMigration.length,
    missingContractMigration: missingContractMigration,
    missingDeliveryMigration: missingDeliveryMigration
  };

  console.log("[2026 판매실적 진단]", result);
  return result;
}

function makeVehicleMigrationKey(customerId, modelName, detailModel, contractDate, deliveryDate) {
  return [
    String(customerId || "").trim(),
    String(modelName || "").trim(),
    String(detailModel || "").trim(),
    fmtDate(contractDate || ""),
    fmtDate(deliveryDate || "")
  ].join("|");
}

function determineLegacyVehicleStatus(c) {
  if (c.deliveryDate) return "출고";
  if (c.contractDate) return "계약";
  if (c.status === "해약" && c.contractDate) return "해약";
  return c.status || "";
}

function migrateLegacyCustomersToVehicles() {
  var cs = getCustomerSheet();
  var vs = getVehicleSheet();
  var now = new Date();
  var nowStr = fmtDate(now);

  var customers = readCustomersForDiagnosis(cs);
  var vehicles  = readAllVehicles(vs);

  var existingKeys = {};
  vehicles.forEach(function(v){
    existingKeys[makeVehicleMigrationKey(v.customerId, v.modelName, v.detailModel, v.contractDate, v.deliveryDate)] = true;
  });
  var vehCountByCustomer = {};
  vehicles.forEach(function(v){
    if (!v.customerId) return;
    vehCountByCustomer[v.customerId] = (vehCountByCustomer[v.customerId]||0) + 1;
  });

  var checked = 0, created = 0, skippedExisting = 0, skippedNoData = 0, errors = 0;
  var newRows = [];

  customers.forEach(function(c){
    checked++;
    try {
      var cid = c.customerId;

      if (!cid) {
        // ★ 고객ID 중복 방지 및 연결 무결성 강화 — 시트에 실제로 기록하는
        //   경로이므로 행번호 기반이 아닌 충돌 검사를 통과한 고유 ID를 사용한다.
        cid = generateUniqueCustomerId(cs);
        var cidCol = ensureCustomerIdColumn(cs);
        cs.getRange(c._rowNumber, cidCol).setValue(cid);
      }

      if ((vehCountByCustomer[cid] || 0) > 0) {
        skippedExisting++;
        return;
      }

      var hasLegacyVehicle = !!(c.modelName || c.detailModel || c.purchaseMethod ||
                                 c.contractDate || c.deliveryDate || c.deliveryMonth);
      if (!hasLegacyVehicle) {
        skippedNoData++;
        return;
      }

      var key = makeVehicleMigrationKey(cid, c.modelName, c.detailModel, c.contractDate, c.deliveryDate);
      if (existingKeys[key]) {
        skippedExisting++;
        return;
      }

      var dd = fmtDate(c.deliveryDate || "");
      var dm = c.deliveryMonth || (dd && dd.length >= 7 ? dd.substring(0,7) : "");

      newRows.push([
        genVehicleId(), cid, c.customerName||"", c.phone||"",
        c.modelName||"", c.detailModel||"", c.purchaseMethod||"",
        determineLegacyVehicleStatus(c),
        fmtDate(c.contractDate||""), dd, dm, 1, nowStr, nowStr
      ]);
      existingKeys[key] = true;
      created++;

    } catch (err) {
      errors++;
      console.error("[마이그레이션 오류]", c.customerId, c.customerName, err.message);
    }
  });

  if (newRows.length > 0) {
    vs.getRange(vs.getLastRow()+1, 1, newRows.length, 14).setValues(newRows);
    SpreadsheetApp.flush();
  }

  var result = {
    checkedCustomers: checked,
    createdVehicles: created,
    skippedAlreadyExisting: skippedExisting,
    skippedNoLegacyData: skippedNoData,
    errors: errors
  };
  console.log("[마이그레이션 완료]", result);
  return result;
}

// ============================================================
// ★ 레거시 고객 차량의 구매차량 전환 및 문서관리 연결 복구 (code106)
//
//   문제 배경: 구매차량 시트에 아직 옮겨지지 않은 기존(레거시) 고객은
//   고객 수정 화면에서 migrateLegacyVehicle()/migrateVehicles()가 화면
//   호환용 "임시 차량 카드"를 보여준다. 이 임시 카드는 vehicleId가
//   비어 있어(vehicleId:"") 사용자에게는 차량이 저장된 것처럼 보이지만
//   실제 구매차량 시트에는 행이 없고, 그 결과 [문서관리] 버튼을 눌러도
//   "차량을 먼저 저장한 후 차량서류를 등록해주세요."가 뜬다.
//
//   아래 두 함수는 이 상태를 진단/복구하기 위한 것이다.
//   - diagnoseLegacyVehicleForDocuments(customerSearch): 읽기 전용 진단
//   - repairLegacyVehicleForCustomer(options): 고객 1명만 복구(dryRun 기본)
// ============================================================

// ── 고객 검색 공통 헬퍼 — 고객명/법인명/연락처/customerId 중 하나라도
//    일치하면 매칭한다. (진단/복구 함수 공용, 읽기 전용)
function _searchLegacyCustomers(customers, search) {
  var s = String(search || "").trim();
  var sPhone = s.replace(/\D/g, "");
  return customers.filter(function(c) {
    if (c.customerId && c.customerId === s) return true;
    if (c.customerName && String(c.customerName).indexOf(s) >= 0) return true;
    if (c.companyName && String(c.companyName).indexOf(s) >= 0) return true;
    if (sPhone && String(c.phone || "").replace(/\D/g, "").indexOf(sPhone) >= 0) return true;
    return false;
  });
}

// ── 특정 고객 진단 (읽기 전용, 데이터 수정 없음) ────────────────
// 사용 예: diagnoseLegacyVehicleForDocuments("노재평");
// Apps Script 편집기에서 이 함수를 선택한 뒤 ▶ 실행 → 보기 → 로그(Ctrl+Enter)로 결과 확인.
function diagnoseLegacyVehicleForDocuments(customerSearch) {
  var search = String(customerSearch || "").trim();
  if (!search) {
    console.log("[레거시 차량 진단] 검색어(고객명/법인명/연락처/customerId)를 인자로 넣어주세요. 예: diagnoseLegacyVehicleForDocuments('노재평')");
    return { success:false, message:"검색어가 필요합니다." };
  }

  var cs = getCustomerSheet();
  var vs = getVehicleSheet();
  var customers = readCustomersForDiagnosis(cs);
  var matches = _searchLegacyCustomers(customers, search);

  console.log("[고객관리 시트] '" + search + "' 검색결과 " + matches.length + "건");

  var result = { success:true, customerMatchCount: matches.length, customers: [] };

  matches.forEach(function(c) {
    var dupCount = c.customerId ? countCustomerIdOccurrences(cs, c.customerId) : 0;
    console.log("[고객관리 시트]", {
      시트행번호: c._rowNumber,
      customerId: c.customerId || ("(없음, 표시용:" + c._suggestedCustomerId + ")"),
      고객명: c.customerName || "",
      법인명: c.companyName || "",
      연락처: c.phone || "",
      모델명: c.modelName || "",
      세부모델: c.detailModel || "",
      구매방식: c.purchaseMethod || "",
      현재상태: c.status || "",
      계약일: c.contractDate || "",
      출고일: c.deliveryDate || "",
      출고월: c.deliveryMonth || "",
      중복customerId여부: c.customerId ? (dupCount > 1) : "customerId 없음"
    });

    var cid = c.customerId || "";
    var vehicles = cid ? getVehiclesByCustomerId(vs, cid) : [];
    console.log("[구매차량 시트] customerId=" + (cid || "(없음)") + " 차량 행 수=" + vehicles.length);
    vehicles.forEach(function(v, i) {
      console.log("[구매차량 시트]", {
        번호: i + 1,
        vehicleId: v.vehicleId,
        모델명: v.modelName,
        세부모델: v.detailModel,
        구매방식: v.purchaseMethod,
        차량상태: v.vehicleStatus,
        계약일: v.contractDate,
        출고일: v.deliveryDate,
        수량: v.quantity
      });
    });

    var hasLegacyRepresentative = !!(c.modelName || c.contractDate || c.deliveryDate);
    var hasRealVehicleRow = vehicles.length > 0;
    var hasVehicleIdGap = hasRealVehicleRow && vehicles.some(function(v){ return !v.vehicleId; });
    var likelyShownAsLegacyInHtml = hasLegacyRepresentative && !hasRealVehicleRow;
    var canUploadDocuments = hasRealVehicleRow && vehicles.every(function(v){ return !!v.vehicleId; });

    var conclusion;
    if (likelyShownAsLegacyInHtml) {
      conclusion = (c.customerName || "해당 고객") + " 고객은 고객관리 탭에 대표차량 정보가 있지만 " +
        "구매차량 탭에는 차량 행이 없습니다. 현재 화면은 migrateLegacyVehicle()로 임시 표시되고 " +
        "있으며 vehicleId가 없기 때문에 차량서류를 등록할 수 없습니다.";
    } else if (hasVehicleIdGap) {
      conclusion = "구매차량 행은 존재하지만 HTML 응답에서 vehicleId가 누락되고 있습니다. 관리자 확인이 필요합니다.";
    } else if (hasRealVehicleRow) {
      conclusion = (c.customerName || "해당 고객") + " 고객은 구매차량 행이 정상적으로 존재하며 문서관리를 사용할 수 있습니다.";
    } else {
      conclusion = (c.customerName || "해당 고객") + " 고객은 대표차량 정보도 구매차량 행도 없습니다(차량이 없는 고객일 수 있습니다).";
    }
    console.log("[진단 결론] " + conclusion);

    result.customers.push({
      rowNumber: c._rowNumber,
      customerId: cid,
      customerName: c.customerName || "",
      hasLegacyRepresentative: hasLegacyRepresentative,
      realVehicleRowCount: vehicles.length,
      likelyShownAsLegacyInHtml: likelyShownAsLegacyInHtml,
      hasVehicleIdGap: hasVehicleIdGap,
      canUploadDocuments: canUploadDocuments,
      conclusion: conclusion
    });
  });

  if (matches.length === 0) {
    console.log("[레거시 차량 진단] '" + search + "'로 검색된 고객이 없습니다.");
  }

  return result;
}

// ── 특정 고객 1명만 복구 (기본값 dryRun:true — 미리보기만, 데이터 미수정) ──
// 사용 예:
//   repairLegacyVehicleForCustomer({ customerSearch:"노재평", dryRun:true });   // 미리보기
//   repairLegacyVehicleForCustomer({ customerSearch:"노재평", dryRun:false });  // 실제 저장
function repairLegacyVehicleForCustomer(options) {
  options = options || {};
  var dryRun = options.dryRun !== false; // ★ 기본값은 반드시 true
  var search = String(options.customerSearch || "").trim();

  function fail(message) {
    console.error("[레거시 차량 복구] " + message);
    return { success:false, dryRun: dryRun, message: message };
  }

  if (!search) return fail("customerSearch(고객명/법인명/연락처/customerId)가 필요합니다.");

  var cs = getCustomerSheet();
  var vs = getVehicleSheet();
  var customers = readCustomersForDiagnosis(cs);
  var matches = _searchLegacyCustomers(customers, search);

  if (matches.length === 0) return fail("'" + search + "'로 검색된 고객이 없습니다.");
  if (matches.length > 1) {
    var names = matches.map(function(c){ return (c.customerName||"이름없음") + "(행 " + c._rowNumber + ")"; }).join(", ");
    return fail("'" + search + "'로 " + matches.length + "명이 검색되어 대상을 특정할 수 없습니다: " + names);
  }

  var c = matches[0];
  var cid = c.customerId || "";

  // ── 차량 생성 조건 검증 (모호하면 생성하지 않고 오류) ────────
  if (!cid) return fail((c.customerName||"해당 고객") + " 고객에게 customerId가 없습니다. 먼저 고객을 저장/수정해 customerId를 발급한 뒤 다시 시도해주세요.");

  var dupCount = countCustomerIdOccurrences(cs, cid);
  if (dupCount !== 1) return fail("customerId " + cid + "가 고객관리 시트에서 정확히 1행과 연결되지 않습니다(연결된 행 수: " + dupCount + ").");

  var existingVehicles = getVehiclesByCustomerId(vs, cid);
  if (existingVehicles.length > 0) return fail((c.customerName||"해당 고객") + " 고객은 이미 구매차량 행이 " + existingVehicles.length + "개 있어 레거시 복구 대상이 아닙니다.");

  var hasLegacyVehicle = !!(c.modelName || c.contractDate || c.deliveryDate);
  if (!hasLegacyVehicle) return fail((c.customerName||"해당 고객") + " 고객에게는 대표차량 정보(모델명/계약일/출고일)가 전혀 없어 생성할 차량 정보가 없습니다.");

  var allVehicles = readAllVehicles(vs);
  var key = makeVehicleMigrationKey(cid, c.modelName, c.detailModel, c.contractDate, c.deliveryDate);
  var dupVehicle = allVehicles.some(function(v){
    return makeVehicleMigrationKey(v.customerId, v.modelName, v.detailModel, v.contractDate, v.deliveryDate) === key;
  });
  if (dupVehicle) return fail("동일한 모델명·세부모델·계약일·출고일의 차량이 이미 구매차량 시트에 존재합니다. 중복 생성 방지를 위해 중단합니다.");

  var nowStr = fmtDate(new Date());
  var newVehicleId = genVehicleId();
  var dd = fmtDate(c.deliveryDate || "");
  var dm = c.deliveryMonth || (dd && dd.length >= 7 ? dd.substring(0,7) : "");
  var vehicleStatus = determineLegacyVehicleStatus(c);

  var preview = {
    대상고객: c.customerName || "",
    고객ID: cid,
    발급예정vehicleId: newVehicleId,
    모델명: c.modelName || "",
    세부모델: c.detailModel || "",
    구매방식: c.purchaseMethod || "",
    차량상태: vehicleStatus,
    계약일: fmtDate(c.contractDate || ""),
    출고일: dd,
    출고월: dm,
    수량: 1,
    중복여부: false,
    실제수정예정시트: "구매차량"
  };

  console.log("[레거시 차량 복구 - " + (dryRun ? "DRY RUN(미리보기, 데이터 변경 없음)" : "실제 실행") + "]", preview);

  if (dryRun) {
    return { success:true, dryRun:true, preview: preview };
  }

  // ★ 실제 저장 — 직접 배열 컬럼 순서를 새로 작성하지 않고, 기존 공통 저장
  //   함수 saveVehiclesToSheet()를 그대로 재사용한다(요청사항 8). 향후
  //   구매차량 시트 컬럼 구조가 바뀌어도 이 함수를 별도로 고칠 필요가 없다.
  saveVehiclesToSheet(vs, cid, c.customerName || "", c.phone || "", [{
    vehicleId: newVehicleId,
    modelName: c.modelName || "",
    detailModel: c.detailModel || "",
    purchaseMethod: c.purchaseMethod || "",
    vehicleStatus: vehicleStatus,
    contractDate: c.contractDate || "",
    deliveryDate: c.deliveryDate || "",
    deliveryMonth: dm,
    quantity: 1,
    memo: ""
  }], nowStr);

  SpreadsheetApp.flush();

  var verify = getVehiclesByCustomerId(vs, cid);
  console.log("[레거시 차량 복구 완료]", { customerId: cid, createdVehicleId: newVehicleId, verifyCount: verify.length });

  return { success:true, dryRun:false, created: preview, verifyVehicleCount: verify.length };
}

// ── 전체 고객 대상 읽기 전용 진단(자동 수정 없음) ────────────────
// 사용 예: diagnoseAllLegacyVehiclesForDocuments();
function diagnoseAllLegacyVehiclesForDocuments() {
  var cs = getCustomerSheet();
  var vs = getVehicleSheet();
  var customers = readCustomersForDiagnosis(cs);
  var vehicles = readAllVehicles(vs);

  var vehCountByCustomer = {};
  vehicles.forEach(function(v) {
    if (!v.customerId) return;
    vehCountByCustomer[v.customerId] = (vehCountByCustomer[v.customerId] || 0) + 1;
  });
  var cidCounts = {};
  customers.forEach(function(c) {
    if (c.customerId) cidCounts[c.customerId] = (cidCounts[c.customerId] || 0) + 1;
  });

  var affected = [];
  customers.forEach(function(c) {
    var cid = c.customerId || "";
    var vehCount = cid ? (vehCountByCustomer[cid] || 0) : 0;
    var hasLegacyVehicle = !!(c.modelName || c.contractDate || c.deliveryDate);
    if (!hasLegacyVehicle || vehCount > 0) return;

    var reason = !cid
      ? "customerId가 없습니다(고객을 먼저 저장/수정해 customerId를 발급해야 합니다)."
      : "구매차량 탭에 차량 행이 없어 문서관리를 사용할 수 없습니다.";

    affected.push({
      고객ID: cid || ("(없음, 표시용:" + c._suggestedCustomerId + ")"),
      고객명: c.customerName || "",
      모델명: c.modelName || "",
      세부모델: c.detailModel || "",
      계약일: c.contractDate || "",
      출고일: c.deliveryDate || "",
      차량상태: determineLegacyVehicleStatus(c),
      문서관리불가능사유: reason,
      중복위험여부: cid ? (cidCounts[cid] > 1) : false
    });
  });

  var result = {
    전체고객수: customers.length,
    구매차량없는기존차량고객수: affected.length,
    대상목록: affected
  };
  console.log("[전체 레거시 차량 진단] 전체고객수=" + result.전체고객수 + " / 대상수=" + affected.length);
  affected.forEach(function(a) { console.log(a); });
  return result;
}

// ============================================================
// ★ 고객ID 중복 방지 및 연결 무결성 강화
//   고객ID 중복 진단 함수 — Apps Script 편집기에서 관리자가 직접 실행.
//   데이터를 전혀 수정하지 않는 읽기 전용 진단이다.
//
//   실행 방법: Apps Script 편집기에서 diagnoseDuplicateCustomerIds 함수를
//   선택한 뒤 ▶ 실행. 실행 로그(보기 → 로그)에서 결과를 확인한다.
// ============================================================
function diagnoseDuplicateCustomerIds() {
  var cs = getCustomerSheet();
  var vs = getVehicleSheet();
  var cData = cs.getDataRange().getValues();
  var vData = vs.getDataRange().getValues();

  if (cData.length <= 1) {
    console.log("[고객ID 중복 진단] 고객 데이터가 없습니다.");
    return { duplicateCount: 0, duplicates: [] };
  }

  var header = cData[0].map(function(h){ return String(h||"").trim(); });
  var cidCol = -1, nameCol = -1, phoneCol = -1, companyCol = -1;
  for (var i = 0; i < header.length; i++) {
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (mapped === "customerId")   cidCol = i;
    if (mapped === "customerName") nameCol = i;
    if (mapped === "phone")        phoneCol = i;
    if (mapped === "companyName")  companyCol = i;
  }

  if (cidCol < 0) {
    console.log("[고객ID 중복 진단] customerId 컬럼을 찾을 수 없습니다.");
    return { duplicateCount: 0, duplicates: [] };
  }

  var byId = {};
  for (var r = 1; r < cData.length; r++) {
    var row = cData[r];
    var cid = String(row[cidCol] || "").trim();
    if (!cid) continue;
    if (!byId[cid]) byId[cid] = [];
    byId[cid].push({
      row: r + 1,
      name: nameCol    >= 0 ? String(row[nameCol]    || "") : "",
      phone: phoneCol   >= 0 ? String(row[phoneCol]   || "") : "",
      companyName: companyCol >= 0 ? String(row[companyCol] || "") : ""
    });
  }

  // 구매차량 시트에서 customerId별로 연결된 행 목록 집계(B열 = 고객ID).
  var vehByCid = {};
  if (vData.length > 1) {
    for (var vr = 1; vr < vData.length; vr++) {
      var vcid = String(vData[vr][1] || "").trim();
      if (!vcid) continue;
      if (!vehByCid[vcid]) vehByCid[vcid] = [];
      vehByCid[vcid].push({ row: vr + 1, name: String(vData[vr][2] || "") });
    }
  }

  var duplicates = [];
  Object.keys(byId).forEach(function(cid){
    if (byId[cid].length > 1) {
      duplicates.push({
        customerId: cid,
        customers: byId[cid],
        vehicleRows: vehByCid[cid] || []
      });
    }
  });

  console.log("[고객ID 중복 진단] 총 " + duplicates.length + "개의 중복 고객ID 발견");
  duplicates.forEach(function(d){ console.log(JSON.stringify(d)); });
  if (duplicates.length === 0) console.log("[고객ID 중복 진단] 중복이 발견되지 않았습니다.");

  return { duplicateCount: duplicates.length, duplicates: duplicates };
}

// ============================================================
// ★ 고객ID 중복 방지 및 연결 무결성 강화
//   이번에 실제로 확인된 특정 중복 건만 정확히 복구하는 함수.
//   - 서경원(CUST-0197), 심흥섭(CUST-0198)은 절대 변경하지 않는다.
//   - 서민수(현재 CUST-0197 공유), 정정희(현재 CUST-0198 공유)만
//     고객명+연락처가 완전히 일치할 때만 새 고유 ID로 교체한다.
//   - 구매차량 시트는 전혀 건드리지 않는다(서민수/정정희는 현재 연결된
//     차량 행이 없으므로 고객관리 시트의 고객ID 칸만 바꾸면 된다).
//   - 이미 교체된 상태에서 다시 실행해도 조건에 걸리지 않으므로
//     중복 변경되지 않는다(멱등성).
//   - 페이지 로드 시 자동실행되지 않으며, 관리자가 Apps Script 편집기에서
//     함수를 선택해 직접 ▶ 실행해야 한다.
// ============================================================
function repairKnownDuplicateCustomerIds() {
  var cs = getCustomerSheet();
  var cData = cs.getDataRange().getValues();
  if (cData.length <= 1) {
    console.log("[중복 고객ID 복구] 고객 데이터가 없습니다.");
    return { changed: [], skipped: [] };
  }

  var header = cData[0].map(function(h){ return String(h||"").trim(); });
  var cidCol = -1, nameCol = -1, phoneCol = -1;
  for (var i = 0; i < header.length; i++) {
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (mapped === "customerId")   cidCol = i;
    if (mapped === "customerName") nameCol = i;
    if (mapped === "phone")        phoneCol = i;
  }
  if (cidCol < 0 || nameCol < 0 || phoneCol < 0) {
    throw new Error("고객ID/고객명/연락처 컬럼을 찾을 수 없어 복구를 중단했습니다.");
  }

  // 이번에 확인된 중복 건만 정확히 지정한다 — 고객명 + 연락처가 완전히
  // 일치하는 행만 대상이 되며, 그 외 어떤 행도 변경하지 않는다.
  var targets = [
    { name: "서민수", phone: "010-6449-6475", oldCustomerId: "CUST-0197" },
    { name: "정정희", phone: "010-7292-4992", oldCustomerId: "CUST-0198" }
  ];

  var changed = [];
  var skipped = [];

  targets.forEach(function(t){
    var normTargetPhone = String(t.phone || "").replace(/\D/g, "");
    var matchRow = -1, matchCid = "";
    for (var r = 1; r < cData.length; r++) {
      var row = cData[r];
      var rowName  = String(row[nameCol]  || "").trim();
      var rowPhone = String(row[phoneCol] || "").replace(/\D/g, "");
      if (rowName === t.name && rowPhone === normTargetPhone) {
        matchRow = r + 1;
        matchCid = String(row[cidCol] || "").trim();
        break;
      }
    }

    if (matchRow < 0) {
      skipped.push({ name: t.name, phone: t.phone, reason: "고객명+연락처가 정확히 일치하는 행을 찾지 못했습니다." });
      return;
    }

    if (matchCid !== t.oldCustomerId) {
      // 이미 다른 ID로 바뀌어 있으면(재실행 등) 다시 건드리지 않는다 — 멱등성 보장.
      skipped.push({
        name: t.name, phone: t.phone, row: matchRow,
        reason: "이미 " + (matchCid || "(빈 값)") + "(으)로 되어 있어 재변경하지 않았습니다."
      });
      return;
    }

    var newCid = generateUniqueCustomerId(cs);
    cs.getRange(matchRow, cidCol + 1).setValue(newCid);
    changed.push({ name: t.name, phone: t.phone, row: matchRow, oldCustomerId: t.oldCustomerId, newCustomerId: newCid });
    console.log("[중복 고객ID 복구] " + t.name + "(행 " + matchRow + ") " + t.oldCustomerId + " → " + newCid);

    // 이후 대상 검색이 방금 바뀐 상태를 반영하도록 메모리상 데이터도 갱신.
    cData[matchRow - 1][cidCol] = newCid;
  });

  console.log("[중복 고객ID 복구 완료]", JSON.stringify({ changed: changed, skipped: skipped }));
  return { changed: changed, skipped: skipped };
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "list";
  if (action === "list") return handleList();
  // ★ 고객 저장속도 최적화 — 저장확인 전용 경량 API (요청사항 4, 5, 6)
  if (action === "getCustomerByRequestToken") return handleGetCustomerByRequestToken(e.parameter);
  if (action === "getCustomerById")            return handleGetCustomerById(e.parameter);
  // ★ 저장확인 API 404 오판정 수정 — 현재 배포가 저장확인 API를 지원하는지
  //   프론트가 페이지 로딩 시 1회 확인할 수 있는 경량 엔드포인트 (요청사항 6)
  if (action === "serverInfo") return handleServerInfo();
  // ★ 고객 입력 자동저장(Draft) — 경량 GET 액션 2개 (요청사항 43, 82)
  if (action === "getAutosaveStatus") return handleGetAutosaveStatus(e.parameter);
  if (action === "getEditDraft")      return handleGetEditDraft(e.parameter);
  // ★ Google Drive 고객·구매차량 문서관리 추가 — 문서 조회는 GET으로도 허용
  if (action === "listCustomerDocuments") return handleListCustomerDocuments(e.parameter);
  if (action === "listVehicleDocuments")  return handleListVehicleDocuments(e.parameter);
  if (action === "documentSummary")       return handleDocumentSummary(e.parameter);
  return jsonResp({success:false, message:"Unknown action: "+action});
}

function handleList() {
  try {
    var allSheetNames = SS.getSheets().map(function(s){return s.getName();});
    console.log("[시트 목록]", JSON.stringify(allSheetNames));

    var cs = getCustomerSheet();
    var vs = getVehicleSheet();
    var cData  = cs.getDataRange().getValues();
    var vData  = vs.getDataRange().getValues();
    var vMemoCol = ensureVehicleMemoColumn(vs); // ★ v37: 메모 컬럼(1-based)

    console.log("[CUSTOMER SHEET]", cs.getSheetId(), cs.getName(), cs.getLastRow(), cs.getLastColumn());

    if (cData.length <= 1) {
      return jsonResp({
        success: true, customers: [], serverVersion: SERVER_VERSION,
        debug: {
          serverVersion: SERVER_VERSION,
          spreadsheetName: SS.getName(),
          customerSheetName: cs.getName(),
          customerSheetLastRow: cs.getLastRow(),
          customerSheetLastColumn: cs.getLastColumn(),
          rawDataRows: cData.length,
          returnedCustomers: 0,
          headers: cData.length > 0 ? cData[0].map(String) : [],
          allSheets: allSheetNames
        }
      });
    }

    var rawHeader = cData[0].map(function(h){ return String(h||"").trim(); });
    var mappedCols = rawHeader.map(function(h){ return HEADER_MAP[h] || null; });

    console.log("[헤더 원본]", JSON.stringify(rawHeader));
    console.log("[헤더 매핑]", JSON.stringify(mappedCols));

    var custIdColIdx = -1;
    for (var ci = 0; ci < mappedCols.length; ci++) {
      if (mappedCols[ci] === "customerId") { custIdColIdx = ci; break; }
    }

    var vehMap = {};
    var skippedVehicleRows = 0;
    if (vData.length > 1) {
      for (var vi = 1; vi < vData.length; vi++) {
        var vr = vData[vi];
        var vcid = String(vr[1]||"").trim();
        if (!vcid) { skippedVehicleRows++; continue; }
        if (!vehMap[vcid]) vehMap[vcid] = [];
        var dd = fmtDate(vr[9]);
        var dm = String(vr[10]||"").trim();
        if (!dm && dd && dd.length >= 7) dm = dd.substring(0,7);
        vehMap[vcid].push({
          vehicleId:      String(vr[0]||"").trim(),
          modelName:      String(vr[4]||"").trim(),
          detailModel:    String(vr[5]||"").trim(),
          purchaseMethod: String(vr[6]||"").trim(),
          vehicleStatus:  String(vr[7]||"").trim(),
          contractDate:   fmtDate(vr[8]),
          deliveryDate:   dd,
          deliveryMonth:  dm,
          quantity:       Math.max(1, parseInt(vr[11],10)||1),
          memo:           String(vr[vMemoCol-1]||"").trim() // ★ v37: 위치 기반 14개 컬럼과 별도로 조회
        });
      }
    }
    if (skippedVehicleRows > 0) {
      console.warn("[구매차량 시트] 고객ID가 비어있어 건너뛴 행 수:", skippedVehicleRows);
    }

    var customers = [];
    for (var i = 1; i < cData.length; i++) {
      var row = cData[i];
      var obj = {};

      for (var j = 0; j < mappedCols.length; j++) {
        var key = mappedCols[j];
        if (!key) continue;
        var val = row[j];
        if (DATE_FIELDS[key]) {
          val = fmtDate(val);
        } else {
          val = (val === null || val === undefined) ? "" : String(val);
        }
        obj[key] = val;
      }

      obj._rowNumber = i + 1;

      if (!obj.customerId) {
        obj.customerId = legacyRowBasedCustomerId(i + 1); // ★ 고객ID 중복 방지 및 연결 무결성 강화 — 목록 표시 전용, 시트에 기록하지 않음
      }

      if (!obj.deliveryMonth && obj.deliveryDate && obj.deliveryDate.length >= 7) {
        obj.deliveryMonth = obj.deliveryDate.substring(0,7);
      }

      if (!obj.customerName && !obj.phone) continue;

      obj.vehicles = vehMap[obj.customerId] || [];

      customers.push(obj);
    }

    console.log("[반환 고객 수]", customers.length);

    return jsonResp({
      success: true,
      customers: customers,
      serverVersion: SERVER_VERSION,
      debug: {
        serverVersion: SERVER_VERSION,
        spreadsheetName: SS.getName(),
        customerSheetName: cs.getName(),
        customerSheetLastRow: cs.getLastRow(),
        customerSheetLastColumn: cs.getLastColumn(),
        rawDataRows: cData.length,
        returnedCustomers: customers.length,
        headers: rawHeader,
        mappedHeaders: mappedCols,
        skippedVehicleRows: skippedVehicleRows,
        allSheets: allSheetNames
      }
    });

  } catch (err) {
    console.error("[handleList 오류]", err.message);
    return jsonResp({success:false, message:err.message, serverVersion: SERVER_VERSION});
  }
}

// ============================================================
// ★ 고객 저장속도 최적화 — 저장확인 전용 경량 API (code107)
//
//   기존 handleList()는 전체 고객(200명 이상)을 매번 object로 만들어
//   반환하므로 "저장됐는지 확인"이라는 목적에는 훨씬 무겁다. 아래 함수는
//   고객 시트를 한 번만 읽고, 조건에 맞는 "고객 1명"만 만들어 반환한다.
//   handleList()는 전혀 건드리지 않았으므로 기존 전체 동기화(syncFromSheet)
//   동작은 완전히 그대로다.
// ============================================================

// customerId → requestToken → phone 순으로 저장확인 대상 고객 1명을 찾는다.
// 시트를 한 번만 읽고, 필요한 컬럼 인덱스도 한 번만 계산한다.
function findCustomerForSaveConfirmation(params) {
  var cs = getCustomerSheet();
  var data = cs.getDataRange().getValues();
  if (data.length <= 1) return null;

  var header = data[0].map(function(h){ return String(h||"").trim(); });
  var colIdx = {};
  for (var i = 0; i < header.length; i++) {
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (colIdx[mapped] === undefined) colIdx[mapped] = i;
  }

  function cell(row, key) {
    var idx = colIdx[key];
    if (idx === undefined) return "";
    var v = row[idx];
    if (v === null || v === undefined) return "";
    return DATE_FIELDS[key] ? fmtDate(v) : String(v);
  }

  var targetCustomerId   = String(params.customerId   || "").trim();
  var targetRequestToken = String(params.requestToken || "").trim();
  var targetPhoneNorm    = String(params.phone || "").replace(/\D/g, "");

  var matchRow = -1, matchRowNum = -1;
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var cid = cell(row, "customerId");
    var rt  = cell(row, "requestToken");

    if (targetCustomerId && cid === targetCustomerId) { matchRow = r; matchRowNum = r + 1; break; }
    if (!targetCustomerId && targetRequestToken && rt === targetRequestToken) { matchRow = r; matchRowNum = r + 1; break; }
    if (!targetCustomerId && !targetRequestToken && targetPhoneNorm &&
        String(cell(row, "phone")||"").replace(/\D/g,"") === targetPhoneNorm) {
      matchRow = r; matchRowNum = r + 1;
      break;
    }
  }

  if (matchRow < 0) return null;

  var row = data[matchRow];
  var obj = {
    customerId:    cell(row, "customerId") || legacyRowBasedCustomerId(matchRowNum),
    customerName:  cell(row, "customerName"),
    companyName:   cell(row, "companyName"),
    phone:         cell(row, "phone"),
    status:        cell(row, "status"),
    leadSource:    cell(row, "leadSource"),
    nextContact:   cell(row, "nextContact"),
    consultation:  cell(row, "consultation"),
    memo:          cell(row, "memo"),
    lastActivityAt:cell(row, "lastActivityAt"),
    _savedAt:      cell(row, "_savedAt"),
    _updatedAt:    cell(row, "_updatedAt"),
    requestToken:  cell(row, "requestToken"),
    manualCreatedDate: cell(row, "manualCreatedDate"),
    _rowNumber:    matchRowNum
  };
  return obj;
}

// ★ 저장확인 실패는 POST 저장 실패를 의미하지 않는다.
//   (프론트 쪽 원칙) 저장확인 오류(이 API의 HTTP 오류 포함) 발생 시
//   POST를 절대 자동 재전송하지 않는다 — 이 API가 404/5xx를 반환해도
//   서버는 아무 것도 하지 않으며, handleNew()의 저장 로직에는 전혀
//   영향을 주지 않는다(완전히 독립된 읽기 전용 GET).
// 신규등록 저장확인 — requestToken 기준. 고객 1명만 반환한다(요청사항 4, 5).
function handleGetCustomerByRequestToken(p) {
  var t0 = Date.now();
  try {
    var requestToken = String((p && p.requestToken) || "").trim();
    if (!requestToken) {
      return jsonResp({ success:false, message:"requestToken이 필요합니다.", serverVersion: SERVER_VERSION });
    }
    var customer = findCustomerForSaveConfirmation({ requestToken: requestToken });
    console.log("[getCustomerByRequestToken] " + (Date.now()-t0) + "ms found=" + !!customer);
    if (!customer) {
      return jsonResp({ success:true, found:false, serverVersion: SERVER_VERSION });
    }
    return jsonResp({ success:true, found:true, customer: customer, serverVersion: SERVER_VERSION });
  } catch (err) {
    console.error("[handleGetCustomerByRequestToken 오류]", err.message);
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  }
}

// 수정저장 저장확인 — customerId 기준. 해당 고객의 vehicles도 함께 반환한다(요청사항 4, 6).
function handleGetCustomerById(p) {
  var t0 = Date.now();
  try {
    var customerId = String((p && p.customerId) || "").trim();
    if (!customerId) {
      return jsonResp({ success:false, message:"customerId가 필요합니다.", serverVersion: SERVER_VERSION });
    }
    var customer = findCustomerForSaveConfirmation({ customerId: customerId });
    var tCust = Date.now();
    if (!customer) {
      console.log("[getCustomerById] " + (tCust-t0) + "ms found=false");
      return jsonResp({ success:true, found:false, serverVersion: SERVER_VERSION });
    }
    var vs = getVehicleSheet();
    customer.vehicles = getVehiclesByCustomerId(vs, customerId);
    var tVeh = Date.now();
    console.log("[getCustomerById] 고객:" + (tCust-t0) + "ms 차량:" + (tVeh-tCust) + "ms found=true vehicles=" + customer.vehicles.length);
    return jsonResp({ success:true, found:true, customer: customer, serverVersion: SERVER_VERSION });
  } catch (err) {
    console.error("[handleGetCustomerById 오류]", err.message);
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  }
}

// ── 저장확인 API 배포 상태 확인 (요청사항 6, 7) ──────────────
//   읽기 전용, 시트를 전혀 읽지 않는다 — 순수하게 "이 배포가 최신
//   Code.gs로 갱신되어 저장확인 API를 지원하는지"만 알려준다.
function handleServerInfo() {
  return jsonResp({
    success: true,
    serverVersion: SERVER_VERSION,
    features: {
      getCustomerByRequestToken: true,
      getCustomerById: true,
      saveOptimization: true,
      serverInfo: true,
      autosave: true,
      autosaveDraft: true,
      getAutosaveStatus: true,
      getEditDraft: true,
      deleteDraft: true,
      setDraftStatus: true
    }
  });
}

// ── 성능 진단 (읽기 전용, 실제 저장 없음) — 요청사항 29 ──────
function diagnoseSavePerformance() {
  var result = {};
  var t;

  t = Date.now();
  var cs = getCustomerSheet();
  var cData = cs.getDataRange().getValues();
  result.customerSheetReadMs = Date.now() - t;
  result.customerCount = Math.max(0, cData.length - 1);

  t = Date.now();
  var vs = getVehicleSheet();
  var vData = vs.getDataRange().getValues();
  result.vehicleSheetReadMs = Date.now() - t;
  result.vehicleRowCount = Math.max(0, vData.length - 1);

  t = Date.now();
  var idSet = buildCustomerIdSet(cs);
  result.customerIdIndexBuildMs = Date.now() - t;
  result.customerIdIndexSize = Object.keys(idSet).length;

  t = Date.now();
  var vehByCustomer = {};
  for (var i = 1; i < vData.length; i++) {
    var cid = String(vData[i][1] || "").trim();
    if (!cid) continue;
    vehByCustomer[cid] = (vehByCustomer[cid] || 0) + 1;
  }
  result.vehicleIndexBuildMs = Date.now() - t;
  result.vehicleIndexSize = Object.keys(vehByCustomer).length;

  t = Date.now();
  var calendarOk = false, calendarMs = -1;
  try {
    CalendarApp.getDefaultCalendar().getName();
    calendarOk = true;
  } catch (e) { calendarOk = false; }
  calendarMs = Date.now() - t;
  result.calendarConnectMs = calendarMs;
  result.calendarOk = calendarOk;

  result.serverVersion = SERVER_VERSION;
  console.log("[diagnoseSavePerformance]", JSON.stringify(result));
  return result;
}

// ============================================================
// ★ 저장확인 API 404 오판정 수정 — 이번 사례 진단 함수 (요청사항 11)
//
//   "화면에는 저장 실패로 표시됐지만 실제로는 정상 저장된 고객"을
//   관리자가 직접 확인할 수 있도록 최근 N분 안에 등록/수정된 고객을
//   조회한다. 읽기 전용 — 데이터를 전혀 수정하지 않는다.
//
//   사용 예 (Apps Script 편집기에서 직접 실행):
//     diagnoseRecentNewCustomers(30)   // 최근 30분
//
//   판정 기준: _savedAt 또는 _updatedAt이 "지금 - minutes분" 이후인 행.
//   두 값 모두 사람이 읽는 날짜 문자열(YYYY-MM-DD)이라 분 단위 정밀도가
//   없으므로, 오늘 날짜인 행만 우선 후보로 삼고 requestToken이 있는(즉
//   최근 신규등록 흐름을 거친) 행을 상단에 표시한다 — 완벽한 분 단위
//   필터링이 아니라 "최근 저장분을 빠르게 훑어보는" 용도임을 감안한다.
// ============================================================
function diagnoseRecentNewCustomers(minutes) {
  minutes = minutes || 30;
  var cs = getCustomerSheet();
  var data = cs.getDataRange().getValues();
  if (data.length <= 1) {
    console.log("[diagnoseRecentNewCustomers] 고객 데이터가 없습니다.");
    return { count: 0, customers: [] };
  }

  var header = data[0].map(function(h){ return String(h||"").trim(); });
  var colIdx = {};
  for (var i = 0; i < header.length; i++) {
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (colIdx[mapped] === undefined) colIdx[mapped] = i;
  }

  function cell(row, key) {
    var idx = colIdx[key];
    if (idx === undefined) return "";
    var v = row[idx];
    if (v === null || v === undefined) return "";
    return DATE_FIELDS[key] ? fmtDate(v) : String(v);
  }

  var todayStr = fmtDate(new Date());
  var results = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var savedAt = cell(row, "_savedAt");
    var updatedAt = cell(row, "_updatedAt");
    // _savedAt/_updatedAt은 날짜만(시분 없음) 저장되므로, 오늘 날짜인 행만
    // 후보로 본다 — "최근 N분"의 근사치다.
    if (savedAt !== todayStr && updatedAt !== todayStr) continue;

    results.push({
      rowNumber: r + 1,
      customerName: cell(row, "customerName"),
      phone: cell(row, "phone"),
      customerId: cell(row, "customerId") || legacyRowBasedCustomerId(r + 1),
      requestToken: cell(row, "requestToken"),
      _savedAt: savedAt,
      _updatedAt: updatedAt
    });
  }

  // requestToken이 있는(= 신규등록 흐름을 거친) 행을 위로 정렬
  results.sort(function(a, b) {
    var aHas = a.requestToken ? 1 : 0;
    var bHas = b.requestToken ? 1 : 0;
    return bHas - aHas;
  });

  var report = { minutes: minutes, note: "_savedAt/_updatedAt은 날짜 단위라 '오늘' 등록/수정된 행을 근사치로 보여줍니다.", count: results.length, customers: results };
  console.log("[diagnoseRecentNewCustomers] 오늘 등록/수정 " + results.length + "건");
  results.forEach(function(c) { console.log(c); });
  return report;
}

// ============================================================
// doPost — action:"new" / "editCustomer" / "update" / "deleteCustomer"
//          / ★ 문서관리 액션 추가
// ============================================================

// ============================================================
// ★ 등록일 미확인 고객 수동 입력 기능 추가
//   POST action:"setManualCreatedDate" { customerId, phone, manualCreatedDate }
//   고객관리 시트의 manualCreatedDate 한 칸만 수정한다.
// ============================================================
function handleSetManualCreatedDate(p) {
  var value = String((p.manualCreatedDate === undefined || p.manualCreatedDate === null) ? "" : p.manualCreatedDate).trim();
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return jsonResp({ success:false, message:"manualCreatedDate 형식이 올바르지 않습니다(YYYY-MM-DD).", serverVersion: SERVER_VERSION });
  }

  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(10000);
  if (!gotLock) {
    return jsonResp({ success:false, message:"다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.", serverVersion: SERVER_VERSION });
  }
  try {
    var cs = getCustomerSheet();
    var target = findCustomerRow(cs, p);
    if (!target) {
      return jsonResp({ success:false, message:"고객을 찾을 수 없습니다.", serverVersion: SERVER_VERSION });
    }
    var col = ensureColumn(cs, "manualCreatedDate");
    cs.getRange(target.rowNum, col).setValue(value);
    return jsonResp({
      success: true,
      customerId: target.customerId,
      manualCreatedDate: value,
      serverVersion: SERVER_VERSION
    });
  } catch (err) {
    console.error("[handleSetManualCreatedDate 오류]", err.message);
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("POST 데이터가 없습니다.");
    }

    var body = JSON.parse(e.postData.contents);

    if (body.action === "new")            return handleNew(body);
    if (body.action === "editCustomer")   return handleEdit(body);
    if (body.action === "update")         return handleUpdate(body);
    if (body.action === "deleteCustomer") return handleDeleteCustomer(body);
    if (body.action === "setManualCreatedDate") return handleSetManualCreatedDate(body);

    // ★ 고객 입력 자동저장(Draft) — 요청사항 33
    if (body.action === "autosaveDraft")  return handleAutosaveDraft(body);
    if (body.action === "deleteDraft")    return handleDeleteDraft(body);
    if (body.action === "setDraftStatus") return handleSetDraftStatus(body);

    // ★ Google Drive 고객·구매차량 문서관리 추가 ────────────────
    if (body.action === "listCustomerDocuments")   return handleListCustomerDocuments(body);
    if (body.action === "listVehicleDocuments")    return handleListVehicleDocuments(body);
    if (body.action === "uploadDocument")          return handleUploadDocument(body);
    if (body.action === "registerDriveDocumentLink") return handleRegisterDriveDocumentLink(body);
    if (body.action === "replaceDocument")         return handleReplaceDocument(body);
    if (body.action === "deleteDocument")          return handleDeleteDocument(body);
    if (body.action === "getDocumentFolder")       return handleGetDocumentFolder(body);
    if (body.action === "createDocumentFolders")   return handleCreateDocumentFolders(body);
    if (body.action === "documentSummary")         return handleDocumentSummary(body);

    throw new Error("지원하지 않는 action: " + body.action);

  } catch (err) {
    console.error("[doPost 오류]", err.stack || err.message);
    return jsonResp({
      success: false,
      message: err.message || "알 수 없는 서버 오류",
      serverVersion: SERVER_VERSION
    });
  }
}

// ── 신규 고객 저장 ──────────────────────────────────────────
function handleNew(p) {
  var __t0 = Date.now(); // ★ code107 성능 로그
  console.log("[handleNew 시작]", JSON.stringify(p));

  var cs = getCustomerSheet();
  console.log("[CUSTOMER SHEET]", cs.getSheetId(), cs.getName(), cs.getLastRow(), cs.getLastColumn());

  var now = new Date();
  var nowStr = fmtDate(now);

  var cidCol = ensureCustomerIdColumn(cs);
  var reqCol = ensureColumn(cs, "requestToken");
  SpreadsheetApp.flush();
  console.log("[customerId 컬럼]", cidCol, "[requestToken 컬럼]", reqCol);

  var expectedColCount = cs.getLastColumn();
  var newRow = buildRowByHeader(cs, p, now, true); // 신규등록: 최초 등록일 생성 허용
  console.log("[저장 행 길이]", newRow.length, "[시트 열 수]", expectedColCount);
  console.log("[고객 시트 헤더]", JSON.stringify(
    cs.getRange(1, 1, 1, expectedColCount).getDisplayValues()[0]
  ));
  console.log("[신규 저장 행]", JSON.stringify(newRow));

  if (newRow.length !== expectedColCount) {
    throw new Error(
      "저장행 길이 불일치: " + newRow.length + " / " + expectedColCount
    );
  }

  // ★ 고객ID 중복 방지 및 연결 무결성 강화 — 프론트엔드가 이미 customerId를
  //   함께 보낸 경우(정상적인 신규 등록에서는 드묾) 저장 전에 다른 고객이
  //   이미 쓰고 있는 ID인지 먼저 확인한다. 여기서 걸리면 행을 추가하지 않고
  //   즉시 중단해 중복 저장을 원천 차단한다.
  if (p.customerId && customerIdExists(cs, p.customerId)) {
    throw new Error(
      "고객ID " + p.customerId + "가 이미 사용 중이어서 신규 저장을 중단했습니다. 관리자에게 문의해주세요."
    );
  }

  // ★ 고객ID 중복 방지 및 연결 무결성 강화 — 시트 append와 ID 발급/기록을
  //   LockService로 묶어, 여러 저장 요청이 동시에 들어와도 같은 ID가
  //   중복 발급되지 않게 한다.
  var newRowNum, customerId;
  var idLock = LockService.getScriptLock();
  try {
    var gotIdLock = idLock.tryLock(10000);
    if (!gotIdLock) {
      throw new Error("다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.");
    }

    cs.appendRow(newRow);
    newRowNum = cs.getLastRow();

    // ★ 고객ID 중복 방지 및 연결 무결성 강화 — 더 이상 행번호 기반으로 ID를
    //   만들지 않는다. generateUniqueCustomerId()는 UUID를 생성한 뒤 시트
    //   전체를 다시 스캔해 중복이 없을 때까지 재시도한다.
    customerId = p.customerId || generateUniqueCustomerId(cs);
    cs.getRange(newRowNum, cidCol).setValue(customerId);
  } finally {
    try { idLock.releaseLock(); } catch (ignore) {}
  }

  var __tSheetSaved = Date.now(); // ★ code107 성능 로그

  var vehicles = Array.isArray(p.vehicles) ? p.vehicles : [];
  var savedVehicles = [];
  if (vehicles.length > 0) {
    var vs = getVehicleSheet();
    // ★ 고객ID 중복 방지 및 연결 무결성 강화 — 구매차량을 저장하기 직전,
    //   이 customerId가 고객관리 시트에서 정확히 1행에만 연결되는지 다시 한 번
    //   확인한다. 0행(연결 안 됨)이거나 2행 이상(중복)이면 저장을 중단한다.
    var linkCount = countCustomerIdOccurrences(cs, customerId);
    if (linkCount !== 1) {
      throw new Error(
        "고객ID " + customerId + "가 고객관리 시트에서 정확히 1행과 연결되지 않아" +
        "(연결된 행 수: " + linkCount + ") 구매차량 저장을 중단했습니다."
      );
    }
    saveVehiclesToSheet(vs, customerId, p.customerName||"", p.phone||"", vehicles, nowStr);
    savedVehicles = getVehiclesByCustomerId(vs, customerId);
  }

  var __tVehiclesSaved = Date.now(); // ★ code107 성능 로그

  SpreadsheetApp.flush();

  var __tFlush = Date.now(); // ★ code107 성능 로그

  // ── 다음연락일 → Google Calendar 동기화 ───────────────────
  // 캘린더 연동이 실패해도 위의 고객/차량 저장은 이미 완료된 뒤이므로
  // 절대 영향을 주지 않는다 (별도 try/catch로 격리).
  try {
    syncNextContactCalendarEvent({
      customerId: customerId,
      customerName: p.customerName || "",
      phone: p.phone || "",
      companyName: p.companyName || "",
      nextContact: p.nextContact || "",
      consultation: p.consultation || "",
      memo: p.memo || "",
      rowNumber: newRowNum
    });
  } catch (calendarError) {
    console.error("[신규 고객 캘린더 연동 오류]", calendarError);
  }

  // ★ 구매차량 계약일·출고일 Google Calendar 자동 동기화 추가 — 방금 저장한
  //   프론트 값(p.vehicles)이 아니라, 시트 저장이 끝난 뒤 다시 읽은
  //   savedVehicles를 기준으로 차량별 계약/출고 일정을 동기화한다. 이 블록의
  //   오류는 고객/차량 저장 결과(위에서 이미 완료됨)에 절대 영향을 주지 않는다.
  var calendarSync = { successCount:0, warningCount:0, errors:[] };
  try {
    if (savedVehicles.length > 0) {
      calendarSync = syncAllCustomerVehicleCalendarEvents(customerId);
    }
  } catch (vehCalErr) {
    console.error("[신규 고객 차량 계약/출고 캘린더 연동 오류]", customerId, vehCalErr.message);
    calendarSync.warningCount++;
    calendarSync.errors.push(vehCalErr.message);
  }

  var __tCalendar = Date.now(); // ★ code107 성능 로그

  console.log("[handleNew 완료]", {
    rowNumber: newRowNum,
    customerId: customerId,
    requestToken: p.requestToken || "",
    vehicleCount: savedVehicles.length,
    calendarSync: calendarSync
  });

  // ★ code107 성능 로그 — 단계별 소요시간(민감정보 없음)
  console.log("[handleNew performance]",
    "고객저장:" + (__tSheetSaved - __t0) + "ms",
    "차량저장:" + (__tVehiclesSaved - __tSheetSaved) + "ms",
    "flush:" + (__tFlush - __tVehiclesSaved) + "ms",
    "calendar:" + (__tCalendar - __tFlush) + "ms",
    "total:" + (__tCalendar - __t0) + "ms",
    "vehicles:" + savedVehicles.length
  );

  return jsonResp({
    success: true,
    rowNumber: newRowNum,
    customerId: customerId,
    requestToken: p.requestToken || "",
    vehicleCount: savedVehicles.length,
    vehicles: savedVehicles,
    calendarSync: calendarSync,
    serverVersion: SERVER_VERSION
  });
}

function testHandleNew() {
  var testPayload = {
    action: "new",
    customerName: "저장테스트_" + new Date().getTime(),
    phone: "010-9999-" + String(new Date().getTime()).slice(-4),
    leadSource: "GETCHA",
    status: "신규문의",
    consultation: "Apps Script 직접 테스트",
    requestToken: "TEST-" + new Date().getTime(),
    vehicles: []
  };
  var result = handleNew(testPayload);
  console.log(result.getContent());
}

// ── 고객 수정 ────────────────────────────────────────────────
function handleEdit(p) {
  var __t0 = Date.now(); // ★ code107 성능 로그
  var cs  = getCustomerSheet();
  var vs  = getVehicleSheet();
  var now = new Date();
  var nowStr = fmtDate(now);

  var target = findCustomerRow(cs, p);
  if (!target) return jsonResp({success:false, message:"고객을 찾을 수 없습니다.", serverVersion: SERVER_VERSION});

  var rowNum     = target.rowNum;
  // ★ 고객ID 중복 방지 및 연결 무결성 강화 — 시트에 이미 저장된 customerId
  //   (target.customerId)가 최우선이며 수정 중에는 절대 재생성/변경하지
  //   않는다. target.customerId가 비어있는 구형 행일 때만(그리고 프론트가
  //   보낸 값도 없을 때만) generateUniqueCustomerId()로 새로 발급한다.
  var customerId = target.customerId || p.customerId || generateUniqueCustomerId(cs);

  // ★ 고객ID 중복 방지 및 연결 무결성 강화 — 저장을 실제로 반영하기 전에,
  //   이 customerId를 자신이 아닌 다른 행이 이미 쓰고 있는지 확인한다.
  //   중복이 발견되면 구매차량을 포함해 아무것도 수정/삭제하지 않고 즉시 중단한다.
  var dupRows = findOtherRowsWithCustomerId(cs, customerId, rowNum);
  if (dupRows.length > 0) {
    var dupInfo = dupRows.map(function(d){ return (d.name||"이름없음") + "(행 " + d.row + ")"; }).join(", ");
    throw new Error(
      "고객ID " + customerId + "이(가) " + dupInfo + " 고객과 중복되어 저장할 수 없습니다. 관리자에게 문의해주세요."
    );
  }

  if (!p._savedAt) {
    var existingHeaders = cs.getRange(1, 1, 1, cs.getLastColumn())
      .getDisplayValues()[0]
      .map(function(h){ return String(h||"").trim(); });
    var existingRow = cs.getRange(rowNum, 1, 1, cs.getLastColumn()).getDisplayValues()[0];
    for (var hi = 0; hi < existingHeaders.length; hi++) {
      var mappedH = HEADER_MAP[existingHeaders[hi]] || existingHeaders[hi];
      if (mappedH === "_savedAt" && existingRow[hi]) {
        p._savedAt = String(existingRow[hi]);
        break;
      }
    }
  }

  // ★ 등록일 미확인 고객 수동 입력 기능 추가 — 일반 고객수정 저장 시
  //   기존 수동등록일이 빈 값으로 덮어써지지 않도록 시트의 값을 보존한다.
  if (!p.manualCreatedDate) {
    var existingHeadersMCD = cs.getRange(1, 1, 1, cs.getLastColumn())
      .getDisplayValues()[0]
      .map(function(h){ return String(h||"").trim(); });
    var existingRowMCD = cs.getRange(rowNum, 1, 1, cs.getLastColumn()).getDisplayValues()[0];
    for (var hiMCD = 0; hiMCD < existingHeadersMCD.length; hiMCD++) {
      var mappedHMCD = HEADER_MAP[existingHeadersMCD[hiMCD]] || existingHeadersMCD[hiMCD];
      if (mappedHMCD === "manualCreatedDate" && existingRowMCD[hiMCD]) {
        p.manualCreatedDate = String(existingRowMCD[hiMCD]);
        break;
      }
    }
  }

  var updRow = buildRowByHeader(cs, p, now, false); // 고객수정: 최초 등록일 생성 금지
  if (updRow.length !== cs.getLastColumn()) {
    throw new Error(
      "저장 데이터 열 수(" + updRow.length + ")와 시트 열 수(" +
      cs.getLastColumn() + ")가 일치하지 않습니다."
    );
  }
  cs.getRange(rowNum, 1, 1, updRow.length).setValues([updRow]);

  var cidCol = ensureCustomerIdColumn(cs);
  cs.getRange(rowNum, cidCol).setValue(customerId);

  var __tCustomerSaved = Date.now(); // ★ code107 성능 로그

  // ── 구매차량 갱신 ────────────────────────────────────────
  // ★ 구매차량 계약일·출고일 Google Calendar 자동 동기화 추가 — 명시적으로
  //   삭제된 vehicleId를 검증 통과 이후 실제로 정리하기 위해 미리 배열에 담아둔다.
  var removedVehicleIdsForCalendar = [];
  if (p.vehicles !== undefined) {
    if (!Array.isArray(p.vehicles)) {
      throw new Error("vehicles는 배열이어야 합니다.");
    }
    var beforeCount = getVehiclesByCustomerId(vs, customerId).length;
    if (beforeCount > 0 && p.vehicles.length < beforeCount) {
      console.warn("[⚠ 구매차량 감소 감지]", {
        customerId: customerId,
        customerName: p.customerName,
        beforeCount: beforeCount,
        afterCount: p.vehicles.length
      });
    }
    // ★ 고객ID 중복 방지 및 연결 무결성 강화 — 기존 구매차량을 삭제/재저장하기
    //   전에, 이 customerId가 고객관리 시트에서 정확히 1행에만 연결되는지
    //   먼저 확인한다. (위에서 이미 중복 검사를 통과했지만, 삭제 전 방어적으로
    //   한 번 더 확인해 어떤 경우에도 잘못된 고객의 차량이 지워지지 않게 한다.)
    var linkCount = countCustomerIdOccurrences(cs, customerId);
    if (linkCount !== 1) {
      throw new Error(
        "고객ID " + customerId + "가 고객관리 시트에서 정확히 1행과 연결되지 않아" +
        "(연결된 행 수: " + linkCount + ") 구매차량 저장을 중단했습니다."
      );
    }
    var oldVehicles = getVehiclesByCustomerId(vs, customerId);
    var oldVehicleIds = {};
    oldVehicles.forEach(function(v){ if (v.vehicleId) oldVehicleIds[v.vehicleId] = true; });
    var newVehicleIds = {};
    p.vehicles.forEach(function(v){ if (v.vehicleId) newVehicleIds[v.vehicleId] = true; });
    // ★ Google Drive 고객·구매차량 문서관리 추가 — 삭제되는 차량이 있으면
    //   문서관리 시트에서 해당 vehicleId의 문서를 자동 삭제하지 않는다
    //   (요구사항 16: 차량 삭제 시 문서/폴더는 보존). 통계 목적으로만 로그.
    Object.keys(oldVehicleIds).forEach(function(vid){
      if (!newVehicleIds[vid]) {
        console.log("[구매차량 제거 감지 - 문서는 보존됨]", customerId, vid);
        // ★ 구매차량 계약일·출고일 Google Calendar 자동 동기화 추가 — 아래
        //   vehicleIdLossDetected 검증을 통과한 뒤에만 실제로 캘린더를
        //   정리한다(오검출 방지를 위해 여기서는 목록에만 담아둔다).
        removedVehicleIdsForCalendar.push(vid);
      }
    });

    // ★ 차량서류 vehicleId 연결 끊김 방지 및 고아문서 복구 (code103) ──────────
    //   기존 방식(전체 삭제 후 재삽입)에서는 카드 하나라도 vehicleId가 빈 값으로
    //   전달되면 saveVehiclesToSheet()가 genVehicleId()로 "조용히" 새 ID를 발급했다.
    //   그 결과 문서관리 시트가 가리키는 vehicleId와 구매차량 시트의 실제 vehicleId가
    //   어긋나 Drive 파일은 남아있는데 문서 개수가 0으로 보이는 사고(GLS450 사례)가
    //   발생했다. 아래 검증은 삭제를 실행하기 전에 먼저 통과해야 한다.
    //   - 프론트가 각 차량에 isNew(true=신규, false=기존)를 함께 보내면 엄격 판정:
    //     isNew:false인데 vehicleId가 비어 있으면 즉시 저장을 중단한다.
    //   - 아직 갱신되지 않은 구버전 화면이라 isNew 필드 자체가 없으면, "차량 총
    //     수는 줄지 않았는데 기존 vehicleId 중 일부가 통째로 사라졌다"는 높은
    //     신뢰도의 패턴에서만 저장을 중단한다(완전한 판별은 불가능하기 때문).
    var hasIsNewField = p.vehicles.some(function(v){
      return v && Object.prototype.hasOwnProperty.call(v, "isNew");
    });
    var vehicleIdLossDetected = false;
    var vehicleIdLossDebug = {};

    if (hasIsNewField) {
      var missingIdIdx = [];
      var legacyConvertedIdx = [];
      p.vehicles.forEach(function(v, i){
        var isNew = v.isNew === true || v.isNew === "true";
        var hasId = !!String(v.vehicleId||"").trim();
        if (isNew || hasId) return;
        // ★ 레거시 고객 차량의 구매차량 전환 및 문서관리 연결 복구 (code106) —
        //   isLegacyVehicle:true 로 전달된 카드는 "기존에 있던 차량인데 ID가
        //   사라진" 게 아니라 "구매차량 행이 원래 없던 레거시 표시차량"이다.
        //   이 고객의 구매차량 행이 실제로 0개였을 때만(beforeCount===0)
        //   신규 전환(=새 vehicleId 발급 후 구매차량 시트에 실제 저장)을
        //   허용한다. 그 외의 경우는 지금까지와 동일하게 "누락"으로 간주해
        //   저장을 차단한다 — 이미 실제 구매차량 행이 있는 고객에게 레거시
        //   전환을 잘못 적용해 중복 차량이 생기는 사고를 막기 위함이다.
        var isLegacy = v.isLegacyVehicle === true || v.isLegacyVehicle === "true";
        if (isLegacy && beforeCount === 0) { legacyConvertedIdx.push(i); return; }
        missingIdIdx.push(i);
      });
      if (missingIdIdx.length > 0) {
        vehicleIdLossDetected = true;
        vehicleIdLossDebug = { mode:"strict(isNew)", missingIdCardIndexes: missingIdIdx };
      }
      if (legacyConvertedIdx.length > 0) {
        console.log("[레거시 차량 → 구매차량 전환 허용]", customerId, "cardIndexes:", legacyConvertedIdx);
      }
    } else if (beforeCount > 0 && p.vehicles.length >= beforeCount) {
      var sentIdSet = {};
      p.vehicles.forEach(function(v){ var id=String(v.vehicleId||"").trim(); if (id) sentIdSet[id]=true; });
      var lostIds = Object.keys(oldVehicleIds).filter(function(id){ return !sentIdSet[id]; });
      var emptyIdCount = p.vehicles.filter(function(v){ return !String(v.vehicleId||"").trim(); }).length;
      if (lostIds.length > 0 && emptyIdCount > 0) {
        vehicleIdLossDetected = true;
        vehicleIdLossDebug = { mode:"legacy-heuristic(no isNew field)", lostVehicleIds: lostIds, emptyIdCount: emptyIdCount };
      }
    }

    if (vehicleIdLossDetected) {
      console.error("[차량ID 누락 감지 - 저장 중단]", JSON.stringify({
        customerId: customerId, customerName: p.customerName,
        beforeCount: beforeCount, sentCount: p.vehicles.length,
        oldVehicleIds: Object.keys(oldVehicleIds),
        sentVehicles: p.vehicles.map(function(v){ return { vehicleId:v.vehicleId||"", isNew:v.isNew, modelName:v.modelName||"" }; }),
        debug: vehicleIdLossDebug
      }));
      throw new Error(
        "기존 구매차량의 차량ID가 누락되어 저장을 중단했습니다. 화면을 새로고침한 후 다시 시도해주세요."
      );
    }

    deleteVehiclesByCustomerId(vs, customerId);
    saveVehiclesToSheet(vs, customerId,
      p.customerName||"", p.newPhone||p.phone||"",
      p.vehicles, nowStr);

    // ★ 구매차량 계약일·출고일 Google Calendar 자동 동기화 추가 — 위의
    //   vehicleIdLossDetected 검증(오검출 방지 가드)을 통과해 실제로 삭제가
    //   실행된 뒤에만, 명시적으로 제거된 차량의 계약/출고 일정을 정리한다.
    //   문서관리/Drive 파일은 기존 정책대로 절대 건드리지 않는다.
    removedVehicleIdsForCalendar.forEach(function(vid){
      try {
        deleteVehicleCalendarEvents(vid);
      } catch (calErr) {
        console.error("[삭제된 차량 캘린더 정리 오류]", customerId, vid, calErr.message);
      }
    });
  }

  var __tVehiclesSaved = Date.now(); // ★ code107 성능 로그

  var savedVehicles = getVehiclesByCustomerId(vs, customerId);
  console.log("[handleEdit 저장 검증]", {
    customerId: customerId,
    customerName: p.customerName,
    vehicleCount: savedVehicles.length,
    vehicles: savedVehicles
  });

  // ── 다음연락일 → Google Calendar 동기화 ───────────────────
  // 날짜 변경 시 기존 일정 이동, 공백 저장 시 기존 일정 삭제, 고객명이
  // 바뀌면 제목도 함께 갱신된다. 실패해도 위 고객/차량 수정 결과에는
  // 영향을 주지 않는다.
  try {
    syncNextContactCalendarEvent({
      customerId: customerId,
      customerName: p.customerName || "",
      phone: p.newPhone || p.phone || "",
      companyName: p.companyName || "",
      nextContact: p.nextContact || "",
      consultation: p.consultation || "",
      memo: p.memo || "",
      rowNumber: rowNum
    });
  } catch (calendarError) {
    console.error("[고객 수정 캘린더 연동 오류]", calendarError);
  }

  // ★ 구매차량 계약일·출고일 Google Calendar 자동 동기화 추가 — 프론트에서
  //   받은 p.vehicles가 아니라, 시트 저장이 끝난 뒤 다시 읽은 savedVehicles를
  //   기준으로 차량별 계약/출고 일정을 동기화한다(요청사항 9). 이 블록의
  //   오류는 위 고객/차량 수정 결과에 절대 영향을 주지 않는다.
  var calendarSync = { successCount:0, warningCount:0, errors:[] };
  try {
    calendarSync = syncAllCustomerVehicleCalendarEvents(customerId);
  } catch (vehCalErr) {
    console.error("[고객 수정 - 차량 계약/출고 캘린더 연동 오류]", customerId, vehCalErr.message);
    calendarSync.warningCount++;
    calendarSync.errors.push(vehCalErr.message);
  }

  var __tCalendar = Date.now(); // ★ code107 성능 로그

  // ★ code107 성능 로그 — 단계별 소요시간(민감정보 없음)
  console.log("[handleEdit performance]",
    "고객저장:" + (__tCustomerSaved - __t0) + "ms",
    "차량저장:" + (__tVehiclesSaved - __tCustomerSaved) + "ms",
    "calendar:" + (__tCalendar - __tVehiclesSaved) + "ms",
    "total:" + (__tCalendar - __t0) + "ms",
    "customerId:", customerId, "vehicles:", savedVehicles.length
  );

  return jsonResp({
    success: true,
    rowNumber: rowNum,
    customerId: customerId,
    vehicleCount: savedVehicles.length,
    vehicles: savedVehicles,
    calendarSync: calendarSync,
    serverVersion: SERVER_VERSION
  });
}

// ── 추가상담(update) 저장 ───────────────────────────────────
function handleUpdate(p) {
  var cs = getCustomerSheet();
  var target = findCustomerRow(cs, p);
  if (!target) return jsonResp({success:false, message:"고객을 찾을 수 없습니다. (연락처를 확인하세요)", serverVersion: SERVER_VERSION});

  var rowNum = target.rowNum;
  var headers = cs.getRange(1, 1, 1, cs.getLastColumn())
    .getDisplayValues()[0]
    .map(function(h){ return String(h||"").trim(); });

  function colIndexFor(key) {
    for (var i = 0; i < headers.length; i++) {
      if ((HEADER_MAP[headers[i]] || headers[i]) === key) return i + 1;
    }
    return -1;
  }

  if (p.consultationEntry) {
    var ccol = colIndexFor("consultation");
    if (ccol > 0) {
      var cell = cs.getRange(rowNum, ccol);
      var prev = String(cell.getValue() || "");
      cell.setValue(prev ? prev + "\n\n" + p.consultationEntry : p.consultationEntry);
    }
  }

  var simpleFields = ["memo", "status", "nextContact", "currentMileageDate", "currentMileage"];
  simpleFields.forEach(function(f) {
    if (p[f] === undefined || p[f] === null || p[f] === "") return;
    var col = colIndexFor(f);
    if (col > 0) cs.getRange(rowNum, col).setValue(p[f]);
  });

  var updCol = colIndexFor("_updatedAt");
  if (updCol > 0) cs.getRange(rowNum, updCol).setValue(fmtDate(new Date()));

  // ── 다음연락일 → Google Calendar 동기화 ───────────────────
  // handleUpdate()는 고객명 등을 요청에 포함하지 않을 수 있으므로,
  // 방금 반영된 시트 값을 다시 읽어 캘린더 동기화에 사용한다.
  // (추가상담 화면은 nextContact를 빈 값으로 보내 지우는 기존 정책이
  //  없으므로 — 위 simpleFields 로직도 그대로 유지 — 여기서도 시트에
  //  남아있는 현재 값을 그대로 사용할 뿐 임의로 비우지 않는다.)
  try {
    function getCurrentVal(key) {
      var col = colIndexFor(key);
      if (col <= 0) return "";
      return String(cs.getRange(rowNum, col).getDisplayValues()[0][0] || "");
    }
    syncNextContactCalendarEvent({
      customerId: target.customerId || legacyRowBasedCustomerId(rowNum), // ★ 고객ID 중복 방지 및 연결 무결성 강화 — 캘린더 동기화 키 용도(시트 기록 아님)이므로 값이 매번 바뀌지 않도록 결정적 값 사용
      customerName: getCurrentVal("customerName"),
      phone: getCurrentVal("phone"),
      companyName: getCurrentVal("companyName"),
      nextContact: getCurrentVal("nextContact"),
      consultation: getCurrentVal("consultation"),
      memo: getCurrentVal("memo"),
      rowNumber: rowNum
    });
  } catch (calendarError) {
    console.error("[추가상담 캘린더 연동 오류]", calendarError);
  }

  // ★ 구매차량 계약일·출고일 Google Calendar 자동 동기화 추가 — handleUpdate()는
  //   구매차량(계약일/출고일)을 수정하는 경로가 아니라 고객 필드(memo/status/
  //   nextContact 등)만 수정하는 "추가상담" 경로다. 따라서 차량 계약/출고
  //   캘린더는 여기서 건드리지 않는다(요청사항 9 — 해당되는 경로가 아니므로
  //   변경 없음). 만약 이 액션이 향후 구매차량도 함께 수정하도록 확장되면
  //   handleEdit()과 동일하게 syncAllCustomerVehicleCalendarEvents(customerId)를
  //   별도 try/catch로 추가하면 된다.

  return jsonResp({success: true, rowNumber: rowNum, customerId: target.customerId, serverVersion: SERVER_VERSION});
}

// ============================================================
// ★ 고객 삭제 — 고객 시트 행 + 연결된 구매차량 행 전체 삭제
//
//   검색 우선순위: rowNumber → customerId → originalPhone
//   (findCustomerRow()를 그대로 재사용 — originalPhone은 p.phone으로 전달)
//
//   LockService로 동시 저장/수정/삭제 충돌을 방지한다.
// ============================================================
function handleDeleteCustomer(p) {
  var lock = LockService.getScriptLock();
  try {
    var gotLock = lock.tryLock(10000); // 최대 10초 대기
    if (!gotLock) {
      return jsonResp({
        success: false,
        message: "다른 저장/수정 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.",
        serverVersion: SERVER_VERSION
      });
    }

    var cs = getCustomerSheet();
    var vs = getVehicleSheet();

    // findCustomerRow()는 rowNumber → customerId → phone(정규화) 순으로 검색한다.
    // 프론트엔드에서 보낸 originalPhone을 phone 필드로 매핑해 그대로 재사용.
    var searchParams = {
      rowNumber:  p.rowNumber  || "",
      customerId: p.customerId || "",
      phone:      p.originalPhone || p.phone || ""
    };

    var target = findCustomerRow(cs, searchParams);
    if (!target) {
      return jsonResp({
        success: false,
        message: "삭제할 고객을 찾을 수 없습니다. (rowNumber/customerId/연락처를 확인하세요)",
        serverVersion: SERVER_VERSION
      });
    }

    var rowNum = target.rowNum;
    var lastRow = cs.getLastRow();

    // ── 고객 행 삭제 안전장치 ────────────────────────────────
    if (rowNum < 2 || rowNum > lastRow) {
      return jsonResp({
        success: false,
        message: "삭제 대상 행 번호가 유효하지 않습니다. (rowNum=" + rowNum + ")",
        serverVersion: SERVER_VERSION
      });
    }

    // rowNumber로 찾았더라도, 요청에 customerId가 있으면 실제 행의 customerId와
    // 반드시 일치하는지 재확인한다. 불일치하면 customerId 기준으로 다시 검색한다.
    var headers = cs.getRange(1, 1, 1, cs.getLastColumn())
      .getDisplayValues()[0]
      .map(function(h){ return String(h||"").trim(); });
    var cidColIdx = -1, phoneColIdx = -1, nameColIdx = -1;
    for (var hi = 0; hi < headers.length; hi++) {
      var mapped = HEADER_MAP[headers[hi]] || headers[hi];
      if (mapped === "customerId")   cidColIdx   = hi;
      if (mapped === "phone")        phoneColIdx = hi;
      if (mapped === "customerName") nameColIdx  = hi;
    }

    var actualRowValues = cs.getRange(rowNum, 1, 1, cs.getLastColumn()).getDisplayValues()[0];
    var actualCustomerId = cidColIdx  >= 0 ? String(actualRowValues[cidColIdx]  || "").trim() : "";

    if (p.customerId && actualCustomerId && String(p.customerId).trim() !== actualCustomerId) {
      // rowNumber 기준 행의 customerId가 요청과 다르다 — customerId로 재검색
      var reSearch = findCustomerRow(cs, { customerId: p.customerId });
      if (!reSearch) {
        return jsonResp({
          success: false,
          message: "rowNumber와 customerId가 일치하지 않아 안전하게 삭제를 중단했습니다.",
          serverVersion: SERVER_VERSION
        });
      }
      rowNum = reSearch.rowNum;
      actualRowValues = cs.getRange(rowNum, 1, 1, cs.getLastColumn()).getDisplayValues()[0];
      actualCustomerId = cidColIdx >= 0 ? String(actualRowValues[cidColIdx] || "").trim() : "";
    }

    // ── 삭제 전 실제 값 다시 읽기 (응답/로그/캘린더 정리용) ──
    var deletedCustomerId   = actualCustomerId || target.customerId || "";
    var deletedCustomerName = nameColIdx  >= 0 ? String(actualRowValues[nameColIdx]  || "").trim() : "";
    var deletedPhone        = phoneColIdx >= 0 ? String(actualRowValues[phoneColIdx] || "").trim() : "";

    // ── 다음연락 캘린더 일정 삭제 ────────────────────────────
    // 고객 데이터 자체는 곧 삭제되므로, 남아있는 다음연락 일정도 함께
    // 정리하는 것이 안전하다고 판단해 nextContact:""를 전달해 삭제
    // 경로를 그대로 재사용한다. 실패해도 고객 삭제 자체는 계속 진행된다.
    try {
      syncNextContactCalendarEvent({
        customerId: deletedCustomerId,
        customerName: deletedCustomerName,
        phone: deletedPhone,
        nextContact: "",
        rowNumber: rowNum
      });
    } catch (calendarError) {
      console.error("[고객 삭제 캘린더 연동 오류]", calendarError);
    }

    // ★ 구매차량 계약일·출고일 Google Calendar 자동 동기화 추가 — 구매차량
    //   시트에서 실제 행을 삭제하기 전에, 이 고객에게 연결된 모든 차량의
    //   계약/출고 일정과 Script Properties 키를 먼저 정리한다. 실패해도
    //   고객/차량 삭제 자체는 기존 정책대로 계속 진행한다.
    var vehicleCalendarWarning = "";
    try {
      var vehiclesToCleanCalendar = deletedCustomerId ? getVehiclesByCustomerId(vs, deletedCustomerId) : [];
      vehiclesToCleanCalendar.forEach(function(v){
        try {
          deleteVehicleCalendarEvents(v.vehicleId);
        } catch (calErr) {
          console.error("[고객삭제 - 차량 캘린더 정리 오류]", deletedCustomerId, v.vehicleId, calErr.message);
        }
      });
    } catch (vehCalOuterErr) {
      vehicleCalendarWarning = "차량 계약/출고 일정 정리 중 오류가 발생했습니다: " + vehCalOuterErr.message;
      console.error("[고객삭제 - 차량 캘린더 정리 전체 오류]", deletedCustomerId, vehCalOuterErr.message);
    }

    // ── 구매차량 시트에서 해당 고객 차량 행 삭제 (아래→위 순회) ──
    var deletedVehicleCount = 0;
    var vehicleWarning = "";

    if (deletedCustomerId) {
      // customerId가 있으면 안전하게 customerId 완전 일치 기준으로만 삭제
      deletedVehicleCount = deleteVehiclesByCustomerIdSafe(vs, deletedCustomerId);
    } else {
      // customerId가 없는 구형 데이터 — 고객명만으로 대량 삭제하지 않는다.
      // 고객명 + 연락처가 모두 일치하는 차량만 삭제하고, 그마저도 불확실하면
      // 차량 삭제는 생략하고 경고만 응답에 포함한다.
      if (deletedCustomerName && deletedPhone) {
        deletedVehicleCount = deleteVehiclesByNameAndPhoneSafe(vs, deletedCustomerName, deletedPhone);
        vehicleWarning = "customerId가 없어 고객명+연락처 일치 기준으로 차량을 삭제했습니다.";
      } else {
        vehicleWarning = "customerId와 연락처 정보가 불충분하여 구매차량 삭제를 생략했습니다. 수동 확인이 필요합니다.";
        console.warn("[고객삭제] " + vehicleWarning, {
          rowNum: rowNum, customerName: deletedCustomerName
        });
      }
    }

    // ── 고객 시트에서 해당 고객 행 삭제 (정확히 1행) ──────────
    // 헤더 행(1행)은 위의 rowNum < 2 체크로 이미 차단됨.
    cs.deleteRow(rowNum);
    SpreadsheetApp.flush();

    // ★ Google Drive 고객·구매차량 문서관리 추가 — 고객 삭제 시 Drive 폴더와
    //   문서관리 시트 기록은 절대 자동 삭제하지 않는다(보존). 필요하면
    //   관리자가 diagnoseDocumentManagement()로 고아 상태를 확인해 수동 처리한다.
    console.log("[고객삭제] 문서/Drive 폴더는 보존됨 (자동 삭제하지 않음)", deletedCustomerId);

    console.log("[고객삭제 완료]", {
      rowNum: rowNum,
      customerId: deletedCustomerId,
      customerName: deletedCustomerName,
      deletedVehicleCount: deletedVehicleCount,
      vehicleWarning: vehicleWarning,
      vehicleCalendarWarning: vehicleCalendarWarning
    });

    var result = {
      success: true,
      message: "고객정보가 삭제되었습니다.",
      deletedCustomerId: deletedCustomerId,
      deletedCustomerName: deletedCustomerName,
      deletedVehicleCount: deletedVehicleCount,
      serverVersion: SERVER_VERSION
    };
    if (vehicleWarning) result.vehicleWarning = vehicleWarning;
    if (vehicleCalendarWarning) result.vehicleCalendarWarning = vehicleCalendarWarning;

    return jsonResp(result);

  } catch (err) {
    console.error("[handleDeleteCustomer 오류]", err.stack || err.message);
    return jsonResp({
      success: false,
      message: err.message || "고객 삭제 중 알 수 없는 오류가 발생했습니다.",
      serverVersion: SERVER_VERSION
    });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

// ── 구매차량 삭제 (customerId 완전 일치, 마지막 행부터 위로) ──
function deleteVehiclesByCustomerIdSafe(vs, customerId) {
  var cid = String(customerId || "").trim();
  if (!cid) return 0;
  var lastRow = vs.getLastRow();
  var deleted = 0;
  // 헤더(1행)는 절대 건드리지 않는다 — i >= 2 까지만 순회.
  for (var i = lastRow; i >= 2; i--) {
    var rowCid = String(vs.getRange(i, 2).getValue() || "").trim(); // B열 = 고객ID
    if (rowCid === cid) {
      vs.deleteRow(i);
      deleted++;
    }
  }
  return deleted;
}

// ── customerId가 없는 구형 차량 데이터 삭제 (고객명+연락처 완전 일치만) ──
function deleteVehiclesByNameAndPhoneSafe(vs, customerName, phone) {
  var name = String(customerName || "").trim();
  var normPhone = String(phone || "").replace(/\D/g, "");
  if (!name || !normPhone) return 0;
  var lastRow = vs.getLastRow();
  var deleted = 0;
  for (var i = lastRow; i >= 2; i--) {
    var rowVals = vs.getRange(i, 1, 1, 4).getValues()[0]; // A:차량ID B:고객ID C:고객명 D:연락처
    var rowCid   = String(rowVals[1] || "").trim();
    var rowName  = String(rowVals[2] || "").trim();
    var rowPhone = String(rowVals[3] || "").replace(/\D/g, "");
    // customerId가 채워진 행은 이 함수에서 절대 건드리지 않는다 (다른 고객 보호).
    if (rowCid) continue;
    if (rowName === name && rowPhone === normPhone) {
      vs.deleteRow(i);
      deleted++;
    }
  }
  return deleted;
}

// ── 헤더 기반 행 배열 생성 ──────────────────────────────────
// 최초 등록일(_savedAt) 불변 보장:
/// - handleNew()만 isNewRegistration=true로 호출해 서버 시간으로 최초 등록일 생성
//  - handleEdit()는 false로 호출해 기존 등록일만 보존하고, 없으면 빈값 유지
function buildRowByHeader(sheet, p, now, isNewRegistration) {
  var headers = sheet.getRange(1,1,1,sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(h){ return String(h||"").trim(); });

  var dataMap = {
    customerId:        p.customerId     || "",
    customerName:      p.customerName   || "",
    companyName:       p.companyName    || "",
    phone:             p.newPhone||p.phone||"",
    region:            p.region         || "",
    modelName:         p.modelName      || "",
    detailModel:       p.detailModel    || "",
    purchaseMethod:    p.purchaseMethod || "",
    budget:            p.budget         || "",
    purchaseTiming:    p.purchaseTiming || "",
    leadSource:        p.leadSource     || "",
    status:            p.status         || "",
    consultation:      p.consultation   || "",
    memo:              p.memo           || "",
    nextContact:       p.nextContact    || "",
    insuranceStartDate:  p.insuranceStartDate  || "",
    insuranceExpireDate: p.insuranceExpireDate || "",
    inspectionDueDate:   p.inspectionDueDate   || "",
    financeStartDate:    p.financeStartDate    || "",
    financeEndDate:      p.financeEndDate      || "",
    contractDate:      p.contractDate   || "",
    deliveryDate:      p.deliveryDate   || "",
    deliveryMonth:     p.deliveryMonth  || "",
    tags:              p.tags           || "",
    lastServiceDate:     p.lastServiceDate     || "",
    lastServiceMileage:  p.lastServiceMileage  || "",
    currentMileageDate:  p.currentMileageDate  || "",
    currentMileage:      p.currentMileage      || "",
    nextServiceDate:     p.nextServiceDate     || "",
    nextServiceMileage:  p.nextServiceMileage  || "",
    birthDate:         p.birthDate      || "",
    _savedAt:          isNewRegistration ? fmtDate(now) : (p._savedAt || ""),
    _updatedAt:        fmtDate(now),
    requestToken:      p.requestToken   || "",
    // ★ 등록일 미확인 고객 수동 입력 기능 추가
    manualCreatedDate: p.manualCreatedDate || ""
  };

  return headers.map(function(rawH) {
    var key = HEADER_MAP[rawH] || rawH;
    return dataMap[key] !== undefined ? dataMap[key] : "";
  });
}

// ── 고객 행 찾기 ─────────────────────────────────────────────
function findCustomerRow(cs, p) {
  var data = cs.getDataRange().getValues();
  if (data.length <= 1) return null;

  var header  = data[0].map(function(h){ return String(h||"").trim(); });
  var cidCol  = -1, phoneCol = -1;
  for (var k = 0; k < header.length; k++) {
    var mapped = HEADER_MAP[header[k]] || header[k];
    if (mapped === "customerId") cidCol  = k;
    if (mapped === "phone")      phoneCol = k;
  }

  if (p.rowNumber) {
    var rn = parseInt(p.rowNumber, 10);
    if (rn >= 2 && rn <= data.length) {
      return {
        rowNum: rn,
        customerId: cidCol >= 0 ? String(data[rn-1][cidCol]||"") : ""
      };
    }
  }

  if (p.customerId && cidCol >= 0) {
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][cidCol]).trim() === p.customerId) {
        return { rowNum: i+1, customerId: p.customerId };
      }
    }
  }

  var sp = (p.phone||"").replace(/\D/g,"");
  if (sp && phoneCol >= 0) {
    for (var j = 1; j < data.length; j++) {
      if (String(data[j][phoneCol]||"").replace(/\D/g,"") === sp) {
        var cid = cidCol >= 0 ? String(data[j][cidCol]||"") : "";
        return { rowNum: j+1, customerId: cid };
      }
    }
  }

  return null;
}

// ── 구매차량 저장 (v37: memo도 함께 저장) ─────────────────────
// 기존 14개 컬럼(차량ID~수정일)은 원래와 완전히 동일한 위치 기반
// setValues() 한 번으로 저장하고, memo는 ensureVehicleMemoColumn()으로
// 확보한 별도 컬럼에 이어서 한 번 더 setValues()로 채운다.
// → 기존 저장 로직/행 구조를 전혀 건드리지 않으면서 memo만 추가.
function saveVehiclesToSheet(vs, customerId, customerName, phone, vehicles, nowStr) {
  if (!Array.isArray(vehicles) || !vehicles.length) return;
  var memoCol = ensureVehicleMemoColumn(vs); // ★ v37
  var rows = vehicles.map(function(v){
    var qty = Math.max(1, parseInt(v.quantity,10)||1);
    var dd  = fmtDate(v.deliveryDate||"");
    var dm  = v.deliveryMonth||(dd&&dd.length>=7?dd.substring(0,7):"");
    return [
      v.vehicleId||genVehicleId(), customerId, customerName, phone,
      v.modelName||"", v.detailModel||"", v.purchaseMethod||"",
      v.vehicleStatus||"", fmtDate(v.contractDate||""), dd, dm, qty, nowStr, nowStr
    ];
  });
  var startRow = vs.getLastRow()+1;
  vs.getRange(startRow, 1, rows.length, 14).setValues(rows);

  // ★ v37: memo는 기존 14개 컬럼과 별도로, 같은 행 범위에 이어서 저장한다.
  var memoRows = vehicles.map(function(v){ return [String(v.memo||"")]; });
  vs.getRange(startRow, memoCol, memoRows.length, 1).setValues(memoRows);
}

// ── 구매차량 삭제 (해당 고객ID만, 아래에서 위로 삭제) ────────
function deleteVehiclesByCustomerId(vs, customerId) {
  var data = vs.getDataRange().getValues();
  for (var i = data.length-1; i >= 1; i--) {
    if (String(data[i][1]||"").trim() === String(customerId||"").trim()) vs.deleteRow(i+1);
  }
}

// ── 구매차량 조회 (해당 고객ID만) — 저장 검증용 (v37: memo 포함) ──
function getVehiclesByCustomerId(vs, customerId) {
  var memoCol = ensureVehicleMemoColumn(vs); // ★ v37
  var data = vs.getDataRange().getValues();
  var result = [];
  var cid = String(customerId||"").trim();
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[1]||"").trim() !== cid) continue;
    var dd = fmtDate(row[9]);
    var dm = String(row[10]||"").trim();
    if (!dm && dd && dd.length >= 7) dm = dd.substring(0,7);
    result.push({
      vehicleId:      String(row[0]||"").trim(),
      modelName:      String(row[4]||"").trim(),
      detailModel:    String(row[5]||"").trim(),
      purchaseMethod: String(row[6]||"").trim(),
      vehicleStatus:  String(row[7]||"").trim(),
      contractDate:   fmtDate(row[8]),
      deliveryDate:   dd,
      deliveryMonth:  dm,
      quantity:       Math.max(1, parseInt(row[11],10)||1),
      memo:           String(row[memoCol-1]||"").trim() // ★ v37
    });
  }
  return result;
}

// ── JSON 응답 ─────────────────────────────────────────────────
function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Google Calendar 연동 (기존 유지 — 계약일/출고일용, 변경 없음) ────
// ★ 참고: 이 함수는 code105 기준 이 파일 안에서 실제로 호출하는 곳이 없다
//   (죽은 코드). 계약일/출고일 캘린더 동기화는 이제 아래 "VEHICLE CONTRACT/
//   DELIVERY CALENDAR SYNC" 구역의 syncVehicleContractDeliveryEvents() 등이
//   전담하며, PropertiesService 키 네임스페이스가 서로 다르므로
//   (VEHICLE_CONTRACT_EVENT_.../VEHICLE_DELIVERY_EVENT_...) 중복 생성될
//   위험은 없다. 이 함수는 과거 호환을 위해 삭제하지 않고 그대로 남겨둔다.
function upsertCalEvent(propKey, title, date, desc) {
  try {
    if (!date) return;
    var d = new Date(date + "T00:00:00");
    if (isNaN(d.getTime())) return;
    var cal = CalendarApp.getCalendarById(Session.getActiveUser().getEmail())
              || CalendarApp.getDefaultCalendar();
    var props = PropertiesService.getScriptProperties();
    var existId = props.getProperty(propKey);
    if (existId) {
      try {
        var ev = cal.getEventById(existId);
        if (ev) { ev.setTitle(title); ev.setDescription(desc||""); return; }
      } catch(ignore) {}
    }
    var newEv = cal.createAllDayEvent(title, d, {description:desc||""});
    props.setProperty(propKey, newEv.getId());
  } catch(err) {
    console.error("Calendar error:", err);
  }
}

// ============================================================
// ★★★ Spreadsheet 서비스 일시 오류 재시도 유틸 (신규, code111) ★★★
//
//   문서 업로드 도중 "스프레드시트 서비스에 오류가 발생했습니다" 같은
//   Google 쪽 일시적 오류(순간적인 서비스 불안정, 과도한 호출 등)가
//   나면 짧게 대기했다가 자동으로 재시도한다.
//
//   반드시 구분해야 할 것: customerId 중복, vehicleId 중복, 차량 없음
//   같은 "논리적으로 실제 잘못된" 검증 오류는 절대 재시도하지 않는다.
//   이런 오류는 몇 번을 다시 시도해도 똑같이 실패하므로, 즉시 그대로
//   사용자에게 보여줘야 한다. isRetryableSpreadsheetError()가 오류
//   메시지 문자열을 보고 이 둘을 구분한다 — validateCustomerForDocuments()/
//   validateVehicleForDocuments()가 던지는 한글 검증 메시지("중복되어",
//   "찾을 수 없습니다" 등)는 이 패턴에 걸리지 않으므로 자동으로 즉시
//   실패 처리된다.
//
//   이 구역은 문서관리 기능에서만 사용한다 — 기존 고객저장/구매차량/
//   통계/캘린더 로직은 전혀 건드리지 않는다.
// ============================================================
var SPREADSHEET_RETRY_DELAYS_MS = [300, 800, 1500];

function isRetryableSpreadsheetError(err) {
  var msg = String((err && err.message) || err || "");
  return msg.indexOf("Spreadsheet") >= 0 ||
         msg.indexOf("스프레드시트") >= 0 ||
         msg.indexOf("Service invoked too many times") >= 0 ||
         msg.indexOf("서비스를 사용할 수 없습니다") >= 0 ||
         msg.indexOf("internal error") >= 0 ||
         msg.indexOf("Internal error") >= 0 ||
         msg.indexOf("시간 초과") >= 0 ||
         msg.indexOf("timed out") >= 0 ||
         msg.indexOf("Timeout") >= 0 ||
         msg.indexOf("Exception: 서비스") >= 0;
}

// fn: 실행할 함수(인자 없음). label: 로그에 남길 작업 이름(어느 단계에서
// 재시도했는지 구분하기 위함, 예: "getDocumentSheet", "appendDocumentRow").
function withSpreadsheetRetry(fn, label) {
  var delays = SPREADSHEET_RETRY_DELAYS_MS;
  var lastErr;
  for (var attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableSpreadsheetError(err)) {
        // 논리 검증 오류 — 재시도 없이 즉시 원래 오류 그대로 던진다 (요청사항 5).
        throw err;
      }
      if (attempt >= delays.length) break; // 재시도 소진, 아래에서 안전 메시지로 감싸 던짐
      console.warn("[Spreadsheet 재시도]", label || "", "attempt=" + (attempt + 1) + "/" + (delays.length + 1), String((err && err.message) || err));
      Utilities.sleep(delays[attempt]);
    }
  }
  // 재시도를 모두 소진한 뒤에도 실패 — Google 내부 오류 문자열을 그대로
  // 보여주지 않고, 사용자가 이해할 수 있는 안전한 안내 메시지로 감싼다.
  // 원본 오류는 err._originalMessage에 담아 Apps Script 로그에만 남긴다.
  var wrapped = new Error(
    "문서 저장 중 Google 스프레드시트에 일시적인 오류가 발생했습니다.\n" +
    "자동으로 " + delays.length + "회 재시도했지만 처리되지 않았습니다.\n\n" +
    "차량정보와 기존 문서는 변경되지 않았습니다.\n" +
    "잠시 후 다시 시도해주세요.\n\n" +
    "오류코드: DOC-SPREADSHEET-TEMP"
  );
  wrapped._isDocSpreadsheetTemp = true;
  wrapped._originalMessage = String((lastErr && lastErr.message) || lastErr);
  wrapped._label = label || "";
  throw wrapped;
}

// ============================================================
// ★★★ Google Drive 고객·구매차량 문서관리 (신규, code102) ★★★
//
//   기존 함수는 위쪽 doGet()/doPost()의 라우팅 분기 추가만 있을 뿐
//   일체 수정하지 않았다. 이 구역부터 파일 끝까지는 전부 신규 코드다.
//
//   구조 요약:
//   - Drive 최상위 폴더는 사용자가 이미 만들어 둔 폴더를 사용한다.
//     아래 DRIVE_ROOT_FOLDER_ID에 폴더ID(또는 폴더 링크)를 붙여넣으면 된다.
//     이 스크립트는 최상위 폴더를 새로 만들지 않는다.
//   - 고객 폴더 / 차량 폴더 / 호차 폴더의 Drive folderId는 "문서폴더" 시트에
//     저장해 재사용한다. 폴더명 검색으로 기존 폴더를 찾지 않고, 반드시
//     customerId/vehicleId/unitNo 조합 키로만 연결한다.
//   - 문서 메타데이터(파일명, 종류, 업로드일 등)는 "문서관리" 시트에 저장한다.
//   - 두 시트 모두 처음 필요할 때 자동 생성되며, 이미 있으면 그대로 재사용한다.
//     기존 "고객관리"/"구매차량" 시트의 열 순서는 전혀 건드리지 않는다.
//   - 파일 업로드/조회/삭제는 LockService로 동시 요청 충돌(중복 폴더 생성 등)을
//     방지한다.
// ============================================================

// ── ▼▼▼ 여기에 Google Drive 최상위 폴더를 설정하세요 ▼▼▼ ────────────
//   1) Google Drive에서 문서를 저장할 폴더를 미리 만들어두세요.
//      (이 스크립트는 최상위 폴더를 스스로 만들지 않습니다.)
//   2) 그 폴더의 ID 또는 폴더 링크 전체를 아래 값에 붙여넣으세요.
//      - 링크 예: https://drive.google.com/drive/folders/XXXXXXXXXXXXXXXXXXXX
//      - ID만:   XXXXXXXXXXXXXXXXXXXX
//      둘 다 허용되며, 링크를 붙여넣어도 자동으로 ID만 추출합니다.
var DRIVE_ROOT_FOLDER_ID = "https://drive.google.com/drive/folders/1v8PqRShNMw-vsEHdo7XkYWRlIH08cbiL";
// ── ▲▲▲ 설정 후 Apps Script 편집기에서 testDriveRootFolderConnection() 실행 ▲▲▲

var DOC_SHEET_NAME = "문서관리";
var DOC_FOLDER_SHEET_NAME = "문서폴더";

// 문서관리 시트 컬럼 순서 (요청사항 5 기준, 항상 이 순서로 생성/사용).
// 새 컬럼이 추후 필요해지면 반드시 이 배열의 "끝"에만 추가한다.
var DOC_SHEET_HEADERS = [
  "documentId","customerId","vehicleId","unitNo",
  "customerName","companyName","modelName","detailModel",
  "documentScope","documentType","documentName",
  "originalFileName","storedFileName","mimeType","fileSize",
  "driveFileId","driveFileUrl","driveFolderId",
  "uploadedAt","updatedAt","memo","isDeleted","deletedAt",
  "requestToken"
];

var DOC_FOLDER_SHEET_HEADERS = [
  "folderKey","scope","customerId","vehicleId","unitNo",
  "folderId","folderName","createdAt","updatedAt"
];

// 업로드 파일 1개 최대 크기 (8MB) — 서버에서도 방어적으로 재검사한다.
var DOC_MAX_FILE_SIZE = 8 * 1024 * 1024;

// 허용 MIME 타입 (확장자만이 아니라 MIME도 함께 검증한다).
var DOC_ALLOWED_MIME = {
  "application/pdf": 1,
  "image/jpeg": 1, "image/jpg": 1, "image/png": 1, "image/webp": 1, "image/heic": 1, "image/heif": 1,
  "application/msword": 1,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": 1,
  "application/vnd.ms-excel": 1,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": 1,
  // HWP는 표준 MIME이 불명확한 경우가 많아 확장자 기준으로도 별도 허용한다.
  "application/x-hwp": 1, "application/haansofthwp": 1, "application/octet-stream": 1
};

// 실행 가능 파일 등 절대 허용하지 않는 확장자 (MIME이 위장되어 있어도 확장자로 재차단).
var DOC_BLOCKED_EXTENSIONS = {
  "html":1,"htm":1,"js":1,"exe":1,"bat":1,"cmd":1,"sh":1,"msi":1,
  "apk":1,"jar":1,"vbs":1,"scr":1,"com":1,"ps1":1,"app":1
};

var DOC_ALLOWED_EXTENSIONS = {
  "pdf":1,"jpg":1,"jpeg":1,"png":1,"webp":1,"heic":1,"heif":1,
  "doc":1,"docx":1,"xls":1,"xlsx":1,"hwp":1
};

// 구매방식별 기본 필수서류 체크리스트 (요청사항 19). 화면에서 진행률 계산용.
var DOC_REQUIRED_BY_METHOD = {
  "현금":     ["차량계약서","입금확인서","자동차등록증","보험증권"],
  "할부":     ["차량계약서","금융계약서","입금확인서","자동차등록증","보험증권"],
  "리스":     ["차량계약서","리스계약서","입금확인서","자동차등록증","보험증권"],
  "장기렌트": ["차량계약서","렌트계약서","입금확인서","자동차등록증","보험증권"]
};

var DOC_CUSTOMER_DOC_TYPES = [
  "신분증","사업자등록증","법인등기부등본","법인인감증명서",
  "대표자 신분증","통장사본","위임장","개인정보동의서","기타"
];
var DOC_VEHICLE_DOC_TYPES = [
  "차량계약서","자동차등록증","입금확인서","세금계산서","보험증권",
  "금융계약서","리스계약서","렌트계약서","인수증","탁송확인서","출고사진","기타"
];

// ── Drive 폴더 링크/ID 문자열에서 폴더 ID만 추출 ──────────────
function extractDriveFolderId(value) {
  var s = String(value || "").trim();
  if (!s) return "";
  // https://drive.google.com/drive/folders/XXXX?usp=sharing 형태
  var m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return m[1];
  // https://drive.google.com/open?id=XXXX 형태
  var m2 = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2 && m2[1]) return m2[1];
  // 이미 ID만 붙여넣은 경우 (구글 드라이브 ID는 보통 영문/숫자/-/_ 조합)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  return s;
}

// ── 설정된 최상위 폴더 가져오기 (여기서 새로 생성하지 않음) ──────
function getDriveRootFolder() {
  var id = extractDriveFolderId(DRIVE_ROOT_FOLDER_ID);
  if (!id || id.indexOf("여기에_") === 0) {
    throw new Error("Google Drive 최상위 폴더가 설정되지 않았습니다. Code.gs 상단의 DRIVE_ROOT_FOLDER_ID를 확인해주세요.");
  }
  try {
    var folder = DriveApp.getFolderById(id);
    // 이름을 한 번 읽어 실제 접근 가능한지(권한 포함) 확인한다.
    folder.getName();
    return folder;
  } catch (err) {
    throw new Error("설정한 Google Drive 폴더를 찾을 수 없거나 접근 권한이 없습니다. 폴더 링크/ID와 공유 설정을 확인해주세요. (" + err.message + ")");
  }
}

// ── 관리자용: 최상위 폴더 연결 테스트 ─────────────────────────
// Apps Script 편집기에서 이 함수를 직접 실행해 결과를 로그에서 확인한다.
function testDriveRootFolderConnection() {
  try {
    var folder = getDriveRootFolder();
    var canWrite = false;
    var writeTestName = "_TEST_연결확인_" + new Date().getTime();
    try {
      var testFile = folder.createFile(Utilities.newBlob("connection test", "text/plain", writeTestName + ".txt"));
      canWrite = true;
      testFile.setTrashed(true); // 테스트 파일은 즉시 휴지통으로 이동
    } catch (writeErr) {
      canWrite = false;
    }
    var result = {
      success: true,
      folderName: folder.getName(),
      folderId: folder.getId(),
      folderUrl: folder.getUrl(),
      canWrite: canWrite
    };
    console.log("[Drive 최상위 폴더 연결 테스트] 성공", JSON.stringify(result));
    return result;
  } catch (err) {
    console.error("[Drive 최상위 폴더 연결 테스트] 실패", err.message);
    return { success: false, message: err.message };
  }
}

// ── 파일/폴더명에 쓸 수 없는 특수문자 안전 치환 ───────────────
function sanitizeDriveName(s) {
  s = String(s || "").trim();
  if (!s) return "이름없음";
  // Windows/Drive에서 문제가 되는 문자 치환: / \ : * ? " < > |
  s = s.replace(/[\/\\:*?"<>|]/g, "_");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 120) s = s.substring(0, 120);
  return s || "이름없음";
}

function pad2(n) { return String(n).padStart(2, "0"); }

function nowTimestampForFileName() {
  var d = new Date();
  return d.getFullYear() + pad2(d.getMonth()+1) + pad2(d.getDate()) + "_" +
         pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

function nowIsoLike() {
  var d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate()) + " " +
         pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

// ── 시트 헤더가 기대한 컬럼을 모두 포함하는지 "한 번의 읽기"로 확인 ──
// (code112 성능 최적화) 기존에는 헤더 개수만큼 ensureColumn()을 반복
// 호출해 매번 sheet.getRange().getDisplayValues()를 따로 실행했다
// (문서관리 시트 기준 헤더 24개 = 요청 1건당 24번의 Spreadsheet 읽기).
// 헤더 행을 딱 한 번만 읽어 메모리에서 비교하고, 실제로 없는 컬럼이
// 있을 때만(스키마 업그레이드 등 드문 경우) ensureColumn()으로 추가한다.
// 컬럼 순서/내용은 기존과 완전히 동일하게 유지된다.
function ensureHeadersFast(sheet, expectedHeaders) {
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function(v){ return String(v||"").trim(); })
    : [];
  var missing = expectedHeaders.filter(function(h){ return headers.indexOf(h) < 0; });
  if (missing.length > 0) {
    missing.forEach(function(h){ ensureColumn(sheet, h); });
  }
}

// ── 문서관리 시트 (없으면 생성, 있으면 재사용 — 기존 열 순서 절대 변경 금지) ──
// ctx(선택): handleUploadDocument()의 요청 단위 캐시 객체. 넘겨주면 같은
// 요청 안에서 이 함수가 여러 번 호출돼도 시트 조회/헤더 검사를 한 번만
// 수행한다. ctx 없이 호출하는 기존 호출부(목록조회/삭제/교체/진단 함수 등)는
// 예전과 완전히 동일하게 동작한다 — 동작 자체는 전혀 바뀌지 않는다.
function getDocumentSheet(ctx) {
  if (ctx && ctx.documentSheet) return ctx.documentSheet;
  var sh = SS.getSheetByName(DOC_SHEET_NAME);
  if (!sh) {
    sh = SS.insertSheet(DOC_SHEET_NAME);
    sh.appendRow(DOC_SHEET_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange("1:1").setFontWeight("bold");
  } else {
    ensureHeadersFast(sh, DOC_SHEET_HEADERS);
  }
  if (ctx) ctx.documentSheet = sh;
  return sh;
}

// ── 문서폴더 시트 (Drive folderId 재사용 저장소) ──────────────
function getDocFolderSheet(ctx) {
  if (ctx && ctx.folderSheet) return ctx.folderSheet;
  var sh = SS.getSheetByName(DOC_FOLDER_SHEET_NAME);
  if (!sh) {
    sh = SS.insertSheet(DOC_FOLDER_SHEET_NAME);
    sh.appendRow(DOC_FOLDER_SHEET_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange("1:1").setFontWeight("bold");
  } else {
    ensureHeadersFast(sh, DOC_FOLDER_SHEET_HEADERS);
  }
  if (ctx) ctx.folderSheet = sh;
  return sh;
}

// scope: "CUSTOMER" | "VEHICLE" | "UNIT"
function makeFolderKey(scope, customerId, vehicleId, unitNo) {
  return [
    scope,
    String(customerId||"").trim(),
    String(vehicleId||"").trim(),
    unitNo ? String(unitNo).trim() : ""
  ].join("::");
}

function findFolderRowByKey(fs, key) {
  var data = fs.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]||"").trim() === key) {
      return {
        rowNum: i+1,
        folderId: String(data[i][5]||"").trim()
      };
    }
  }
  return null;
}

// ── (code112) 문서폴더 시트 전체를 "요청당 한 번만" 읽어 folderKey→행 맵을
//   만든다. 고객/차량/호차 폴더 3단계를 조회할 때마다 매번 전체 시트를
//   다시 읽던 것(최대 3회)을 1회로 줄인다. ctx 없이 부르면(다른 기능에서
//   호출 시) 캐싱 없이 이전과 동일하게 매번 새로 읽는다 — 기존 동작 보존.
function getFolderMapCached(ctx) {
  if (ctx && ctx.folderMapByKey) return ctx.folderMapByKey;
  var fs = getDocFolderSheet(ctx);
  var data = fs.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]||"").trim();
    if (!key) continue;
    map[key] = { rowNum: i+1, folderId: String(data[i][5]||"").trim() };
  }
  if (ctx) ctx.folderMapByKey = map;
  return map;
}

// ── 문서관리 시트에서 지정된 folderId가 Drive에 실제로 존재하는지 확인 ──
function folderStillExists(folderId) {
  if (!folderId) return false;
  try {
    var f = DriveApp.getFolderById(folderId);
    return !f.isTrashed();
  } catch (err) {
    return false;
  }
}

// ── 고객 폴더 / 차량 폴더 / 호차 폴더 가져오기(없으면 생성) ────────
// LockService로 동시 업로드 요청에서도 같은 폴더가 중복 생성되지 않게 한다.
// (code112) 폴더가 이미 존재하는 정상 케이스(가장 흔한 경우)는:
//   - 문서폴더 시트를 ctx 캐시(getFolderMapCached)로 조회 → 전체 재조회 없음
//   - DriveApp.getFolderById()를 "한 번만" 호출 (기존엔 존재확인 1회 +
//     반환용으로 다시 1회, 총 2회 호출했다)
//   - Lock을 전혀 잡지 않는다 (요청사항 9)
// 폴더가 실제로 없어서 "새로 만들어야 하는" 경우에만 Lock을 잡고, 락 이후
// 재확인은 안전을 위해 시트를 다시 읽는다(캐시를 신뢰하지 않음 — 동시 요청
// 방어가 캐시 최적화보다 우선한다).
function getOrCreateFolder(scope, key, folderName, parentFolder, customerId, vehicleId, unitNo, ctx) {
  var map = getFolderMapCached(ctx);
  var existing = map[key];

  if (existing && existing.folderId) {
    try {
      var f = DriveApp.getFolderById(existing.folderId);
      if (!f.isTrashed()) return f;
    } catch (notFoundErr) {
      // 폴더가 삭제/접근불가 — 아래에서 Lock을 잡고 새로 만든다.
    }
  }

  var fs = getDocFolderSheet(ctx);
  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(15000);
  if (!gotLock) {
    throw new Error("다른 폴더 생성 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.");
  }
  try {
    // 락을 잡은 뒤 한 번 더 확인 (동시 요청 방어) — 이 재확인은 캐시가 아니라
    // 시트를 직접 다시 읽어야 정확하다(다른 요청이 그 사이 만들었을 수 있음).
    var reCheck = findFolderRowByKey(fs, key);
    if (reCheck && reCheck.folderId && folderStillExists(reCheck.folderId)) {
      return DriveApp.getFolderById(reCheck.folderId);
    }

    var newFolder = parentFolder.createFolder(folderName);
    var nowStr = nowIsoLike();

    if (reCheck) {
      fs.getRange(reCheck.rowNum, 6).setValue(newFolder.getId()); // folderId
      fs.getRange(reCheck.rowNum, 7).setValue(folderName);        // folderName
      fs.getRange(reCheck.rowNum, 9).setValue(nowStr);            // updatedAt
    } else {
      fs.appendRow([
        key, scope, customerId||"", vehicleId||"", unitNo||"",
        newFolder.getId(), folderName, nowStr, nowStr
      ]);
    }
    // 같은 요청 안에서 다음 폴더 단계(차량→호차 등)가 이 결과를 캐시에서
    // 바로 재사용할 수 있게 갱신해둔다.
    if (ctx && ctx.folderMapByKey) {
      ctx.folderMapByKey[key] = { rowNum: reCheck ? reCheck.rowNum : fs.getLastRow(), folderId: newFolder.getId() };
    }
    return newFolder;
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

// ── 고객 폴더명: "CUST-xxxx_법인명또는고객명" ─────────────────
function buildCustomerFolderName(customerId, customerName, companyName) {
  var label = companyName ? companyName : customerName;
  return sanitizeDriveName(customerId) + "_" + sanitizeDriveName(label);
}

function getOrCreateCustomerFolder(customerId, customerName, companyName, ctx) {
  var root = getDriveRootFolder();
  var key = makeFolderKey("CUSTOMER", customerId, "", "");
  var folderName = buildCustomerFolderName(customerId, customerName, companyName);
  return getOrCreateFolder("CUSTOMER", key, folderName, root, customerId, "", "", ctx);
}

// ── 고객 공통서류 하위 폴더: "00_고객공통서류" ─────────────────
function getOrCreateCustomerCommonDocFolder(customerId, customerName, companyName, ctx) {
  var customerFolder = getOrCreateCustomerFolder(customerId, customerName, companyName, ctx);
  var key = makeFolderKey("CUSTOMER_COMMON", customerId, "", "");
  return getOrCreateFolder("CUSTOMER_COMMON", key, "00_고객공통서류", customerFolder, customerId, "", "", ctx);
}

// ── 차량 폴더명: "VEH-xxxx_모델명_세부모델" ─────────────────────
function buildVehicleFolderName(vehicleId, modelName, detailModel) {
  var parts = [sanitizeDriveName(vehicleId), sanitizeDriveName(modelName || "모델미상")];
  if (detailModel) parts.push(sanitizeDriveName(detailModel));
  return parts.join("_");
}

function getOrCreateVehicleFolder(customerId, customerName, companyName, vehicleId, modelName, detailModel, ctx) {
  var customerFolder = getOrCreateCustomerFolder(customerId, customerName, companyName, ctx);
  var key = makeFolderKey("VEHICLE", customerId, vehicleId, "");
  var folderName = buildVehicleFolderName(vehicleId, modelName, detailModel);
  return getOrCreateFolder("VEHICLE", key, folderName, customerFolder, customerId, vehicleId, "", ctx);
}

// ── 호차 폴더: "01호차" 또는 "01호차_차량번호" (수량 2대 이상일 때만 사용) ──
function buildUnitFolderName(unitNo, plateNo) {
  var base = pad2(parseInt(unitNo,10)||1) + "호차";
  return plateNo ? base + "_" + sanitizeDriveName(plateNo) : base;
}

function getOrCreateUnitFolder(customerId, customerName, companyName, vehicleId, modelName, detailModel, unitNo, plateNo, ctx) {
  var vehicleFolder = getOrCreateVehicleFolder(customerId, customerName, companyName, vehicleId, modelName, detailModel, ctx);
  var key = makeFolderKey("UNIT", customerId, vehicleId, unitNo);
  var folderName = buildUnitFolderName(unitNo, plateNo);
  return getOrCreateFolder("UNIT", key, folderName, vehicleFolder, customerId, vehicleId, unitNo, ctx);
}

// ── customerId/vehicleId 서버측 검증 (문서관리 전용, 요청사항 18) ──────
function validateCustomerForDocuments(customerId) {
  var cid = String(customerId||"").trim();
  if (!cid) throw new Error("고객을 먼저 저장한 후 문서를 등록해주세요.");
  var cs = getCustomerSheet();
  var count = countCustomerIdOccurrences(cs, cid);
  if (count === 0) throw new Error("고객ID " + cid + "를 고객관리 시트에서 찾을 수 없습니다. 고객을 먼저 저장해주세요.");
  if (count > 1) throw new Error("고객ID가 중복되어 문서를 연결할 수 없습니다. 관리자에게 문의해주세요.");
  return true;
}

function findVehicleRowInfo(vs, vehicleId) {
  var data = vs.getDataRange().getValues();
  var matches = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]||"").trim() === String(vehicleId||"").trim()) {
      matches.push({
        rowNum: i+1,
        customerId: String(data[i][1]||"").trim(),
        customerName: String(data[i][2]||"").trim(),
        modelName: String(data[i][4]||"").trim(),
        detailModel: String(data[i][5]||"").trim(),
        quantity: Math.max(1, parseInt(data[i][11],10)||1)
      });
    }
  }
  return matches;
}

function validateVehicleForDocuments(customerId, vehicleId) {
  var cid = String(customerId||"").trim();
  var vid = String(vehicleId||"").trim();
  if (!vid) throw new Error("차량을 먼저 저장한 후 차량서류를 등록해주세요.");
  validateCustomerForDocuments(cid);
  var vs = getVehicleSheet();
  var matches = findVehicleRowInfo(vs, vid);
  if (matches.length === 0) throw new Error("해당 차량 정보를 찾을 수 없습니다. 차량을 먼저 저장해주세요.");
  if (matches.length > 1) throw new Error("차량ID가 중복되어 문서를 연결할 수 없습니다. 관리자에게 문의해주세요.");
  if (matches[0].customerId !== cid) throw new Error("해당 차량이 이 고객에게 연결되어 있지 않습니다.");
  return matches[0];
}

// ── 파일명/확장자/MIME 검증 ─────────────────────────────────
function getFileExtension(fileName) {
  var s = String(fileName||"");
  var idx = s.lastIndexOf(".");
  if (idx < 0) return "";
  return s.substring(idx+1).toLowerCase().trim();
}

function validateUploadFile(fileName, mimeType, fileSize) {
  var ext = getFileExtension(fileName);
  if (DOC_BLOCKED_EXTENSIONS[ext]) {
    throw new Error("지원하지 않는 파일 형식입니다. (실행 파일 등은 업로드할 수 없습니다)");
  }
  if (!DOC_ALLOWED_EXTENSIONS[ext]) {
    throw new Error("지원하지 않는 파일 형식입니다. (.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.hwp 만 허용)");
  }
  if (mimeType && mimeType.indexOf("text/html") >= 0) {
    throw new Error("지원하지 않는 파일 형식입니다.");
  }
  var size = parseInt(fileSize, 10) || 0;
  if (size > DOC_MAX_FILE_SIZE) {
    throw new Error("파일 크기가 8MB를 초과합니다. 파일을 압축하거나 Google Drive에 직접 저장한 후 링크를 등록해주세요.");
  }
  // 경로 조작 문자 제거는 sanitizeDriveName()에서 별도로 처리한다.
  return true;
}

// ── documentId 생성 ──────────────────────────────────────────
function genDocumentId() {
  return "DOC-" + Utilities.getUuid();
}

// ── 문서관리 시트에 한 행 추가 ─────────────────────────────────
// ctx(선택)를 넘기면 getDocumentSheet(ctx)의 캐시된 시트 객체를 재사용한다.
function appendDocumentRow(fields, ctx) {
  var ds = getDocumentSheet(ctx);
  var nowStr = nowIsoLike();
  var row = DOC_SHEET_HEADERS.map(function(h){
    if (h === "uploadedAt" || h === "updatedAt") return fields[h] || nowStr;
    if (h === "isDeleted") return fields.isDeleted ? "TRUE" : "FALSE";
    return fields[h] !== undefined && fields[h] !== null ? fields[h] : "";
  });
  ds.appendRow(row);
  return ds.getLastRow();
}

// ── (code112) requestToken 컬럼 위치 — DOC_SHEET_HEADERS 순서를 그대로
//   따른다(끝에서 계산하므로 컬럼 추가/순서 변경 시에도 항상 정확하다).
var DOC_REQUEST_TOKEN_COL = DOC_SHEET_HEADERS.indexOf("requestToken") + 1;

// ── (code112) requestToken 중복 확인을 "전체 시트 재조회" 없이 수행 ──
//   기존에는 readDocumentRows(false)로 문서관리 시트 전체(모든 컬럼 ×
//   모든 행)를 읽어와 requestToken이 일치하는 행을 찾았다. 이는 문서가
//   많아질수록 느려지고, 업로드 한 건당 최대 2번(사전확인 + append 직전
//   재확인) 반복됐다.
//   TextFinder는 requestToken "한 컬럼"만 대상으로 검색하므로 훨씬
//   가볍다. 이 함수는 매번 시트를 실시간으로 검색한다(캐시하지 않음) —
//   특히 append 직전의 두 번째 확인은 동시 요청으로 인한 진짜 중복을
//   잡아내야 하므로 캐시된 값이 아니라 항상 최신 데이터를 봐야 한다.
function findDocumentByRequestTokenLive(ds, requestToken) {
  var token = String(requestToken||"").trim();
  if (!token) return null;
  var lastRow = ds.getLastRow();
  if (lastRow < 2) return null; // 헤더만 있고 데이터 없음
  var range = ds.getRange(2, DOC_REQUEST_TOKEN_COL, lastRow - 1, 1);
  var finder = range.createTextFinder(token).matchEntireCell(true);
  var found = finder.findNext();
  if (!found) return null;
  var rowNum = found.getRow();
  var rowValues = ds.getRange(rowNum, 1, 1, DOC_SHEET_HEADERS.length).getValues()[0];
  var obj = docRowToObject(rowValues, rowNum);
  if (obj.isDeleted) return null; // 삭제된 문서는 중복으로 취급하지 않음(기존 readDocumentRows(false)와 동일 규칙)
  return { rowNum: rowNum, obj: obj };
}

// ── (code112) 고객 검증 + 고객 기본정보 조회를 "한 번의 시트 읽기"로 통합 ──
//   기존에는 validateCustomerForDocuments()(countCustomerIdOccurrences 포함)와
//   getCustomerBasicInfo()가 각각 고객관리 시트 전체를 따로 읽었다(요청당
//   2회). 이 함수는 같은 데이터를 한 번만 읽어 "중복 개수"와 "고객명/법인명"을
//   동시에 계산한다. ctx.customerData에 결과를 캐시해 같은 요청 안에서
//   재호출돼도 다시 읽지 않는다.
//   검증 로직(0개→오류, 2개 이상→오류)은 validateCustomerForDocuments()와
//   완전히 동일하다 — 문서관리 전용 handleUploadDocument()에서만 사용하고,
//   validateCustomerForDocuments()/getCustomerBasicInfo() 자체는 다른
//   기능(문서 조회/삭제/링크등록, 진단 함수 등)이 계속 그대로 쓰므로
//   손대지 않았다.
function loadCustomerInfoForDocuments(customerId, ctx) {
  var cid = String(customerId||"").trim();
  if (ctx && ctx.customerInfoByCid && ctx.customerInfoByCid[cid]) return ctx.customerInfoByCid[cid];

  var cs = getCustomerSheet();
  var data = (ctx && ctx.customerData) ? ctx.customerData : cs.getDataRange().getValues();
  if (ctx) ctx.customerData = data;

  var header = data[0].map(function(h){ return String(h||"").trim(); });
  var cidCol=-1, nameCol=-1, companyCol=-1;
  for (var i=0;i<header.length;i++) {
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (mapped==="customerId") cidCol=i;
    if (mapped==="customerName") nameCol=i;
    if (mapped==="companyName") companyCol=i;
  }

  var count = 0, customerName = "", companyName = "", found = false;
  if (cidCol >= 0) {
    for (var r=1;r<data.length;r++) {
      if (String(data[r][cidCol]||"").trim() === cid) {
        count++;
        if (!found) {
          customerName = nameCol>=0 ? String(data[r][nameCol]||"") : "";
          companyName  = companyCol>=0 ? String(data[r][companyCol]||"") : "";
          found = true;
        }
      }
    }
  }
  var result = { count: count, customerName: customerName, companyName: companyName };
  if (ctx) {
    ctx.customerInfoByCid = ctx.customerInfoByCid || {};
    ctx.customerInfoByCid[cid] = result;
  }
  return result;
}

function docRowToObject(row, rowNum) {
  var obj = {};
  DOC_SHEET_HEADERS.forEach(function(h, i){ obj[h] = row[i] === undefined || row[i] === null ? "" : row[i]; });
  obj.isDeleted = String(obj.isDeleted).toUpperCase() === "TRUE";
  obj.fileSize = parseInt(obj.fileSize, 10) || 0;
  obj._rowNumber = rowNum;
  return obj;
}

function readDocumentRows(includeDeleted) {
  var ds = getDocumentSheet();
  var data = ds.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue; // documentId 없는 빈 행은 건너뜀
    var obj = docRowToObject(data[i], i+1);
    if (!includeDeleted && obj.isDeleted) continue;
    result.push(obj);
  }
  return result;
}

function findDocumentRowById(documentId) {
  var ds = getDocumentSheet();
  var data = ds.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]||"").trim() === String(documentId||"").trim()) {
      return { rowNum: i+1, obj: docRowToObject(data[i], i+1) };
    }
  }
  return null;
}

// ── 고객 공통서류 목록 조회 ─────────────────────────────────
function handleListCustomerDocuments(p) {
  try {
    var customerId = String(p.customerId||"").trim();
    if (!customerId) throw new Error("customerId가 필요합니다.");
    var docs = readDocumentRows(false).filter(function(d){
      return d.customerId === customerId && d.documentScope === "CUSTOMER";
    });
    docs.sort(function(a,b){ return (a.uploadedAt < b.uploadedAt) ? 1 : -1; });
    return jsonResp({ success:true, documents: docs, count: docs.length, serverVersion: SERVER_VERSION });
  } catch (err) {
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  }
}

// ── 차량서류 목록 조회 (unitNo 지정 시 해당 호차만, 없으면 차량 전체) ──
function handleListVehicleDocuments(p) {
  try {
    var customerId = String(p.customerId||"").trim();
    var vehicleId  = String(p.vehicleId||"").trim();
    if (!customerId || !vehicleId) throw new Error("customerId와 vehicleId가 필요합니다.");
    var unitNo = (p.unitNo !== undefined && p.unitNo !== null && p.unitNo !== "") ? String(p.unitNo) : "";

    var docs = readDocumentRows(false).filter(function(d){
      if (d.customerId !== customerId || d.vehicleId !== vehicleId || d.documentScope !== "VEHICLE") return false;
      if (unitNo && String(d.unitNo||"") !== unitNo) return false;
      return true;
    });
    docs.sort(function(a,b){ return (a.uploadedAt < b.uploadedAt) ? 1 : -1; });
    return jsonResp({ success:true, documents: docs, count: docs.length, serverVersion: SERVER_VERSION });
  } catch (err) {
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  }
}

// ── 문서 업로드 (Base64) ─────────────────────────────────────
function handleUploadDocument(p) {
  var createdFile = null; // 검증 실패 시 롤백(휴지통 이동) 대상
  var step = "요청 파싱";
  var customerId = "", vehicleId = "", requestToken = "";

  // ★ (code112) 요청 단위 메모리 캐시 — 이 handleUploadDocument() 실행 1회
  //   안에서만 살아있다. getDocumentSheet/getDocFolderSheet가 반환한 시트
  //   객체와 문서폴더 folderKey→행 맵, 고객 시트 원본 데이터를 담아 같은
  //   요청 안에서 같은 시트를 여러 번 getDataRange().getValues()하지
  //   않게 한다. CacheService 같은 실행 간 캐시는 절대 사용하지 않는다 —
  //   다른 요청에서 바뀐 데이터가 여기 남아 문서가 잘못 연결되는 사고를
  //   막기 위함이다(요청사항 2).
  var ctx = {
    documentSheet: null,
    folderSheet: null,
    folderMapByKey: null,
    customerData: null,
    customerInfoByCid: null
  };

  // ★ (code112) 서버 구간별 성능 로그 (요청사항 12) — Base64/개인정보는
  //   남기지 않고, 각 단계 소요시간과 총 소요시간만 기록한다.
  var perfStart = Date.now();
  var perfLastMark = perfStart;
  var perfMarks = [];
  function markPerf(label) {
    var now = Date.now();
    perfMarks.push(label + ": " + (now - perfLastMark) + "ms");
    perfLastMark = now;
  }
  function flushPerfLog() {
    var totalMs = Date.now() - perfStart;
    console.log("[DOC-PERF]\n\n" + perfMarks.join("\n") + "\n\nTOTAL: " + totalMs + "ms");
  }

  try {
    var scope = String(p.documentScope||"").toUpperCase();
    if (scope !== "CUSTOMER" && scope !== "VEHICLE") {
      throw new Error("documentScope는 CUSTOMER 또는 VEHICLE 이어야 합니다.");
    }

    customerId = String(p.customerId||"").trim();
    vehicleId  = scope === "VEHICLE" ? String(p.vehicleId||"").trim() : "";
    var unitNo = scope === "VEHICLE" && p.unitNo ? String(p.unitNo).trim() : "";

    var fileName = String(p.fileName||"").trim();
    var mimeType = String(p.mimeType||"application/octet-stream").trim();
    var fileSize = parseInt(p.fileSize,10) || 0;
    var base64Data = p.base64Data;

    if (!fileName || !base64Data) throw new Error("업로드할 파일 정보가 올바르지 않습니다.");
    validateUploadFile(fileName, mimeType, fileSize);

    // ★ 차량서류 vehicleId 연결 끊김 방지 및 고아문서 복구 (code103) ──────────
    //   동일 requestToken으로 이미 저장된 "삭제되지 않은" 문서가 있으면
    //   새로 만들지 않고 그 문서 정보를 그대로 반환한다.
    //   ★ (code112) readDocumentRows(false)로 문서관리 시트 전체를 읽던 것을
    //   requestToken 컬럼만 검색하는 TextFinder 기반 조회로 교체했다
    //   (findDocumentByRequestTokenLive, 요청사항 6). 매번 실시간 조회이므로
    //   중복 방지 정확도는 그대로 유지된다.
    //   ★ (code111) 이 조회도 Spreadsheet 일시 오류의 영향을 받을 수 있으므로
    //   재시도 대상으로 감싼다(논리 오류는 withSpreadsheetRetry가 재시도 없이
    //   즉시 던진다).
    requestToken = String(p.requestToken||"").trim();
    step = "requestToken 중복 확인";
    if (requestToken) {
      var already = withSpreadsheetRetry(function () {
        var ds0 = getDocumentSheet(ctx);
        var hit = findDocumentByRequestTokenLive(ds0, requestToken);
        return hit ? hit.obj : null;
      }, step);
      markPerf("requestToken 확인");
      if (already) {
        console.log("[중복 업로드 방지] 동일 requestToken의 기존 문서를 그대로 반환", requestToken, already.documentId);
        flushPerfLog();
        return jsonResp({
          success: true,
          documentId: already.documentId,
          fileUrl: already.driveFileUrl,
          driveFileId: already.driveFileId,
          requestToken: requestToken,
          duplicate: true,
          serverVersion: SERVER_VERSION
        });
      }
    } else {
      markPerf("requestToken 확인");
    }

    var docType = String(p.documentType||"기타").trim() || "기타";
    var docName = String(p.documentName||"").trim();
    var memo = String(p.memo||"").trim();

    var targetFolder, customerName = "", companyName = "", modelName = "", detailModel = "";

    // ★ (code112) 고객 검증(중복 개수)과 고객 기본정보(고객명/법인명) 조회를
    //   loadCustomerInfoForDocuments() 한 번으로 합쳤다 — 기존에는
    //   validateCustomerForDocuments()와 getCustomerBasicInfo()가 각각
    //   고객관리 시트 전체를 따로 읽었다(요청사항 7). 검증 순서·오류
    //   메시지는 기존 validateCustomerForDocuments()/validateVehicleForDocuments()와
    //   동일하게 유지했다(먼저 고객 검증 → 그 다음 차량 검증).
    if (scope === "CUSTOMER") {
      if (!customerId) throw new Error("고객을 먼저 저장한 후 문서를 등록해주세요.");
      step = "고객 검증 및 정보 조회";
      var custData = withSpreadsheetRetry(function () { return loadCustomerInfoForDocuments(customerId, ctx); }, step);
      if (custData.count === 0) throw new Error("고객ID " + customerId + "를 고객관리 시트에서 찾을 수 없습니다. 고객을 먼저 저장해주세요.");
      if (custData.count > 1) throw new Error("고객ID가 중복되어 문서를 연결할 수 없습니다. 관리자에게 문의해주세요.");
      customerName = custData.customerName;
      companyName  = custData.companyName;
      markPerf("고객/차량 검증");

      step = "고객 공통서류 폴더 준비";
      targetFolder = withSpreadsheetRetry(function () {
        return getOrCreateCustomerCommonDocFolder(customerId, customerName, companyName, ctx);
      }, step);
      markPerf("Drive 폴더 준비");
    } else {
      // ★ 다중차량 고객 보호 (요청사항 2, 9, 10) — customerId만으로 문서를
      //   연결하지 않고, 반드시 customerId + vehicleId 복합 조건으로 정확히
      //   1개의 차량 행을 찾아야 한다. 차량이 없거나(matches.length===0),
      //   vehicleId가 중복이거나(matches.length>1), 이 차량이 다른 고객
      //   소유면(customerId 불일치) 즉시 논리 오류를 던진다 — 이런 경우는
      //   재시도해도 결과가 같으므로 withSpreadsheetRetry가 재시도 없이
      //   그대로 통과시킨다.
      if (!vehicleId) throw new Error("차량을 먼저 저장한 후 차량서류를 등록해주세요.");
      if (!customerId) throw new Error("고객을 먼저 저장한 후 문서를 등록해주세요.");

      step = "고객 검증 및 정보 조회";
      var custData2 = withSpreadsheetRetry(function () { return loadCustomerInfoForDocuments(customerId, ctx); }, step);
      if (custData2.count === 0) throw new Error("고객ID " + customerId + "를 고객관리 시트에서 찾을 수 없습니다. 고객을 먼저 저장해주세요.");
      if (custData2.count > 1) throw new Error("고객ID가 중복되어 문서를 연결할 수 없습니다. 관리자에게 문의해주세요.");
      companyName = custData2.companyName;

      step = "차량 검증(customerId+vehicleId)";
      var vInfo = withSpreadsheetRetry(function () {
        var vs = getVehicleSheet();
        var matches = findVehicleRowInfo(vs, vehicleId);
        if (matches.length === 0) throw new Error("해당 차량 정보를 찾을 수 없습니다. 차량을 먼저 저장해주세요.");
        if (matches.length > 1) throw new Error("차량ID가 중복되어 문서를 연결할 수 없습니다. 관리자에게 문의해주세요.");
        if (matches[0].customerId !== customerId) throw new Error("해당 차량이 이 고객에게 연결되어 있지 않습니다.");
        return matches[0];
      }, step);
      customerName = vInfo.customerName;
      modelName    = vInfo.modelName;
      detailModel  = vInfo.detailModel;
      markPerf("고객/차량 검증");

      step = "차량서류 폴더 준비";
      if (vInfo.quantity >= 2 && unitNo) {
        targetFolder = withSpreadsheetRetry(function () {
          return getOrCreateUnitFolder(customerId, customerName, companyName, vehicleId, modelName, detailModel, unitNo, "", ctx);
        }, step);
      } else {
        targetFolder = withSpreadsheetRetry(function () {
          return getOrCreateVehicleFolder(customerId, customerName, companyName, vehicleId, modelName, detailModel, ctx);
        }, step);
      }
      markPerf("Drive 폴더 준비");
    }

    // ── 저장 파일명 규칙 (요청사항 12, 이전 세션) ──────────────
    var ts = nowTimestampForFileName();
    var safeOriginal = sanitizeDriveName(fileName);
    var storedFileName;
    if (scope === "CUSTOMER") {
      storedFileName = sanitizeDriveName(companyName||customerName) + "_" + sanitizeDriveName(docType) + "_" + ts + "_" + safeOriginal;
    } else {
      var unitLabel = unitNo ? pad2(parseInt(unitNo,10)||1)+"호차" : "";
      storedFileName = [sanitizeDriveName(modelName), sanitizeDriveName(detailModel), unitLabel, sanitizeDriveName(docType), ts, safeOriginal]
        .filter(function(x){return x;}).join("_");
    }

    step = "Base64 디코드";
    var bytes = Utilities.base64Decode(base64Data);
    markPerf("Base64 decode");

    step = "Drive 파일 생성";
    var blob = Utilities.newBlob(bytes, mimeType, storedFileName);
    var file = targetFolder.createFile(blob);
    createdFile = file; // 이 시점부터 실패하면 휴지통으로 되돌린다
    // 기본 Drive 권한 유지 — 링크 공개 공유로 절대 변경하지 않는다 (요청사항 17).
    markPerf("Drive 파일 생성");

    var documentId = genDocumentId();

    // ★ Spreadsheet 재시도 + requestToken 이중 방어 (요청사항 6, 7, 8, code111/112) ──
    //   append 직전에 requestToken을 한 번 더 확인한다(TextFinder, 항상 실시간
    //   조회 — 캐시하지 않음. 동시 요청으로 인한 진짜 중복을 잡아내야 하므로).
    //   withSpreadsheetRetry가 이 함수 전체를 재시도할 때도(예: appendRow는
    //   성공했는데 그 다음 저장검증 단계에서만 일시 오류가 나 재시도가 걸리는
    //   경우), 재시도 2회차는 이 재확인에서 "이미 저장됨"을 발견하고
    //   appendDocumentRow()를 다시 호출하지 않는다 — 문서관리 행이 중복
    //   생성되는 사고를 원천 차단한다.
    //   방금 만든 Drive 파일(file)의 ID와 발견된 기존 행의 driveFileId가
    //   같으면 "이번 요청이 실제로 저장한 것"이므로 정상 성공으로 처리하고,
    //   다르면(= 이전의 별도 요청이 이미 저장해둔 문서) 방금 만든 파일은
    //   중복이므로 휴지통으로 되돌린다.
    var appendResult = withSpreadsheetRetry(function () {
      var ds = getDocumentSheet(ctx);

      if (requestToken) {
        var dupHit = findDocumentByRequestTokenLive(ds, requestToken);
        if (dupHit) {
          return { duplicate: true, sameFile: dupHit.obj.driveFileId === file.getId(), doc: dupHit.obj };
        }
      }

      step = "문서관리 행 저장";
      var rowNum = appendDocumentRow({
        documentId: documentId,
        customerId: customerId,
        vehicleId: vehicleId,
        unitNo: unitNo,
        customerName: customerName,
        companyName: companyName,
        modelName: modelName,
        detailModel: detailModel,
        documentScope: scope,
        documentType: docType,
        documentName: docName,
        originalFileName: fileName,
        storedFileName: storedFileName,
        mimeType: mimeType,
        fileSize: fileSize,
        driveFileId: file.getId(),
        driveFileUrl: file.getUrl(),
        driveFolderId: targetFolder.getId(),
        memo: memo,
        isDeleted: false,
        requestToken: requestToken
      }, ctx);

      // ★ (code112) flush()는 정확히 1회만 호출한다(요청사항 5) — 안전을
      //   위해 완전히 제거하지는 않되, appendRow 직후 "방금 그 한 행"만
      //   검증에 쓸 것이므로 여기서 한 번으로 충분하다.
      SpreadsheetApp.flush();

      // ★ (code112, 요청사항 1·4) 문서관리 원자성 검증 — 기존에는
      //   findDocumentRowById()가 문서관리 시트 전체를 다시 읽어 documentId를
      //   검색했다. appendDocumentRow()가 반환한 rowNum을 그대로 이용해
      //   "그 한 행만" 읽어 검증하도록 바꿨다 — 전체 재조회가 사라진다.
      step = "저장 검증";
      var savedRow = ds.getRange(rowNum, 1, 1, DOC_SHEET_HEADERS.length).getValues()[0];
      var savedObj = docRowToObject(savedRow, rowNum);
      if (savedObj.documentId !== documentId || savedObj.driveFileId !== file.getId()) {
        throw new Error("문서관리 시트 저장 검증에 실패했습니다. 방금 업로드한 파일을 휴지통으로 이동합니다.");
      }
      return { duplicate: false };
    }, "문서관리 행 추가/검증");

    markPerf("문서관리 행 저장+검증");

    if (appendResult.duplicate) {
      if (!appendResult.sameFile) {
        try { file.setTrashed(true); console.warn("[중복 업로드 방지] 재확인 단계에서 다른 기존 문서 발견 — 방금 만든 파일을 휴지통으로 이동", file.getId()); }
        catch (ignoreTrash) {}
      }
      console.log("[문서 업로드]", appendResult.sameFile ? "재시도 중 이미 저장된 것을 확인" : "중복 업로드 방지", documentId, "→", appendResult.doc.documentId);
      flushPerfLog();
      return jsonResp({
        success: true,
        documentId: appendResult.doc.documentId,
        fileUrl: appendResult.doc.driveFileUrl,
        driveFileId: appendResult.doc.driveFileId,
        requestToken: requestToken,
        duplicate: !appendResult.sameFile,
        serverVersion: SERVER_VERSION
      });
    }

    console.log("[문서 업로드 완료]", documentId, scope, customerId, vehicleId, docType);
    flushPerfLog();

    return jsonResp({
      success: true,
      documentId: documentId,
      fileUrl: file.getUrl(),
      driveFileId: file.getId(),
      requestToken: requestToken,
      serverVersion: SERVER_VERSION
    });

  } catch (err) {
    // ★ code111: Spreadsheet 일시 오류로 재시도를 모두 소진한 경우
    //   (err._isDocSpreadsheetTemp) 원본 Google 오류 문자열은 로그에만
    //   남기고, 사용자에게는 withSpreadsheetRetry가 만든 안전한 안내
    //   메시지(err.message, 오류코드 DOC-SPREADSHEET-TEMP)만 보여준다.
    //   customerId 중복/차량 없음 등 논리 검증 오류는 이 분기를 타지
    //   않으므로 기존처럼 구체적인 원본 메시지 그대로 사용자에게 보여준다.
    if (err && err._isDocSpreadsheetTemp) {
      console.error("[DOC-SPREADSHEET-TEMP]",
        "customerId:", customerId,
        "vehicleId:", vehicleId,
        "requestToken:", requestToken,
        "step:", err._label || step,
        "originalError:", err._originalMessage);
    } else {
      console.error("[handleUploadDocument 오류]", "step:", step, "message:", err.message);
    }
    if (createdFile) {
      try { createdFile.setTrashed(true); console.warn("[업로드 실패 롤백] Drive 파일을 휴지통으로 이동", createdFile.getId()); }
      catch (trashErr) { console.error("[업로드 실패 롤백 실패]", trashErr.message); }
    }
    flushPerfLog();
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  }
}

// ── Google Drive 링크 직접 등록 (대용량 파일용, 요청사항 11) ──────
function handleRegisterDriveDocumentLink(p) {
  try {
    var scope = String(p.documentScope||"").toUpperCase();
    if (scope !== "CUSTOMER" && scope !== "VEHICLE") {
      throw new Error("documentScope는 CUSTOMER 또는 VEHICLE 이어야 합니다.");
    }
    var customerId = String(p.customerId||"").trim();
    var vehicleId  = scope === "VEHICLE" ? String(p.vehicleId||"").trim() : "";
    var unitNo     = scope === "VEHICLE" && p.unitNo ? String(p.unitNo).trim() : "";
    var driveLink  = String(p.driveLink||"").trim();
    if (!driveLink) throw new Error("Google Drive 파일 링크를 입력해주세요.");

    var fileId = extractDriveFolderId(driveLink); // 파일ID 패턴도 동일 정규식으로 대응
    var m = driveLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m && m[1]) fileId = m[1];

    var file;
    try {
      file = DriveApp.getFileById(fileId);
      file.getName(); // 접근 가능 여부 확인
    } catch (err) {
      throw new Error("해당 Drive 파일에 접근할 수 없습니다. 다른 계정 소유 파일이거나 권한이 없는 파일일 수 있습니다.");
    }

    if (scope === "CUSTOMER") {
      validateCustomerForDocuments(customerId);
    } else {
      validateVehicleForDocuments(customerId, vehicleId);
    }

    var custInfo = getCustomerBasicInfo(customerId);
    var docType = String(p.documentType||"기타").trim() || "기타";
    var docName = String(p.documentName||"").trim();
    var memo = String(p.memo||"").trim();

    var documentId = genDocumentId();
    appendDocumentRow({
      documentId: documentId,
      customerId: customerId,
      vehicleId: vehicleId,
      unitNo: unitNo,
      customerName: custInfo.customerName,
      companyName: custInfo.companyName,
      documentScope: scope,
      documentType: docType,
      documentName: docName,
      originalFileName: file.getName(),
      storedFileName: file.getName(),
      mimeType: file.getMimeType(),
      fileSize: file.getSize(),
      driveFileId: file.getId(),
      driveFileUrl: file.getUrl(),
      driveFolderId: "",
      memo: memo,
      isDeleted: false
    });

    SpreadsheetApp.flush();
    return jsonResp({ success:true, documentId: documentId, fileUrl: file.getUrl(), serverVersion: SERVER_VERSION });

  } catch (err) {
    console.error("[handleRegisterDriveDocumentLink 오류]", err.message);
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  }
}

// ── 문서 교체: 새 파일 업로드 성공 확인 후에만 기존 파일 정리 ──────
function handleReplaceDocument(p) {
  try {
    var oldDocId = String(p.oldDocumentId||"").trim();
    if (!oldDocId) throw new Error("교체할 기존 문서 ID가 필요합니다.");
    var found = findDocumentRowById(oldDocId);
    if (!found || found.obj.isDeleted) throw new Error("교체할 문서를 찾을 수 없습니다.");

    // 1) 새 파일을 먼저 업로드한다 (실패 시 여기서 예외가 나며 기존 파일은 그대로 유지됨).
    var uploadPayload = JSON.parse(JSON.stringify(p));
    uploadPayload.documentScope = found.obj.documentScope;
    uploadPayload.customerId = found.obj.customerId;
    uploadPayload.vehicleId = found.obj.vehicleId;
    uploadPayload.unitNo = found.obj.unitNo;
    uploadPayload.documentType = p.documentType || found.obj.documentType;

    var uploadResp = handleUploadDocument(uploadPayload);
    var uploadResult = JSON.parse(uploadResp.getContent());
    if (!uploadResult.success) {
      // 새 파일 업로드 실패 — 기존 파일은 절대 건드리지 않는다.
      return jsonResp(uploadResult);
    }

    // 2) 새 파일 저장이 확인된 뒤에만 기존 파일을 휴지통으로 이동하고 행을 isDeleted 처리한다.
    try {
      if (found.obj.driveFileId) {
        var oldFile = DriveApp.getFileById(found.obj.driveFileId);
        oldFile.setTrashed(true);
      }
    } catch (trashErr) {
      console.warn("[문서 교체 - 기존 파일 휴지통 이동 실패]", oldDocId, trashErr.message);
    }

    var ds = getDocumentSheet();
    var isDeletedCol = DOC_SHEET_HEADERS.indexOf("isDeleted") + 1;
    var deletedAtCol = DOC_SHEET_HEADERS.indexOf("deletedAt") + 1;
    ds.getRange(found.rowNum, isDeletedCol).setValue("TRUE");
    if (deletedAtCol > 0) ds.getRange(found.rowNum, deletedAtCol).setValue(nowIsoLike());

    return jsonResp({
      success: true,
      newDocumentId: uploadResult.documentId,
      replacedDocumentId: oldDocId,
      fileUrl: uploadResult.fileUrl,
      serverVersion: SERVER_VERSION
    });

  } catch (err) {
    console.error("[handleReplaceDocument 오류]", err.message);
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  }
}

// ── 문서 삭제 (Drive 파일은 휴지통, 시트 행은 isDeleted=TRUE로만 표시) ──
function handleDeleteDocument(p) {
  try {
    var documentId = String(p.documentId||"").trim();
    if (!documentId) throw new Error("삭제할 문서 ID가 필요합니다.");
    var found = findDocumentRowById(documentId);
    if (!found || found.obj.isDeleted) throw new Error("삭제할 문서를 찾을 수 없습니다.");

    try {
      if (found.obj.driveFileId) {
        var file = DriveApp.getFileById(found.obj.driveFileId);
        file.setTrashed(true);
      }
    } catch (trashErr) {
      console.warn("[문서 삭제 - Drive 파일 휴지통 이동 실패]", documentId, trashErr.message);
    }

    var ds = getDocumentSheet();
    var isDeletedCol = DOC_SHEET_HEADERS.indexOf("isDeleted") + 1;
    var deletedAtCol = DOC_SHEET_HEADERS.indexOf("deletedAt") + 1;
    ds.getRange(found.rowNum, isDeletedCol).setValue("TRUE");
    if (deletedAtCol > 0) ds.getRange(found.rowNum, deletedAtCol).setValue(nowIsoLike());

    return jsonResp({ success:true, documentId: documentId, serverVersion: SERVER_VERSION });
  } catch (err) {
    console.error("[handleDeleteDocument 오류]", err.message);
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  }
}

// ── 고객/차량 폴더 URL 조회 (Drive 링크 열기 버튼용) ───────────
function handleGetDocumentFolder(p) {
  try {
    var scope = String(p.documentScope||"CUSTOMER").toUpperCase();
    var customerId = String(p.customerId||"").trim();
    validateCustomerForDocuments(customerId);
    var custInfo = getCustomerBasicInfo(customerId);

    var folder;
    if (scope === "CUSTOMER") {
      folder = getOrCreateCustomerCommonDocFolder(customerId, custInfo.customerName, custInfo.companyName);
    } else {
      var vehicleId = String(p.vehicleId||"").trim();
      var unitNo = p.unitNo ? String(p.unitNo).trim() : "";
      var vInfo = validateVehicleForDocuments(customerId, vehicleId);
      if (unitNo) {
        folder = getOrCreateUnitFolder(customerId, custInfo.customerName, custInfo.companyName, vehicleId, vInfo.modelName, vInfo.detailModel, unitNo, "");
      } else {
        folder = getOrCreateVehicleFolder(customerId, custInfo.customerName, custInfo.companyName, vehicleId, vInfo.modelName, vInfo.detailModel);
      }
    }
    return jsonResp({ success:true, folderUrl: folder.getUrl(), serverVersion: SERVER_VERSION });
  } catch (err) {
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  }
}

// ── 고객/차량 폴더 미리 생성 (선택적 사전 준비용) ───────────────
function handleCreateDocumentFolders(p) {
  try {
    var customerId = String(p.customerId||"").trim();
    validateCustomerForDocuments(customerId);
    var custInfo = getCustomerBasicInfo(customerId);
    var result = { customerFolderUrl: getOrCreateCustomerCommonDocFolder(customerId, custInfo.customerName, custInfo.companyName).getUrl() };

    if (p.vehicleId) {
      var vInfo = validateVehicleForDocuments(customerId, p.vehicleId);
      result.vehicleFolderUrl = getOrCreateVehicleFolder(customerId, custInfo.customerName, custInfo.companyName, p.vehicleId, vInfo.modelName, vInfo.detailModel).getUrl();
    }
    return jsonResp({ success:true, folders: result, serverVersion: SERVER_VERSION });
  } catch (err) {
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  }
}

// ── 고객/차량 카드 문서 상태 요약 (개수, 필수서류 진행률) ───────
function handleDocumentSummary(p) {
  try {
    var customerId = String(p.customerId||"").trim();
    if (!customerId) throw new Error("customerId가 필요합니다.");
    var docs = readDocumentRows(false).filter(function(d){ return d.customerId === customerId; });

    var customerDocs = docs.filter(function(d){ return d.documentScope === "CUSTOMER"; });
    var vehicleDocsByVehicle = {};
    docs.filter(function(d){ return d.documentScope === "VEHICLE"; }).forEach(function(d){
      if (!vehicleDocsByVehicle[d.vehicleId]) vehicleDocsByVehicle[d.vehicleId] = [];
      vehicleDocsByVehicle[d.vehicleId].push(d);
    });

    // ★ 차량서류 vehicleId 연결 끊김 방지 및 고아문서 복구 (code103) — 이 고객의
    //   차량서류 중 현재 구매차량 시트에 없는 vehicleId를 가리키는 문서가 있으면
    //   "고아 문서"로 집계한다. 자동으로 어느 차량에 연결할지 결정하지 않고
    //   개수만 알려준다 — 실제 연결은 반드시 진단/복구 함수를 통해서만 한다.
    var vs = getVehicleSheet();
    var vData = vs.getDataRange().getValues();
    var currentVehicleIds = {};
    for (var i=1;i<vData.length;i++){
      var vid = String(vData[i][1]||"").trim() === customerId ? String(vData[i][0]||"").trim() : "";
      if (vid) currentVehicleIds[vid] = true;
    }
    var orphanVehicleDocs = docs.filter(function(d){
      return d.documentScope === "VEHICLE" && d.vehicleId && !currentVehicleIds[d.vehicleId];
    });

    return jsonResp({
      success: true,
      customerDocCount: customerDocs.length,
      vehicleDocCounts: Object.keys(vehicleDocsByVehicle).reduce(function(acc,k){ acc[k]=vehicleDocsByVehicle[k].length; return acc; }, {}),
      orphanVehicleDocCount: orphanVehicleDocs.length,
      serverVersion: SERVER_VERSION
    });
  } catch (err) {
    return jsonResp({ success:false, message: err.message, serverVersion: SERVER_VERSION });
  }
}

// ── 고객 기본정보(고객명/법인명) 조회 헬퍼 ─────────────────────
function getCustomerBasicInfo(customerId) {
  var cs = getCustomerSheet();
  var data = cs.getDataRange().getValues();
  var header = data[0].map(function(h){ return String(h||"").trim(); });
  var cidCol=-1, nameCol=-1, companyCol=-1;
  for (var i=0;i<header.length;i++) {
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (mapped==="customerId") cidCol=i;
    if (mapped==="customerName") nameCol=i;
    if (mapped==="companyName") companyCol=i;
  }
  for (var r=1;r<data.length;r++) {
    if (cidCol>=0 && String(data[r][cidCol]||"").trim()===String(customerId).trim()) {
      return {
        customerName: nameCol>=0?String(data[r][nameCol]||""):"",
        companyName: companyCol>=0?String(data[r][companyCol]||""):""
      };
    }
  }
  return { customerName:"", companyName:"" };
}

// ============================================================
// ★ 문서관리 테스트/진단 함수 (관리자용, Apps Script 편집기에서 직접 실행)
// ============================================================

function testCreateCustomerDocumentFolder() {
  var testCustomerId = "_TEST_" + Utilities.getUuid();
  var folder = getOrCreateCustomerCommonDocFolder(testCustomerId, "_TEST_고객", "");
  console.log("[테스트] 고객 공통서류 폴더 생성:", folder.getUrl());
  folder.setTrashed(true);
  // 문서폴더 시트의 테스트 행도 정리
  var fs = getDocFolderSheet();
  var data = fs.getDataRange().getValues();
  for (var i = data.length-1; i>=1; i--) {
    if (String(data[i][2]||"").indexOf(testCustomerId) >= 0) fs.deleteRow(i+1);
  }
  console.log("[테스트 완료] 폴더는 휴지통으로 이동, 문서폴더 시트 테스트 행 정리됨");
}

function testCreateVehicleDocumentFolder() {
  var testCustomerId = "_TEST_" + Utilities.getUuid();
  var testVehicleId = "_TEST_" + Utilities.getUuid();
  var folder = getOrCreateVehicleFolder(testCustomerId, "_TEST_고객", "", testVehicleId, "GLE", "GLE450");
  console.log("[테스트] 차량서류 폴더 생성:", folder.getUrl());
  var unitFolder = getOrCreateUnitFolder(testCustomerId, "_TEST_고객", "", testVehicleId, "GLE", "GLE450", "1", "");
  console.log("[테스트] 호차 폴더 생성:", unitFolder.getUrl());
  folder.setTrashed(true);
  var fs = getDocFolderSheet();
  var data = fs.getDataRange().getValues();
  for (var i = data.length-1; i>=1; i--) {
    if (String(data[i][3]||"").indexOf(testVehicleId) >= 0) fs.deleteRow(i+1);
  }
  console.log("[테스트 완료] 폴더는 휴지통으로 이동, 문서폴더 시트 테스트 행 정리됨");
}

function testDocumentSheetStructure() {
  var ds = getDocumentSheet();
  var headers = ds.getRange(1,1,1,ds.getLastColumn()).getDisplayValues()[0];
  console.log("[문서관리 시트 헤더]", JSON.stringify(headers));
  var expected = DOC_SHEET_HEADERS;
  var missing = expected.filter(function(h){ return headers.indexOf(h) < 0; });
  console.log("[누락된 컬럼]", JSON.stringify(missing));
  var fs = getDocFolderSheet();
  var fHeaders = fs.getRange(1,1,1,fs.getLastColumn()).getDisplayValues()[0];
  console.log("[문서폴더 시트 헤더]", JSON.stringify(fHeaders));
  return { documentSheetHeaders: headers, missingColumns: missing, docFolderSheetHeaders: fHeaders };
}

// ── 문서관리 전체 진단 (읽기 전용, 데이터 자동 수정 없음) ───────
function diagnoseDocumentManagement() {
  var result = {
    driveRootConnected: false,
    documentSheetExists: false,
    totalActiveDocuments: 0,
    customerDocCount: 0,
    vehicleDocCount: 0,
    orphanCustomerIdCount: 0,
    orphanVehicleIdCount: 0,
    missingDriveFileCount: 0,
    duplicateDocumentIdCount: 0,
    duplicateRequestTokenCount: 0,
    orphanCustomerIds: [],
    orphanVehicleIds: [],
    missingDriveFiles: []
  };

  try {
    getDriveRootFolder();
    result.driveRootConnected = true;
  } catch (err) {
    result.driveRootConnected = false;
    result.driveRootError = err.message;
  }

  var sh = SS.getSheetByName(DOC_SHEET_NAME);
  result.documentSheetExists = !!sh;
  if (!sh) {
    console.log("[문서관리 진단]", JSON.stringify(result));
    return result;
  }

  var cs = getCustomerSheet();
  var vs = getVehicleSheet();
  var validCustomerIds = {};
  var cData = cs.getDataRange().getValues();
  var cHeader = cData[0].map(function(h){return String(h||"").trim();});
  var cCidCol = -1;
  for (var i=0;i<cHeader.length;i++){ if((HEADER_MAP[cHeader[i]]||cHeader[i])==="customerId") cCidCol=i; }
  if (cCidCol>=0) for (var r=1;r<cData.length;r++){ var v=String(cData[r][cCidCol]||"").trim(); if(v) validCustomerIds[v]=true; }

  var validVehicleIds = {};
  var vData = vs.getDataRange().getValues();
  for (var vr=1; vr<vData.length; vr++) { var vid=String(vData[vr][0]||"").trim(); if (vid) validVehicleIds[vid]=true; }

  var docIdSeen = {};
  var tokenSeen = {};

  var all = readDocumentRows(true);
  all.forEach(function(d){
    if (d.isDeleted) return;
    result.totalActiveDocuments++;
    if (d.documentScope === "CUSTOMER") result.customerDocCount++;
    if (d.documentScope === "VEHICLE") result.vehicleDocCount++;

    if (d.customerId && !validCustomerIds[d.customerId] && result.orphanCustomerIds.indexOf(d.customerId) < 0) {
      result.orphanCustomerIds.push(d.customerId);
    }
    if (d.documentScope === "VEHICLE" && d.vehicleId && !validVehicleIds[d.vehicleId] && result.orphanVehicleIds.indexOf(d.vehicleId) < 0) {
      result.orphanVehicleIds.push(d.vehicleId);
    }

    if (d.driveFileId) {
      try {
        var f = DriveApp.getFileById(d.driveFileId);
        if (f.isTrashed()) result.missingDriveFiles.push(d.documentId);
      } catch (e) {
        result.missingDriveFiles.push(d.documentId);
      }
    }

    if (docIdSeen[d.documentId]) result.duplicateDocumentIdCount++;
    docIdSeen[d.documentId] = true;
  });

  result.orphanCustomerIdCount = result.orphanCustomerIds.length;
  result.orphanVehicleIdCount = result.orphanVehicleIds.length;
  result.missingDriveFileCount = result.missingDriveFiles.length;

  console.log("[문서관리 진단 완료]", JSON.stringify(result));
  return result;
}

// ============================================================
// ★ 문서업로드 진단 (신규, code111, 읽기 전용) ─────────────────
//   특정 고객의 문서 업로드 오류(예: 김성민 고객의 "스프레드시트 서비스에
//   오류가 발생했습니다")를 조사하기 위한 관리자용 함수다.
//   Apps Script 편집기에서 직접 실행한다:
//     diagnoseCustomerDocumentUpload("김성민")
//   고객정보/구매차량/문서관리/Drive 파일을 절대 수정·삭제하지 않는다
//   (읽기 전용 — console.log()로만 결과를 출력한다).
//   동명이인이 여러 명이면 각각 따로 보고한다.
// ============================================================
function diagnoseCustomerDocumentUpload(customerName) {
  var lines = [];
  function log(label, value) {
    lines.push(label + (value === undefined || value === null || value === "" ? "" : ": " + value));
  }

  lines.push("[문서업로드 진단]");
  lines.push("");
  log("고객명", customerName);

  var matches;
  try {
    matches = withSpreadsheetRetry(function () {
      return _findCustomerRowsByNameOrCompany(customerName).filter(function (m) { return m.customerName === customerName; });
    }, "고객관리 시트 조회");
  } catch (err) {
    lines.push("고객관리 시트 접근: 오류 — " + err.message);
    console.log(lines.join("\n"));
    return { found: false, error: err.message, lines: lines };
  }

  if (matches.length === 0) {
    lines.push("결과: 고객관리 시트에서 \"" + customerName + "\" 이름의 고객을 찾을 수 없습니다.");
    console.log(lines.join("\n"));
    return { found: false, lines: lines };
  }

  var report = { found: true, customers: [] };

  matches.forEach(function (m, idx) {
    var cid = m.customerId;
    if (matches.length > 1) {
      lines.push("");
      lines.push("── 동명이인 " + (idx + 1) + "/" + matches.length + " (고객관리 시트 행 " + m.rowNum + ") ──");
    }
    log("customerId", cid);
    log("고객관리 시트 행번호", m.rowNum);

    var cidCount = 0, cidCountErr = "";
    try {
      cidCount = withSpreadsheetRetry(function () {
        var cs = getCustomerSheet();
        return cid ? countCustomerIdOccurrences(cs, cid) : 0;
      }, "customerId 중복 확인");
    } catch (err) { cidCountErr = err.message; }
    log("동일 customerId 개수", cidCountErr ? ("오류 — " + cidCountErr) : cidCount);

    var vehicles = [], vehErr = "";
    try {
      vehicles = withSpreadsheetRetry(function () {
        var vs = getVehicleSheet();
        var vData = vs.getDataRange().getValues();
        var list = [];
        for (var r = 1; r < vData.length; r++) {
          if (String(vData[r][1] || "").trim() === cid) {
            list.push({
              rowNum: r + 1,
              vehicleId: String(vData[r][0] || "").trim(),
              modelName: String(vData[r][4] || "").trim(),
              detailModel: String(vData[r][5] || "").trim()
            });
          }
        }
        return list;
      }, "구매차량 시트 조회");
    } catch (err) { vehErr = err.message; }

    if (vehErr) {
      log("구매차량 개수", "오류 — " + vehErr);
    } else {
      log("구매차량 개수", vehicles.length);
      lines.push("");
      vehicles.forEach(function (v, vi) {
        lines.push("차량 " + (vi + 1));
        log("  vehicleId", v.vehicleId);
        log("  modelName", v.modelName);
        log("  detailModel", v.detailModel);
        lines.push("");
      });
    }

    var vehIdSeen = {}, dupVehicleId = false;
    vehicles.forEach(function (v) {
      if (vehIdSeen[v.vehicleId]) dupVehicleId = true;
      vehIdSeen[v.vehicleId] = true;
    });
    log("vehicleId 중복 여부", dupVehicleId ? "있음 (비정상)" : "없음 (정상)");

    var docSheetOk = true, docSheetErr = "";
    try { withSpreadsheetRetry(function () { getDocumentSheet(); }, "문서관리 시트 접근"); }
    catch (e) { docSheetOk = false; docSheetErr = e.message; }
    log("문서관리 시트 접근", docSheetOk ? "정상" : ("오류 — " + docSheetErr));

    var folderSheetOk = true, folderSheetErr = "";
    try { withSpreadsheetRetry(function () { getDocFolderSheet(); }, "문서폴더 시트 접근"); }
    catch (e) { folderSheetOk = false; folderSheetErr = e.message; }
    log("문서폴더 시트 접근", folderSheetOk ? "정상" : ("오류 — " + folderSheetErr));

    var driveOk = true, driveErr = "";
    try { getDriveRootFolder(); }
    catch (e) { driveOk = false; driveErr = e.message; }
    log("Drive Root Folder 접근", driveOk ? "정상" : ("오류 — " + driveErr));

    var verdict;
    if (cidCountErr) {
      verdict = "고객관리 시트 조회 중 오류가 발생했습니다 — Spreadsheet 서비스 일시 오류일 가능성이 높습니다. 잠시 후 다시 실행해보세요.";
    } else if (cidCount > 1) {
      verdict = "customerId가 고객관리 시트에 " + cidCount + "행 중복되어 있습니다. 문서 업로드가 차단되는 것이 정상 동작입니다 — 중복 행을 정리해야 합니다.";
    } else if (cidCount === 0) {
      verdict = "customerId가 고객관리 시트에서 발견되지 않습니다. 고객 저장 여부를 확인하세요.";
    } else if (dupVehicleId) {
      verdict = "동일 vehicleId를 가진 차량이 2행 이상 존재합니다. 구매차량 시트를 확인하세요.";
    } else if (!docSheetOk || !folderSheetOk) {
      verdict = "문서관리/문서폴더 시트 접근 오류입니다 — Spreadsheet 서비스의 일시적 오류일 가능성이 높습니다(재시도 로직으로 자동 복구되어야 합니다). 계속 반복되면 시트 이름/권한을 확인하세요.";
    } else if (!driveOk) {
      verdict = "Drive 최상위 폴더 접근 오류입니다 — DRIVE_ROOT_FOLDER_ID 설정 및 공유 권한을 확인하세요.";
    } else {
      verdict = "customerId/vehicleId 데이터는 정상입니다. 실제 발생했던 업로드 실패는 Google Spreadsheet 서비스의 일시적 오류였을 가능성이 높으며, 이번에 추가된 재시도 로직으로 자동 복구되어야 합니다.";
    }
    log("최종 판정", verdict);

    report.customers.push({
      customerId: cid, rowNum: m.rowNum,
      customerIdOccurrences: cidCountErr ? null : cidCount,
      vehicles: vehicles, duplicateVehicleId: dupVehicleId,
      documentSheetOk: docSheetOk, docFolderSheetOk: folderSheetOk, driveRootOk: driveOk,
      verdict: verdict
    });
  });

  var output = lines.join("\n");
  console.log(output);
  return report;
}

// ============================================================
// ★ 차량서류 vehicleId 연결 끊김 방지 및 고아문서 복구 (code103)
//   아래는 전부 읽기 전용 진단 + 1회성 안전 복구 함수다.
//   자동 실행되지 않으며 관리자가 Apps Script 편집기에서 직접 실행해야 한다.
// ============================================================

// ── 고객명/법인명으로 고객관리 시트 행을 찾는 공용 헬퍼 ──────────
function _findCustomerRowsByNameOrCompany(search) {
  var cs = getCustomerSheet();
  var data = cs.getDataRange().getValues();
  if (data.length <= 1) return [];
  var header = data[0].map(function(h){ return String(h||"").trim(); });
  var cidCol=-1, nameCol=-1, companyCol=-1, phoneCol=-1;
  for (var i=0;i<header.length;i++){
    var mapped = HEADER_MAP[header[i]] || header[i];
    if (mapped==="customerId")   cidCol=i;
    if (mapped==="customerName") nameCol=i;
    if (mapped==="companyName")  companyCol=i;
    if (mapped==="phone")        phoneCol=i;
  }
  var s = String(search||"").trim();
  var rows = [];
  for (var r=1;r<data.length;r++){
    var name = nameCol>=0 ? String(data[r][nameCol]||"") : "";
    var company = companyCol>=0 ? String(data[r][companyCol]||"") : "";
    if (!s || name.indexOf(s)>=0 || company.indexOf(s)>=0) {
      rows.push({
        rowNum: r+1,
        customerId: cidCol>=0 ? String(data[r][cidCol]||"").trim() : "",
        customerName: name,
        companyName: company,
        phone: phoneCol>=0 ? String(data[r][phoneCol]||"") : ""
      });
    }
  }
  return rows;
}

// ── 진단: 특정 고객의 구매차량 ↔ 문서관리 연결 상태를 상세히 출력 ──
// 사용 예: diagnoseVehicleDocumentLink("정우이앤씨", "GLS 450");
function diagnoseVehicleDocumentLink(customerSearch, vehicleSearch) {
  var report = {
    customerMatches: [], duplicateCustomerId: false,
    vehicles: [], documents: [], orphanDocuments: [],
    documentSummary: null, vehicleDocumentLists: [], conclusion: ""
  };

  var customerRows = _findCustomerRowsByNameOrCompany(customerSearch);
  report.customerMatches = customerRows;
  console.log("[진단1: 고객관리 시트]", JSON.stringify(customerRows));

  if (customerRows.length === 0) {
    report.conclusion = "[진단 결론] 고객명/법인명 '"+customerSearch+"'과 일치하는 고객을 고객관리 시트에서 찾을 수 없습니다.";
    console.log(report.conclusion);
    return report;
  }

  var uniqueIds = {};
  customerRows.forEach(function(r){ if (r.customerId) uniqueIds[r.customerId]=(uniqueIds[r.customerId]||0)+1; });
  var dupIds = Object.keys(uniqueIds).filter(function(id){ return uniqueIds[id]>1; });
  if (dupIds.length > 0) report.duplicateCustomerId = true;

  if (customerRows.length > 1) {
    report.conclusion = "[진단 결론] 고객명/법인명이 여러 행("+customerRows.length+"건)과 일치해 customerId를 하나로 특정할 수 없습니다. "+
      "더 구체적인 검색어로 다시 실행해주세요. (중복 customerId 여부: "+report.duplicateCustomerId+")";
    console.log(report.conclusion);
    return report;
  }

  var customerId = customerRows[0].customerId;
  if (!customerId) {
    report.conclusion = "[진단 결론] 고객은 찾았지만 customerId가 비어 있습니다(구형 행). 먼저 고객을 한 번 수정 저장해 customerId를 발급받아주세요.";
    console.log(report.conclusion);
    return report;
  }

  // ── 구매차량 시트 조회 ──────────────────────────────────
  var vs = getVehicleSheet();
  var vData = vs.getDataRange().getValues();
  var vehicleRows = [];
  var vehIdCount = {};
  for (var i=1;i<vData.length;i++){
    var row = vData[i];
    if (String(row[1]||"").trim() !== customerId) continue;
    var vid = String(row[0]||"").trim();
    vehIdCount[vid] = (vehIdCount[vid]||0)+1;
    vehicleRows.push({
      rowNum: i+1, vehicleId: vid,
      modelName: String(row[4]||""), detailModel: String(row[5]||""),
      vehicleStatus: String(row[7]||""),
      contractDate: fmtDate(row[8]), deliveryDate: fmtDate(row[9]),
      quantity: Math.max(1, parseInt(row[11],10)||1),
      memo: String(row[14]||"")
    });
  }
  vehicleRows.forEach(function(v){ v.duplicateVehicleId = vehIdCount[v.vehicleId] > 1; });
  report.vehicles = vehicleRows;
  console.log("[진단2: 구매차량 시트 - 이 고객의 전체 차량]", JSON.stringify(vehicleRows));

  var vSearch = String(vehicleSearch||"").trim();
  var matchedVehicles = vSearch
    ? vehicleRows.filter(function(v){ return v.modelName.indexOf(vSearch)>=0 || v.detailModel.indexOf(vSearch)>=0; })
    : vehicleRows;

  // ── 문서관리 시트 조회 (삭제된 것 포함, 진단이므로 전부 본다) ──
  var allDocs = readDocumentRows(true).filter(function(d){ return d.customerId === customerId; });
  var docsOut = allDocs.map(function(d){
    var driveExists=false, driveTrashed=false;
    if (d.driveFileId) {
      try { var f = DriveApp.getFileById(d.driveFileId); driveExists=true; driveTrashed=f.isTrashed(); }
      catch (e) { driveExists=false; }
    }
    return {
      rowNum:d._rowNumber, documentId:d.documentId, customerId:d.customerId,
      vehicleId:d.vehicleId, unitNo:d.unitNo, documentScope:d.documentScope,
      documentType:d.documentType, originalFileName:d.originalFileName,
      driveFileId:d.driveFileId, driveFileUrl:d.driveFileUrl, driveFolderId:d.driveFolderId,
      uploadedAt:d.uploadedAt, isDeleted:d.isDeleted,
      driveFileExists:driveExists, driveFileTrashed:driveTrashed
    };
  });
  report.documents = docsOut;
  console.log("[진단3: 문서관리 시트 - 이 고객의 전체 문서]", JSON.stringify(docsOut));

  var currentVehicleIds = {};
  vehicleRows.forEach(function(v){ currentVehicleIds[v.vehicleId] = true; });

  var comparisonList = matchedVehicles.map(function(v){
    var linked = docsOut.filter(function(d){ return d.documentScope==="VEHICLE" && d.vehicleId===v.vehicleId && !d.isDeleted; });
    return { currentVehicle:v, linkedDocuments: linked, linkedDocumentCount: linked.length };
  });
  report.comparison = comparisonList;
  console.log("[진단4: 지정 차량 기준 비교]", JSON.stringify(comparisonList));

  var orphanDocs = docsOut.filter(function(d){
    return d.documentScope==="VEHICLE" && !d.isDeleted && d.vehicleId && !currentVehicleIds[d.vehicleId];
  });
  report.orphanDocuments = orphanDocs;
  console.log("[진단5: 고아 문서 - vehicleId가 현재 구매차량에 없음]", JSON.stringify(orphanDocs));

  try {
    report.documentSummary = JSON.parse(handleDocumentSummary({customerId:customerId}).getContent());
  } catch (e1) { report.documentSummary = {success:false, message:e1.message}; }
  console.log("[진단6: documentSummary 실제 응답]", JSON.stringify(report.documentSummary));

  report.vehicleDocumentLists = matchedVehicles.map(function(v){
    var resp;
    try { resp = JSON.parse(handleListVehicleDocuments({customerId:customerId, vehicleId:v.vehicleId}).getContent()); }
    catch (e2) { resp = {success:false, message:e2.message}; }
    return { vehicleId:v.vehicleId, modelName:v.modelName, detailModel:v.detailModel, result:resp };
  });
  console.log("[진단7: listVehicleDocuments 실제 응답]", JSON.stringify(report.vehicleDocumentLists));

  // ── 결론 요약 ─────────────────────────────────────────
  var lines = [];
  if (orphanDocs.length > 0) {
    orphanDocs.forEach(function(d){
      lines.push(
        "["+(d.documentType||"문서")+"] documentId="+d.documentId+" 은 vehicleId="+d.vehicleId+
        " 에 연결되어 있으나, 현재 구매차량 시트에는 이 vehicleId가 존재하지 않습니다. "+
        "Drive 파일은 "+(d.driveFileExists ? (d.driveFileTrashed ? "휴지통 상태로 존재합니다." : "정상 존재합니다.") : "존재하지 않습니다.")+
        " 고객 수정 저장 과정에서 이 차량의 vehicleId가 재발급된 것으로 추정됩니다."
      );
    });
  } else {
    lines.push("현재 vehicleId 불일치로 인한 고아 문서가 발견되지 않았습니다.");
  }
  if (report.duplicateCustomerId) {
    lines.push("⚠ 동일 고객명/법인명에 중복된 customerId가 존재합니다 — repairKnownDuplicateCustomerIds() 관련 여부를 별도 확인하세요.");
  }
  report.conclusion = "[진단 결론]\n" + lines.join("\n");
  console.log(report.conclusion);

  return report;
}

// ── 진단: 특정 고객의 고아 차량서류만 빠르게 확인 ──────────────
function diagnoseOrphanVehicleDocuments(customerSearch) {
  var customerRows = _findCustomerRowsByNameOrCompany(customerSearch);
  if (customerRows.length !== 1) {
    var msg = customerRows.length===0 ? "일치하는 고객이 없습니다." : "고객명/법인명이 여러 행과 일치해 customerId를 특정할 수 없습니다.";
    console.log("[고아문서 진단]", msg, JSON.stringify(customerRows));
    return { success:false, message:msg, matches:customerRows };
  }
  var customerId = customerRows[0].customerId;
  var vs = getVehicleSheet();
  var vData = vs.getDataRange().getValues();
  var currentIds = {};
  for (var i=1;i<vData.length;i++){
    if (String(vData[i][1]||"").trim()===customerId) currentIds[String(vData[i][0]||"").trim()]=true;
  }
  var docs = readDocumentRows(false).filter(function(d){
    return d.customerId===customerId && d.documentScope==="VEHICLE" && d.vehicleId && !currentIds[d.vehicleId];
  });
  console.log("[고아문서 진단] customerId="+customerId+" 고아 문서 "+docs.length+"건", JSON.stringify(docs));
  return { success:true, customerId:customerId, orphanCount:docs.length, orphanDocuments:docs };
}

// ── 테스트: documentSummary()가 실제로 어떤 값을 반환하는지 확인 ──
function testDocumentSummaryForCustomer(customerSearch) {
  var rows = _findCustomerRowsByNameOrCompany(customerSearch);
  if (rows.length !== 1) { console.log("[테스트] 고객을 하나로 특정하지 못했습니다.", JSON.stringify(rows)); return rows; }
  var resp = JSON.parse(handleDocumentSummary({customerId: rows[0].customerId}).getContent());
  console.log("[documentSummary 테스트]", JSON.stringify(resp));
  return resp;
}

// ── 테스트: listVehicleDocuments()가 실제로 어떤 값을 반환하는지 확인 ──
function testVehicleDocumentList(customerSearch, vehicleSearch) {
  var rows = _findCustomerRowsByNameOrCompany(customerSearch);
  if (rows.length !== 1) { console.log("[테스트] 고객을 하나로 특정하지 못했습니다.", JSON.stringify(rows)); return rows; }
  var customerId = rows[0].customerId;
  var vs = getVehicleSheet();
  var vData = vs.getDataRange().getValues();
  var matches = [];
  for (var i=1;i<vData.length;i++){
    if (String(vData[i][1]||"").trim()!==customerId) continue;
    var model=String(vData[i][4]||""), detail=String(vData[i][5]||"");
    if (!vehicleSearch || model.indexOf(vehicleSearch)>=0 || detail.indexOf(vehicleSearch)>=0) {
      matches.push({ vehicleId:String(vData[i][0]||"").trim(), modelName:model, detailModel:detail });
    }
  }
  var results = matches.map(function(m){
    var resp = JSON.parse(handleListVehicleDocuments({customerId:customerId, vehicleId:m.vehicleId}).getContent());
    return { vehicle:m, result:resp };
  });
  console.log("[listVehicleDocuments 테스트]", JSON.stringify(results));
  return results;
}

// ── 테스트: vehicleId가 안정적으로 유지되고 있는지 종합 점검 (읽기 전용) ──
function testVehicleIdPersistence(customerSearch) {
  var rows = _findCustomerRowsByNameOrCompany(customerSearch);
  if (rows.length !== 1) { console.log("[vehicleId 지속성 테스트] 고객을 하나로 특정하지 못했습니다.", JSON.stringify(rows)); return rows; }
  var customerId = rows[0].customerId;
  var vs = getVehicleSheet();
  var vData = vs.getDataRange().getValues();
  var vehicles = []; var idCount = {};
  for (var i=1;i<vData.length;i++){
    if (String(vData[i][1]||"").trim()!==customerId) continue;
    var vid = String(vData[i][0]||"").trim();
    idCount[vid] = (idCount[vid]||0)+1;
    vehicles.push({ rowNum:i+1, vehicleId:vid, modelName:String(vData[i][4]||""), detailModel:String(vData[i][5]||"") });
  }
  var missingIdCount = vehicles.filter(function(v){ return !v.vehicleId; }).length;
  var duplicateIds = Object.keys(idCount).filter(function(k){ return idCount[k]>1; });
  var docs = readDocumentRows(false).filter(function(d){ return d.customerId===customerId && d.documentScope==="VEHICLE"; });
  var currentIds = {}; vehicles.forEach(function(v){ currentIds[v.vehicleId]=true; });
  var orphanCount = docs.filter(function(d){ return d.vehicleId && !currentIds[d.vehicleId]; }).length;
  var result = {
    customerId: customerId,
    vehicleCount: vehicles.length,
    missingVehicleIdCount: missingIdCount,
    duplicateVehicleIds: duplicateIds,
    vehicleDocumentCount: docs.length,
    orphanVehicleDocumentCount: orphanCount,
    vehicles: vehicles
  };
  console.log("[vehicleId 지속성 테스트]", JSON.stringify(result));
  return result;
}

// ============================================================
// ★ 안전한 1회 복구 함수 — 기본값 dryRun:true. 실제 데이터 변경은
//   dryRun:false를 명시적으로 전달했을 때만, 그리고 아래 7가지 조건이
//   모두 정확히 일치할 때만 실행된다. 하나라도 모호하면 아무것도
//   바꾸지 않고 오류만 반환한다.
//
//   사용 예:
//   repairVehicleDocumentLink({
//     customerName: "정우이앤씨", modelName: "GLS", detailModel: "GLS 450 4M AMG LINE",
//     documentType: "자동차등록증", dryRun: true
//   });
// ============================================================
function repairVehicleDocumentLink(options) {
  options = options || {};
  var dryRun = options.dryRun !== false; // 기본값 true
  var customerName = String(options.customerName||"").trim();
  var modelName     = String(options.modelName||"").trim();
  var detailModel   = String(options.detailModel||"").trim();
  var documentType  = String(options.documentType||"").trim();

  if (!customerName || !modelName || !documentType) {
    var m0 = "customerName, modelName, documentType는 반드시 필요합니다.";
    console.log("[복구 중단]", m0);
    return { success:false, message:m0 };
  }

  // 조건1: 고객명/법인명이 정확히 일치, customerId 정확히 1개로 특정
  var candidateRows = _findCustomerRowsByNameOrCompany(customerName);
  var exactRows = candidateRows.filter(function(r){ return r.customerName===customerName || r.companyName===customerName; });
  if (exactRows.length !== 1) {
    var m1 = "customerId를 정확히 1개로 특정할 수 없습니다 (일치 "+exactRows.length+"건). 복구를 중단합니다.";
    console.log("[복구 중단]", m1, JSON.stringify(exactRows));
    return { success:false, message:m1, matches:exactRows };
  }
  var customerId = exactRows[0].customerId;
  if (!customerId) {
    var m1b = "고객은 특정했지만 customerId가 비어 있습니다. 복구를 중단합니다.";
    console.log("[복구 중단]", m1b);
    return { success:false, message:m1b };
  }

  // 조건2: 현재 구매차량에서 모델이 정확히 1행으로 특정
  var vs = getVehicleSheet();
  var vData = vs.getDataRange().getValues();
  var vehicleMatches = [];
  for (var i=1;i<vData.length;i++){
    if (String(vData[i][1]||"").trim()!==customerId) continue;
    var mn = String(vData[i][4]||"").trim(), dm = String(vData[i][5]||"").trim();
    var modelHit  = mn.indexOf(modelName)>=0;
    var detailHit = !detailModel || dm===detailModel || dm.indexOf(detailModel)>=0;
    if (modelHit && detailHit) {
      vehicleMatches.push({ rowNum:i+1, vehicleId:String(vData[i][0]||"").trim(), modelName:mn, detailModel:dm });
    }
  }
  if (vehicleMatches.length !== 1) {
    var m2 = "현재 구매차량에서 해당 모델을 정확히 1행으로 특정할 수 없습니다 (일치 "+vehicleMatches.length+"건). 복구를 중단합니다.";
    console.log("[복구 중단]", m2, JSON.stringify(vehicleMatches));
    return { success:false, message:m2, matches:vehicleMatches };
  }
  var currentVehicleId    = vehicleMatches[0].vehicleId;
  var currentModelName    = vehicleMatches[0].modelName;
  var currentDetailModel  = vehicleMatches[0].detailModel;

  // 조건3: 문서가 documentType으로 특정됨 + 조건4(암묵): Drive 파일 존재
  var docs = readDocumentRows(false).filter(function(d){
    return d.customerId===customerId && d.documentScope==="VEHICLE" && d.documentType===documentType;
  });

  // 조건7: 이미 현재 vehicleId에 연결된 동일 문서가 있으면 복구 불필요
  var alreadyLinked = docs.filter(function(d){ return d.vehicleId===currentVehicleId; });
  if (alreadyLinked.length > 0) {
    var m3 = "동일한 문서가 이미 현재 차량ID("+currentVehicleId+")에 연결되어 있습니다. 복구가 필요하지 않습니다.";
    console.log("[복구 중단]", m3, JSON.stringify(alreadyLinked));
    return { success:false, message:m3, alreadyLinked:alreadyLinked };
  }

  // 조건6: 문서의 기존 vehicleId가 현재 구매차량에 존재하지 않는 "고아" ID여야 함
  var allCurrentVehicleIds = {};
  for (var j=1;j<vData.length;j++){
    var vid2 = String(vData[j][0]||"").trim();
    if (vid2) allCurrentVehicleIds[vid2] = true;
  }
  var orphanCandidates = docs.filter(function(d){ return d.vehicleId && !allCurrentVehicleIds[d.vehicleId]; });
  if (orphanCandidates.length !== 1) {
    var m4 = "조건에 맞는 고아 문서를 정확히 1건으로 특정할 수 없습니다 (후보 "+orphanCandidates.length+"건). 복구를 중단합니다.";
    console.log("[복구 중단]", m4, JSON.stringify(orphanCandidates));
    return { success:false, message:m4, candidates:orphanCandidates };
  }
  var target = orphanCandidates[0];

  // Drive 파일이 실제로 존재하는지 확인
  var driveOk = false;
  try { var f = DriveApp.getFileById(target.driveFileId); driveOk = !f.isTrashed(); }
  catch (e) { driveOk = false; }
  if (!driveOk) {
    var m5 = "Drive 파일이 존재하지 않거나 이미 휴지통에 있어 복구를 중단합니다.";
    console.log("[복구 중단]", m5);
    return { success:false, message:m5 };
  }

  var plan = {
    documentId: target.documentId,
    rowNum: target._rowNumber,
    fromCustomerId: target.customerId,
    toCustomerId: customerId,
    fromVehicleId: target.vehicleId,
    toVehicleId: currentVehicleId,
    fromModelName: target.modelName,
    toModelName: currentModelName,
    fromDetailModel: target.detailModel,
    toDetailModel: currentDetailModel,
    driveFileName: target.originalFileName,
    driveFileId: target.driveFileId
  };

  if (dryRun) {
    console.log("[복구 시뮬레이션 - dryRun:true, 실제 데이터는 변경하지 않음]", JSON.stringify(plan));
    return { success:true, dryRun:true, plan:plan };
  }

  // ★ 실제 변경 — documentId/driveFileId는 절대 건드리지 않고, 연결 정보만 보정한다.
  var ds = getDocumentSheet();
  var vidCol = DOC_SHEET_HEADERS.indexOf("vehicleId")+1;
  var mnCol  = DOC_SHEET_HEADERS.indexOf("modelName")+1;
  var dmCol  = DOC_SHEET_HEADERS.indexOf("detailModel")+1;
  var updCol = DOC_SHEET_HEADERS.indexOf("updatedAt")+1;
  ds.getRange(target._rowNumber, vidCol).setValue(currentVehicleId);
  ds.getRange(target._rowNumber, mnCol).setValue(currentModelName);
  ds.getRange(target._rowNumber, dmCol).setValue(currentDetailModel);
  ds.getRange(target._rowNumber, updCol).setValue(nowIsoLike());
  SpreadsheetApp.flush();

  console.log("[복구 완료 - dryRun:false]", JSON.stringify(plan));
  return { success:true, dryRun:false, plan:plan };
}

// ============================================================
// ★★★ 등록일시 미확인 고객 — 자동저장(NEW draft) 기반 복원 가능성 진단
//   (신규, 읽기 전용) ★★★
//
//   diagnoseMissingCustomerRegistrationDates()
//
//   목적: 고객관리 시트의 "등록일시"(_savedAt)가 비어 있는 고객에 대해,
//   자동저장 시트의 draftType="NEW" draft(신규등록 화면에서 입력 중
//   자동 저장된 임시본)의 createdAt을 근거로 "이 고객이 실제로 CRM에
//   최초 등록된 시점"을 안전하게 추정할 수 있는지 진단한다.
//
//   ★★★ 절대 원칙: 이 함수는 순수 읽기 전용이다 ★★★
//   - setValue()/setValues()/appendRow()/deleteRow()/insertRow()/clear()/
//     clearContent()를 단 한 번도 호출하지 않는다.
//   - 고객관리/구매차량/자동저장/문서관리/문서폴더 시트 중 어느 것도
//     수정하지 않는다.
//   - 결과는 console.log()와 return object로만 제공한다.
//   - 실제 등록일시를 채워 넣는 작업(repairMissingCustomerRegistrationDates
//     같은 함수)은 이번 작업 범위가 아니다 — 다음 단계에서 이 진단 결과를
//     사람이 검토한 뒤에만 별도로 작업한다.
//
//   매칭 우선순위(요청사항 5):
//     1) CONFIRMED_CUSTOMER_ID  — customerId 완전일치           (VERY_HIGH)
//     2) CONFIRMED_NAME_PHONE   — 고객명+전화번호 완전일치       (HIGH)
//     3) REVIEW_PHONE_ONLY      — 전화번호만 일치                (MEDIUM)
//     4) REVIEW_NAME_ONLY       — 고객명만 일치(동명이인 위험)   (LOW)
//     5) NO_EVIDENCE            — 근거 없음
//   더 높은 우선순위에서 후보를 찾으면 그 아래 순위는 시도하지 않는다.
//
//   최종 분류(요청사항 10):
//     - AUTO_RECOVERABLE : 1)/2) 매칭이면서, 후보 draft가 하나의 "등록
//       세션"으로 묶이고(DRAFT_CLUSTER_GAP_MS 이내), 그 중 가장 신뢰할
//       수 있는 draft의 status가 COMPLETED인 경우.
//     - REVIEW_REQUIRED  : 3)/4) 매칭이거나, 1)/2) 매칭이라도 status가
//       COMPLETED가 아니거나, 서로 멀리 떨어진 여러 NEW draft가 존재해
//       자동으로 하나를 고를 수 없는 경우(MULTIPLE_NEW_DRAFTS_REVIEW).
//     - NO_EVIDENCE      : 자동저장에 아무 흔적이 없는 경우 — 임의 날짜로
//       대체하지 않는다.
// ============================================================

// 같은 신규등록 시도에서 나온 draft들로 볼 수 있는 최대 시간 간격.
// 이 간격 이내에 여러 NEW draft가 몰려 있으면 "같은 등록 세션"으로 보고
// 그 중 가장 이른 시각을 후보로 삼는다. 이 간격을 넘어서는 날짜 차이가
// 있으면(예: 8/3 신규 draft와 9/1 신규 draft) 절대 자동으로 하나를
// 고르지 않고 MULTIPLE_NEW_DRAFTS_REVIEW로 분류해 사람이 확인하게 한다.
var DRAFT_CLUSTER_GAP_MS = 6 * 60 * 60 * 1000; // 6시간

function _diagPad2(n) { return String(n).padStart(2, "0"); }

// 자동저장 시트의 createdAt/updatedAt 셀 값(보통 실제 Date 객체, 드물게
// 문자열일 수 있음)을 "YYYY-MM-DD HH:MM:SS" 문자열로 안전하게 변환한다.
// 파싱 실패 시 빈 문자열을 반환한다(임의 날짜로 대체하지 않는다).
function _diagFormatDraftDateTime(v) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return "";
    return v.getFullYear() + "-" + _diagPad2(v.getMonth() + 1) + "-" + _diagPad2(v.getDate()) +
      " " + _diagPad2(v.getHours()) + ":" + _diagPad2(v.getMinutes()) + ":" + _diagPad2(v.getSeconds());
  }
  var s = String(v).trim();
  if (!s) return "";
  // 이미 "YYYY-MM-DD HH:MM:SS" 형태 문자열이면 그대로 사용
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.replace("T", " ");
  var d = new Date(s.replace(" ", "T"));
  if (!isNaN(d.getTime())) {
    return d.getFullYear() + "-" + _diagPad2(d.getMonth() + 1) + "-" + _diagPad2(d.getDate()) +
      " " + _diagPad2(d.getHours()) + ":" + _diagPad2(d.getMinutes()) + ":" + _diagPad2(d.getSeconds());
  }
  return ""; // 파싱 실패 — 임의 날짜로 대체하지 않는다
}

// 정렬/간격 계산용 epoch ms. 파싱 실패 시 null(정렬에서 가장 뒤로 취급).
function _diagDraftTimestampMs(v) {
  if (v instanceof Date) {
    var t = v.getTime();
    return isNaN(t) ? null : t;
  }
  var formatted = _diagFormatDraftDateTime(v);
  if (!formatted) return null;
  var d = new Date(formatted.replace(" ", "T"));
  var t2 = d.getTime();
  return isNaN(t2) ? null : t2;
}

function _diagNormalizePhone(v) {
  return String(v || "").replace(/\D/g, "");
}

// payloadJson에서 필요한 식별값만 안전하게 추출한다(전체 payload는 절대
// console.log에 출력하지 않는다 — 요청사항 8).
function _diagExtractPayloadIdentifiers(payloadJson) {
  var result = { requestToken: "", savedAtRaw: "" };
  if (!payloadJson) return result;
  try {
    var obj = JSON.parse(payloadJson);
    if (obj && obj.requestToken) result.requestToken = String(obj.requestToken).trim();
    if (obj && obj._savedAt) result.savedAtRaw = String(obj._savedAt).trim();
  } catch (e) {
    // 파싱 실패는 무시 — 진단이 멈추면 안 된다
  }
  return result;
}

// ── 자동저장 시트를 읽기 전용으로 읽는다 ─────────────────────
// 주의: 기존 getAutosaveSheet()는 시트가 없으면 새로 만들고(appendRow),
// 있어도 누락된 헤더 컬럼을 추가할 수 있어(setValues) 완전한 읽기
// 전용이 아니다. 이 진단 함수는 그 어떤 쓰기도 발생시키면 안 되므로,
// 절대 getAutosaveSheet()를 호출하지 않고 시트를 직접 조회만 한다.
// 자동저장 시트 자체가 아직 없으면 null을 반환한다(=자동저장 도입 이전
// 데이터일 수 있음, 요청사항 15).
function _diagReadAutosaveRowsReadOnly() {
  var sh = SS.getSheetByName(AUTOSAVE_SHEET_NAME);
  if (!sh) return null;
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow <= 1 || lastCol < 1) return [];

  var headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
    .map(function (h) { return String(h || "").trim(); });
  var colIdx = {};
  headers.forEach(function (h, i) { if (colIdx[h] === undefined) colIdx[h] = i; });

  var data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    function cell(key) {
      var idx = colIdx[key];
      if (idx === undefined) return "";
      var v = row[idx];
      return (v === null || v === undefined) ? "" : v;
    }
    var draftId = String(cell("draftId") || "").trim();
    if (!draftId) continue; // 빈 행은 건너뜀(시트 자체는 건드리지 않음)

    var payloadJson = String(cell("payloadJson") || "");
    var ids = _diagExtractPayloadIdentifiers(payloadJson);

    rows.push({
      draftId: draftId,
      draftType: String(cell("draftType") || "").trim().toUpperCase(),
      customerId: String(cell("customerId") || "").trim(),
      customerName: String(cell("customerName") || "").trim(),
      phone: String(cell("phone") || "").trim(),
      createdAtRaw: cell("createdAt"),
      updatedAtRaw: cell("updatedAt"),
      status: String(cell("status") || "").trim().toUpperCase(),
      payloadRequestToken: ids.requestToken,
      payloadSavedAtRaw: ids.savedAtRaw,
      _rowNumber: i + 2
    });
  }
  return rows;
}

// draft 객체를 보고서에 노출할 형태로 가공(payloadJson 원문은 절대 포함하지 않음)
function _diagDraftSummary(d) {
  return {
    draftId: d.draftId,
    draftType: d.draftType,
    status: d.status,
    customerId: d.customerId || "(없음)",
    customerName: d.customerName,
    phone: d.phone,
    createdAt: _diagFormatDraftDateTime(d.createdAtRaw),
    updatedAt: _diagFormatDraftDateTime(d.updatedAtRaw)
  };
}

// status 신뢰 우선순위(요청사항 7): COMPLETED(0) > ACTIVE(1) > DISCARDED(2) > 기타(3)
function _diagStatusRank(status) {
  if (status === "COMPLETED") return 0;
  if (status === "ACTIVE") return 1;
  if (status === "DISCARDED") return 2;
  return 3;
}

// 후보 NEW draft 배열 하나를 분석해 클러스터(같은 등록 세션으로 볼 수
// 있는지)와 대표 draft(가장 이른 시각 + 가장 신뢰도 높은 status)를 찾는다.
function _diagAnalyzeCandidateCluster(candidates) {
  var withTs = candidates.map(function (c) {
    return { draft: c, ms: _diagDraftTimestampMs(c.createdAtRaw) };
  });
  // 타임스탬프 파싱이 된 것만 정렬 대상으로 사용, 못한 것은 뒤로 보낸다.
  withTs.sort(function (a, b) {
    if (a.ms === null && b.ms === null) return 0;
    if (a.ms === null) return 1;
    if (b.ms === null) return -1;
    return a.ms - b.ms;
  });

  var parsedTimestamps = withTs.filter(function (x) { return x.ms !== null; }).map(function (x) { return x.ms; });
  var isSingleCluster = true;
  if (parsedTimestamps.length >= 2) {
    var maxGap = 0;
    for (var i = 1; i < parsedTimestamps.length; i++) {
      var gap = parsedTimestamps[i] - parsedTimestamps[i - 1];
      if (gap > maxGap) maxGap = gap;
    }
    isSingleCluster = maxGap <= DRAFT_CLUSTER_GAP_MS;
  } else if (parsedTimestamps.length === 0) {
    // 시간 파싱이 전혀 안 되면 클러스터 여부를 판단할 수 없으므로
    // 안전하게 "단일 클러스터 아님(검토 필요)"으로 취급한다.
    isSingleCluster = candidates.length <= 1;
  }

  // 가장 이른 시각의 draft를 기준 후보로 삼되, 클러스터 내에서
  // status가 더 신뢰도 높은(랭크가 낮은) draft가 있으면 그것을 우선한다.
  var earliest = withTs.length ? withTs[0].draft : null;
  var bestInCluster = earliest;
  if (isSingleCluster) {
    withTs.forEach(function (x) {
      if (_diagStatusRank(x.draft.status) < _diagStatusRank(bestInCluster.status)) {
        bestInCluster = x.draft;
      }
    });
  }

  return {
    isSingleCluster: isSingleCluster,
    earliestDraft: earliest,
    bestDraft: bestInCluster,
    sortedDrafts: withTs.map(function (x) { return x.draft; })
  };
}

// ============================================================
// ★ 메인 진단 함수 — 읽기 전용. Apps Script 편집기에서 이 함수를 선택한
//   뒤 ▶ 실행하면 된다. 실행 후 [보기] → [실행 로그](Ctrl+Enter)에서
//   console.log() 출력을 확인할 수 있고, 실행 결과 패널에서도 return된
//   object를 확인할 수 있다.
// ============================================================
function diagnoseMissingCustomerRegistrationDates() {
  console.log("[등록일 복원 진단] 시작 — 읽기 전용, 어떤 시트도 수정하지 않습니다.");

  // ── 1. 고객관리 시트 읽기 (읽기 전용) ──────────────────────
  var cs = getCustomerSheet();
  var cData = cs.getDataRange().getValues();
  if (cData.length <= 1) {
    console.log("[등록일 복원 진단] 고객관리 시트에 데이터가 없습니다.");
    return { success: true, message: "고객관리 시트에 데이터가 없습니다." };
  }
  var cHeader = cData[0].map(function (h) { return String(h || "").trim(); });
  var cColIdx = {};
  cHeader.forEach(function (h, i) {
    var mapped = HEADER_MAP[h] || h;
    if (cColIdx[mapped] === undefined) cColIdx[mapped] = i;
  });

  function custCell(row, key) {
    var idx = cColIdx[key];
    if (idx === undefined) return "";
    var v = row[idx];
    return (v === null || v === undefined) ? "" : v;
  }

  var allCustomers = [];
  var missingCustomers = [];
  for (var r = 1; r < cData.length; r++) {
    var row = cData[r];
    var customerName = String(custCell(row, "customerName") || "").trim();
    var phone = String(custCell(row, "phone") || "").trim();
    if (!customerName && !phone) continue; // 빈 행

    var savedAtVal = custCell(row, "_savedAt");
    var savedAtStr = (savedAtVal instanceof Date)
      ? _diagFormatDraftDateTime(savedAtVal)
      : String(savedAtVal || "").trim();

    var cust = {
      rowNumber: r + 1,
      customerId: String(custCell(row, "customerId") || "").trim(),
      customerName: customerName,
      phone: phone,
      requestToken: String(custCell(row, "requestToken") || "").trim(),
      savedAt: savedAtStr
    };
    allCustomers.push(cust);
    if (!savedAtStr) missingCustomers.push(cust);
  }

  console.log("[등록일 복원 진단] 전체 고객 " + allCustomers.length + "명 / 등록일시 미확인 " + missingCustomers.length + "명");

  // ── 2. 자동저장 시트 읽기 (읽기 전용, 없으면 null) ─────────
  var autosaveRows = _diagReadAutosaveRowsReadOnly();
  if (autosaveRows === null) {
    console.log("[등록일 복원 진단] 자동저장 시트가 존재하지 않습니다 — 자동저장 도입 이전 데이터로 판단해 전원 NO_EVIDENCE 처리합니다.");
    autosaveRows = [];
  }

  var newDrafts = autosaveRows.filter(function (d) { return d.draftType === "NEW"; });
  var otherDrafts = autosaveRows.filter(function (d) { return d.draftType === "EDIT" || d.draftType === "CONSULT"; });

  console.log("[등록일 복원 진단] 자동저장 NEW draft " + newDrafts.length + "건 / EDIT·CONSULT draft " + otherDrafts.length + "건(참고용)");

  // ── 3. NEW draft 매칭 인덱스 구성 ──────────────────────────
  var byCustomerId = {}, byNamePhone = {}, byPhoneOnly = {}, byNameOnly = {};
  newDrafts.forEach(function (d) {
    if (d.customerId) {
      (byCustomerId[d.customerId] = byCustomerId[d.customerId] || []).push(d);
    }
    var normName = d.customerName.trim();
    var normPhone = _diagNormalizePhone(d.phone);
    if (normName && normPhone) {
      var key = normName + "|" + normPhone;
      (byNamePhone[key] = byNamePhone[key] || []).push(d);
    }
    if (normPhone) {
      (byPhoneOnly[normPhone] = byPhoneOnly[normPhone] || []).push(d);
    }
    if (normName) {
      (byNameOnly[normName] = byNameOnly[normName] || []).push(d);
    }
  });

  // EDIT/CONSULT는 customerId 기준으로만 참고 카운트를 만든다(요청사항 4, 6).
  var otherDraftsByCustomerId = {};
  otherDrafts.forEach(function (d) {
    if (!d.customerId) return;
    (otherDraftsByCustomerId[d.customerId] = otherDraftsByCustomerId[d.customerId] || []).push(d);
  });

  // ── 4. 고객별 매칭 및 분류 ──────────────────────────────────
  var autoRecoverable = [];
  var reviewRequired = [];
  var noEvidence = [];

  missingCustomers.forEach(function (cust) {
    var normName = cust.customerName.trim();
    var normPhone = _diagNormalizePhone(cust.phone);

    var tier = null, candidates = [];

    if (cust.customerId && byCustomerId[cust.customerId] && byCustomerId[cust.customerId].length) {
      tier = "CONFIRMED_CUSTOMER_ID";
      candidates = byCustomerId[cust.customerId];
    }
    if (!candidates.length && normName && normPhone) {
      var key = normName + "|" + normPhone;
      if (byNamePhone[key] && byNamePhone[key].length) {
        tier = "CONFIRMED_NAME_PHONE";
        candidates = byNamePhone[key];
      }
    }
    if (!candidates.length && normPhone && byPhoneOnly[normPhone] && byPhoneOnly[normPhone].length) {
      tier = "REVIEW_PHONE_ONLY";
      candidates = byPhoneOnly[normPhone];
    }
    if (!candidates.length && normName && byNameOnly[normName] && byNameOnly[normName].length) {
      tier = "REVIEW_NAME_ONLY";
      candidates = byNameOnly[normName];
    }
    if (!candidates.length) {
      tier = "NO_EVIDENCE";
    }

    // requestToken 교차검증(요청사항 8) — payloadJson 안의 requestToken과
    // 고객관리 시트의 requestToken이 일치하는 후보가 있는지만 확인한다.
    var requestTokenMatchedDraftId = "";
    if (cust.requestToken && candidates.length) {
      var rtHit = candidates.filter(function (d) { return d.payloadRequestToken && d.payloadRequestToken === cust.requestToken; });
      if (rtHit.length) requestTokenMatchedDraftId = rtHit[0].draftId;
    }

    var otherRef = cust.customerId ? (otherDraftsByCustomerId[cust.customerId] || []) : [];
    var otherDraftsReference = otherRef.length
      ? { count: otherRef.length, latest: _diagDraftSummary(otherRef[otherRef.length - 1]) }
      : null;

    if (tier === "NO_EVIDENCE") {
      noEvidence.push({
        rowNumber: cust.rowNumber,
        customerId: cust.customerId || "(없음)",
        customerName: cust.customerName,
        phone: cust.phone
      });
      return;
    }

    var cluster = _diagAnalyzeCandidateCluster(candidates);
    var matchedDraftSummaries = cluster.sortedDrafts.map(_diagDraftSummary);

    var baseEntry = {
      rowNumber: cust.rowNumber,
      customerId: cust.customerId || "(없음)",
      customerName: cust.customerName,
      phone: cust.phone,
      currentRegistrationDate: "(빈값)",
      matchTier: tier,
      matchedDraftCount: candidates.length,
      matchedDrafts: matchedDraftSummaries,
      requestTokenMatchedDraftId: requestTokenMatchedDraftId || null,
      otherDraftsReference: otherDraftsReference
    };

    // ── 여러 NEW draft가 서로 멀리 떨어져 있는 경우 ─────────────
    if (candidates.length > 1 && !cluster.isSingleCluster) {
      reviewRequired.push(Object.assign({}, baseEntry, {
        classification: "REVIEW_REQUIRED",
        reviewReason: "MULTIPLE_NEW_DRAFTS_REVIEW — 서로 다른 시점의 NEW draft가 여러 건 존재하여 자동으로 하나를 확정하지 않았습니다.",
        confidence: (tier === "CONFIRMED_CUSTOMER_ID") ? "VERY_HIGH" : (tier === "CONFIRMED_NAME_PHONE") ? "HIGH" : (tier === "REVIEW_PHONE_ONLY") ? "MEDIUM" : "LOW"
      }));
      return;
    }

    var bestDraft = cluster.bestDraft;
    var candidateRegistrationAt = bestDraft ? _diagFormatDraftDateTime(bestDraft.createdAtRaw) : "";
    var candidateRegistrationDate = candidateRegistrationAt ? candidateRegistrationAt.substring(0, 10) : "";
    var candidateRegistrationMonth = candidateRegistrationAt ? candidateRegistrationAt.substring(0, 7) : "";

    var withCandidateDates = Object.assign({}, baseEntry, {
      candidateRegistrationAt: candidateRegistrationAt,
      candidateRegistrationDate: candidateRegistrationDate,
      candidateRegistrationMonth: candidateRegistrationMonth,
      matchCriteria: (tier === "CONFIRMED_CUSTOMER_ID") ? "customerId 완전일치"
        : (tier === "CONFIRMED_NAME_PHONE") ? "고객명 + 전화번호 완전일치"
        : (tier === "REVIEW_PHONE_ONLY") ? "전화번호만 일치(이름 불일치 또는 자동저장 이름 없음)"
        : "고객명만 일치(동명이인 가능성 있음)"
    });

    // ── 1)/2) 매칭이면서 클러스터 대표 draft가 COMPLETED → AUTO_RECOVERABLE ──
    if ((tier === "CONFIRMED_CUSTOMER_ID" || tier === "CONFIRMED_NAME_PHONE") &&
        bestDraft && bestDraft.status === "COMPLETED" && candidateRegistrationAt) {
      autoRecoverable.push(Object.assign({}, withCandidateDates, {
        classification: "AUTO_RECOVERABLE",
        confidence: (tier === "CONFIRMED_CUSTOMER_ID") ? "VERY_HIGH" : "HIGH"
      }));
      return;
    }

    // ── 그 외 전부 REVIEW_REQUIRED ──────────────────────────────
    var reason;
    if (tier === "REVIEW_PHONE_ONLY") {
      reason = "전화번호만 일치하고 고객명이 다르거나 자동저장 쪽 이름이 비어 있어 자동 확정하지 않았습니다.";
    } else if (tier === "REVIEW_NAME_ONLY") {
      reason = "고객명만 일치합니다(동명이인일 가능성이 있어 자동 확정하지 않았습니다).";
    } else if (!bestDraft || !candidateRegistrationAt) {
      reason = "매칭된 draft의 생성 시각을 안전하게 해석할 수 없어 자동 확정하지 않았습니다.";
    } else {
      reason = "가장 유력한 draft의 상태가 COMPLETED가 아닙니다(현재: " + bestDraft.status + ") — 실제로 저장까지 이어졌는지 확인이 필요합니다.";
    }

    reviewRequired.push(Object.assign({}, withCandidateDates, {
      classification: "REVIEW_REQUIRED",
      reviewReason: reason,
      confidence: (tier === "CONFIRMED_CUSTOMER_ID") ? "VERY_HIGH" : (tier === "CONFIRMED_NAME_PHONE") ? "HIGH" : (tier === "REVIEW_PHONE_ONLY") ? "MEDIUM" : "LOW"
    }));
  });

  // ── 5. 월별 집계(AUTO_RECOVERABLE만, 요청사항 11) ────────────
  var byMonth = {};
  autoRecoverable.forEach(function (e) {
    var m = e.candidateRegistrationMonth || "(월 미상)";
    byMonth[m] = (byMonth[m] || 0) + 1;
  });
  var byMonthSorted = Object.keys(byMonth).sort(function (a, b) { return b.localeCompare(a); })
    .map(function (m) { return { month: m, count: byMonth[m] }; });

  // ── 6. 콘솔 요약 출력 ─────────────────────────────────────
  console.log("");
  console.log("[등록일 복원 진단]");
  console.log("");
  console.log("등록일 미확인 고객: " + missingCustomers.length + "명");
  console.log("");
  console.log("자동 복원 가능: " + autoRecoverable.length + "명");
  console.log("검토 필요: " + reviewRequired.length + "명");
  console.log("복원 근거 없음: " + noEvidence.length + "명");
  console.log("");
  if (byMonthSorted.length) {
    console.log("[자동 복원 가능 고객 월별 집계]");
    byMonthSorted.forEach(function (m) { console.log(m.month + " : " + m.count + "명"); });
    console.log("");
  }

  autoRecoverable.forEach(function (e) {
    console.log("[AUTO_RECOVERABLE]");
    console.log("고객관리 행: " + e.rowNumber);
    console.log("customerId: " + e.customerId);
    console.log("고객명: " + e.customerName);
    console.log("연락처: " + e.phone);
    console.log("현재 등록일시: " + e.currentRegistrationDate);
    console.log("매칭기준: " + e.matchCriteria);
    console.log("추천 등록일시: " + e.candidateRegistrationAt);
    console.log("신뢰도: " + e.confidence);
    if (e.requestTokenMatchedDraftId) console.log("requestToken 교차검증 일치 draftId: " + e.requestTokenMatchedDraftId);
    console.log("");
  });

  reviewRequired.forEach(function (e) {
    console.log("[REVIEW_REQUIRED]");
    console.log(e.customerName + " / " + e.phone + " (행 " + e.rowNumber + ")");
    console.log("NEW draft 후보 " + e.matchedDraftCount + "건");
    e.matchedDrafts.forEach(function (d) { console.log("  - " + d.createdAt + " (status:" + d.status + ", draftId:" + d.draftId + ")"); });
    console.log("이유: " + e.reviewReason);
    console.log("");
  });

  var result = {
    success: true,
    summary: {
      totalCustomers: allCustomers.length,
      missingRegistrationDateCount: missingCustomers.length,
      autoRecoverableCount: autoRecoverable.length,
      reviewRequiredCount: reviewRequired.length,
      noEvidenceCount: noEvidence.length,
      autoRecoverableByMonth: byMonthSorted
    },
    autoRecoverable: autoRecoverable,
    reviewRequired: reviewRequired,
    noEvidence: noEvidence
  };

  console.log("[등록일 복원 진단] 완료 — 어떤 시트도 수정하지 않았습니다.");
  return result;
}
// ============================================================
// ★★★ 등록일시 미확인 고객 — AUTO_RECOVERABLE 17명 실제 복구 함수
//   (신규, 관리자 전용) ★★★
//
//   repairMissingCustomerRegistrationDates()             // 기본값: 미리보기만
//   repairMissingCustomerRegistrationDates({dryRun:true}) // 미리보기만(명시)
//   repairMissingCustomerRegistrationDates({dryRun:false})// 실제 기록
//
//   ★★★ 이 함수는 diagnoseMissingCustomerRegistrationDates()의 매칭/판정
//   로직을 그대로 재사용한다 — 새로운 매칭 기준을 만들지 않는다. 복구
//   대상은 오직 그 함수가 classification:"AUTO_RECOVERABLE"로 판정한
//   고객만이다. REVIEW_REQUIRED/NO_EVIDENCE는 절대 건드리지 않는다.
//
//   안전장치:
//   1) 기본값 dryRun:true — 인자 없이 실행하면 실제 수정 없이 대상만
//      보여준다. dryRun:false를 명시적으로 전달했을 때만 실제로 기록한다.
//   2) 최대 복구 인원 상한(MAX_REPAIR_COUNT=17) — 이를 초과하면 단 한
//      건도 기록하지 않고 즉시 예외를 던진다.
//   3) 기존 등록일 보호 — 등록일시가 조금이라도 있으면 무조건 건너뛴다.
//      (dryRun 대상 목록 자체가 diagnoseMissingCustomerRegistrationDates()의
//      "등록일시가 비어있는 고객"만 대상으로 하므로 1차로 보호되고,
//      실제 기록 직전에 셀 값을 다시 한 번 직접 읽어 2차로도 확인한다.)
//   4) 실행 직전 재검증 — 진단 결과를 그대로 믿지 않고, 실제 기록 직전에
//      diagnoseMissingCustomerRegistrationDates()를 다시 한 번 호출해
//      "지금 이 순간" 기준으로도 여전히 AUTO_RECOVERABLE인지, 매칭되는
//      NEW draft와 추천 등록일시가 동일한지 재확인한 뒤에만 기록한다.
//   5) 오직 "등록일시"(_savedAt) 컬럼 한 칸만 수정한다 — 헤더명으로
//      컬럼 위치를 찾아 사용하며(하드코딩 금지), 다른 컬럼·다른 시트는
//      절대 건드리지 않는다. 자동저장 시트는 diagnoseMissingCustomerRegistrationDates()
//      를 통해 읽기만 한다(수정 없음).
//   6) 고객 행 식별은 customerId 완전일치를 최우선으로 하고, 없으면
//      고객명+전화번호(정규화) 완전일치만 사용한다 — 고객명 단독 일치는
//      절대 복구 근거로 쓰지 않는다.
//
//   handleNew()/handleEdit()/handleUpdate()/handleList()/
//   handleDeleteCustomer()/handleAutosaveDraft()/handleSetDraftStatus()
//   등 기존 운영 함수는 이번 작업에서 한 글자도 수정하지 않았다 — 이
//   함수는 완전히 독립된 관리자 전용 1회성 복구 도구다.
// ============================================================

var REGISTRATION_DATE_REPAIR_MAX_COUNT = 17;

function repairMissingCustomerRegistrationDates(options) {
  options = options || {};
  var dryRun = options.dryRun !== false; // ★ 기본값은 반드시 true

  // ── 1. 기존 진단 로직을 그대로 재사용해 대상 목록을 만든다 ──────
  //   (요청사항 1) — 새로운 매칭/판정 기준을 여기서 만들지 않는다.
  var diag = diagnoseMissingCustomerRegistrationDates();
  var targets = diag.autoRecoverable;

  console.log("[등록일 복구 " + (dryRun ? "미리보기" : "실행") + "] AUTO_RECOVERABLE 대상: " + targets.length + "명");

  // ── 2. 최대 복구 건수 안전장치(요청사항 8) ──────────────────
  if (targets.length > REGISTRATION_DATE_REPAIR_MAX_COUNT) {
    throw new Error(
      "예상보다 복구 대상이 많습니다(" + targets.length + "명, 안전 상한 " +
      REGISTRATION_DATE_REPAIR_MAX_COUNT + "명). 단 한 건도 기록하지 않고 작업을 " +
      "중단했습니다. diagnoseMissingCustomerRegistrationDates() 결과를 다시 확인해주세요."
    );
  }

  // ── 3. dryRun(기본값) — 미리보기만, 시트는 전혀 건드리지 않는다 ──
  if (dryRun) {
    console.log("");
    console.log("[등록일 복구 미리보기]");
    console.log("");
    console.log("복구 예정: " + targets.length + "명");
    console.log("");
    targets.forEach(function (t) {
      console.log("고객명: " + t.customerName);
      console.log("연락처: " + t.phone);
      console.log("customerId: " + t.customerId);
      console.log("고객관리 행번호: " + t.rowNumber);
      console.log("현재 등록일시: " + t.currentRegistrationDate);
      console.log("추천 등록일시: " + t.candidateRegistrationAt);
      console.log("매칭기준: " + t.matchCriteria);
      console.log("신뢰도: " + t.confidence);
      console.log("");
    });
    console.log("[등록일 복구 미리보기] 완료 — 시트는 전혀 수정되지 않았습니다.");
    console.log("실제로 기록하려면 repairMissingCustomerRegistrationDates({dryRun:false})를 실행하세요.");

    return {
      success: true,
      dryRun: true,
      targetCount: targets.length,
      targets: targets.map(function (t) {
        return {
          customerName: t.customerName,
          phone: t.phone,
          customerId: t.customerId,
          rowNumber: t.rowNumber,
          currentRegistrationDate: t.currentRegistrationDate,
          candidateRegistrationAt: t.candidateRegistrationAt,
          matchCriteria: t.matchCriteria,
          confidence: t.confidence
        };
      })
    };
  }

  // ── 4. 실제 실행(dryRun:false) ────────────────────────────────
  // ★ 요청사항 7: 예전 진단 결과(targets)를 그대로 믿고 쓰지 않는다.
  //   실제로 기록하기 직전, diagnoseMissingCustomerRegistrationDates()를
  //   다시 한 번 호출해 "지금 이 순간" 기준으로 재검증한다.
  var freshDiag = diagnoseMissingCustomerRegistrationDates();
  var freshByRowNumber = {};
  freshDiag.autoRecoverable.forEach(function (t) { freshByRowNumber[t.rowNumber] = t; });

  var cs = getCustomerSheet();
  var lastCol = cs.getLastColumn();
  var headers = cs.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
    .map(function (h) { return String(h || "").trim(); });

  // 헤더명으로 "등록일시" 컬럼 위치를 찾는다(요청사항 5 — 컬럼 번호 하드코딩 금지).
  var savedAtCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var mapped = HEADER_MAP[headers[i]] || headers[i];
    if (mapped === "_savedAt") { savedAtCol = i + 1; break; }
  }
  if (savedAtCol < 0) {
    throw new Error("고객관리 시트에서 '등록일시'(_savedAt) 컬럼을 찾을 수 없어 복구를 중단했습니다.");
  }

  var repaired = [], skipped = [], errors = [];

  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(10000);
  if (!gotLock) {
    throw new Error("다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.");
  }

  try {
    targets.forEach(function (t) {
      try {
        // ── 재검증 1: 지금 다시 진단해도 여전히 이 행이 AUTO_RECOVERABLE인가 ──
        var fresh = freshByRowNumber[t.rowNumber];
        if (!fresh) {
          skipped.push({
            customerName: t.customerName, phone: t.phone, rowNumber: t.rowNumber,
            reason: "AUTO_RECOVERABLE 조건 불충족(재검증 시점 기준 — 이미 등록일이 채워졌거나 매칭 근거가 바뀜)"
          });
          return;
        }

        // ── 재검증 2: 같은 고객 행이 맞는지(customerId 또는 이름+전화) ──
        var sameCustomerId = t.customerId !== "(없음)" && fresh.customerId === t.customerId;
        var sameNamePhone = fresh.customerName === t.customerName && fresh.phone === t.phone;
        if (!(sameCustomerId || sameNamePhone)) {
          skipped.push({
            customerName: t.customerName, phone: t.phone, rowNumber: t.rowNumber,
            reason: "고객 행 매칭 실패(진단 시점과 현재 시트 내용이 달라짐)"
          });
          return;
        }


        var candidateRegistrationAt = fresh.candidateRegistrationAt;
        if (!candidateRegistrationAt) {
          skipped.push({
            customerName: t.customerName, phone: t.phone, rowNumber: t.rowNumber,
            reason: "추천 등록일시를 다시 확인할 수 없음"
          });
          return;
        }

        // ── 재검증 3: 등록일시 셀을 직접 다시 읽어 정말 비어있는지 최종 확인 ──
        //   (요청사항 3 — 기존 등록일 보호. 조금이라도 값이 있으면 무조건 건너뜀)
        var currentCellDisplay = cs.getRange(t.rowNumber, savedAtCol).getDisplayValues()[0][0];
        if (String(currentCellDisplay || "").trim()) {
          skipped.push({
            customerName: t.customerName, phone: t.phone, rowNumber: t.rowNumber,
            reason: "이미 등록일 존재(" + currentCellDisplay + ")"
          });
          return;
        }

        // ── 실제 기록: 이 고객 행의 "등록일시" 셀 한 칸만 수정한다 ──
        //   (요청사항 13, 14 — 다른 컬럼/다른 시트는 절대 건드리지 않음)
        cs.getRange(t.rowNumber, savedAtCol).setValue(candidateRegistrationAt);

        console.log("[복구 완료]");
        console.log("고객명: " + t.customerName);
        console.log("연락처: " + t.phone);
        console.log("customerId: " + t.customerId);
        console.log("행번호: " + t.rowNumber);
        console.log("기존 등록일시: (빈값)");
        console.log("복구 등록일시: " + candidateRegistrationAt);
        console.log("매칭기준: " + t.matchCriteria);
        console.log("신뢰도: " + t.confidence);
        console.log("");

        repaired.push({
          customerName: t.customerName, phone: t.phone, customerId: t.customerId,
          rowNumber: t.rowNumber, registeredAt: candidateRegistrationAt,
          matchCriteria: t.matchCriteria, confidence: t.confidence
        });

      } catch (innerErr) {
        errors.push({ customerName: t.customerName, phone: t.phone, rowNumber: t.rowNumber, message: innerErr.message });
        console.error("[등록일 복구 오류]", t.customerName, t.phone, t.rowNumber, innerErr.message);
      }
    });

    if (repaired.length > 0) SpreadsheetApp.flush();

  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }

  console.log("");
  console.log("[등록일 복구 완료]");
  console.log("");
  console.log("복구 대상: " + targets.length + "명");
  console.log("실제 복구: " + repaired.length + "명");
  console.log("건너뜀: " + skipped.length + "명");
  console.log("오류: " + errors.length + "명");
  if (skipped.length) {
    console.log("");
    console.log("[건너뜀 상세]");
    skipped.forEach(function (s) { console.log(s.customerName + " / " + s.phone + " (행 " + s.rowNumber + ") — " + s.reason); });
  }
  if (errors.length) {
    console.log("");
    console.log("[오류 상세]");
    errors.forEach(function (e) { console.log(e.customerName + " / " + e.phone + " (행 " + e.rowNumber + ") — " + e.message); });
  }

  return {
    success: true,
    dryRun: false,
    targetCount: targets.length,
    repairedCount: repaired.length,
    skippedCount: skipped.length,
    errorCount: errors.length,
    repaired: repaired,
    skipped: skipped,
    errors: errors
  };
}
function runRegistrationDateRepair() {
  throw new Error(
    "이 단축 함수는 비활성화되었습니다. 자동저장 NEW draft의 createdAt은 " +
    "실제 고객관리 시트 최초 등록 시각과 100% 동일하다고 보장할 수 없어 " +
    "실수로 등록일을 다시 복구하는 작업을 막았습니다."
  );
}