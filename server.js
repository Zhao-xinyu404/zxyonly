const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, 'data');
console.log('Data directory:', DATA_DIR);
if (!fs.existsSync(DATA_DIR)) {
  console.log('Creating data directory');
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

console.log('Users file:', USERS_FILE);
console.log('Messages file:', MESSAGES_FILE);

let users = [];
let friends = {};
let messages = {};
let socketMap = {};

try {
  if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  if (fs.existsSync(FRIENDS_FILE)) friends = JSON.parse(fs.readFileSync(FRIENDS_FILE, 'utf8'));
  if (fs.existsSync(MESSAGES_FILE)) messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
} catch (e) {}

if (users.length === 0) {
  users = [
    { username: 'alice', password: '1234', nickname: 'Alice', avatar: 2, bio: 'hello', createdAt: Date.now() },
    { username: 'bob', password: '1234', nickname: 'Bob', avatar: 4, bio: 'hi', createdAt: Date.now() },
    { username: 'charlie', password: '1234', nickname: 'Charlie', avatar: 5, bio: 'hey', createdAt: Date.now() }
  ];
  friends['alice'] = ['bob'];
  friends['bob'] = ['alice'];
  friends['charlie'] = [];
  saveData();
}

function saveData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    fs.writeFileSync(FRIENDS_FILE, JSON.stringify(friends, null, 2));
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    console.log('Data saved successfully:', Object.keys(messages).length, 'message keys');
  } catch (e) {
    console.error('Save data error:', e.message);
  }
}

function getUser(username) { return users.find(u => u.username === username); }
function getFriends(username) { return friends[username] || []; }
function addFriend(a, b) {
  if (!friends[a]) friends[a] = [];
  if (!friends[b]) friends[b] = [];
  if (!friends[a].includes(b)) friends[a].push(b);
  if (!friends[b].includes(a)) friends[b].push(a);
  saveData();
}
function getMsgs(a, b) {
  const key = [a, b].sort().join('__');
  return messages[key] || [];
}
function addMsg(from, to, content) {
  const key = [from, to].sort().join('__');
  if (!messages[key]) messages[key] = [];
  const msg = { from, to, content, time: Date.now() };
  messages[key].push(msg);
  saveData();
  return msg;
}

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
    users.push(user);
    friends[username] = [];
    saveData();
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

  if (req.method === 'GET' && url === '/api/users') {
    const allUsers = users.map(u => ({ username: u.username, nickname: u.nickname, avatar: u.avatar, createdAt: u.createdAt }));
    return send(res, 200, { success: true, users: allUsers });
  }

  if (req.method === 'GET' && url === '/api/debug/messages') {
    const keys = Object.keys(messages);
    const summary = keys.map(k => ({ key: k, count: messages[k].length }));
    return send(res, 200, { success: true, totalKeys: keys.length, summary });
  }

  if (req.method === 'GET' && url.startsWith('/api/user/')) {
    const username = decodeURIComponent(url.slice(10));
    const user = getUser(username);
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    return send(res, 200, { success: true, user });
  }

  if (req.method === 'GET' && url.startsWith('/api/friends/')) {
    const username = decodeURIComponent(url.slice(12));
    const list = getFriends(username).map(u => getUser(u)).filter(Boolean);
    return send(res, 200, { success: true, friends: list });
  }

  if (req.method === 'GET' && url.startsWith('/api/messages/')) {
    const parts = url.slice(13).split('/');
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
    console.log('Message sent:', from, '->', to, content.length, 'chars');
    console.log('Messages in memory:', Object.keys(messages).length, 'keys');
    const checkKey = [from, to].sort().join('__');
    console.log('Specific key messages:', messages[checkKey]?.length || 0);
    return send(res, 200, { success: true, message: msg });
  }

  send(res, 404, { error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port ' + PORT);
});
