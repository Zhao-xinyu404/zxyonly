const http = require('http');
const fs = require('fs');
const path = require('path');

function findWritableDir() {
  const candidates = [
    '/tmp/wuliao-data',
    '/app/wuliao-data',
    path.resolve(__dirname, 'data'),
    process.env.WULIAO_DATA_DIR
  ].filter(Boolean);
  
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const testFile = path.join(dir, 'test_write.txt');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      console.log('[INFO] Found writable directory:', dir);
      return dir;
    } catch (e) {
      console.warn('[WARN] Directory not writable:', dir, e.message);
    }
  }
  
  console.error('[ERROR] No writable directory found, using memory only');
  return null;
}

const DATA_DIR = findWritableDir();

if (DATA_DIR) {
  console.log('[INFO] Data directory:', DATA_DIR);
  
  const USERS_DIR = path.join(DATA_DIR, 'users');
  const FRIENDS_DIR = path.join(DATA_DIR, 'friends');
  const MESSAGES_DIR = path.join(DATA_DIR, 'messages');

  function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log('[INFO] Created directory:', dir);
      } catch (e) {
        console.error('[ERROR] Failed to create directory:', dir, e.message);
        throw e;
      }
    }
  }

  try {
    ensureDir(DATA_DIR);
    ensureDir(USERS_DIR);
    ensureDir(FRIENDS_DIR);
    ensureDir(MESSAGES_DIR);
    console.log('[INFO] All directories created successfully');
  } catch (e) {
    console.error('[ERROR] Cannot create data directories:', e.message);
  }

  function userFile(username) { return path.join(USERS_DIR, username + '.json'); }
  function friendsFile(username) { return path.join(FRIENDS_DIR, username + '.json'); }
  function messagesFile(a, b) {
    const key = [a, b].sort().join('__');
    return path.join(MESSAGES_DIR, key + '.json');
  }
} else {
  console.warn('[WARN] Using memory-only storage, data will be lost on restart');
}

let users = [];
let friends = {};
let messages = {};

function readJSON(file, defaultVal) {
  if (!DATA_DIR) return defaultVal;
  try {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      const data = JSON.parse(content);
      console.log('[DEBUG] Read file:', file, 'size:', content.length, 'bytes');
      return data;
    }
  } catch (e) {
    console.warn('[WARN] Read error:', file, e.message);
  }
  return defaultVal;
}

function writeJSON(file, data) {
  if (!DATA_DIR) return false;
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(file, content);
    const fd = fs.openSync(file, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    console.log('[DEBUG] Written file:', file, 'size:', content.length, 'bytes');
    
    if (!fs.existsSync(file)) {
      console.error('[ERROR] File not found after write:', file);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[ERROR] Write error:', file, e.message);
    return false;
  }
}

function getUser(username) {
  if (DATA_DIR) {
    return readJSON(userFile(username), null);
  }
  return users.find(u => u.username === username);
}

function saveUser(user) {
  if (DATA_DIR) {
    return writeJSON(userFile(user.username), user);
  }
  const idx = users.findIndex(u => u.username === user.username);
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  return true;
}

function getAllUsers() {
  if (DATA_DIR) {
    try {
      const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
      console.log('[DEBUG] Found users:', files.length, files);
      return files.map(f => readJSON(path.join(USERS_DIR, f), null)).filter(Boolean);
    } catch (e) {
      console.error('[ERROR] getAllUsers:', e.message);
      return [];
    }
  }
  return users;
}

function getFriends(username) {
  if (DATA_DIR) {
    return readJSON(friendsFile(username), []);
  }
  return friends[username] || [];
}

function saveFriends(username, list) {
  if (DATA_DIR) {
    return writeJSON(friendsFile(username), list);
  }
  friends[username] = list;
  return true;
}

function addFriend(a, b) {
  console.log('[INFO] Adding friend:', a, '<->', b);
  const fa = getFriends(a);
  const fb = getFriends(b);
  console.log('[DEBUG] Current friends:', a, 'has', fa.length, 'friends:', fa);
  console.log('[DEBUG] Current friends:', b, 'has', fb.length, 'friends:', fb);
  
  if (!fa.includes(b)) {
    fa.push(b);
    const result = saveFriends(a, fa);
    console.log('[DEBUG] Saved friends for', a, '- result:', result);
  }
  if (!fb.includes(a)) {
    fb.push(a);
    const result = saveFriends(b, fb);
    console.log('[DEBUG] Saved friends for', b, '- result:', result);
  }
}

function getMsgs(a, b) {
  if (DATA_DIR) {
    return readJSON(messagesFile(a, b), []);
  }
  const key = [a, b].sort().join('__');
  return messages[key] || [];
}

function addMsg(from, to, content) {
  console.log('[INFO] Sending message:', from, '->', to, content.length, 'chars');
  let msgs = [];
  let file = null;
  
  if (DATA_DIR) {
    file = messagesFile(from, to);
    msgs = readJSON(file, []);
  } else {
    const key = [from, to].sort().join('__');
    msgs = messages[key] || [];
  }
  
  console.log('[DEBUG] Existing messages:', msgs.length);
  
  const msg = { from, to, content, time: Date.now() };
  msgs.push(msg);
  
  let result = false;
  if (DATA_DIR) {
    result = writeJSON(file, msgs);
  } else {
    const key = [from, to].sort().join('__');
    messages[key] = msgs;
    result = true;
  }
  
  console.log('[DEBUG] Saved messages - result:', result, 'total:', msgs.length);
  return msg;
}

const DEFAULT_USERS = [
  { username: 'admin', password: 'admin123', nickname: '无聊官方', avatar: 1, bio: '无聊官方公众号 · 发布最新公告和使用指南', createdAt: Date.now() },
  { username: 'alice', password: '1234', nickname: 'Alice', avatar: 2, bio: 'hello', createdAt: Date.now() },
  { username: 'bob', password: '1234', nickname: 'Bob', avatar: 4, bio: 'hi', createdAt: Date.now() },
  { username: 'charlie', password: '1234', nickname: 'Charlie', avatar: 5, bio: 'hey', createdAt: Date.now() }
];

function initDefaultData() {
  const all = getAllUsers();
  console.log('[INFO] initDefaultData - found', all.length, 'users');
  if (all.length > 0) {
    console.log('[INFO] Users already exist, skipping initialization');
    return;
  }
  console.log('[INFO] Initializing default users');
  DEFAULT_USERS.forEach(u => {
    const result = saveUser(u);
    console.log('[DEBUG] Saved user:', u.username, '- result:', result);
  });
  addFriend('alice', 'bob');
  console.log('[INFO] Default data initialized');
}
initDefaultData();

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
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  const url = req.url;
  console.log('[INFO] Request:', req.method, url);

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
    return send(res, 200, { success: true, user });
  }

  if (req.method === 'POST' && url === '/api/login') {
    const body = await readBody(req);
    const { username, password } = body;
    const user = getUser(username);
    if (!user || user.password !== password) return send(res, 200, { success: false, msg: '无聊号或密码错误' });
    return send(res, 200, { success: true, user });
  }

  if (req.method === 'POST' && url === '/api/add-friend') {
    const body = await readBody(req);
    const { from, to } = body;
    if (from === to) return send(res, 200, { success: false, msg: '不能添加自己为好友' });
    const target = getUser(to);
    if (!target) return send(res, 200, { success: false, msg: '用户不存在' });
    if (getFriends(from).includes(to)) return send(res, 200, { success: false, msg: '你们已经是好友了' });
    addFriend(from, to);
    return send(res, 200, { success: true, target });
  }

  if (req.method === 'GET' && url.startsWith('/api/user/')) {
    const username = decodeURIComponent(url.slice(10));
    const user = getUser(username);
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    return send(res, 200, { success: true, user });
  }

  if (req.method === 'GET' && url.startsWith('/api/friends/')) {
    const username = decodeURIComponent(url.slice(13));
    const friendNames = getFriends(username);
    console.log('[DEBUG] Friends for', username, ':', friendNames);
    const list = friendNames.map(name => getUser(name)).filter(Boolean);
    return send(res, 200, { success: true, friends: list });
  }

  if (req.method === 'GET' && url.startsWith('/api/messages/')) {
    const parts = url.slice(14).split('/');
    if (parts.length >= 2) {
      const a = decodeURIComponent(parts[0]);
      const b = decodeURIComponent(parts[1]);
      const msgs = getMsgs(a, b);
      console.log('[DEBUG] Messages between', a, 'and', b, ':', msgs.length);
      return send(res, 200, { success: true, messages: msgs });
    }
    return send(res, 200, { success: true, messages: [] });
  }

  if (req.method === 'POST' && url === '/api/messages/send') {
    const body = await readBody(req);
    const { from, to, content } = body;
    if (!from || !to || !content) return send(res, 200, { success: false, msg: '参数错误' });
    if (!getUser(from) || !getUser(to)) return send(res, 200, { success: false, msg: '用户不存在' });
    if (!getFriends(from).includes(to)) return send(res, 200, { success: false, msg: '对方不是你的好友' });
    const msg = addMsg(from, to, content);
    return send(res, 200, { success: true, message: msg });
  }

  send(res, 404, { error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('[INFO] Server running on port ' + PORT);
});
