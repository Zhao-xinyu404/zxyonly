const http = require('http');
const fs = require('fs');
const path = require('path');

/* ============ 数据存储 ============ */
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
const REQ_DIR = DATA_DIR ? path.join(DATA_DIR, 'friend-requests') : null;
const MOMENTS_DIR = DATA_DIR ? path.join(DATA_DIR, 'moments') : null;
const MOMENT_LIKES_DIR = DATA_DIR ? path.join(DATA_DIR, 'moment-likes') : null;
const MOMENT_COMMENTS_DIR = DATA_DIR ? path.join(DATA_DIR, 'moment-comments') : null;

if (DATA_DIR) {
  [USERS_DIR, FRIENDS_DIR, MSG_DIR, REQ_DIR, MOMENTS_DIR, MOMENT_LIKES_DIR, MOMENT_COMMENTS_DIR].forEach(d => {
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  });
}

/* 内存存储 */
let memUsers = {};
let memFriends = {};
let memMsgs = {};
let memRequests = { incoming: {}, outgoing: {} };
let memMoments = [];
let memMomentLikes = {};
let memMomentComments = {};

/* ============ 文件工具 ============ */
function userFile(u) { return path.join(USERS_DIR, u + '.json'); }
function friendsFile(u) { return path.join(FRIENDS_DIR, u + '.json'); }
function msgFile(a, b) { return path.join(MSG_DIR, [a, b].sort().join('__') + '.json'); }
function incomingReqFile(u) { return path.join(REQ_DIR, u + '_in.json'); }
function outgoingReqFile(u) { return path.join(REQ_DIR, u + '_out.json'); }
function momentsFile() { return path.join(MOMENTS_DIR, 'all.json'); }
function momentLikesFile(id) { return path.join(MOMENT_LIKES_DIR, id + '.json'); }
function momentCommentsFile(id) { return path.join(MOMENT_COMMENTS_DIR, id + '.json'); }

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

function removeFriend(a, b) {
  const fa = getFriends(a).filter(x => x !== b);
  const fb = getFriends(b).filter(x => x !== a);
  saveFriends(a, fa);
  saveFriends(b, fb);
}

function areFriends(a, b) {
  return getFriends(a).includes(b) && getFriends(b).includes(a);
}

/* ============ 好友请求 ============ */
function getIncomingRequests(username) {
  if (DATA_DIR) {
    const r = readJSON(incomingReqFile(username), null);
    if (r) return r;
  }
  return memRequests.incoming[username] || [];
}

function getOutgoingRequests(username) {
  if (DATA_DIR) {
    const r = readJSON(outgoingReqFile(username), null);
    if (r) return r;
  }
  return memRequests.outgoing[username] || [];
}

function saveIncomingRequests(username, list) {
  memRequests.incoming[username] = list;
  if (DATA_DIR) writeJSON(incomingReqFile(username), list);
}

function saveOutgoingRequests(username, list) {
  memRequests.outgoing[username] = list;
  if (DATA_DIR) writeJSON(outgoingReqFile(username), list);
}

function sendFriendRequest(from, to, message) {
  const incoming = getIncomingRequests(to);
  const outgoing = getOutgoingRequests(from);
  
  const existing = incoming.find(r => r.from === from && r.status === 'pending');
  if (existing) return { success: false, msg: '已发送过好友请求' };
  
  const req = {
    id: 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    from,
    to,
    message: message || '',
    status: 'pending',
    createdAt: Date.now()
  };
  
  incoming.unshift(req);
  outgoing.unshift(req);
  saveIncomingRequests(to, incoming);
  saveOutgoingRequests(from, outgoing);
  
  return { success: true, request: req };
}

function acceptFriendRequest(username, requestId) {
  const incoming = getIncomingRequests(username);
  const idx = incoming.findIndex(r => r.id === requestId);
  if (idx === -1) return { success: false, msg: '请求不存在' };
  
  const req = incoming[idx];
  if (req.status !== 'pending') return { success: false, msg: '请求已处理' };
  
  req.status = 'accepted';
  req.handledAt = Date.now();
  incoming[idx] = req;
  saveIncomingRequests(username, incoming);
  
  const outgoing = getOutgoingRequests(req.from);
  const oidx = outgoing.findIndex(r => r.id === requestId);
  if (oidx !== -1) {
    outgoing[oidx] = req;
    saveOutgoingRequests(req.from, outgoing);
  }
  
  addFriend(req.from, username);
  
  return { success: true, request: req };
}

function rejectFriendRequest(username, requestId) {
  const incoming = getIncomingRequests(username);
  const idx = incoming.findIndex(r => r.id === requestId);
  if (idx === -1) return { success: false, msg: '请求不存在' };
  
  const req = incoming[idx];
  if (req.status !== 'pending') return { success: false, msg: '请求已处理' };
  
  req.status = 'rejected';
  req.handledAt = Date.now();
  incoming[idx] = req;
  saveIncomingRequests(username, incoming);
  
  const outgoing = getOutgoingRequests(req.from);
  const oidx = outgoing.findIndex(r => r.id === requestId);
  if (oidx !== -1) {
    outgoing[oidx] = req;
    saveOutgoingRequests(req.from, outgoing);
  }
  
  return { success: true, request: req };
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
  const key = [from, to].sort().join('__');
  if (!memMsgs[key]) memMsgs[key] = [];
  memMsgs[key].push(msg);
  
  if (DATA_DIR) {
    const file = msgFile(from, to);
    const existing = readJSON(file, []);
    existing.push(msg);
    writeJSON(file, existing);
  }
  
  return msg;
}

/* ============ 朋友圈 ============ */
function getAllMoments() {
  if (DATA_DIR) {
    const m = readJSON(momentsFile(), null);
    if (m) return m;
  }
  return memMoments;
}

function saveAllMoments(list) {
  memMoments = list;
  if (DATA_DIR) writeJSON(momentsFile(), list);
}

function getMomentLikes(momentId) {
  if (DATA_DIR) {
    const l = readJSON(momentLikesFile(momentId), null);
    if (l) return l;
  }
  return memMomentLikes[momentId] || [];
}

function saveMomentLikes(momentId, list) {
  memMomentLikes[momentId] = list;
  if (DATA_DIR) writeJSON(momentLikesFile(momentId), list);
}

function getMomentComments(momentId) {
  if (DATA_DIR) {
    const c = readJSON(momentCommentsFile(momentId), null);
    if (c) return c;
  }
  return memMomentComments[momentId] || [];
}

function saveMomentComments(momentId, list) {
  memMomentComments[momentId] = list;
  if (DATA_DIR) writeJSON(momentCommentsFile(momentId), list);
}

function createMoment(username, content, images, hideFrom) {
  const moment = {
    id: 'mom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    author: username,
    content: content || '',
    images: images || [],
    hideFrom: hideFrom || [],
    createdAt: Date.now()
  };
  
  const all = getAllMoments();
  all.unshift(moment);
  saveAllMoments(all);
  saveMomentLikes(moment.id, []);
  saveMomentComments(moment.id, []);
  
  return moment;
}

function getMomentsForUser(username) {
  const all = getAllMoments();
  const userFriends = getFriends(username);
  
  return all.filter(m => {
    if (m.author === username) return true;
    if (!userFriends.includes(m.author)) return false;
    if (m.hideFrom && m.hideFrom.includes(username)) return false;
    return true;
  });
}

function likeMoment(momentId, username) {
  const likes = getMomentLikes(momentId);
  const idx = likes.indexOf(username);
  if (idx === -1) {
    likes.push(username);
  } else {
    likes.splice(idx, 1);
  }
  saveMomentLikes(momentId, likes);
  return likes;
}

function addMomentComment(momentId, username, content, replyTo) {
  const comments = getMomentComments(momentId);
  const comment = {
    id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    from: username,
    replyTo: replyTo || null,
    content,
    createdAt: Date.now()
  };
  comments.push(comment);
  saveMomentComments(momentId, comments);
  return comment;
}

function deleteMomentComment(momentId, commentId, username) {
  const comments = getMomentComments(momentId);
  const idx = comments.findIndex(c => c.id === commentId);
  if (idx === -1) return { success: false, msg: '评论不存在' };
  
  const comment = comments[idx];
  const all = getAllMoments();
  const moment = all.find(m => m.id === momentId);
  if (comment.from !== username && (!moment || moment.author !== username)) {
    return { success: false, msg: '无权限删除' };
  }
  
  comments.splice(idx, 1);
  saveMomentComments(momentId, comments);
  return { success: true };
}

/* ============ 默认数据 ============ */
const DEFAULT_USERS = [
  { username: 'admin', password: 'admin123', nickname: '无聊官方', avatar: 1, bio: '无聊官方公众号 · 发布最新公告和使用指南', email: 'admin@wuliao.com', createdAt: Date.now() },
  { username: 'alice', password: '1234', nickname: 'Alice', avatar: 2, bio: 'hello', email: 'alice@example.com', createdAt: Date.now() },
  { username: 'bob', password: '1234', nickname: 'Bob', avatar: 4, bio: 'hi', email: 'bob@example.com', createdAt: Date.now() },
  { username: 'charlie', password: '1234', nickname: 'Charlie', avatar: 5, bio: 'hey', email: 'charlie@example.com', createdAt: Date.now() }
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
    saveIncomingRequests(u.username, []);
    saveOutgoingRequests(u.username, []);
  });
  addFriend('alice', 'bob');
  
  createMoment('alice', '今天天气真好~', [], []);
  createMoment('bob', '你好世界', [], []);
  
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

  /* ====== 健康检查 ====== */
  if (req.method === 'GET' && (url === '/api' || url === '/api/health')) {
    return send(res, 200, {
      ok: true,
      service: 'wuliao-chat',
      version: '3.0',
      dataDir: DATA_DIR,
      userCount: getAllUsers().length,
      momentCount: getAllMoments().length
    });
  }

  /* ====== 注册 ====== */
  if (req.method === 'POST' && url === '/api/register') {
    const body = await readBody(req);
    const { username, password, nickname, avatar, email } = body;
    if (!username || !password || !nickname) return send(res, 200, { success: false, msg: '请填写完整信息' });
    if (username.length < 3) return send(res, 200, { success: false, msg: '无聊号至少3个字符' });
    if (password.length < 4) return send(res, 200, { success: false, msg: '密码至少4位' });
    if (getUser(username)) return send(res, 200, { success: false, msg: '该无聊号已被注册' });
    if (email) {
      const allUsers = getAllUsers();
      if (allUsers.find(u => u.email === email)) return send(res, 200, { success: false, msg: '该邮箱已被注册' });
    }
    const user = { username, password, nickname, avatar: avatar || 1, bio: '', email: email || '', createdAt: Date.now() };
    saveUser(user);
    saveFriends(username, []);
    saveIncomingRequests(username, []);
    saveOutgoingRequests(username, []);
    return send(res, 200, { success: true, user });
  }

  /* ====== 登录 ====== */
  if (req.method === 'POST' && url === '/api/login') {
    const body = await readBody(req);
    const { username, password } = body;
    // 先按无聊号查找
    let user = getUser(username);
    // 如果没找到，按邮箱查找
    if (!user) {
      const allUsers = getAllUsers();
      user = allUsers.find(u => u.email === username);
    }
    if (!user || user.password !== password) return send(res, 200, { success: false, msg: '无聊号/邮箱或密码错误' });
    return send(res, 200, { success: true, user });
  }

  /* ====== 忘记密码 ====== */
  if (req.method === 'POST' && url === '/api/forgot-password') {
    const body = await readBody(req);
    const { account, newPassword } = body;
    if (!account || !newPassword) return send(res, 200, { success: false, msg: '请填写完整信息' });
    if (newPassword.length < 4) return send(res, 200, { success: false, msg: '密码至少4位' });
    let user = getUser(account);
    if (!user) {
      const allUsers = getAllUsers();
      user = allUsers.find(u => u.email === account);
    }
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    user.password = newPassword;
    saveUser(user);
    return send(res, 200, { success: true });
  }

  /* ====== 发送好友请求 ====== */
  if (req.method === 'POST' && url === '/api/friend-request/send') {
    const body = await readBody(req);
    const { from, to, message } = body;
    if (!from || !to) return send(res, 200, { success: false, msg: '参数错误' });
    if (from === to) return send(res, 200, { success: false, msg: '不能添加自己为好友' });
    if (!getUser(to)) return send(res, 200, { success: false, msg: '用户不存在' });
    if (areFriends(from, to)) return send(res, 200, { success: false, msg: '你们已经是好友了' });
    const result = sendFriendRequest(from, to, message);
    return send(res, 200, result);
  }

  /* ====== 收到的好友请求 ====== */
  if (req.method === 'GET' && url.startsWith('/api/friend-requests/incoming/')) {
    const username = decodeURIComponent(url.slice(30));
    const requests = getIncomingRequests(username);
    const withUsers = await Promise.all(requests.map(async r => ({
      ...r,
      fromUser: getUser(r.from)
    })));
    return send(res, 200, { success: true, requests: withUsers });
  }

  /* ====== 发出的好友请求 ====== */
  if (req.method === 'GET' && url.startsWith('/api/friend-requests/outgoing/')) {
    const username = decodeURIComponent(url.slice(30));
    const requests = getOutgoingRequests(username);
    const withUsers = await Promise.all(requests.map(async r => ({
      ...r,
      toUser: getUser(r.to)
    })));
    return send(res, 200, { success: true, requests: withUsers });
  }

  /* ====== 接受好友请求 ====== */
  if (req.method === 'POST' && url === '/api/friend-request/accept') {
    const body = await readBody(req);
    const { username, requestId } = body;
    const result = acceptFriendRequest(username, requestId);
    return send(res, 200, result);
  }

  /* ====== 拒绝好友请求 ====== */
  if (req.method === 'POST' && url === '/api/friend-request/reject') {
    const body = await readBody(req);
    const { username, requestId } = body;
    const result = rejectFriendRequest(username, requestId);
    return send(res, 200, result);
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

  /* ====== 删除好友 ====== */
  if (req.method === 'POST' && url === '/api/friend/delete') {
    const body = await readBody(req);
    const { from, to } = body;
    if (!from || !to) return send(res, 200, { success: false, msg: '参数错误' });
    removeFriend(from, to);
    return send(res, 200, { success: true });
  }

  /* ====== 获取消息 ====== */
  if (req.method === 'GET' && url.startsWith('/api/messages/')) {
    const parts = url.slice(14).split('/');
    if (parts.length >= 2) {
      const a = decodeURIComponent(parts[0]);
      const b = decodeURIComponent(parts[1]);
      const msgs = getMsgs(a, b);
      return send(res, 200, { success: true, messages: msgs });
    }
    return send(res, 200, { success: true, messages: [] });
  }

  /* ====== 发送消息 ====== */
  if (req.method === 'POST' && url === '/api/messages/send') {
    const body = await readBody(req);
    const { from, to, content } = body;
    if (!from || !to || !content) return send(res, 200, { success: false, msg: '参数错误' });
    if (!getUser(from) || !getUser(to)) return send(res, 200, { success: false, msg: '用户不存在' });
    if (!areFriends(from, to)) return send(res, 200, { success: false, msg: '对方不是你的好友' });
    const msg = addMsg(from, to, content);
    return send(res, 200, { success: true, message: msg });
  }

  /* ====== 发布朋友圈 ====== */
  if (req.method === 'POST' && url === '/api/moments/create') {
    const body = await readBody(req);
    const { username, content, images, hideFrom } = body;
    if (!username) return send(res, 200, { success: false, msg: '参数错误' });
    if (!getUser(username)) return send(res, 200, { success: false, msg: '用户不存在' });
    if (!content && (!images || images.length === 0)) {
      return send(res, 200, { success: false, msg: '内容不能为空' });
    }
    const moment = createMoment(username, content || '', images || [], hideFrom || []);
    return send(res, 200, { success: true, moment });
  }

  /* ====== 获取朋友圈列表 ====== */
  if (req.method === 'GET' && url.startsWith('/api/moments/')) {
    const username = decodeURIComponent(url.slice(13));
    const moments = getMomentsForUser(username);
    const withDetails = await Promise.all(moments.map(async m => {
      const author = getUser(m.author);
      const likes = getMomentLikes(m.id);
      const comments = getMomentComments(m.id);
      const commentWithUsers = comments.map(c => ({
        ...c,
        fromUser: getUser(c.from),
        replyToUser: c.replyTo ? getUser(c.replyTo) : null
      }));
      return { ...m, author, likes, comments: commentWithUsers };
    }));
    return send(res, 200, { success: true, moments: withDetails });
  }

  /* ====== 点赞朋友圈 ====== */
  if (req.method === 'POST' && url === '/api/moments/like') {
    const body = await readBody(req);
    const { momentId, username } = body;
    if (!momentId || !username) return send(res, 200, { success: false, msg: '参数错误' });
    const likes = likeMoment(momentId, username);
    return send(res, 200, { success: true, likes });
  }

  /* ====== 评论朋友圈 ====== */
  if (req.method === 'POST' && url === '/api/moments/comment') {
    const body = await readBody(req);
    const { momentId, username, content, replyTo } = body;
    if (!momentId || !username || !content) return send(res, 200, { success: false, msg: '参数错误' });
    const comment = addMomentComment(momentId, username, content, replyTo);
    return send(res, 200, { success: true, comment });
  }

  /* ====== 删除评论 ====== */
  if (req.method === 'POST' && url === '/api/moments/comment/delete') {
    const body = await readBody(req);
    const { momentId, commentId, username } = body;
    const result = deleteMomentComment(momentId, commentId, username);
    return send(res, 200, result);
  }

  /* ====== 删除朋友圈 ====== */
  if (req.method === 'POST' && url === '/api/moments/delete') {
    const body = await readBody(req);
    const { momentId, username } = body;
    if (!momentId || !username) return send(res, 200, { success: false, msg: '参数错误' });
    const all = getAllMoments();
    const idx = all.findIndex(m => m.id === momentId);
    if (idx === -1) return send(res, 200, { success: false, msg: '动态不存在' });
    if (all[idx].author !== username) return send(res, 200, { success: false, msg: '无权限删除' });
    all.splice(idx, 1);
    saveAllMoments(all);
    return send(res, 200, { success: true });
  }

  /* ====== 调试端点 ====== */
  if (req.method === 'GET' && url === '/api/debug') {
    let msgFiles = [];
    if (DATA_DIR && MSG_DIR) {
      try { msgFiles = fs.readdirSync(MSG_DIR).filter(f => f.endsWith('.json')); } catch (e) {}
    }
    return send(res, 200, {
      version: '3.0',
      dataDir: DATA_DIR,
      users: getAllUsers().map(u => u.username),
      msgFiles,
      momentCount: getAllMoments().length
    });
  }

  /* ====== Admin: 获取所有用户数据 ====== */
  if (req.method === 'GET' && url === '/api/admin/users') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const username = q.get('username') || '';
    if (username !== 'admin') return send(res, 200, { success: false, msg: '无权限' });
    const users = getAllUsers().map(u => ({
      username: u.username,
      password: u.password,
      nickname: u.nickname,
      email: u.email || '',
      avatar: u.avatar,
      bio: u.bio || '',
      createdAt: u.createdAt
    }));
    return send(res, 200, { success: true, users });
  }

  /* ====== Admin: 清空所有数据 ====== */
  if (req.method === 'POST' && url === '/api/admin/clear-all') {
    const body = await readBody(req);
    const { username } = body;
    if (username !== 'admin') return send(res, 200, { success: false, msg: '无权限' });

    // 清空内存
    memUsers = {};
    memFriends = {};
    memMsgs = {};
    memRequests = { incoming: {}, outgoing: {} };
    memMoments = [];
    memMomentLikes = {};
    memMomentComments = {};

    // 清空文件
    if (DATA_DIR) {
      try {
        fs.rmSync(DATA_DIR, { recursive: true });
        fs.mkdirSync(USERS_DIR, { recursive: true });
        fs.mkdirSync(FRIENDS_DIR, { recursive: true });
        fs.mkdirSync(MSG_DIR, { recursive: true });
        fs.mkdirSync(REQ_DIR, { recursive: true });
        fs.mkdirSync(MOMENTS_DIR, { recursive: true });
        fs.mkdirSync(MOMENT_LIKES_DIR, { recursive: true });
        fs.mkdirSync(MOMENT_COMMENTS_DIR, { recursive: true });
      } catch (e) {}
    }

    return send(res, 200, { success: true, msg: '所有数据已清空' });
  }

  /* ====== 静态文件服务 ====== */
  if (req.method === 'GET') {
    let filePath = url === '/' ? '/index.html' : url;
    const fullPath = path.join(__dirname, 'public', filePath);
    
    const publicDir = path.join(__dirname, 'public');
    if (fullPath.startsWith(publicDir) && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const ext = path.extname(fullPath).toLowerCase();
      const contentTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';
      const content = fs.readFileSync(fullPath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(content)
      });
      res.end(content);
      return;
    }
  }

  send(res, 404, { error: 'Not found', url });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('[INFO] 无聊聊天服务 v3.0');
  console.log('[INFO] 端口:', PORT);
  console.log('[INFO] 数据目录:', DATA_DIR || '仅内存');
  console.log('[INFO] 用户数:', getAllUsers().length);
  console.log('[INFO] 朋友圈数:', getAllMoments().length);
  console.log('========================================');
});