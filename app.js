const express = require('express');
const { authenticator } = require('otplib');
const puppeteer = require('puppeteer');
const path = require('path');
const { loadClients } = require('./sheets_loader');
const fs = require('fs');
const app = express();

app.use(express.static('public'));
// 아이콘 파일 제공
app.get('/icon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'icon.ico'));
});
app.use(express.json());

// puppeteer-cache 디렉토리 생성
const cacheDir = path.join(process.cwd(), 'puppeteer-cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

// 환경 변수 설정
process.env.PUPPETEER_CACHE_DIR = cacheDir;



// 내장 크롬 브라우저 경로 찾기
function getLocalChromiumPath() {
  try {
      // 1. 개발 환경에서의 기본 경로 시도
      const defaultPath = puppeteer.executablePath();
      if (fs.existsSync(defaultPath)) {
          console.log('Using Chrome from default path:', defaultPath);
          return defaultPath;
      }

      // 2. 앱이 패키징된 경우의 경로 시도
      const appPath = process.resourcesPath ? 
          path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'puppeteer', '.local-chromium', 'chrome', 'win64-138.0.7204.92', 'chrome-win64', 'chrome.exe') : 
          path.join(__dirname, 'node_modules', 'puppeteer', '.local-chromium', 'chrome', 'win64-138.0.7204.92', 'chrome-win64', 'chrome.exe');

      if (fs.existsSync(appPath)) {
          console.log('Using Chrome from app path:', appPath);
          return appPath;
      }

      // 3. 상대 경로로도 시도 (개발 환경에서의 대체 경로)
      const relativePath = path.join(__dirname, 'node_modules', 'puppeteer', '.local-chromium', 'chrome', 'win64-138.0.7204.92', 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(relativePath)) {
          console.log('Using Chrome from relative path:', relativePath);
          return relativePath;
      }

      console.error('Chrome not found in any location');
      return null;
  } catch (e) {
      console.error('Error finding Chrome:', e);
      return null;
  }
}

// config.json 파일 경로 결정
function getConfigPath() {
  try {
    // 1. AppData/Roaming/aws-login-port 디렉토리 경로 생성
    const appDataPath = process.env.APPDATA || 
      (process.platform === 'darwin' 
        ? path.join(process.env.HOME, 'Library/Application Support') 
        : path.join(process.env.HOME, '.config'));
    
    const configDir = path.join(appDataPath, 'aws-login-port');
    
    // 디렉토리가 없으면 생성
    if (typeof fs !== 'undefined' && !fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    const configPath = path.join(configDir, 'config.json');
    
    // config.json 파일이 없으면 기본값으로 생성
    if (typeof fs !== 'undefined' && !fs.existsSync(configPath)) {
      const defaultConfig = {
        sheet_title: 'SRE1_자동화 고객사 목록',
        credentials_file: path.join(path.dirname(process.execPath || ''), 'resources', 'app.asar.unpacked', 'bespin-464808-5843cc63067d.json')
      };
      
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
      console.log('기본 config.json 파일이 생성되었습니다:', configPath);
    }
    
    return configPath;
  } catch (error) {
    console.error('config.json 경로를 가져오는 중 오류가 발생했습니다:', error);
    // 오류가 발생해도 기본 경로 반환
    return path.join(process.env.APPDATA || process.cwd(), 'aws-login-port', 'config.json');
  }
}

async function loadClientsFromPython() {
    try {
        const configPath = getConfigPath();
        console.log('Config 경로:', configPath);
        const clients = await loadClients(configPath);
        console.log(`클라이언트 데이터 가져오기 성공: ${clients.length}개`);
        return clients;
    } catch (err) {
        console.error('Sheets 로드 오류:', err);
        throw err;
    }
}
    

// 클라이언트 데이터를 저장할 변수
let clients = [];

// 서버 시작 시 데이터를 로드하는 함수
async function initializeServer() {
    try {
        clients = await loadClientsFromPython();
        console.log('로드된 클라이언트 수:', clients.length);
    } catch (error) {
        console.error('클라이언트 로드 실패:', error);
    }
}

// Electron에서 실행할 때는 여기서 자동으로 초기화하지 않고 main.js에서 실행

app.get('/', async (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    let html = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>AWS LoginPort</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" />
    <script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"></script>
      <style>
        body {
          padding: 0;
          margin: 0;
          background-color: #f8f8f8;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          overflow: hidden;
        }
        .container {
          max-width: 100%;
          margin: 0;
          padding: 0;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 35px;
        }
        .header i {
          font-size: 34px;
          color: #007bff;
          margin-right: 12px;
        }
        .header h2 {
          font-size: 26px;
          color: #333;
          margin: 0;
        }
        .list-group-item {
          display: flex;
          align-items: center;
          padding: 20px;
          border: none;
          border-radius: 12px;
          background-color: #fff;
          margin-bottom: 20px;
          transition: all 0.3s ease;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
          justify-content: space-between;
        }
        .list-group-item:hover {
          transform: translateY(-3px);
          box-shadow: 0 6px 12px rgba(0,0,0,0.1);
        }
        .column {
          overflow-wrap: break-word;
          word-wrap: break-word;
          padding: 0 12px;
          text-align: left;
        }
        .col-account {
          width: 450px;
          display: flex;
          align-items: center;
          cursor: pointer;
        }
        .col-account i {
          font-size: 26px;
          color: #007bff;
          margin-right: 12px;
        }
        .col-account span {
          font-size: 18px;
          font-weight: 600;
          color: #333;
        }
        .col-account input {
          width: 100%;
          padding: 6px;
          font-size: 16px;
          border: 1px solid #ccc;
          border-radius: 4px;
          display: none;
        }
        .col-aws-account {
          width: 150px;
          font-size: 16px;
          color: #555;
          cursor: pointer;
        }
        .col-aws-account input {
          width: 100%;
          padding: 6px;
          font-size: 16px;
          border: 1px solid #ccc;
          border-radius: 4px;
          display: none;
        }
        .col-username {
          width: 300px;
          font-size: 16px;
          color: #555;
          cursor: pointer;
        }
        .col-username input {
          width: 100%;
          padding: 6px;
          font-size: 16px;
          border: 1px solid #ccc;
          border-radius: 4px;
          display: none;
        }
        .col-password {
          width: 150px;
          cursor: pointer;
        }
        .col-password span {
          color: #777;
          font-family: monospace;
          font-size: 16px;
        }
        .col-password input {
          width: 100%;
          padding: 6px;
          font-size: 16px;
          border: 1px solid #ccc;
          border-radius: 4px;
          display: none;
        }
        .col-mfa {
          width: 150px;
        }
        .btn-mfa {
          background-color: #28a745;
          color: white;
          border: none;
          padding: 8px 14px;
          border-radius: 6px;
          cursor: pointer;
          transition: background-color 0.3s;
          font-size: 14px;
        }
        .btn-mfa:hover {
          background-color: #218838;
        }
        .col-login {
          width: 150px;
          text-align: right;
        }
        .btn-login {
          background-color: #007bff;
          color: white;
          border: none;
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          transition: background-color 0.3s;
          width: 100%;
        }
        .btn-login:hover {
          background-color: #0056b3;
        }
        .notification {
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background-color: #28a745;
          color: white;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 14px;
          z-index: 1000;
          opacity: 0;
          transition: opacity 0.5s ease-in-out;
        }
        .notification.show {
          opacity: 1;
        }
        /* 드래그 가능한 타이틀 바 */
        .titlebar {
          height: 40px;
          background-color: #2c2c2c;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px;
          -webkit-app-region: drag;
        }
        
        /* 타이틀 영역 */
        .titlebar-title {
          display: flex;
          align-items: center;
        }
        
        /* 검색 영역 */
        .titlebar-search {
          flex: 0 1 400px;
          -webkit-app-region: no-drag;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .qr-scan-btn {
          background: transparent;
          border: none;
          color: #fff;
          font-size: 16px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .qr-scan-btn:hover {
          background-color: rgba(255, 255, 255, 0.1);
        }
        
        /* 윈도우 컨트롤 버튼 */
        .window-controls {
          display: flex;
          -webkit-app-region: no-drag;
        }
        
        .window-control-button {
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          background: transparent;
          border: none;
          cursor: pointer;
          margin-left: 5px;
          border-radius: 3px;
        }
        
        .window-control-button:hover {
          background-color: rgba(255, 255, 255, 0.1);
        }
        
        .window-control-button.close:hover {
          background-color: #e81123;
        }
        
        /* 콘텐츠 영역 */
        .content {
          padding: 20px;
          height: calc(100vh - 40px);
          overflow-y: auto;
        }
        
        .account-count {
          color: #ccc;
          font-weight: 500;
          margin-right: 15px;
          white-space: nowrap;
        }
        
        /* 검색 입력란 */
        .search-input {
          width: 100%;
          padding: 5px 10px;
          border-radius: 15px;
          border: 1px solid #555;
          background-color: #3a3a3a;
          color: white;
        }
        
        .search-input::placeholder {
          color: #aaa;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="titlebar">
          <div class="titlebar-title">
            <img src="/icon.ico" style="width:20px;height:20px;margin-right:8px;" alt="icon">
            <div class="account-count">총 ${clients.length} 계정</div>
          </div>
          
          <div class="titlebar-search">
            <button class="qr-scan-btn" title="QR 코드 스캔" onclick="openQrScanner()">
              <i class="fas fa-qrcode"></i>
            </button>
            <input type="text" id="searchInput" class="search-input" placeholder="계정명 또는 Account ID 검색" oninput="filterClients()">
          </div>
          
          <div class="window-controls">
            <button class="window-control-button minimize" id="minimize-btn"><i class="fas fa-minus"></i></button>
            <button class="window-control-button maximize" id="maximize-btn"><i class="fas fa-expand"></i></button>
            <button class="window-control-button close" id="close-btn"><i class="fas fa-times"></i></button>
          </div>
        </div>
        
        <div class="content">
          <ul class="list-group">
  `;

    clients.forEach(client => {
        html += `
      <li class="list-group-item">
        <div class="column col-account" onclick="editField(this, '${client.account}', 'name')">
          <i class="fas fa-user-shield"></i>
          <span>${client.name}</span>
          <input type="text" value="${client.name}" onblur="saveField(this, '${client.account}', 'name')" onkeydown="if(event.key === 'Enter') this.blur()">
        </div>
        <div class="column col-aws-account" onclick="editField(this, '${client.account}', 'account')">
          <span>${client.account}</span>
          <input type="text" value="${client.account}" onblur="saveField(this, '${client.account}', 'account')" onkeydown="if(event.key === 'Enter') this.blur()">
        </div>
        <div class="column col-username" onclick="editField(this, '${client.account}', 'username')">
          <span>${client.username}</span>
          <input type="text" value="${client.username}" onblur="saveField(this, '${client.account}', 'username')" onkeydown="if(event.key === 'Enter') this.blur()">
        </div>
        <div class="column col-password" onclick="editField(this, '${client.account}', 'password')">
          <span>••••••••</span>
          <input type="text" value="${client.password}" onblur="saveField(this, '${client.account}', 'password')" onkeydown="if(event.key === 'Enter') this.blur()">
        </div>
        <div class="column col-mfa">
          <button class="btn-mfa" onclick="copyMfa('${client.mfaSecret}')">MFA 복사</button>
        </div>
        <div class="column col-login">
          <button class="btn btn-login" onclick="startLogin('${client.name}')">로그인</button>
        </div>
      </li>
    `;
    });

    html += `
        </ul>
      </div>
      <div id="notification" class="notification"></div>
      <script>
        async function startLogin(clientName) {
          try {
            const response = await fetch('/login/' + clientName, {
              method: 'GET',
              headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) {
              console.error('로그인 요청 실패:', response.status);
            }
          } catch (error) {
            console.error('로그인 요청 중 오류:', error);
          }
        }

        function copyMfa(mfaSecret) {
          fetch('/generate-mfa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mfaSecret })
          })
          .then(response => response.json())
          .then(data => {
            navigator.clipboard.writeText(data.mfaCode)
              .then(() => {
                showNotification('MFA 코드가 복사되었습니다: ' + data.mfaCode, 'success');
              })
              .catch(err => console.error('복사 실패:', err));
          })
          .catch(error => console.error('MFA 생성 오류:', error));
        }

        function editField(element, account, field) {
          const span = element.querySelector('span');
          const input = element.querySelector('input');
          span.style.display = 'none';
          input.style.display = 'block';
          input.focus();
        }

        async function saveField(input, account, field) {
          const newValue = input.value;
          const span = input.parentElement.querySelector('span');
          span.textContent = field === 'password' ? '••••••••' : newValue;
          input.style.display = 'none';
          span.style.display = 'block';

          try {
            const response = await fetch('/update-client', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ account, field, value: newValue })
            });
            if (!response.ok) {
              console.error('업데이트 실패:', response.status);
            }
            if (field === 'account') {
              input.parentElement.setAttribute('onclick', "editField(this, '" + newValue + "', 'account')");
              input.setAttribute('onblur', "saveField(this, '" + newValue + "', 'account')");
              input.setAttribute('onkeydown', "if(event.key === 'Enter') this.blur()");
            }
          } catch (error) {
            console.error('업데이트 중 오류:', error);
          }
        }
        document.addEventListener('DOMContentLoaded', function() {
          const minimizeBtn = document.getElementById('minimize-btn');
          const maximizeBtn = document.getElementById('maximize-btn');
          const closeBtn = document.getElementById('close-btn');
          
          if (minimizeBtn) {
            minimizeBtn.addEventListener('click', function() {
              window.electron.ipcRenderer.send('window-control', 'minimize');
            });
          }
          
          if (maximizeBtn) {
            maximizeBtn.addEventListener('click', function() {
              window.electron.ipcRenderer.send('window-control', 'maximize');
            });
          }
          
          if (closeBtn) {
            closeBtn.addEventListener('click', function() {
              window.electron.ipcRenderer.send('window-control', 'close');
            });
          }
        });
        
        function openQrScanner() {
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
        
        function filterClients() {
          const query = document.getElementById('searchInput').value.toLowerCase();
          const items = document.querySelectorAll('.list-group-item');
          let visibleCount = 0;
          items.forEach(item => {
            const nameText = item.querySelector('.col-account span').textContent.toLowerCase();
            const accountText = item.querySelector('.col-aws-account span').textContent.toLowerCase();
            if (nameText.includes(query) || accountText.includes(query)) {
              item.style.display = 'flex';
              visibleCount++;
            } else {
              item.style.display = 'none';
            }
          });
          document.getElementById('accountCount').textContent = '총 ' + visibleCount + ' 계정';
        }
      </script>
    </body>
    </html>
  `;

    res.send(html);
});

app.get('/login/:name', async (req, res) => {
    const client = clients.find(c => c.name === req.params.name);
    if (!client) {
        return res.sendStatus(404);
    }

    res.sendStatus(200);

    (async () => {
        const awsLoginUrl = `https://${client.account}.signin.aws.amazon.com/console`;
        let browser;

        try {
          const executablePath = getLocalChromiumPath();
          if (!executablePath) {
              console.error('Chrome executable not found');
              return;
          }            

            browser = await puppeteer.launch({
                executablePath,
                headless: false,
                args: ['--start-maximized'],
                defaultViewport: null
            });

            const pages = await browser.pages();
            const page = pages[0];

            await page.goto(awsLoginUrl, { waitUntil: 'networkidle2' });

            console.log('Username 입력 중...');
            await page.waitForSelector('#username', { visible: true });
            await page.type('#username', client.username);

            console.log('Password 입력 중...');
            await page.waitForSelector('#password', { visible: true });
            await page.type('#password', client.password);

            console.log('로그인 버튼 클릭...');
            await page.waitForSelector('#signin_button', { visible: true });
            await page.click('#signin_button');

            console.log('MFA 코드 입력 대기...');
            await page.waitForSelector('[id="mfacode" i]', { visible: true, timeout: 10000 });
            const mfaCode = authenticator.generate(client.mfaSecret);
            console.log(`생성된 MFA 코드: ${mfaCode}`);

            await page.type('[id="mfacode" i]', mfaCode);
            console.log('MFA 코드 입력 완료');

            await page.waitForSelector('button[type="submit"], button.awsui-button', { visible: true });
            console.log('MFA 확인 버튼 클릭...');
            await page.click('button[type="submit"], button.awsui-button');

            await Promise.race([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null),
                page.waitForSelector('#aws-console-root, #consoleHomeDashboard', { timeout: 15000 }).catch(() => null)
            ]);

            console.log('로그인 완료! 브라우저 유지 중...');
        } catch (error) {
            if (browser && !browser.isConnected()) {
                console.warn('브라우저가 닫혀서 로그인 프로세스를 중단합니다.');
            } else {
                console.error('로그인 중 오류 발생:', error.message);
            }
        }
    })();
});

app.post('/generate-mfa', (req, res) => {
    const { mfaSecret } = req.body;
    const mfaCode = authenticator.generate(mfaSecret);
    res.json({ mfaCode });
});

app.post('/update-client', (req, res) => {
    const { account, field, value } = req.body;
    const clientIndex = clients.findIndex(c => c.account === account);
    if (clientIndex !== -1) {
        clients[clientIndex][field] = value;
        // 여기서 Google Sheets로 업데이트를 원한다면 추가 로직 필요
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

// 포트 가용성 확인 함수
async function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = require('net').createServer();
        
        server.once('error', (err) => {
            // 포트가 사용 중인 경우
            if (err.code === 'EADDRINUSE') {
                resolve(false);
            }
        });
        
        server.once('listening', () => {
            // 포트 사용 가능
            server.close();
            resolve(true);
        });
        
        server.listen(port, '127.0.0.1');
    });
}

// 모듈로 내보내기
module.exports = {
    app,
    initializeServer,
    listen: async (port = 3000, host = '127.0.0.1', callback) => {
        const isAvailable = await isPortAvailable(port);
        if (!isAvailable) {
            throw new Error(`포트 ${port} 이미 사용 중입니다. 기존 인스턴스를 먼저 종료해야 합니다.`);
        }
        console.log(`포트 ${port} 사용하여 서버 시작`);
        return app.listen(port, host, callback);
    }
};

// 직접 실행할 경우 서버 시작
if (require.main === module) {
    (async () => {
        try {
            clients = await loadClientsFromPython();
            console.log('로드된 클라이언트 수:', clients.length);
        } catch (error) {
            console.error('클라이언트 로드 실패:', error);
        }

        try {
            await module.exports.listen(3000, '127.0.0.1', () => {
                console.log('서버 실행 중: http://127.0.0.1:3000');
            });
        } catch (listenError) {
            console.error('서버 시작 실패:', listenError);
            process.exit(1);
        }
    })();
}