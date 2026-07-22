const http = require('http');

/* ============ 数据存储 ============ */
/* 使用内存存储 + 文件存储双模式 */
/* Render上文件可能丢失，内存保证当前会话可用 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = (() => {
  const dirs = ['/tmp/wuliao-data', path.join(__dirname, 'data')];
  for (const d of dirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, '.test'), '1');
      fs.unlinkSync(path.join(d, '.test'));
      console.log('[INFO] Using data dir:', d);
      return d;
    } catch (e) {}
  }
  return null;
})();

const USERS_DIR = DATA_DIR ? path.join(DATA_DIR, 'users') : null;
const FRIENDS_DIR = DATA_DIR ? path.join(DATA_DIR, 'friends') : null;
const MSG_DIR = DATA_DIR ? path.join(DATA_DIR, 'messages') : null;

if (DATA_DIR) {
  [USERS_DIR, FRIENDS_DIR, MSG_DIR].forEach(d => {
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  });
}

/* 内存存储（备份） */
let memUsers = {};
let memFriends = {};
let memMsgs = {};

function userFile(u) { return path.join(USERS_DIR, u + '.json'); }
function friendsFile(u) { return path.join(FRIENDS_DIR, u + '.json'); }
function msgFile(a, b) { return path.join(MSG_DIR, [a, b].sort().join('__') + '.json'); }

function readJSON(file, def) {
  if (!file || !DATA_DIR) return def;
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {}
  return def;
}

function writeJSON(file, data) {
  if (!file || !DATA_DIR) return false;
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('[ERROR] Write failed:', e.message);
    return false;
  }
}

/* ============ 用户操作 ============ */
function getUser(username) {
  if (DATA_DIR) {
    const u = readJSON(userFile(username), null);
    if (u) return u;
  }
  return memUsers[username] || null;
}

function saveUser(user) {
  memUsers[user.username] = user;
  if (DATA_DIR) writeJSON(userFile(user.username), user);
  return true;
}

function getAllUsers() {
  if (DATA_DIR) {
    try {
      const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
      return files.map(f => readJSON(path.join(USERS_DIR, f), null)).filter(Boolean);
    } catch (e) {}
  }
  return Object.values(memUsers);
}

/* ============ 好友操作 ============ */
function getFriends(username) {
  if (DATA_DIR) {
    const f = readJSON(friendsFile(username), null);
    if (f) return f;
  }
  return memFriends[username] || [];
}

function saveFriends(username, list) {
  memFriends[username] = list;
  if (DATA_DIR) writeJSON(friendsFile(username), list);
  return true;
}

function addFriend(a, b) {
  const fa = getFriends(a);
  const fb = getFriends(b);
  if (!fa.includes(b)) { fa.push(b); saveFriends(a, fa); }
  if (!fb.includes(a)) { fb.push(a); saveFriends(b, fb); }
}

/* ============ 消息操作 ============ */
function getMsgs(a, b) {
  if (DATA_DIR) {
    const m = readJSON(msgFile(a, b), null);
    if (m) return m;
  }
  const key = [a, b].sort().join('__');
  return memMsgs[key] || [];
}

function addMsg(from, to, content) {
  const msg = { from, to, content, time: Date.now() };
  
  /* 同时写入内存和文件 */
  const key = [from, to].sort().join('__');
  if (!memMsgs[key]) memMsgs[key] = [];
  memMsgs[key].push(msg);
  
  if (DATA_DIR) {
    const file = msgFile(from, to);
    const existing = readJSON(file, []);
    existing.push(msg);
    const result = writeJSON(file, existing);
    console.log('[DEBUG] Message saved to file:', result, 'file:', file, 'total msgs:', existing.length);
  }
  
  return msg;
}

/* ============ 默认数据 ============ */
const DEFAULT_USERS = [
  { username: 'admin', password: 'admin123', nickname: '无聊官方', avatar: 1, bio: '无聊官方公众号 · 发布最新公告和使用指南', createdAt: Date.now() },
  { username: 'alice', password: '1234', nickname: 'Alice', avatar: 2, bio: 'hello', createdAt: Date.now() },
  { username: 'bob', password: '1234', nickname: 'Bob', avatar: 4, bio: 'hi', createdAt: Date.now() },
  { username: 'charlie', password: '1234', nickname: 'Charlie', avatar: 5, bio: 'hey', createdAt: Date.now() }
];

function initDefaultData() {
  const all = getAllUsers();
  if (all.length > 0) {
    console.log('[INFO] Users exist:', all.length);
    return;
  }
  console.log('[INFO] Initializing default users');
  DEFAULT_USERS.forEach(u => {
    saveUser(u);
    saveFriends(u.username, []);
  });
  addFriend('alice', 'bob');
  console.log('[INFO] Default data initialized');
}
initDefaultData();

/* ============ HTTP 工具 ============ */
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { resolve({}); }
    });
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

/* ============ 路由 ============ */
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  const url = req.url.split('?')[0];
  console.log('[REQ]', req.method, url);

  /* ====== 健康检查 ====== */
  if (req.method === 'GET' && (url === '/' || url === '/api' || url === '/api/health')) {
    return send(res, 200, {
      ok: true,
      service: 'wuliao-chat',
      version: '2.0',
      dataDir: DATA_DIR,
      userCount: getAllUsers().length
    });
  }

  /* ====== 注册 ====== */
  if (req.method === 'POST' && url === '/api/register') {
    const body = await readBody(req);
    const { username, password, nickname, avatar } = body;
    if (!username || !password || !nickname) return send(res, 200, { success: false, msg: '请填写完整信息' });
    if (username.length < 3) return send(res, 200, { success: false, msg: '无聊号至少3个字符' });
    if (password.length < 4) return send(res, 200, { success: false, msg: '密码至少4位' });
    if (getUser(username)) return send(res, 200, { success: false, msg: '该无聊号已被注册' });
    const user = { username, password, nickname, avatar: avatar || 1, bio: '', createdAt: Date.now() };
    saveUser(user);
    saveFriends(username, []);
    console.log('[OK] Registered:', username);
    return send(res, 200, { success: true, user });
  }

  /* ====== 登录 ====== */
  if (req.method === 'POST' && url === '/api/login') {
    const body = await readBody(req);
    const { username, password } = body;
    const user = getUser(username);
    if (!user || user.password !== password) return send(res, 200, { success: false, msg: '无聊号或密码错误' });
    console.log('[OK] Login:', username);
    return send(res, 200, { success: true, user });
  }

  /* ====== 添加好友 ====== */
  if (req.method === 'POST' && url === '/api/add-friend') {
    const body = await readBody(req);
    const { from, to } = body;
    if (from === to) return send(res, 200, { success: false, msg: '不能添加自己为好友' });
    const target = getUser(to);
    if (!target) return send(res, 200, { success: false, msg: '用户不存在' });
    const friendsList = getFriends(from);
    if (friendsList.includes(to)) return send(res, 200, { success: false, msg: '你们已经是好友了' });
    addFriend(from, to);
    console.log('[OK] Friend added:', from, '->', to);
    return send(res, 200, { success: true, target });
  }

  /* ====== 获取用户信息 ====== */
  if (req.method === 'GET' && url.startsWith('/api/user/')) {
    const username = decodeURIComponent(url.slice(10));
    const user = getUser(username);
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    return send(res, 200, { success: true, user });
  }

  /* ====== 获取好友列表 ====== */
  if (req.method === 'GET' && url.startsWith('/api/friends/')) {
    const username = decodeURIComponent(url.slice(13));
    const friendNames = getFriends(username);
    const friends = friendNames.map(name => getUser(name)).filter(Boolean);
    return send(res, 200, { success: true, friends });
  }

  /* ====== 获取消息 ====== */
  if (req.method === 'GET' && url.startsWith('/api/messages/')) {
    const parts = url.slice(14).split('/');
    if (parts.length >= 2) {
      const a = decodeURIComponent(parts[0]);
      const b = decodeURIComponent(parts[1]);
      const msgs = getMsgs(a, b);
      console.log('[OK] GetMsgs:', a, '<->', b, 'count:', msgs.length);
      return send(res, 200, { success: true, messages: msgs });
    }
    return send(res, 200, { success: true, messages: [] });
  }

  /* ====== 发送消息 ====== */
  if (req.method === 'POST' && url === '/api/messages/send') {
    const body = await readBody(req);
    const { from, to, content } = body;
    console.log('[MSG] Send request:', { from, to, content: content?.substring(0, 20) });
    
    if (!from || !to || !content) return send(res, 200, { success: false, msg: '参数错误' });
    
    const fromUser = getUser(from);
    const toUser = getUser(to);
    if (!fromUser) return send(res, 200, { success: false, msg: '发送者不存在' });
    if (!toUser) return send(res, 200, { success: false, msg: '接收者不存在' });
    
    const friendsList = getFriends(from);
    if (!friendsList.includes(to)) return send(res, 200, { success: false, msg: '对方不是你的好友' });
    
    const msg = addMsg(from, to, content);
    console.log('[OK] Message saved:', msg.from, '->', msg.to, 'time:', msg.time);
    
    /* 验证消息确实保存了 */
    const verify = getMsgs(from, to);
    console.log('[VERIFY] Total messages now:', verify.length);
    
    return send(res, 200, { success: true, message: msg, totalMessages: verify.length });
  }

  /* ====== 调试端点 ====== */
  if (req.method === 'GET' && url === '/api/debug') {
    let msgFiles = [];
    if (DATA_DIR && MSG_DIR) {
      try { msgFiles = fs.readdirSync(MSG_DIR).filter(f => f.endsWith('.json')); } catch (e) {}
    }
    return send(res, 200, {
      version: '2.0',
      dataDir: DATA_DIR,
      users: getAllUsers().map(u => u.username),
      msgFiles: msgFiles,
      memMsgsKeys: Object.keys(memMsgs)
    });
  }

  send(res, 404, { error: 'Not found', url: url });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('[INFO] 无聊聊天服务已启动');
  console.log('[INFO] 端口:', PORT);
  console.log('[INFO] 数据目录:', DATA_DIR || '仅内存');
  console.log('[INFO] 用户数:', getAllUsers().length);
  console.log('========================================');
});