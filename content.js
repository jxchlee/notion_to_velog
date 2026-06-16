(function () {
  'use strict';

  // ![alt](attachment:UUID:filename) 패턴 (구버전 text/plain 포맷)
  const ATTACHMENT_RE = /!\[([^\]]*)\]\(attachment:([a-f0-9-]{36}):([^)]+)\)/g;
  // <img src="attachment:UUID:filename" alt="alt"> 패턴 (신버전 text/html 포맷)
  const HTML_IMG_RE = /<img src="attachment:([a-f0-9-]{36}):([^"]+)" alt="([^"]*)">/g;
  // Notion 이미지 URL에서 UUID 추출: attachment%3AUUID%3A or attachment:UUID:
  const NOTION_UUID_RE = /attachment(?:%3A|:)([a-f0-9-]{36})(?:%3A|:)/i;

  let isProcessing = false;

  // ─────────────────────────────────────────────────────────────
  // 붙여넣기 이벤트 인터셉트
  // ─────────────────────────────────────────────────────────────
  document.addEventListener('paste', async (event) => {
    if (isProcessing) return;

    const text = event.clipboardData?.getData('text/plain') || '';
    const html = event.clipboardData?.getData('text/html') || '';
    const pasteTarget = event.target;

    // 에디터(CodeMirror 영역) 밖(예: 제목)에서 붙여넣기하면 인터셉트 안 함
    const editorParent = document.querySelector('.CodeMirror')?.parentElement;
    if (editorParent && !editorParent.contains(pasteTarget)) return;

    // Notion attachment 형식이 없으면 평소대로 처리
    let plainText = text;
    let attachments = [...plainText.matchAll(ATTACHMENT_RE)];

    if (attachments.length === 0) {
      // 신버전 포맷: text/plain에는 "!filename"만 있고, UUID는 text/html의 <img>에 있음
      // → text/html에서 UUID/alt를 파일명별 큐로 추출 후, text/plain의 "!filename.ext"를
      //   문서 순서대로(같은 파일명이 여러 개여도 큐 순서대로) 치환
      const queues = new Map();
      for (const [, uuid, filename, alt] of html.matchAll(HTML_IMG_RE)) {
        if (!queues.has(filename)) queues.set(filename, []);
        queues.get(filename).push({ uuid, alt });
      }

      if (queues.size > 0) {
        const PLACEHOLDER_RE = /!([^\s!"'()<>]+\.(?:png|jpe?g|gif|webp|svg|bmp))/gi;
        plainText = plainText.replace(PLACEHOLDER_RE, (match, filename) => {
          const queue = queues.get(filename);
          if (!queue || queue.length === 0) return match;
          const { uuid, alt } = queue.shift();
          return `![${alt}](attachment:${uuid}:${filename})`;
        });
      }

      attachments = [...plainText.matchAll(ATTACHMENT_RE)];
    }

    if (attachments.length === 0) {
      console.log('[N2V] attachment 패턴 매칭 안됨. clipboard text/plain:', JSON.stringify(text.slice(0, 500)));
      console.log('[N2V] clipboard text/html:', JSON.stringify(html.slice(0, 500)));
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    isProcessing = true;

    try {
      showToast(`⏳ Notion 이미지 처리 중... (총 ${attachments.length}개)`);

      // Notion 페이지에서 미리 저장해둔 UUID → URL 매핑 조회
      const urlMap = await getNotionUrlMap();
      if (Object.keys(urlMap).length === 0) {
        showToast('⚠️ Notion 이미지 URL을 찾지 못했습니다.\nNotion 탭을 열고 해당 페이지를 스크롤한 뒤 다시 복사해주세요.', 'warn', 6000);
        isProcessing = false;
        return;
      }

      let processed = plainText;
      let successCount = 0;
      const failed = [];

      for (let i = 0; i < attachments.length; i++) {
        const [fullMatch, alt, uuid, filename] = attachments[i];

        updateToast(`⏳ 이미지 업로드 중... (${i + 1} / ${attachments.length})`);

        const notionUrl = urlMap[uuid];
        if (!notionUrl) {
          failed.push({ uuid, reason: 'Notion 페이지 이미지 스캔 필요 — 노션 탭에서 페이지를 스크롤 후 다시 복사' });
          continue;
        }

        try {
          const imageData = await fetchImageFromBackground(notionUrl);
          const velogUrl = await uploadToVelogViaBackground(imageData, filename);
          processed = processed.replace(fullMatch, `![${alt}](${velogUrl})`);
          successCount++;

          // 20개마다 15초 대기 (마지막 배치 이후 제외)
          if (successCount % 20 === 0 && i < attachments.length - 1) {
            for (let sec = 15; sec > 0; sec--) {
              updateToast(`⏸ 잠시 대기 중... ${sec}초 후 재개 (${successCount} / ${attachments.length} 완료)`);
              await new Promise(r => setTimeout(r, 1000));
            }
          }
        } catch (err) {
          console.error(`[N2V] 이미지 처리 실패 (${uuid}):`, err);
          failed.push({ uuid, reason: err.message });
        }
      }

      setEditorContent(processed, pasteTarget);

      if (failed.length === 0) {
        showToast(`✅ 완료! ${successCount}개 이미지 업로드됨`, 'ok', 3000);
      } else {
        const msg = `⚠️ ${successCount}개 성공, ${failed.length}개 실패\n`
          + failed.map(f => `· ${f.uuid.slice(0, 8)}… : ${f.reason}`).join('\n');
        showToast(msg, 'warn', 6000);
        console.warn('[N2V] 실패 목록:', failed);
      }
    } catch (err) {
      console.error('[N2V] 치명적 오류:', err);
      showToast('❌ 오류: ' + err.message, 'error', 6000);
    } finally {
      isProcessing = false;
    }
  }, true);

  // ─────────────────────────────────────────────────────────────
  // Notion 페이지에서 저장해둔 UUID → URL 매핑 조회
  // ─────────────────────────────────────────────────────────────
  function getNotionUrlMap() {
    return new Promise(resolve => {
      chrome.storage.local.get('notionImageMap', data => {
        resolve(data?.notionImageMap || {});
      });
    });
  }

  // 캔버스 재인코딩: 손상된 이미지도 올바른 PNG로 변환
  function reencodeAsValidPng(blob) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob(newBlob => {
          URL.revokeObjectURL(url);
          resolve(newBlob);
        }, 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // ─────────────────────────────────────────────────────────────
  // background에서 Velog 업로드 (CORS 없음 + Authorization 헤더)
  // ─────────────────────────────────────────────────────────────
  function uploadToVelogViaBackground(imageData, filename) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'UPLOAD_TO_VELOG', imageData, filename }, (response) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (response?.success) resolve(response.url);
        else reject(new Error(response?.error || '업로드 실패'));
      });
    });
  }

  // ─────────────────────────────────────────────────────────────
  // background에서 Notion 이미지 다운로드
  // ─────────────────────────────────────────────────────────────
  function fetchImageFromBackground(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.success) resolve(response);
        else reject(new Error(response?.error || '알 수 없는 오류'));
      });
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Velog 이미지 업로드
  // POST https://v2.velog.io/api/v2/files/upload (multipart/form-data)
  // ─────────────────────────────────────────────────────────────
  async function uploadToVelog(imageData, filename) {
    let blob = new Blob(
      [new Uint8Array(imageData.data)],
      { type: imageData.mimeType }
    );

    const ext = filename.split('.').pop().toLowerCase() || 'png';
    const uploadFilename = `image.${ext}`;
    // 실제 PNG 유효성 확인 (첫 4바이트: 89 50 4E 47)
    const header = new Uint8Array(imageData.data.slice(0, 4));
    const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
    console.log('[N2V] 업로드 시도:', uploadFilename, blob.size, 'bytes', blob.type,
      isPng ? '✓ valid PNG' : `✗ invalid (${header.map(b=>b.toString(16)).join(' ')})`);


    const makeRequest = () => {
      const fd = new FormData();
      fd.append('type', 'post');
      fd.append('image', blob, uploadFilename);
      return fetch('https://v2.velog.io/api/v2/files/upload', {
        method: 'POST',
        body: fd,
        credentials: 'include'
      });
    };

    // fetch()가 throw하는 경우(CORS+400)도 잡아서 재시도
    let response;
    try {
      response = await makeRequest();
    } catch (e) {
      console.warn('[N2V] 업로드 첫 시도 실패:', e.message, '— 1.5초 후 재시도');
      await new Promise(r => setTimeout(r, 1500));
      response = await makeRequest();
    }

    if (!response.ok) {
      console.warn('[N2V] 업로드 HTTP 실패:', response.status, '— 재시도');
      await new Promise(r => setTimeout(r, 1500));
      response = await makeRequest();
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error('Velog 로그인이 필요합니다. velog.io에서 로그인 후 다시 시도하세요.');
    }
    if (!response.ok) {
      throw new Error(`Velog 업로드 실패: HTTP ${response.status}`);
    }

    const result = await response.json();

    // API 응답에서 URL 추출 (필드명이 다를 경우 대비)
    const url = result.url ?? result.image_url ?? result.path ?? result.data?.url;
    if (!url) {
      throw new Error('업로드 응답에 URL 없음: ' + JSON.stringify(result));
    }

    return url;
  }

  // ─────────────────────────────────────────────────────────────
  // CodeMirror 에디터에 마크다운 주입
  // pasteTarget(CodeMirror 내부 textarea)에 합성 paste 이벤트 dispatch
  // → isProcessing=true 상태라 우리 listener는 무시, CodeMirror 자체 핸들러 실행
  // ─────────────────────────────────────────────────────────────
  function setEditorContent(text, pasteTarget) {
    // 1순위: 원래 붙여넣기 타겟에 합성 paste 이벤트 (CodeMirror 자체 처리)
    if (pasteTarget) {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        pasteTarget.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        }));
        return;
      } catch (e) {
        console.warn('[N2V] 합성 paste 실패:', e.message);
      }
    }

    // 2순위: CodeMirror instance
    const cm = [...document.querySelectorAll('.CodeMirror')]
      .map(w => w.CodeMirror).find(Boolean);
    if (cm) {
      cm.focus();
      cm.replaceRange(text, cm.getCursor('from'), cm.getCursor('to'));
      return;
    }

    // 3순위: 클립보드 복사 + 안내
    navigator.clipboard.writeText(text).catch(() => {});
    alert('[Notion to Velog] 처리된 마크다운을 클립보드에 복사했습니다. 에디터에 붙여넣기 해주세요.');
  }

  // ─────────────────────────────────────────────────────────────
  // 토스트 알림 UI
  // ─────────────────────────────────────────────────────────────
  let toastEl = null;
  let toastTimer = null;

  function showToast(message, type = 'info', autoHideMs = 0) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = [
        'position:fixed',
        'bottom:24px',
        'right:24px',
        'padding:12px 18px',
        'border-radius:8px',
        'font:14px/1.5 -apple-system,sans-serif',
        'color:#fff',
        'z-index:2147483647',
        'box-shadow:0 4px 16px rgba(0,0,0,0.25)',
        'white-space:pre-line',
        'max-width:340px',
        'word-break:break-all'
      ].join(';');
      document.body.appendChild(toastEl);
    }

    const colors = {
      info: '#20c997',
      ok: '#12b886',
      warn: '#f76707',
      error: '#e03131'
    };
    toastEl.style.background = colors[type] || colors.info;
    toastEl.textContent = message;
    toastEl.style.display = 'block';

    if (toastTimer) clearTimeout(toastTimer);
    if (autoHideMs > 0) {
      toastTimer = setTimeout(() => {
        if (toastEl) toastEl.style.display = 'none';
      }, autoHideMs);
    }
  }

  function updateToast(message) {
    if (toastEl) toastEl.textContent = message;
  }
})();
