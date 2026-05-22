# Notion to Velog

**한국어** | [English](README.en.md)

노션 콘텐츠를 이미지 자동 업로드와 함께 벨로그에 바로 붙여넣기하는 크롬 확장 프로그램.

![preview](assets/preview.webp)

노션은 이미지를 `![alt](attachment:UUID:filename)` 형식으로 복사합니다. 벨로그는 이 형식을 렌더링하지 못해 이미지가 깨집니다. 이 확장 프로그램은 `velog.io/write`의 붙여넣기 이벤트를 인터셉트해 각 이미지를 벨로그 CDN에 업로드한 뒤 URL을 교체하고 에디터에 삽입합니다.

---

## 요구 사항

- 크로뮴 기반 브라우저 (Chrome, Brave 등)
- [Notion Integration Token](https://www.notion.so/my-integrations)
- [velog.io](https://velog.io) 로그인 상태

---

## 설치

1. 이 저장소를 클론하거나 다운로드
2. 브라우저에서 `chrome://extensions` 열기
3. 우측 상단 **개발자 모드** 활성화
4. **압축 해제된 확장 프로그램을 로드합니다** 클릭 후 프로젝트 폴더 선택

---

## 초기 설정

### 1. Notion Integration 생성

1. [notion.so/my-integrations](https://www.notion.so/my-integrations) 접속
2. **새 통합 만들기** 클릭 후 이름 입력
3. **Internal Integration Token** (`ntn_...`) 복사

### 2. Notion 페이지에 Integration 연결

복사할 노션 페이지마다:

1. 노션 페이지 우측 상단 **···** 클릭
2. **Connections** → 생성한 Integration 선택

### 3. 확장 프로그램에 토큰 저장

브라우저 툴바에서 확장 아이콘을 클릭해 토큰을 붙여넣고 **저장**을 누릅니다.

---

## 사용 방법

1. 게시할 노션 페이지 열기
2. `Ctrl+A` → `Ctrl+C` 로 전체 복사
3. `velog.io/write` 에서 `Ctrl+V` 붙여넣기
4. 이미지가 자동으로 업로드되고 완성된 마크다운이 에디터에 삽입됩니다

화면 우하단에 진행 상황과 결과를 알려주는 토스트 알림이 표시됩니다.

---

## 주의 사항

- **Brave 사용자**: Notion 페이지에서 Brave Shields를 꺼야 합니다. 주소창의 Brave 라이온 아이콘을 클릭해 Shields를 비활성화하세요.
- 복사 전에 Integration이 해당 페이지에 연결되어 있어야 합니다. 연결되지 않으면 block 조회 시 404 오류가 발생합니다.
- 노션의 S3 presigned URL은 약 1시간 후 만료됩니다. 복사 후 바로 붙여넣기 하세요.
