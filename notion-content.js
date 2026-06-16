// Notion 페이지에서 실행
// 1) 이미지 UUID → URL 매핑 수집
// 2) background 요청 시 same-origin fetch로 이미지 전달 (token_v2 쿠키 자동 포함)

const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi;
const imageMap = {};

// URL 경로(쿼리 제외)에서 마지막 UUID를 첨부 파일 UUID로 추출
// 구버전: notion.so/image/attachment%3AUUID%3Aimage.png?id=BLOCK_ID
// 신버전: app.notion.com/image/https%3A...s3.../WORKSPACE_UUID/ATTACHMENT_UUID/image.png?id=BLOCK_ID
function extractAttachmentUUID(src) {
  const path = src.split('?')[0];
  const matches = path.match(UUID_RE);
  return matches ? matches[matches.length - 1] : null;
}

function captureImg(img) {
  if (!img?.src?.startsWith('http')) return;
  try {
    const blockId = new URL(img.src).searchParams.get('id');
    if (!blockId) return; // UI 이미지(아바타, 아이콘 등) 제외
    const uuid = extractAttachmentUUID(img.src);
    if (uuid && !imageMap[uuid]) {
      imageMap[uuid] = img.src;
      chrome.storage.local.set({ notionImageMap: { ...imageMap } });
      console.log('[N2V] 이미지 캡처 성공:', uuid);
    }
  } catch (e) {}
}

document.querySelectorAll('img[src]').forEach(captureImg);

const mutObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.type === 'attributes' && m.target.tagName === 'IMG') captureImg(m.target);
    if (m.type === 'childList') {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.tagName === 'IMG') captureImg(node);
        node.querySelectorAll?.('img[src]').forEach(captureImg);
      });
    }
  }
});

mutObserver.observe(document.body, {
  subtree: true, childList: true,
  attributes: true, attributeFilter: ['src']
});

// ─── background로부터 이미지 fetch 요청 수신 ───────────────────
// notion.so 컨텍스트 = same-origin fetch = token_v2(HttpOnly) 자동 포함
// Brave Shields가 off여야 동작함
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'FETCH_IMAGE_FOR_VELOG') return;

  fetch(message.url, {
    credentials: 'include',
    headers: { 'Accept': 'image/*,*/*' }
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const buffer = await blob.arrayBuffer();
      sendResponse({
        success: true,
        data: Array.from(new Uint8Array(buffer)),
        mimeType: blob.type || 'image/png'
      });
    })
    .catch(err => sendResponse({ success: false, error: err.message }));

  return true;
});
