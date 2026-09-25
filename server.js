'use strict';
/*
 * dfd - a single page hub
 * 单页应用集成工具：
 *   - 将单页项目放入 projects/ 目录，自动集成到门户主页
 *   - 将需要自行启动的服务放入 services/ 目录，可在门户上探测状态、一键启动、配置首页地址
 *
 * 零第三方依赖，仅用 Node.js 标准库。
 * 用法：
 *   node server.js              # 默认端口 8080
 *   PORT=9090 node server.js    # 自定义端口
 *   node server.js --help       # 查看帮助
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PROJECTS_DIR = path.join(ROOT, 'projects');
const SERVICES_DIR = path.join(ROOT, 'services');
const INDEX_FILE = path.join(ROOT, 'index.html');
const EXTERNAL_SERVICES_FILE = path.join(ROOT, 'external-services.json');
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;

const PORT = (() => {
  const p = parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
})();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

/* ---------------- 通用读取 ---------------- */

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

function parseIcon(icon, itemName, assetBase) {
  if (icon && typeof icon === 'object' && icon.type === 'image' && icon.value) {
    return { type: 'image', value: icon.value };
  }
  if (icon && /^(https?:)?\/\//i.test(icon)) {
    return { type: 'image', value: icon };
  }
  if (icon && /^[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(icon)) {
    return { type: 'image', value: assetBase + encodeURIComponent(itemName) + '/' + icon };
  }
  return { type: 'emoji', value: icon || '📦' };
}

/* ---------------- 项目扫描 ---------------- */

function scanProjects() {
  const projects = [];
  let entries = [];
  try {
    entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch (_) {
    return projects; // projects 目录不存在时返回空列表
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.')) continue; // 跳过隐藏目录

    const dir = path.join(PROJECTS_DIR, ent.name);
    const manifest = readManifest(dir) || {};
    const entry = manifest.entry || 'index.html';
    const entryExists = fs.existsSync(path.join(dir, entry));

    projects.push({
      name: ent.name,
      title: manifest.name || ent.name,
      description: manifest.description || '',
      icon: parseIcon(manifest.icon, ent.name, '/projects/'),
      entry,
      entryExists,
      tags: Array.isArray(manifest.tags) ? manifest.tags : [],
      url: '/projects/' + encodeURIComponent(ent.name) + '/' + entry,
    });
  }

  projects.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return projects;
}

/* ---------------- 服务扫描与状态 ---------------- */

// 自动探测服务启动入口并写入 manifest.json（仅在无 manifest 时执行）
function ensureServiceManifest(dir, entName) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) return null; // 已有 manifest，跳过

  const manifest = {};

  // 1. 探测启动脚本：按优先级查找常见启动脚本
  const scriptCandidates = ['start.bat', 'Start.bat', 'run.bat', 'start.cmd', 'start.sh', 'run.sh'];
  for (const s of scriptCandidates) {
    if (fs.existsSync(path.join(dir, s))) {
      manifest.startScript = s;
      break;
    }
  }
  // 若没找到，默认 start.bat（前端会显示"缺少启动脚本"提示）
  if (!manifest.startScript) manifest.startScript = 'start.bat';

  // 2. 从 package.json 提取名称、描述、标签
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    manifest.name = pkg.name || entName;
    if (pkg.description) manifest.description = pkg.description;
    if (Array.isArray(pkg.keywords) && pkg.keywords.length) manifest.tags = pkg.keywords;
  } catch (_) {
    manifest.name = entName;
  }

  // 3. 推断首页地址（端口）
  const candidateUrls = inferServiceUrls(dir);
  if (candidateUrls.length) {
    manifest.url = candidateUrls[0];
  }

  // 4. 默认图标
  manifest.icon = '📦';

  // 5. 写入 manifest.json
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  } catch (_) {
    return null; // 写入失败（权限等），不阻断扫描
  }
}

// 从服务目录中推断可能的端口：读取 package.json 的 config.port / scripts 中的 PORT，
// 或 .env 文件、源码中的 listen(PORT) 模式。返回候选地址列表。
function inferServiceUrls(dir) {
  const candidates = [];

  // 1. package.json 的 config.port 或 config.ports
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const cfg = pkg.config || {};
    for (const key of ['port', 'ports', 'PORT']) {
      const v = cfg[key];
      if (v && (typeof v === 'number' || /^\d+$/.test(String(v)))) {
        candidates.push(Number(v));
      }
    }
    // 2. scripts 中的 PORT=xxxx
    for (const script of Object.values(pkg.scripts || {})) {
      const m = String(script).match(/PORT\s*=\s*(\d+)/);
      if (m) candidates.push(Number(m[1]));
    }
  } catch (_) { /* 无 package.json */ }

  // 3. 读取 .env / .env.example / .env.local
  for (const envFile of ['.env', '.env.example', '.env.local']) {
    try {
      const txt = fs.readFileSync(path.join(dir, envFile), 'utf8');
      const m = txt.match(/^(?:export\s+)?PORT\s*=\s*(\d+)/m);
      if (m) candidates.push(Number(m[1]));
    } catch (_) { /* 无此文件 */ }
  }

  // 4. 源码中查找端口线索（含 src/ 子目录）：
  //    - app.listen(3000) 字面量端口
  //    - config 文件: port: process.env.PORT || 3000
  //    - 通用 process.env.PORT || 3000 模式
  const srcFiles = ['app.js', 'server.js', 'index.js', 'main.js', 'config.js',
    'src/app.js', 'src/server.js', 'src/index.js', 'src/config.js'];
  for (const f of srcFiles) {
    try {
      const txt = fs.readFileSync(path.join(dir, f), 'utf8');
      // 直接 listen(3000)
      let m = txt.match(/\.listen\(\s*(\d{4,5})/);
      if (m) candidates.push(Number(m[1]));
      // config 对象: port: process.env.PORT || 3000 / port = 3000
      m = txt.match(/port\s*[:=]\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{4,5})/);
      if (m) candidates.push(Number(m[1]));
      // 通用: process.env.PORT || 3000
      m = txt.match(/process\.env\.PORT\s*\|\|\s*(\d{4,5})/);
      if (m) candidates.push(Number(m[1]));
    } catch (_) { /* 文件不存在 */ }
  }

  const ports = [...new Set(candidates)].filter(p => p > 0 && p < 65536);
  return ports.map(p => `http://127.0.0.1:${p}/`);
}

// 探测多个候选地址，返回第一个可达的（或全部失败时返回空）
async function probeCandidates(urls, timeoutMs) {
  for (const url of urls) {
    const r = await checkUrl(url, timeoutMs);
    if (r.online) return { url, status: r };
  }
  return null;
}

function scanServices() {
  const services = [];
  let entries = [];
  try {
    entries = fs.readdirSync(SERVICES_DIR, { withFileTypes: true });
  } catch (_) {
    return services; // services 目录不存在时返回空列表
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.')) continue;

    const dir = path.join(SERVICES_DIR, ent.name);
    ensureServiceManifest(dir, ent.name); // 无 manifest 时自动探测并写入
    const manifest = readManifest(dir) || {};
    const startScript = manifest.startScript || 'start.bat';
    const startExists = fs.existsSync(path.join(dir, startScript));
    const candidateUrls = inferServiceUrls(dir); // 推断候选地址
    // 首页地址：优先 manifest.url；否则用推断的第一个候选
    const url = manifest.url || (candidateUrls.length ? candidateUrls[0] : '');

    services.push({
      name: ent.name,
      dir,
      title: manifest.name || ent.name,
      description: manifest.description || '',
      icon: parseIcon(manifest.icon, ent.name, '/services/'),
      url,
      candidateUrls,
      urlInferred: !manifest.url && !!url, // 标记地址是自动推断的
      startScript,
      startExists,
      tags: Array.isArray(manifest.tags) ? manifest.tags : [],
    });
  }

  services.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return services;
}

function checkUrl(url, timeoutMs) {
  return new Promise((resolve) => {
    if (!url) { resolve({ online: false, error: '未配置首页地址' }); return; }
    let mod;
    try {
      const u = new URL(url);
      mod = u.protocol === 'https:' ? https : http;
    } catch (_) {
      return resolve({ online: false, error: '地址格式无效' });
    }
    const start = Date.now();
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ online: true, statusCode: res.statusCode, latencyMs: Date.now() - start });
    });
    req.on('timeout', () => { req.destroy(); resolve({ online: false, error: '连接超时' }); });
    req.on('error', (e) => resolve({ online: false, error: e.code || e.message }));
  });
}

async function withStatus(service) {
  const status = await checkUrl(service.url, 2500);
  return { ...service, status };
}

async function getServicesWithStatus() {
  const services = scanServices();
  const results = await Promise.all(services.map(withStatus));
  const cleaned = results.map(({ dir, ...rest }) => rest); // 不暴露本地目录路径

  // 注入虚拟的「项目配置」服务：随 dfd 本体在线
  const extList = readExternalServices();
  const extCount = extList.length;
  cleaned.unshift({
    name: CONFIG_SERVICE_ID,
    title: '项目配置',
    description: `管理 dfd 项目外的服务启动配置${extCount ? `（${extCount} 个外部项目）` : ''}`,
    icon: { type: 'emoji', value: '🎛️' },
    url: `http://${HOST}:${actualPort}/`,
    candidateUrls: [],
    urlInferred: false,
    startScript: '',
    startExists: false,
    tags: ['配置'],
    isConfig: true,
    status: { online: true, statusCode: 200, latencyMs: 0 },
  });

  // 追加外部服务（项目配置面板中配置的服务）到服务列表
  const extResults = await Promise.all(extList.map(async (item) => {
    const status = await checkUrl(item.url, 2500);
    const startExists = item.path && item.startScript
      ? fs.existsSync(path.join(item.path, item.startScript))
      : false;
    return {
      name: 'ext:' + item.id,          // 带前缀避免与 services/ 目录名称冲突
      extId: item.id,                  // 原始 id，前端用于调用外部服务 API
      title: item.name || item.id,
      description: item.description || '',
      icon: { type: 'emoji', value: item.icon || '📦' },
      url: item.url || '',
      candidateUrls: [],
      urlInferred: false,
      startScript: item.startScript || '',
      startExists,
      tags: [],
      isExternal: true,
      status,
    };
  }));
  cleaned.push(...extResults);

  return cleaned;
}

/* ---------------- 服务操作 ---------------- */

// 启动服务：在服务目录中运行其启动脚本（新开 cmd 窗口）
function startService(service) {
  return new Promise((resolve) => {
    const script = path.join(service.dir, service.startScript);
    if (!fs.existsSync(script)) {
      return resolve({ ok: false, error: '启动脚本不存在: ' + service.startScript });
    }
    let child;
    try {
      // cmd /c start "" /D <目录> <脚本> —— 立即返回，脚本在独立窗口中运行
      child = spawn('cmd.exe', ['/c', 'start', '""', '/D', service.dir, service.startScript], {
        detached: true,
        stdio: 'ignore',
      });
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.unref();
    resolve({ ok: true, message: '启动指令已发送' });
  });
}

// 在文件管理器中打开服务目录（Windows 资源管理器 / macOS Finder / Linux 文件管理器）
function openServiceFolder(service) {
  return new Promise((resolve) => {
    const dir = service.dir;
    if (!fs.existsSync(dir)) {
      return resolve({ ok: false, error: '目录不存在: ' + dir });
    }
    let cmd, args;
    if (process.platform === 'win32') {
      cmd = 'explorer.exe';
      args = [dir];
    } else if (process.platform === 'darwin') {
      cmd = 'open';
      args = [dir];
    } else {
      cmd = 'xdg-open';
      args = [dir];
    }
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.on('error', (err) => resolve({ ok: false, error: err.message }));
      child.unref();
      resolve({ ok: true, message: '已请求打开文件夹' });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

// 保存服务配置（如首页地址）到其 manifest.json
function saveServiceConfig(service, updates) {
  const manifestPath = path.join(service.dir, 'manifest.json');
  const manifest = readManifest(service.dir) || {};
  if (typeof updates.name === 'string' && updates.name.trim()) manifest.name = updates.name.trim();
  if (typeof updates.url === 'string') manifest.url = updates.url.trim();
  if (typeof updates.startScript === 'string' && updates.startScript.trim()) {
    manifest.startScript = updates.startScript.trim();
  }
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ---------------- 外部服务（项目配置面板） ---------------- */

// 虚拟服务 ID：用于在 /api/services 中注入「项目配置」特殊条目
const CONFIG_SERVICE_ID = '__dfd_config__';

function readExternalServices() {
  try {
    const data = JSON.parse(fs.readFileSync(EXTERNAL_SERVICES_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function saveExternalServices(list) {
  try {
    fs.writeFileSync(EXTERNAL_SERVICES_FILE, JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function genId() {
  return 'ext-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// 获取外部服务列表（含状态探测），不暴露内部 id 以外的敏感字段
async function getExternalServicesWithStatus() {
  const list = readExternalServices();
  const results = await Promise.all(list.map(async (item) => {
    const status = await checkUrl(item.url, 2500);
    const startExists = item.path && item.startScript
      ? fs.existsSync(path.join(item.path, item.startScript))
      : false;
    return {
      id: item.id,
      name: item.name || item.id,
      description: item.description || '',
      icon: item.icon || '📦',
      path: item.path || '',
      startScript: item.startScript || '',
      url: item.url || '',
      startExists,
      status,
    };
  }));
  return results;
}

// 启动外部服务：在指定目录中运行启动脚本
function startExternalService(item) {
  return new Promise((resolve) => {
    if (!item.path || !item.startScript) {
      return resolve({ ok: false, error: '未配置路径或启动脚本' });
    }
    const dir = item.path;
    if (!fs.existsSync(dir)) {
      return resolve({ ok: false, error: '目录不存在: ' + dir });
    }
    const script = path.join(dir, item.startScript);
    if (!fs.existsSync(script)) {
      return resolve({ ok: false, error: '启动脚本不存在: ' + item.startScript });
    }
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '""', '/D', dir, item.startScript], {
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', (err) => resolve({ ok: false, error: err.message }));
      child.unref();
      resolve({ ok: true, message: '启动指令已发送' });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

// 打开外部服务目录
function openExternalFolder(item) {
  return new Promise((resolve) => {
    const dir = item.path;
    if (!dir || !fs.existsSync(dir)) {
      return resolve({ ok: false, error: '目录不存在: ' + (dir || '(空)') });
    }
    try {
      const child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' });
      child.on('error', (err) => resolve({ ok: false, error: err.message }));
      child.unref();
      resolve({ ok: true, message: '已请求打开文件夹' });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

/* ---------------- 静态文件服务 ---------------- */

function safeResolve(base, relPath) {
  // 防止路径穿越：解析后必须仍在 base 之内
  const resolved = path.resolve(base, '.' + path.sep + relPath);
  const baseResolved = path.resolve(base);
  return resolved.startsWith(baseResolved + path.sep) ? resolved : null;
}

function sendFile(res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      send404(res);
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

function sendJson(res, obj, code) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > (limit || 1024 * 1024)) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (_) {
        reject(new Error('请求体不是有效 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/* ---------------- HTTP 服务 ---------------- */

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${HOST}:${PORT}`).pathname);
  } catch (_) {
    send404(res);
    return;
  }

  /* ---------- API ---------- */

  // 项目列表
  if (pathname === '/api/projects') {
    const projects = scanProjects();
    sendJson(res, { count: projects.length, projects });
    return;
  }

  // 服务列表（实时探测状态）
  if (pathname === '/api/services') {
    const services = await getServicesWithStatus();
    sendJson(res, { count: services.length, services });
    return;
  }

  // 启动服务：POST /api/services/<name>/start
  const startMatch = pathname.match(/^\/api\/services\/([^/]+)\/start$/);
  if (startMatch && req.method === 'POST') {
    const name = startMatch[1];
    const service = scanServices().find(s => s.name === name);
    if (!service) { sendJson(res, { ok: false, error: '服务不存在: ' + name }, 404); return; }
    const result = await startService(service);
    sendJson(res, result, result.ok ? 200 : 500);
    return;
  }

  // 打开服务文件夹：POST /api/services/<name>/open-folder
  const folderMatch = pathname.match(/^\/api\/services\/([^/]+)\/open-folder$/);
  if (folderMatch && req.method === 'POST') {
    const name = folderMatch[1];
    const service = scanServices().find(s => s.name === name);
    if (!service) { sendJson(res, { ok: false, error: '服务不存在: ' + name }, 404); return; }
    const result = await openServiceFolder(service);
    sendJson(res, result, result.ok ? 200 : 500);
    return;
  }

  // 保存服务配置：POST /api/services/<name>/config
  const configMatch = pathname.match(/^\/api\/services\/([^/]+)\/config$/);
  if (configMatch && req.method === 'POST') {
    const name = configMatch[1];
    const service = scanServices().find(s => s.name === name);
    if (!service) { sendJson(res, { ok: false, error: '服务不存在: ' + name }, 404); return; }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 400);
      return;
    }
    const result = saveServiceConfig(service, body);
    sendJson(res, result, result.ok ? 200 : 500);
    return;
  }

  /* ---------- 外部服务（项目配置面板） ---------- */

  // 外部服务列表（含状态探测）
  if (pathname === '/api/external-services' && req.method === 'GET') {
    const list = await getExternalServicesWithStatus();
    sendJson(res, { count: list.length, services: list });
    return;
  }

  // 新增外部服务
  if (pathname === '/api/external-services' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 400);
      return;
    }
    const name = (body.name || '').trim();
    const p = (body.path || '').trim();
    if (!name) { sendJson(res, { ok: false, error: '名称不能为空' }, 400); return; }
    if (!p) { sendJson(res, { ok: false, error: '路径不能为空' }, 400); return; }
    const list = readExternalServices();
    const item = {
      id: genId(),
      name,
      description: (body.description || '').trim(),
      icon: (body.icon || '📦').trim() || '📦',
      path: p,
      startScript: (body.startScript || 'start.bat').trim() || 'start.bat',
      url: (body.url || '').trim(),
    };
    list.push(item);
    if (!saveExternalServices(list)) {
      sendJson(res, { ok: false, error: '写入配置文件失败' }, 500);
      return;
    }
    sendJson(res, { ok: true, id: item.id });
    return;
  }

  // 修改外部服务：PUT /api/external-services/<id>
  const extPutMatch = pathname.match(/^\/api\/external-services\/([^/]+)$/);
  if (extPutMatch && req.method === 'PUT') {
    const id = extPutMatch[1];
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, { ok: false, error: err.message }, 400);
      return;
    }
    const list = readExternalServices();
    const item = list.find(s => s.id === id);
    if (!item) { sendJson(res, { ok: false, error: '配置不存在' }, 404); return; }
    if (typeof body.name === 'string') item.name = body.name.trim();
    if (typeof body.description === 'string') item.description = body.description.trim();
    if (typeof body.icon === 'string') item.icon = body.icon.trim() || '📦';
    if (typeof body.path === 'string') item.path = body.path.trim();
    if (typeof body.startScript === 'string') item.startScript = body.startScript.trim() || 'start.bat';
    if (typeof body.url === 'string') item.url = body.url.trim();
    if (!saveExternalServices(list)) {
      sendJson(res, { ok: false, error: '写入配置文件失败' }, 500);
      return;
    }
    sendJson(res, { ok: true });
    return;
  }

  // 删除外部服务：DELETE /api/external-services/<id>
  const extDelMatch = pathname.match(/^\/api\/external-services\/([^/]+)$/);
  if (extDelMatch && req.method === 'DELETE') {
    const id = extDelMatch[1];
    const list = readExternalServices();
    const idx = list.findIndex(s => s.id === id);
    if (idx < 0) { sendJson(res, { ok: false, error: '配置不存在' }, 404); return; }
    list.splice(idx, 1);
    if (!saveExternalServices(list)) {
      sendJson(res, { ok: false, error: '写入配置文件失败' }, 500);
      return;
    }
    sendJson(res, { ok: true });
    return;
  }

  // 启动外部服务：POST /api/external-services/<id>/start
  const extStartMatch = pathname.match(/^\/api\/external-services\/([^/]+)\/start$/);
  if (extStartMatch && req.method === 'POST') {
    const id = extStartMatch[1];
    const list = readExternalServices();
    const item = list.find(s => s.id === id);
    if (!item) { sendJson(res, { ok: false, error: '配置不存在' }, 404); return; }
    const result = await startExternalService(item);
    sendJson(res, result, result.ok ? 200 : 500);
    return;
  }

  // 打开外部服务目录：POST /api/external-services/<id>/open-folder
  const extFolderMatch = pathname.match(/^\/api\/external-services\/([^/]+)\/open-folder$/);
  if (extFolderMatch && req.method === 'POST') {
    const id = extFolderMatch[1];
    const list = readExternalServices();
    const item = list.find(s => s.id === id);
    if (!item) { sendJson(res, { ok: false, error: '配置不存在' }, 404); return; }
    const result = await openExternalFolder(item);
    sendJson(res, result, result.ok ? 200 : 500);
    return;
  }

  /* ---------- 静态页面 ---------- */

  // 门户主页
  if (pathname === '/' || pathname === '/index.html') {
    sendFile(res, INDEX_FILE);
    return;
  }

  // 项目静态资源：/projects/<name>/<file...>
  if (pathname.startsWith('/projects/')) {
    const rel = pathname.slice('/projects/'.length);
    const filePath = safeResolve(PROJECTS_DIR, rel);
    if (!filePath) { send404(res); return; }
    fs.stat(filePath, (err, stat) => {
      if (err) { send404(res); return; }
      if (stat.isDirectory()) {
        sendFile(res, path.join(filePath, 'index.html'));
      } else {
        sendFile(res, filePath);
      }
    });
    return;
  }

  // 其他：尝试根目录下的静态文件（如 favicon 等）
  if (pathname !== '/') {
    const rootFile = safeResolve(ROOT, pathname);
    if (rootFile && rootFile !== ROOT) {
      sendFile(res, rootFile);
      return;
    }
  }

  send404(res);
});

/* ---------------- 端口监听（自动递增） ---------------- */

let actualPort = PORT;
const MAX_PORT_TRIES = 10;

function tryListen(port, triesLeft) {
  server.removeAllListeners('error');
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) {
      const nextPort = port + 1;
      if (port === PORT) {
        console.log(`[提示] 端口 ${PORT} 已被占用，自动尝试 ${nextPort}…`);
      }
      actualPort = nextPort;
      tryListen(nextPort, triesLeft - 1);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`[错误] 端口 ${PORT}~${port} 均被占用，请手动指定：PORT=9300 node server.js`);
      process.exit(1);
    } else {
      console.error('[错误]', err.message);
      process.exit(1);
    }
  });
  server.listen(port, HOST);
}

server.on('listening', () => {
  const lan = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        lan.push(`http://${addr.address}:${actualPort}/`);
      }
    }
  }
  console.log('==========================================');
  console.log('  dfd 单页应用集成工具 已启动');
  const localUrl = `http://${HOST}:${actualPort}/`;
  console.log(`  本机访问: ${localUrl}`);
  if (lan.length) console.log(`  局域网:   ${lan[0]}`);
  console.log(`  项目目录: ${PROJECTS_DIR}`);
  console.log(`  服务目录: ${SERVICES_DIR}`);
  console.log('  按 Ctrl+C 停止服务');
  console.log('==========================================');

  // 自动打开浏览器（实际端口可能与请求端口不同，故在 listening 后打开）
  if (!process.env.DFD_NO_OPEN) {
    const openCmd = process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '""', localUrl]]
      : process.platform === 'darwin'
        ? ['open', [localUrl]]
        : ['xdg-open', [localUrl]];
    try {
      const [cmd, args] = openCmd;
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    } catch (_) { /* 忽略 */ }
  }
});

tryListen(PORT, MAX_PORT_TRIES);

/* ---------------- 命令行入口 ---------------- */

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log([
    'dfd - 单页应用集成工具 (single page hub)',
    '',
    '用法:',
    '  node server.js             启动服务（默认端口 8080）',
    '  PORT=9090 node server.js   指定端口启动',
    '  node server.js --help      显示本帮助',
    '',
    '说明:',
    '  将单页项目（含 index.html）放入 projects/ 目录下的子文件夹，',
    '  服务启动时自动扫描并在门户主页集成展示。',
    '  每个项目可附带 manifest.json 自定义名称/描述/图标/标签/入口。',
    '',
    '  将需自行启动的服务放入 services/ 目录（含 start.bat 启动脚本），',
    '  门户可探测其状态、一键启动脚本、编辑服务首页地址。',
    '',
    '常用入口:',
    `  主页:      http://${HOST}:${DEFAULT_PORT}/`,
    '  项目列表:  http://127.0.0.1:' + DEFAULT_PORT + '/api/projects',
    '  服务列表:  http://127.0.0.1:' + DEFAULT_PORT + '/api/services',
  ].join('\n'));
  process.exit(0);
}