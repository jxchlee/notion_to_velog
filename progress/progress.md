# Notion to Velog 확장 프로그램 개발 진행상황

## 프로젝트 목적
Notion에서 Ctrl+A → Ctrl+C로 전체 복사한 내용을 Velog 글쓰기(velog.io/write)에
Ctrl+V로 붙여넣을 때 이미지까지 자동으로 Velog CDN에 업로드되게 하는 Chrome/Brave 확장.

Notion이 이미지를 `![image.png](attachment:UUID:image.png)` 형식으로 복사하는데,
이 URL scheme은 Velog에서 렌더링되지 않으므로 직접 업로드해야 함.

---

## 파일 구조
```
notion_to_velog/
  manifest.json       - MV3 매니페스트 (permissions: storage, cookies, tabs, scripting)
  background.js       - Service worker (이미지 다운로드 + Velog 업로드)
  content.js          - velog.io/write 콘텐츠 스크립트 (붙여넣기 인터셉트)
  notion-content.js   - notion.so 콘텐츠 스크립트 (UUID→URL 매핑 저장)
  popup.html/js       - Notion Integration Token 입력 UI
```

---

## 동작 흐름
1. notion.so에서 `notion-content.js`가 img 태그 src를 스캔 → `chrome.storage.local`에 `{UUID: notionProxyUrl}` 저장
2. velog.io/write에서 `content.js`가 paste 이벤트 인터셉트
3. 클립보드 텍스트에서 `![alt](attachment:UUID:filename)` 패턴 추출
4. `chrome.storage.local`에서 UUID→URL 맵 조회 (`notionImageMap`)
5. 각 UUID에 대해 background에 `FETCH_IMAGE` 메시지 → Notion API로 S3 URL 조회 → 이미지 다운로드
6. background에 `UPLOAD_TO_VELOG` 메시지 → `chrome.scripting.executeScript` MAIN world로 Velog 업로드
7. 성공한 URL로 markdown 교체 후 CodeMirror에 합성 paste 이벤트로 주입

---

## 해결된 문제들

### chrome.storage.session 접근 불가 (Brave)
- 증상: content script에서 `chrome.storage.session` 접근 시 undefined
- 해결: `chrome.storage.local`로 교체

### 붙여넣기 타겟이 제목으로 가는 문제
- 증상: paste 이벤트가 에디터 밖에서도 인터셉트됨
- 해결: `editorParent.contains(pasteTarget)` 체크로 CodeMirror 영역 밖은 무시

### CodeMirror에 텍스트 주입 실패
- 증상: cm.CodeMirror 프로퍼티가 undefined (Velog는 DOM에 CM 인스턴스 노출 안 함)
- 해결: 합성 ClipboardEvent를 원래 pasteTarget(textarea)에 dispatch → isProcessing=true라 재진입 방지

### Notion 이미지 다운로드 실패 (Brave Shield)
- 증상: Brave가 content script의 notion.so fetch 차단
- 해결: Notion Integration Token으로 공식 API(api.notion.com/v1/blocks/{blockId}) 호출 → S3 presigned URL 획득 → 다운로드

### Velog 업로드 400 Bad Request
- 증상: POST v2.velog.io/api/v2/files/upload → 400
- 원인: API가 FormData에 `type` 필드('post' 또는 'profile')를 요구하는데 미전송
- 해결: fd.append('type', 'post') 추가
- 비고: CORS 정책으로 에러 응답 body를 읽을 수 없어 디버깅에 시간 소요
         velog-server GitHub 소스(velopert/velog-server) 직접 분석해서 원인 파악

---

## 현재 미해결 문제

없음. 전체 플로우 정상 동작 확인 (2026-05-22)

---

## 에러 히스토리

| 시기 | 에러 | 원인 | 해결 |
|------|------|------|------|
| 초기 | storage.session undefined | Brave 정책 | storage.local 사용 |
| 초기 | 텍스트가 제목에 붙여넣어짐 | 이벤트 타겟 구분 없음 | editorParent 체크 |
| 중기 | cm.CodeMirror undefined | Velog DOM에 CM 노출 안 함 | 합성 paste 이벤트 |
| 중기 | Notion 이미지 fetch 실패 | Brave Shield CORS | Integration Token API |
| 후기 | 업로드 400 | type 필드 미전송 | fd.append('type','post') |
| 해결 | 업로드 403 | ref_id 미전송 | URL ?id= 파라미터 활용, 신규 글은 profile 폴백 |

---

## 기술 메모

### Brave에서 chrome.cookies가 Velog 쿠키를 못 읽는 문제
- Brave가 HttpOnly 쿠키를 extension API에서 숨김
- 그러나 브라우저 자체는 credentials: include fetch에 쿠키를 포함해서 보냄
- MAIN world executeScript에서의 fetch는 인증 쿠키 정상 전송됨

### MAIN world executeScript 사용 이유
- content script isolated world에서 v2.velog.io fetch 시 CORS 헤더 문제 발생
- MAIN world는 페이지(velog.io) 컨텍스트로 실행 → same-site 요청 → 쿠키 포함됨

### Notion 이미지 URL 구조
- Notion clipboard 복사 형식: ![alt](attachment:UUID:filename)
- Notion proxy URL: https://www.notion.so/image/...?id=BLOCK_UUID&...
- Notion API: GET api.notion.com/v1/blocks/{BLOCK_UUID} → block.image.file.url (S3 presigned)
- S3 URL은 만료 시간 있음 → 즉시 다운로드 필요

### Velog 업로드 API (velog-server 소스 확인)
- Endpoint: POST https://v2.velog.io/api/v2/files/upload
- Auth: authorized 미들웨어 (access_token 쿠키)
- FormData 필드:
  - type: 'post' | 'profile' (필수, 없으면 400)
  - ref_id: 글 UUID (type='post'일 때 필수, 없으면 403)
  - image: 이미지 파일 (multer single upload, field name = 'image')
- Response: { path: "https://..." }  (url, image_url 아님!)
- Storage: Backblaze B2

### Velog 응답 필드 주의
- 현재 코드: d.url ?? d.image_url ?? d.path
- 실제 응답은 `path` 필드만 존재하는 것으로 보임 → 일단 폴백 처리로 커버됨

---

## 다음 작업

없음. 기능 완성 및 동작 확인 완료.
