const input = document.getElementById('tokenInput');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('tokenStatus');

// 저장된 토큰 불러오기
chrome.storage.local.get('notionToken', ({ notionToken }) => {
  if (notionToken) {
    input.value = notionToken;
    showStatus('ok', '✅ 토큰 저장됨');
  }
});

saveBtn.addEventListener('click', () => {
  const token = input.value.trim();
  if (!token) {
    showStatus('err', '토큰을 입력하세요');
    return;
  }
  if (!token.startsWith('ntn_') && !token.startsWith('secret_')) {
    showStatus('err', '올바른 Notion 토큰 형식이 아닙니다');
    return;
  }
  chrome.storage.local.set({ notionToken: token }, () => {
    showStatus('ok', '✅ 저장됨');
  });
});

function showStatus(type, msg) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
}
