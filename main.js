const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// electron-store 문제 해결을 위해 올바른 방식으로 불러오기
const Store = require('electron-store').default;
const store = new Store();

let mainWindow;
let tray = null;
let serverRunning = false;
let expressProcess = null; // 백그라운드 app.js 프로세스
let isUpdateAvailable = false;


// 다운로드한 아이콘 파일 경로 사용
const iconPath = path.join(__dirname, 'icon.ico');
// 아이콘이 없으면 기본 데이터 URL 사용
const iconDataUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0Ij48cGF0aCBmaWxsPSIjMDA3YmZmIiBkPSJNMTkuMzUgMTAuMDRDMTguNjcgNi41OSAxNS42NCA0IDEyIDQgOS4xMSA0IDYuNiA1LjY0IDUuMzUgOC4wNCAyLjM0IDguMzYgMCAxMC45MSAwIDE0YzAgMy4zMSAyLjY5IDYgNiA2aDEzYzIuNzYgMCA1LTIuMjQgNS01IDAtMi42NC0yLjA1LTQuNzgtNC42NS00Ljk2eiI+PC9wYXRoPjwvc3ZnPg==';

// 현재 실행 중인 Express 서버 종료
function stopExpressServer() {
  return new Promise((resolve) => {
    const killByPort = () => {
      exec('for /f "tokens=5" %a in (\'netstat -ano ^| findstr :3000\') do taskkill /F /PID %a', () => {
        serverRunning = false;
        setTimeout(resolve, 1000);
      });
    };

    // 자식 프로세스 객체가 있으면 우선 시도
    if (expressProcess && !expressProcess.killed) {
      try {
        expressProcess.kill();
      } catch (e) {
        console.error('expressProcess.kill 오류:', e);
      }
      expressProcess.on && expressProcess.on('close', () => {
        expressProcess = null;
        killByPort();
      });
      // 1초 후에도 close가 안 오면 포트 킬 시도
      setTimeout(killByPort, 1000);
      return;
    }

    // expressProcess 없거나 이미 죽었을 때 바로 포트 킬
    killByPort();
  });
}


// Express 서버 시작
async function startExpressServer(sheetTitle = null) {
  console.log('서버 시작 중...');
  
  try {
    // 이전 서버가 실행 중이면 먼저 종료
    await stopExpressServer();
    
    // 포트가 확실히 해제될 충분한 시간을 두기 (여유를 더 두기)
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 구글 시트 제목 인자를 추가하여 app.js 실행
    // 특수 문자 처리
    const sanitizedTitle = sheetTitle ? sheetTitle.replace(/"/g, '\"') : '';
    
    // 공통으로 unpacked 디렉터리 경로를 구하는 헬퍼
    const getUnpackedDir = () => app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked')
      : __dirname;

    // 실행할 app.js 경로 (개발: 소스, 배포: unpacked)
    const appPath = app.isPackaged
      ? path.join(__dirname, 'app.js') // asar 내부 경로
      : path.join(__dirname, 'app.js');

    // 패키징된 앱에서는 자체 exe(process.execPath)가 Node 역할을 함
    const nodeExec = app.isPackaged ? process.execPath : 'node';

    const execArgs = [appPath];
    // config 경로 인자 추가
    const configPath = getConfigPath();
    execArgs.push('--config', configPath);
    if (sanitizedTitle) {
      execArgs.push('--sheet-title', sanitizedTitle);
    }

    console.log('서버 시작 명령:', nodeExec, execArgs.join(' '));

    // 환경 변수: 패키지 모드에서는 Electron을 Node로 실행하도록 지정해 중복 창 방지
    const childEnv = { ...process.env };
    if (app.isPackaged) {
      childEnv.ELECTRON_RUN_AS_NODE = '1';
    }

    // 앱.js 파일 실행 (spawn 사용해 실시간 로그 수집)
    // 사용자 데이터(logs) 폴더에 express.log 작성
    const logDir = app.getPath('logs');
    try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
    const logPath = path.join(logDir, 'express.log');
    let logStream;
    try {
      logStream = fs.createWriteStream(logPath, { flags: 'a' });
    } catch (e) {
      console.warn('로그 파일 생성 실패, 콘솔만 사용:', e);
      logStream = { write() {}, end() {} };
    }

    // const logStream = { write() {}, end() {} };

    expressProcess = spawn(nodeExec, execArgs, { env: childEnv, shell: false });

    // 오류 핸들러
    expressProcess.on('error', (err) => {
      console.error('Express 서버 시작 오류:', err);
      serverRunning = false;
      if (mainWindow) {
        mainWindow.webContents.send('sheet-loading-error', err.message || String(err));
      }
    });

    // 종료 핸들러
    expressProcess.on('close', (code) => {
      console.log('Express 프로세스 종료, 코드:', code);
      try { logStream.end(`[EXIT ${code}]\n`); } catch {}
      serverRunning = false;
    });

    // stdout을 실시간으로 출력
    expressProcess.stdout.on('data', (chunk) => {
      const data = chunk.toString('utf8');
      console.log(`Express 서버 출력: ${data}`);
      logStream.write(`[STDOUT] ${data}`);
      // 서버 준비 완료 문자열 감지 시 즉시 페이지 로드
      if (/포트 3000|서버 실행 중/.test(data)) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL('http://localhost:3000');
          try {
            mainWindow.webContents.send('sheet-loading-complete');
          } catch {}
        }
      }
    });

    // stderr 출력도 기록
    expressProcess.stderr.on('data', (chunk) => {
      const data = chunk.toString('utf8');
      console.error(`Express 서버 STDERR: ${data}`);
      logStream.write(`[STDERR] ${data}`);
    });
    
    // 서버가 실제로 응답할 때까지 대기 후 페이지 로드
    const waitForServer = async (retries = 60) => {
      const http = require('http');
      for (let i = 0; i < retries; i++) {
        try {
          await new Promise((resolve, reject) => {
            const req = http.get('http://127.0.0.1:3000', res => {
              res.destroy();
              resolve();
            });
            req.on('error', reject);
            req.setTimeout(1000, () => {
              req.destroy();
              reject(new Error('timeout'));
            });
          });
          // 응답 수신 성공 – 페이지 로드
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL('http://localhost:3000');
          }
          return;
        } catch {
          // 0.5초 후 재시도
          await new Promise(r => setTimeout(r, 500));
        }
      }
      console.error('서버가 준비되지 않아 페이지를 로드할 수 없습니다.');
    };
    waitForServer();
    
  } catch (error) {
    console.error('서버 시작 오류:', error);
    serverRunning = false;
    if (mainWindow) {
      mainWindow.webContents.send('sheet-loading-error', error.message || '서버 시작 중 오류 발생');
    }
  }
}

// 메인 윈도우 생성
function createWindow() {
  // 이미 창이 있고 파괴되지 않았으면 반환
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return mainWindow;
  }

  // 아이콘 파일 존재 여부 확인
  let iconOption;
  try {
    if (fs.existsSync(iconPath)) {
      iconOption = iconPath; // 아이콘 파일이 있는 경우
    } else {
      iconOption = nativeImage.createFromDataURL(iconDataUrl); // 아이콘 파일이 없는 경우
    }
  } catch (error) {
    console.error('아이콘 로드 오류:', error);
    iconOption = nativeImage.createFromDataURL(iconDataUrl); // 오류 발생 시 기본 아이콘 사용
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // 상단 바 제거
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: iconOption
  });

  // 시트 선택 페이지 로드
  mainWindow.loadFile('sheet_selector.html');
  
  // 마지막으로 사용한 시트 제목이 있는 경우 자동으로 폭을 띄워서 시간 절약
  const lastSheetTitle = store.get('sheetTitle');
  // 페이지가 로드될 때마다 현재 URL 확인 후 시트 selector일 때만 값 주입
  mainWindow.webContents.on('did-finish-load', () => {
    const currentUrl = mainWindow.webContents.getURL();
    if (currentUrl.endsWith('sheet_selector.html') && lastSheetTitle) {
      // 존재 여부 확인 후 값 설정 (없는 요소 접근 방지)
      const escaped = lastSheetTitle.replace(/"/g, '\\"');
      mainWindow.webContents.executeJavaScript(`
        const inp = document.getElementById('sheetTitle');
        if (inp) inp.value = "${escaped}";
      `).catch(err => console.error('시트 제목 자동 입력 오류:', err));
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 닫기 버튼을 눌렀을 때 창만 닫고 앱은 종료하지 않음
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      return false;
    }
  });
}

// config.json 파일 경로 결정
function getConfigPath() {
  // 1. AppData/Roaming/aws-login-port 디렉토리 경로 생성
  const appDataPath = process.env.APPDATA || 
    (process.platform === 'darwin' 
      ? path.join(process.env.HOME, 'Library/Application Support') 
      : path.join(process.env.HOME, '.config'));
  
  const configDir = path.join(appDataPath, 'aws-login-port');
  
  // 디렉토리가 없으면 생성
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  return path.join(configDir, 'config.json');
}

// 모듈로 내보내기
if (typeof module !== 'undefined' && module.exports) {
  module.exports.getConfigPath = getConfigPath;
}

// 전역 변수로도 내보내기 (Electron 렌더러 프로세스에서 접근 가능하도록)
if (typeof window !== 'undefined') {
  window.getConfigPath = getConfigPath;
}

// 시트 제목을 저장하는 함수
function saveSheetTitle(sheetTitle) {
  // electron-store 저장 (UI 자동 입력용)
  store.set('sheetTitle', sheetTitle);

  // Python 스크립트와 공유할 config.json 저장
  const configPath = getConfigPath();
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    let config = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch {}
    }
    config.sheet_title = sheetTitle;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('config.json 저장 오류:', err);
  }
}

// 인증 JSON 파일 경로를 저장하는 함수
function saveCredentialsFile(filePath) {
  store.set('credentialsFile', filePath);
  const configPath = getConfigPath();
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    let config = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch {}
    }
    config.credentials_file = filePath;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('config.json 저장 오류:', err);
  }
}

// 단일 인스턴스 잠금
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 이미 실행 중인 앱이 있으면 종료
  app.quit();
  return;
}

// 두 번째 인스턴스가 실행될 때 호출
app.on('second-instance', (event, commandLine, workingDirectory) => {
  // 기존 창이 있으면 포커스
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

// 업데이트 초기화 및 확인
function initializeAutoUpdater() {
  // 로그 설정
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'debug';
  
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'djdlzl',
    repo: 'aws-loginport',
  });

  console.log('Auto-update feed URL set to:', {
    owner: 'djdlzl',
    repo: 'aws-loginport',
  });

  // 업데이트 확인
  autoUpdater.checkForUpdates().then(() => {
    console.log('Update check completed');
  }).catch(err => {
    console.error('Update check failed:', err);
  });
  
  // 1시간마다 업데이트 확인
  setInterval(() => {
    if (!isUpdateAvailable) {
      autoUpdater.checkForUpdates();
    }
  }, 3600000);
  
  // 업데이트 가능 시 이벤트
// main.js의 autoUpdater 이벤트 핸들러 부분을 찾아서 수정
autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info);
  isUpdateAvailable = true;
  
  // 사용자 정의 다이얼로그 표시
  const dialogOpts = {
    type: 'info',
    buttons: ['업데이트', '나중에'],
    title: '업데이트 알림',
    message: '새로운 버전이 있습니다!',
    detail: `현재 버전: ${app.getVersion()}\n새 버전: ${info.version}\n\n업데이트를 진행하시겠습니까?`,
    icon: nativeImage.createFromPath(iconPath),
    defaultId: 0,
    cancelId: 1
  };

  dialog.showMessageBox(mainWindow, dialogOpts).then(({ response }) => {
    if (response === 0) {
      // 앱 재시작 (바로가기 유지)
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
    }
  });
});

// 다운로드 완료 시
autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info);
  
  const dialogOpts = {
    type: 'question',
    buttons: ['지금 재시작', '나중에'],
    title: '업데이트 준비 완료',
    message: '업데이트가 준비되었습니다!',
    detail: '지금 앱을 재시작하여 업데이트를 적용하시겠습니까?',
    icon: nativeImage.createFromPath(iconPath),
    defaultId: 0,
    cancelId: 1
  };

  dialog.showMessageBox(mainWindow, dialogOpts).then(({ response }) => {
    if (response === 0) {
      // 앱 재시작
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });
});
  
  // 에러 처리
  autoUpdater.on('error', (err) => {
    console.error('업데이트 오류:', err);
    isUpdateAvailable = false;
  });
}

// 애플리케이션이 준비되면 실행
app.on('ready', () => {
  // 자동 업데이터 초기화
  if (process.env.NODE_ENV !== 'development') {
    initializeAutoUpdater();
  }

  // 캐시 관련 오류 해결을 위한 설정
  app.commandLine.appendSwitch('disable-http-cache');
  
  // 윈도우 컨트롤 IPC 이벤트 핸들러
  ipcMain.on('window-control', (event, command) => {
    if (!mainWindow) return;
    
    switch (command) {
      case 'minimize':
        mainWindow.minimize();
        break;
      case 'maximize':
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        } else {
          mainWindow.maximize();
        }
        break;
      case 'close':
        mainWindow.hide(); // 종료 대신 숨기기
        break;
    }
  });
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-gpu-program-cache');
  
  createWindow();
  
  // 시스템 트레이 설정
  const trayIcon = fs.existsSync(iconPath) ? iconPath : nativeImage.createFromDataURL(iconDataUrl);
  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: '열기',  
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
          }
        } else {
          mainWindow = createWindow();
        }
      } 
    },
    { 
      label: '종료', 
      click: async () => {
        try {
          await stopExpressServer();
        } catch (err) {
          console.error('Express 서버 종료 오류:', err);
        }
        app.isQuitting = true;
        app.quit();
      } 
    }
  ]);
  
  tray.setToolTip('AWS LoginPort');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });

  // IPC 이벤트 설정
  ipcMain.handle('get-saved-sheet-title', () => {
    // 저장된 시트 제목을 반환하되, 없는 경우 기본값 대신 비운 문자열 반환 (사용자가 직접 입력하도록)
    return store.get('sheetTitle', '');
  });

  // 현재 저장된 인증 JSON 경로 반환
  ipcMain.handle('get-credentials-file', () => {
    return store.get('credentialsFile', '');
  });

  // 인증 JSON 파일 업로드 다이얼로그
  ipcMain.handle('open-credentials-dialog', async () => {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'API 인증 JSON 파일 선택',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) {
      return { canceled: true };
    }

    const selectedPath = filePaths[0];
    const destName = path.basename(selectedPath);
    const destDir = path.join(app.getPath('userData'), 'credentials');
    const destPath = path.join(destDir, destName);

    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(selectedPath, destPath);
      // 선택한 경로를 저장 및 config 반영
      saveCredentialsFile(destPath);
      return { canceled: false, savedPath: destPath };
    } catch (err) {
      console.error('Credentials 파일 복사 오류:', err);
      return { canceled: false, error: err.message };
    }
  });

  ipcMain.on('submit-sheet-title', async (event, sheetTitle) => {
    console.log('선택된 시트 제목:', sheetTitle);
    
    try {
      // 시트 제목 저장
      store.set('sheetTitle', sheetTitle);
      
      // 파이썬 스크립트에서 사용할 config.json에도 저장
      saveSheetTitle(sheetTitle);
      
      // 이전 서버가 있으면 종료 - 데이터 캐시 방지
      if (serverRunning) {
        console.log('시트 변경 감지 - 이전 서버 종료 중...');
        await stopExpressServer();
        
        // 잠시 대기 후 새 서버 시작 (포트 사용 해제 대기)
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // 시트 제목으로 Express 서버 시작
      await startExpressServer(sheetTitle);
    } catch (error) {
      console.error('시트 제목 처리 중 오류:', error);
      if (mainWindow) {
        mainWindow.webContents.send('sheet-loading-error', error.message || '서버 시작 오류');
      }
    }
  });
});

// 모든 창이 닫혔을 때의 동작 (트레이로 최소화)
app.on('window-all-closed', (e) => {
  // 기본 동작 방지 (앱이 종료되지 않음)
  e.preventDefault();
  // macOS가 아니고 메인 윈도우가 있는 경우 숨기기
  if (process.platform !== 'darwin' && mainWindow) {
    mainWindow.hide();
  }
});

// 앱이 활성화될 때 (트레이 아이콘 클릭 등)
app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    // 이미 창이 있으면 보여주고 포커스
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// 앱 종료 이벤트
app.on('before-quit', async () => {
  try {
    await stopExpressServer();
  } catch (e) {
    console.error('before-quit 중 Express 종료 오류:', e);
  }
  app.isQuitting = true;
});

// 노드 프로세스가 SIGINT, SIGTERM, exit 등으로 종료될 때 Express 서버 정리
['SIGINT', 'SIGTERM', 'exit'].forEach(sig => {
  process.on(sig, async () => {
    try { await stopExpressServer(); } catch {}
    process.exit();
  });
});