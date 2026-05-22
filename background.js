// Notion 이미지 다운로드만 담당 (Velog 업로드는 content.js에서)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'FETCH_IMAGE') return;

  downloadNotionImage(message.url)
    .then(result => sendResponse({ success: true, ...result }))
    .catch(err => sendResponse({ success: false, error: err.message }));

  return true;
});

async function downloadNotionImage(notionProxyUrl) {
  const { notionToken } = await chrome.storage.local.get('notionToken');
  if (!notionToken) throw new Error('Notion Token 미설정. 확장 팝업에서 토큰을 입력하세요.');

  const blockId = extractBlockId(notionProxyUrl);
  if (!blockId) throw new Error('block ID 추출 실패: ' + notionProxyUrl.slice(0, 80));

  const s3Url = await getS3UrlFromApi(blockId, notionToken);

  const res = await fetch(s3Url);
  if (!res.ok) throw new Error(`S3 다운로드 실패: HTTP ${res.status}`);

  const blob = await res.blob();
  const buffer = await blob.arrayBuffer();
  return {
    data: Array.from(new Uint8Array(buffer)),
    mimeType: blob.type || 'image/png'
  };
}

// Velog 업로드: MAIN world에서 실행 (sec-fetch-site: same-site 보장)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'UPLOAD_TO_VELOG') return;

  uploadViaMainWorld(sender.tab.id, message.imageData, message.filename)
    .then(url => sendResponse({ success: true, url }))
    .catch(err => sendResponse({ success: false, error: err.message }));

  return true;
});

async function uploadViaMainWorld(tabId, imageData, filename) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',  // 페이지 JS 컨텍스트 → sec-fetch-site: same-site
    func: (data, mimeType, fname) => {
      const blob = new Blob([new Uint8Array(data)], { type: mimeType });
      const ext = fname.split('.').pop().toLowerCase() || 'png';
      const fd = new FormData();

      // ref_id: 현재 편집 중인 글의 UUID. 없으면 profile 타입으로 폴백
      const refId = new URLSearchParams(window.location.search).get('id');
      if (refId) {
        fd.append('type', 'post');
        fd.append('ref_id', refId);
      } else {
        fd.append('type', 'profile');
      }

      fd.append('image', blob, `image.${ext}`);
      return fetch('https://v2.velog.io/api/v2/files/upload', {
        method: 'POST',
        body: fd,
        credentials: 'include'
      })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(d => d.url ?? d.image_url ?? d.path);
    },
    args: [imageData.data, imageData.mimeType, filename]
  });

  const url = results?.[0]?.result;
  if (!url) throw new Error('업로드 결과 URL 없음');
  return url;
}

function extractBlockId(url) {
  try { return new URL(url).searchParams.get('id'); }
  catch { return null; }
}

async function getS3UrlFromApi(blockId, token) {
  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28'
    }
  });
  if (res.status === 401) throw new Error('Notion Token이 유효하지 않습니다.');
  if (res.status === 403) throw new Error('페이지를 Integration과 공유하지 않았습니다.');
  if (res.status === 404) throw new Error('Block을 찾을 수 없습니다. 페이지를 Integration과 공유하세요.');
  if (!res.ok) throw new Error(`Notion API 오류: HTTP ${res.status}`);

  const block = await res.json();
  const url = block.image?.file?.url ?? block.image?.external?.url;
  if (!url) throw new Error(`이미지 URL 없음 (block type: ${block.type})`);
  return url;
}
