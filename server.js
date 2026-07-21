const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.WULIAO_DATA_DIR || path.resolve(__dirname, 'data');
console.log('Data directory:', DATA_DIR);
if (!fs.existsSync(DATA_DIR)) {
  console.log('Creating data directory');
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_DIR = path.join(DATA_DIR, 'users');
const FRIENDS_DIR = path.join(DATA_DIR, 'friends');
const MESSAGES_DIR = path.join(DATA_DIR, 'messages');

[USERS_DIR, FRIENDS_DIR, MESSAGES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function userFile(username) { return path.join(USERS_DIR, username + '.json'); }
function friendsFile(username) { return path.join(FRIENDS_DIR, username + '.json'); }
function messagesFile(a, b) {
  const key = [a, b].sort().join('__');
  return path.join(MESSAGES_DIR, key + '.json');
}

function readJSON(file, defaultVal) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.warn('Read error:', file, e.message); }
  return defaultVal;
}

function writeJSON(file, data) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('Write error:', file, e.message);
    return false;
  }
}

function getUser(username) {
  return readJSON(userFile(username), null);
}

function saveUser(user) {
  return writeJSON(userFile(user.username), user);
}

function getAllUsers() {
  try {
    const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => readJSON(path.join(USERS_DIR, f), null)).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function getFriends(username) {
  return readJSON(friendsFile(username), []);
}

function saveFriends(username, list) {
  return writeJSON(friendsFile(username), list);
}

function addFriend(a, b) {
  const fa = getFriends(a);
  const fb = getFriends(b);
  if (!fa.includes(b)) { fa.push(b); saveFriends(a, fa); }
  if (!fb.includes(a)) { fb.push(a); saveFriends(b, fb); }
}

function getMsgs(a, b) {
  return readJSON(messagesFile(a, b), []);
}

function addMsg(from, to, content) {
  const file = messagesFile(from, to);
  const msgs = readJSON(file, []);
  const msg = { from, to, content, time: Date.now() };
  msgs.push(msg);
  writeJSON(file, msgs);
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
  if (all.length > 0) return;
  console.log('Initializing default users');
  DEFAULT_USERS.forEach(u => saveUser(u));
  addFriend('alice', 'bob');
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

  if (req.method === 'POST' && url === '/api/register') {
    const body = await readBody(req);
    const { username, password, nickname, avatar } = body;
    if (!username || !password || !nickname) return send(res, 200, { success: false, msg: '请填写完整信息' });
    if (username.length < 3) return send(res, 200, { success: false, msg: '用户名至少3个字符' });
    if (password.length < 4) return send(res, 200, { success: false, msg: '密码至少4位' });
    if (getUser(username)) return send(res, 200, { success: false, msg: '该用户名已被注册' });
    const user = { username, password, nickname, avatar: avatar || 1, bio: '', createdAt: Date.now() };
    saveUser(user);
    saveFriends(username, []);
    return send(res, 200, { success: true, user });
  }

  if (req.method === 'POST' && url === '/api/login') {
    const body = await readBody(req);
    const { username, password } = body;
    const user = getUser(username);
    if (!user || user.password !== password) return send(res, 200, { success: false, msg: '用户名或密码错误' });
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
    const list = friendNames.map(name => getUser(name)).filter(Boolean);
    return send(res, 200, { success: true, friends: list });
  }

  if (req.method === 'GET' && url.startsWith('/api/messages/')) {
    const parts = url.slice(14).split('/');
    if (parts.length >= 2) {
      const a = decodeURIComponent(parts[0]);
      const b = decodeURIComponent(parts[1]);
      return send(res, 200, { success: true, messages: getMsgs(a, b) });
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
  console.log('Server running on port ' + PORT);
});
