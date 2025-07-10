/* eslint-disable no-console */
// Google Sheets client data loader implemented in Node.js so that Python is no longer required.
// Author: Jaewoo Cho + Cascade AI

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const DEFAULT_SHEET_TITLE = 'SRE1_자동화 고객사 목록';
const DEFAULT_CREDENTIAL_FILE = 'bespin-464808-5843cc63067d.json';
const EXCLUDE_KEYWORDS = ['고객사', 'issuereporter', 'NCP'];

// 인증 스코프 - Python gspread와 동일한 범위 사용
const SCOPES = [
  "https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"
];

function resolveCredentialPath(config, baseDir) {
  // 1. config.json에 지정된 경로 확인 (우선순위 가장 높음)
  if (config.credentials_file) {
    let credFile = config.credentials_file;
    if (!path.isAbsolute(credFile)) {
      credFile = path.join(baseDir, credFile);
    }
    if (fs.existsSync(credFile)) {
      console.log(`인증 파일을 config.json에 지정된 경로에서 찾음: ${credFile}`);
      return credFile;
    } else {
      console.log(`config.json에 지정된 인증 파일을 찾을 수 없습니다: ${credFile}`);
    }
  }

  // 2. app.asar.unpacked 디렉토리 확인 (패키지된 앱의 리소스)
  const unpackedDir = path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked');
  const unpackedCredFile = path.join(unpackedDir, DEFAULT_CREDENTIAL_FILE);
  if (fs.existsSync(unpackedCredFile)) {
    console.log(`인증 파일을 app.asar.unpacked에서 찾음: ${unpackedCredFile}`);
    return unpackedCredFile;
  }

  // 3. 현재 디렉토리에서 기본 인증 파일 확인
  const localCredFile = path.join(path.dirname(process.execPath), DEFAULT_CREDENTIAL_FILE);
  if (fs.existsSync(localCredFile)) {
    console.log(`인증 파일을 현재 디렉토리에서 찾음: ${localCredFile}`);
    return localCredFile;
  }

  // 4. AppData/Roaming/aws-login-port 디렉토리 확인
  const appDataPath = path.join(process.env.APPDATA || 
    (process.platform === 'darwin' ? 
      path.join(process.env.HOME, 'Library/Application Support') : 
      path.join(process.env.HOME, '.config')), 'aws-login-port');
  
  const appDataCredFile = path.join(appDataPath, DEFAULT_CREDENTIAL_FILE);
  
  // 디렉토리가 없으면 생성
  if (!fs.existsSync(appDataPath)) {
    fs.mkdirSync(appDataPath, { recursive: true });
    
    // 인증 파일을 app.asar.unpacked에서 복사
    try {
      const unpackedDir = path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked');
      const sourceFile = path.join(unpackedDir, DEFAULT_CREDENTIAL_FILE);
      if (fs.existsSync(sourceFile)) {
        fs.copyFileSync(sourceFile, appDataCredFile);
        console.log(`인증 파일을 ${appDataCredFile}로 복사했습니다.`);
        return appDataCredFile;
      }
    } catch (e) {
      console.error('인증 파일 복사 중 오류 발생:', e);
    }
  } else if (fs.existsSync(appDataCredFile)) {
    console.log(`인증 파일을 AppData에서 찾음: ${appDataCredFile}`);
    return appDataCredFile;
  }

  console.error(`인증 파일을 찾을 수 없습니다. 다음 위치에서 확인해주세요:
  1. ${unpackedCredFile}
  2. ${localCredFile}
  3. ${appDataCredFile}`);
  
  // 마지막으로 app.asar.unpacked 경로를 반환 (파일이 없어도 경로는 반환)
  return unpackedCredFile;
}

function resolveSheetTitle(config) {
  return config.sheet_title || DEFAULT_SHEET_TITLE;
}

async function findSpreadsheetIdByTitle(authClient, title) {
  try {
    const drive = google.drive({ version: 'v3', auth: authClient });
    
    // 정확한 제목으로만 검색
    const encodedTitle = encodeURIComponent(title);
    const q = `name='${encodedTitle}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    console.log(`스프레드시트 검색 쿼리: ${q}`);
    
    const res = await drive.files.list({ 
      q,
      fields: 'files(id,name,webViewLink)',
      pageSize: 1, // 정확한 일치이므로 1개만 필요
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      spaces: 'drive'
    });
    
    if (!res.data.files || res.data.files.length === 0) {
      throw new Error(`'${title}' 제목의 스프레드시트를 찾을 수 없습니다. 정확한 제목을 확인해주세요.`);
    }
    
    // 4. 결과가 여러 개이면 첫 번째 항목 사용 (로깅 추가)
    const file = res.data.files[0];
    console.log(`스프레드시트를 찾았습니다: ${file.name} (${file.id})`);
    console.log(`스프레드시트 URL: ${file.webViewLink}`);
    
    return file.id;
  } catch (error) {
    console.error('Google Drive API 오류:', error.message);
    if (error.errors) {
      console.error('오류 상세 정보:', error.errors);
    }
    throw new Error(`스프레드시트 검색 중 오류가 발생했습니다: ${error.message}`);
  }
}

function parseRows(rows) {
  let latestCompanyName = null;
  const parsed = [];

  for (const row of rows) {
    const company = row[1]?.trim() || '';
    const env = row[3]?.trim() || '';
    if (!company && !env) continue;

    if (company) latestCompanyName = company;
    const effectiveCompany = company || latestCompanyName;

    const detail = row[2]?.trim() || '';
    const fullName = `${effectiveCompany}-${env}-${detail}`;

    if (EXCLUDE_KEYWORDS.some((k) => fullName.includes(k))) continue;

    const username = row[4]?.trim() || '';
    const password = row[5]?.trim() || '';
    const account = row[6]?.trim() || '';
    const mfaSecret = row[7]?.trim() || '';

    if (!(username && password && account && mfaSecret)) continue;

    parsed.push({ name: fullName, username, password, account, mfaSecret });
  }
  return parsed;
}

async function loadClients(configPath) {
  let config;
  let baseDir;
  let credentialsPath;
  let auth;
  let authClient;
  let sheets;
  let spreadsheetId = null;
  
  try {
    // 1. config.json 파일 읽기
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    baseDir = path.dirname(configPath);
    
    // 2. 인증 파일 경로 확인
    credentialsPath = resolveCredentialPath(config, baseDir);
    if (!fs.existsSync(credentialsPath)) {
      throw new Error(`인증 파일을 찾을 수 없습니다: ${credentialsPath}`);
    }
    
    // 3. 인증 및 API 클라이언트 생성 - Python과 동일한 스코프 사용
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: SCOPES,
    });
    
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    
    // 4. 시트 제목 결정 및 스프레드시트 ID 가져오기
    let spreadsheetId = null;
    
    // 4. 스프레드시트 제목으로 검색 (항상 최신 시트를 가져오기 위해 제목으로 검색)
    const sheetTitle = resolveSheetTitle(config);
    console.log(`시트 제목으로 검색 시도: ${sheetTitle}`);
    
    try {
        // 시트 제목으로 검색 시도
        const drive = google.drive({ version: 'v3', auth: authClient });
        
        // 1. 정확한 제목 일치 검색 - 한글 제목을 그대로 사용 (인코딩 없이)
        const exactQ = `name='${sheetTitle}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
        console.log(`정확한 제목 일치 검색 쿼리: ${exactQ}`);
        
        let res = await drive.files.list({ 
          q: exactQ, 
          fields: 'files(id,name,webViewLink)',
          pageSize: 1,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          spaces: 'drive'
        });
        
        // 2. 정확한 제목으로 찾지 못하면 인코딩된 제목으로 다시 검색
        if (!res.data.files || res.data.files.length === 0) {
          const encodedTitle = encodeURIComponent(sheetTitle);
          const encodedQ = `name='${encodedTitle}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
          console.log(`인코딩된 제목으로 검색 쿼리: ${encodedQ}`);
          
          res = await drive.files.list({ 
            q: encodedQ, 
            fields: 'files(id,name,webViewLink)',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            spaces: 'drive'
          });
        }
        
        // 3. 여전히 찾지 못하면 오류 처리
        if (!res.data.files || res.data.files.length === 0) {
          // 사용 가능한 모든 스프레드시트 목록 가져오기
          const allSheets = await drive.files.list({
            q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
            fields: 'files(name)',
            pageSize: 50,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            spaces: 'drive'
          });
          
          const availableSheets = allSheets.data.files ? allSheets.data.files.map(f => `- ${f.name}`).join('\n') : '없음';
          
          throw new Error(
            `'${sheetTitle}' 제목의 스프레드시트를 찾을 수 없습니다.\n\n` +
            `사용 가능한 스프레드시트 목록:\n${availableSheets}\n\n` +
            `config.json 파일의 'sheet_title' 값을 확인하고 정확한 시트 이름을 입력해주세요.`
          );
        }
        
        // 5. 발견된 스프레드시트 처리
        const file = res.data.files[0];
        console.log(`스프레드시트를 찾았습니다: ${file.name} (${file.id})`);
        spreadsheetId = file.id;
        
        // 찾은 ID를 사용 (저장은 하지 않음)
        console.log(`스프레드시트 ID를 사용합니다: ${spreadsheetId}`);
      } catch (error) {
        console.error('스프레드시트 검색 오류:', error.message);
        throw new Error(`스프레드시트 검색 중 오류가 발생했습니다: ${error.message}`);
      }
    
    // 5. 스프레드시트 데이터 가져오기
    if (!spreadsheetId) {
      throw new Error('스프레드시트 ID를 찾을 수 없습니다.');
    }
    
    console.log(`스프레드시트 ID로 데이터 로드 중: ${spreadsheetId}`);
    
    try {
      // 먼저 스프레드시트 정보 가져오기
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      console.log(`스프레드시트 정보:`, meta.data.properties.title);
      
      // 첫 번째 시트 이름 가져오기
      const firstSheetName = meta.data.sheets?.[0]?.properties?.title || 'Sheet1';
      console.log(`첫 번째 시트 이름: ${firstSheetName}`);
      
      // 데이터 가져오기
      const range = `${firstSheetName}!A1:Z1000`;
      const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      
      // 데이터 파싱
      if (!response.data.values || response.data.values.length === 0) {
        const errorMsg = '시트에 데이터가 없습니다';
        if (mainWindow) {
          mainWindow.webContents.send('sheet-loading-error', errorMsg);
        }
        throw new Error(errorMsg);
      }
      
      return parseRows(response.data.values);
    } catch (error) {
      console.error('스프레드시트 데이터 가져오기 오류:', error.message);
      if (error.message.includes('The caller does not have permission')) {
        const errorMsg = `권한 오류: API인증파일에 스프레드시트 접근 권한이 없습니다. 스프레드시트를 이메일 주소와 공유해야 합니다.`;
        if (mainWindow) {
          mainWindow.webContents.send('sheet-loading-error', errorMsg);
        }
        throw new Error(errorMsg);
      }
      const errorMsg = `스프레드시트 데이터 가져오기 중 오류가 발생했습니다: ${error.message}`;
      if (mainWindow) {
        mainWindow.webContents.send('sheet-loading-error', errorMsg);
      }
      throw error;
    }
  } catch (error) {
    console.error('Sheets 로드 오류:', error);
    const errorMsg = `Sheets 로드 중 오류가 발생했습니다: ${error.message}`;
    if (mainWindow) {
      mainWindow.webContents.send('sheet-loading-error', errorMsg);
    }
    throw error;
  }
}

module.exports = { loadClients };
