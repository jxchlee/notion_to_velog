// Notion 페이지에서 실행
// 1) 이미지 UUID → URL 매핑 수집
// 2) background 요청 시 same-origin fetch로 이미지 전달 (token_v2 쿠키 자동 포함)

const UUID_FROM_SRC = /attachment(?:%3A|:)([a-f0-9-]{36})(?:%3A|:)/i;
const imageMap = {};

function captureImg(img) {
  if (!img?.src) return;
  const match = img.src.match(UUID_FROM_SRC);
  if (match && !imageMap[match[1]]) {
    imageMap[match[1]] = img.src;
    chrome.storage.local.set({ notionImageMap: { ...imageMap } });
  }
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
