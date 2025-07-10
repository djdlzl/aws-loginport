// QR 코드 스캔 버튼 이벤트 리스너
document.getElementById('qrScanBtn').addEventListener('click', openQrScanner);

// 검색 입력 필드 이벤트 리스너
document.getElementById('searchInput').addEventListener('input', filterClients);

// 윈도우 컨트롤 버튼 이벤트 리스너
document.getElementById('minimize-btn').addEventListener('click', () => {
  window.electron.minimizeWindow();
});

document.getElementById('maximize-btn').addEventListener('click', () => {
  window.electron.toggleMaximize();
});

document.getElementById('close-btn').addEventListener('click', () => {
  window.electron.closeWindow();
});

// QR 코드 스캐너 열기
async function openQrScanner() {
  // 파일 입력 엘리먼트 생성
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  
  // 파일 선택 시 처리
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      // FileReader로 이미지 로드
      const imgData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      // 이미지 로드
      const img = new Image();
      await new Promise((resolve) => {
        img.onload = resolve;
        img.src = imgData;
      });
      
      // 캔버스 생성 및 이미지 그리기
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, img.width, img.height);
      
      // jsQR로 QR 코드 인식
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });
      
      if (code) {
        // QR 코드에서 secret 추출 (예: otpauth://totp/...?secret=...&...)
        const secretMatch = code.data.match(/secret=([^&]+)/);
        if (secretMatch && secretMatch[1]) {
          const secret = secretMatch[1];
          document.getElementById('searchInput').value = secret;
          showNotification('QR 코드에서 시크릿을 성공적으로 추출했습니다.', 'success');
        } else {
          // 시크릿을 찾을 수 없는 경우 전체 데이터를 표시
          document.getElementById('searchInput').value = code.data;
          showNotification('QR 코드를 스캔했지만 시크릿을 찾을 수 없습니다. 전체 데이터를 표시합니다.', 'warning');
        }
        
        // 검색 필터링 실행
        filterClients();
      } else {
        showNotification('QR 코드를 인식할 수 없습니다. 다른 이미지를 시도해주세요.', 'danger');
      }
    } catch (error) {
      console.error('QR 코드 처리 중 오류:', error);
      showNotification('QR 코드 처리 중 오류가 발생했습니다.', 'danger');
    }
  };
  
  // 파일 선택 대화상자 열기
  input.click();
}

// 클라이언트 목록 필터링
function filterClients() {
  const query = document.getElementById('searchInput').value.toLowerCase();
  const items = document.querySelectorAll('.list-group-item');
  
  items.forEach(item => {
    const clientName = item.querySelector('.client-name').textContent.toLowerCase();
    const clientAccount = item.querySelector('.client-account').textContent.toLowerCase();
    
    if (clientName.includes(query) || clientAccount.includes(query)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
}

// AWS 로그인 시작
async function startLogin(clientName) {
  try {
    const response = await fetch(`/login?client=${encodeURIComponent(clientName)}`);
    const data = await response.json();
    
    if (data.success) {
      showNotification(`${clientName} 로그인을 시작합니다.`, 'success');
    } else {
      showNotification(data.error || '로그인 중 오류가 발생했습니다.', 'error');
    }
  } catch (error) {
    console.error('로그인 요청 실패:', error);
    showNotification('서버와의 통신 중 오류가 발생했습니다.', 'error');
  }
}

// 알림 표시
function showNotification(message, type = 'info') {
  const notification = document.getElementById('notification');
  if (!notification) return;
  
  notification.textContent = message;
  notification.className = `notification show ${type}`;
  
  setTimeout(() => {
    notification.className = 'notification';
  }, 3000);
}

// MFA 코드 복사
function copyMfaCode(code) {
  navigator.clipboard.writeText(code)
    .then(() => {
      showNotification(`MFA 코드가 복사되었습니다: ${code}`, 'success');
    })
    .catch(err => {
      console.error('복사 실패:', err);
      showNotification('MFA 코드 복사에 실패했습니다.', 'error');
    });
}
