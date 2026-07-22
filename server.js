const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

/* ============ Supabase 配置 ============ */
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
function supabaseEnabled() {
  return SUPABASE_URL && SUPABASE_KEY;
}

function supabaseRequest(path, method = 'GET', body = null, query = null) {
  return new Promise((resolve, reject) => {
    let baseUrl = SUPABASE_URL;
    if (baseUrl.endsWith('/rest/v1')) baseUrl = baseUrl.slice(0, -9);
    if (baseUrl.endsWith('/rest/v1/')) baseUrl = baseUrl.slice(0, -10);
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    const url = new URL(baseUrl + 'rest/v1' + path);
    if (query) {
      Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const isHttps = url.protocol === 'https:';
    const proxyUrl = isHttps ? process.env.https_proxy || process.env.HTTPS_PROXY : process.env.http_proxy || process.env.HTTP_PROXY;
    
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json'
    };
    if (method === 'POST' || method === 'PATCH') {
      headers['Prefer'] = 'resolution=merge-duplicates,return=minimal';
    }

    if (proxyUrl) {
      const proxy = new URL(proxyUrl);
      const proxyMod = proxy.protocol === 'https:' ? https : http;
      const connectOpts = {
        method: 'CONNECT',
        hostname: proxy.hostname,
        port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
        path: `${url.hostname}:${url.port || (isHttps ? 443 : 80)}`,
        headers: {}
      };

      const connectReq = proxyMod.request(connectOpts);
      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          reject(new Error(`Proxy connect failed: ${res.statusCode}`));
          return;
        }

        const tunnelMod = isHttps ? https : http;
        const tunnelOpts = {
          method,
          headers,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          socket
        };

        const tunnelReq = tunnelMod.request(tunnelOpts, (tunnelRes) => {
          let data = '';
          tunnelRes.on('data', chunk => data += chunk);
          tunnelRes.on('end', () => {
            if (tunnelRes.statusCode >= 200 && tunnelRes.statusCode < 300) {
              try { resolve(data ? JSON.parse(data) : null); } catch (e) { resolve(data); }
            } else {
              reject(new Error(`Supabase ${tunnelRes.statusCode}: ${data}`));
            }
          });
        });
        tunnelReq.on('error', reject);
        if (body) tunnelReq.write(JSON.stringify(body));
        tunnelReq.end();
      });
      connectReq.on('error', reject);
      connectReq.end();
    } else {
      const mod = isHttps ? https : http;
      const opts = { method, headers, hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), path: url.pathname + url.search };
      const req = mod.request(opts, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(data ? JSON.parse(data) : null); } catch (e) { resolve(data); }
          } else {
            reject(new Error(`Supabase ${res.statusCode}: ${data}`));
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    }
  });
}

async function supabaseUpsert(id, type, data) {
  if (!supabaseEnabled()) return;
  await supabaseRequest('/wuliao_data', 'POST', {
    id: type + '__' + id,
    type,
    data,
    updated_at: Date.now()
  });
}

async function supabaseSelect(type) {
  if (!supabaseEnabled()) return [];
  return await supabaseRequest('/wuliao_data', 'GET', null, { type: `eq.${type}` });
}

async function supabaseDeleteById(id, type) {
  if (!supabaseEnabled()) return;
  await supabaseRequest('/wuliao_data', 'DELETE', null, { id: `eq.${type + '__' + id}` });
}

async function supabaseDeleteByType(type) {
  if (!supabaseEnabled()) return;
  await supabaseRequest('/wuliao_data', 'DELETE', null, { type: `eq.${type}` });
}

async function loadFromSupabase() {
  if (!supabaseEnabled()) return;
  console.log('[INFO] Loading data from Supabase...');
  const typeMap = {
    'users': (id, data) => { memUsers[id] = data; },
    'friends': (id, data) => { memFriends[id] = data; },
    'messages': (id, data) => { memMsgs[id] = data; },
    'incoming_requests': (id, data) => { memRequests.incoming[id] = data; },
    'outgoing_requests': (id, data) => { memRequests.outgoing[id] = data; },
    'moments': (id, data) => { memMoments = data; },
    'moment_likes': (id, data) => { memMomentLikes[id] = data; },
    'moment_comments': (id, data) => { memMomentComments[id] = data; }
  };

  for (const type of Object.keys(typeMap)) {
    try {
      const rows = await supabaseSelect(type);
      /* 新格式优先：先加载旧格式，再用新格式覆盖 */
      const oldFmt = [];
      const newFmt = [];
      for (const row of rows) {
        if (row.id.startsWith(type + '__')) {
          newFmt.push(row);
        } else {
          oldFmt.push(row);
        }
      }
      for (const row of oldFmt) {
        typeMap[type](row.id, row.data);
      }
      for (const row of newFmt) {
        const originalId = row.id.slice(type.length + 2);
        typeMap[type](originalId, row.data);
      }
      console.log(`[INFO] Loaded ${rows.length} ${type} from Supabase (new: ${newFmt.length}, old: ${oldFmt.length})`);
    } catch (e) {
      console.error(`[ERROR] Failed to load ${type} from Supabase:`, e.message);
    }
  }

  syncAllToFiles();
  console.log('[INFO] Supabase data synced to local files');
}

function syncAllToFiles() {
  if (!DATA_DIR) return;
  try {
    Object.values(memUsers).forEach(u => writeJSON(userFile(u.username), u));
    Object.entries(memFriends).forEach(([k, v]) => writeJSON(friendsFile(k), v));
    Object.entries(memMsgs).forEach(([k, v]) => writeJSON(msgFileByKey(k), v));
    Object.entries(memRequests.incoming).forEach(([k, v]) => writeJSON(incomingReqFile(k), v));
    Object.entries(memRequests.outgoing).forEach(([k, v]) => writeJSON(outgoingReqFile(k), v));
    writeJSON(momentsFile(), memMoments);
    Object.entries(memMomentLikes).forEach(([k, v]) => writeJSON(momentLikesFile(k), v));
    Object.entries(memMomentComments).forEach(([k, v]) => writeJSON(momentCommentsFile(k), v));
  } catch (e) {
    console.error('[ERROR] syncAllToFiles failed:', e.message);
  }
}

/* ============ 数据存储 ============ */
const DATA_DIR = (() => {
  const dirs = [path.join(__dirname, 'data'), '/tmp/wuliao-data'];
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
const AVATAR_DIR = DATA_DIR ? path.join(DATA_DIR, 'avatars') : null;

if (DATA_DIR) {
  [USERS_DIR, FRIENDS_DIR, MSG_DIR, REQ_DIR, MOMENTS_DIR, MOMENT_LIKES_DIR, MOMENT_COMMENTS_DIR, AVATAR_DIR].forEach(d => {
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
function msgFileByKey(key) { return path.join(MSG_DIR, key + '.json'); }
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
  if (supabaseEnabled()) supabaseUpsert(user.username, 'users', user).catch(e => console.error('[Supabase] saveUser failed:', e.message));
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
  if (supabaseEnabled()) supabaseUpsert(username, 'friends', list).catch(e => console.error('[Supabase] saveFriends failed:', e.message));
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
  if (supabaseEnabled()) supabaseUpsert(username, 'incoming_requests', list).catch(e => console.error('[Supabase] saveIncomingRequests failed:', e.message));
}

function saveOutgoingRequests(username, list) {
  memRequests.outgoing[username] = list;
  if (DATA_DIR) writeJSON(outgoingReqFile(username), list);
  if (supabaseEnabled()) supabaseUpsert(username, 'outgoing_requests', list).catch(e => console.error('[Supabase] saveOutgoingRequests failed:', e.message));
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

  if (supabaseEnabled()) supabaseUpsert(key, 'messages', memMsgs[key]).catch(e => console.error('[Supabase] addMsg failed:', e.message));

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
  if (supabaseEnabled()) supabaseUpsert('all', 'moments', list).catch(e => console.error('[Supabase] saveAllMoments failed:', e.message));
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
  if (supabaseEnabled()) supabaseUpsert(momentId, 'moment_likes', list).catch(e => console.error('[Supabase] saveMomentLikes failed:', e.message));
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
  if (supabaseEnabled()) supabaseUpsert(momentId, 'moment_comments', list).catch(e => console.error('[Supabase] saveMomentComments failed:', e.message));
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

async function testSupabaseConnection() {
  if (!supabaseEnabled()) return false;
  try {
    await supabaseRequest('/wuliao_data', 'GET', null, { type: 'eq.users', limit: 1 });
    console.log('[INFO] Supabase connection OK');
    return true;
  } catch (e) {
    console.error('[ERROR] Supabase connection failed:', e.message);
    return false;
  }
}

async function initDefaultData() {
  const sbOk = await testSupabaseConnection();
  
  memUsers = {};
  memFriends = {};
  memMsgs = {};
  memRequests = { incoming: {}, outgoing: {} };
  memMoments = [];
  memMomentLikes = {};
  memMomentComments = {};

  let sbLoaded = false;
  if (supabaseEnabled()) {
    try {
      await loadFromSupabase();
      sbLoaded = true;
      console.log('[INFO] Data loaded from Supabase');
    } catch (e) {
      console.error('[WARN] Failed to load from Supabase:', e.message);
    }
  }

  const sbUsers = getAllUsers();
  if (sbLoaded && sbUsers.length > 0) {
    console.log('[INFO] Users from Supabase:', sbUsers.length);
    syncAllToFiles();
    return;
  }

  /* Supabase为空或加载失败时，尝试从本地文件加载 */
  if (DATA_DIR) {
    try {
      const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
      if (files.length > 0) {
        console.log('[INFO] Found', files.length, 'local users, loading...');
        files.forEach(f => {
          const u = readJSON(path.join(USERS_DIR, f), null);
          if (u) {
            memUsers[u.username] = u;
            if (supabaseEnabled()) supabaseUpsert(u.username, 'users', u).catch(() => {});
          }
        });
        
        const friendFiles = fs.readdirSync(FRIENDS_DIR).filter(f => f.endsWith('.json'));
        friendFiles.forEach(f => {
          const username = f.replace('.json', '');
          const list = readJSON(path.join(FRIENDS_DIR, f), []);
          memFriends[username] = list;
          if (supabaseEnabled()) supabaseUpsert(username, 'friends', list).catch(() => {});
        });

        const msgFiles = fs.readdirSync(MSG_DIR).filter(f => f.endsWith('.json'));
        msgFiles.forEach(f => {
          const key = f.replace('.json', '');
          const list = readJSON(path.join(MSG_DIR, f), []);
          memMsgs[key] = list;
          if (supabaseEnabled()) supabaseUpsert(key, 'messages', list).catch(() => {});
        });

        console.log('[INFO] Local data loaded');
        return;
      }
    } catch (e) {
      console.error('[WARN] Failed to load from local files:', e.message);
    }
  }

  if (!supabaseEnabled()) {
    console.log('[INFO] Supabase not enabled, initializing default users');
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
  } else {
    console.log('[INFO] Supabase enabled but no data found, starting with empty state');
  }
}

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
      version: '3.1',
      dataDir: DATA_DIR,
      userCount: getAllUsers().length,
      momentCount: getAllMoments().length,
      supabaseEnabled: supabaseEnabled() ? true : false,
      supabaseUrl: SUPABASE_URL ? 'configured' : 'not set',
      supabaseKey: SUPABASE_KEY ? 'configured' : 'not set'
    });
  }

  /* ====== 注册 ====== */
  if (req.method === 'POST' && url === '/api/register') {
    const body = await readBody(req);
    const { username, password, nickname, avatar, email } = body;
    if (!username || !password || !nickname || !email) return send(res, 200, { success: false, msg: '请填写完整信息' });
    if (username.length < 3) return send(res, 200, { success: false, msg: '无聊号至少3个字符' });
    if (password.length < 4) return send(res, 200, { success: false, msg: '密码至少4位' });
    if (getUser(username)) return send(res, 200, { success: false, msg: '该无聊号已被注册' });
    const allUsers = getAllUsers();
    if (allUsers.find(u => u.email === email)) return send(res, 200, { success: false, msg: '该邮箱已被注册' });
    const user = { username, password, nickname, avatar: avatar || 1, bio: '', email, createdAt: Date.now() };
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
      version: '3.1',
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

  /* ====== Admin: 清空所有朋友圈 ====== */
  if (req.method === 'POST' && url === '/api/admin/clear-moments') {
    const body = await readBody(req);
    const { username } = body;
    if (username !== 'admin') return send(res, 200, { success: false, msg: '无权限' });
    memMoments = {};
    saveAllMoments([]);
    return send(res, 200, { success: true });
  }

  /* ====== 更新个人资料 ====== */
  if (req.method === 'POST' && url === '/api/profile/update') {
    const body = await readBody(req);
    const { username, nickname } = body;
    if (!username || !nickname) return send(res, 200, { success: false, msg: '参数错误' });
    
    const user = memUsers[username];
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    
    user.nickname = nickname;
    saveUser(username);
    return send(res, 200, { success: true });
  }

  /* ====== 头像上传 ====== */
  if (req.method === 'POST' && url === '/api/avatar/upload') {
    const body = await readBody(req);
    const { username, image } = body;
    if (!username || !image) return send(res, 200, { success: false, msg: '参数错误' });
    
    const user = getUser(username);
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    
    try {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      const maxSize = 500 * 1024;
      let compressedBuffer = buffer;
      let quality = 0.8;
      
      while (compressedBuffer.length > maxSize && quality > 0.1) {
        compressedBuffer = await sharp(compressedBuffer)
          .resize(512, 512, { fit: 'inside' })
          .jpeg({ quality: Math.round(quality * 100) })
          .toBuffer();
        quality -= 0.1;
      }
      
      const avatarFileName = `${username}.jpg`;
      const avatarPath = path.join(AVATAR_DIR, avatarFileName);
      fs.writeFileSync(avatarPath, compressedBuffer);
      
      const compressedBase64 = 'data:image/jpeg;base64,' + compressedBuffer.toString('base64');
      user.customAvatar = avatarFileName;
      user.avatarData = compressedBase64;
      saveUser(user);
      
      return send(res, 200, {
        success: true,
        size: compressedBuffer.length,
        originalSize: buffer.length,
        avatarData: compressedBase64
      });
    } catch (e) {
      console.error('[ERROR] Avatar upload failed:', e.message);
      return send(res, 200, { success: false, msg: '上传失败' });
    }
  }

  /* ====== 百度搜索 ====== */
  if (req.method === 'GET' && url.startsWith('/api/search/baidu')) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const keyword = q.get('q') || '';
    if (!keyword) return send(res, 200, { success: false, msg: '关键词不能为空' });

    try {
      const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(keyword)}`;
      const results = await new Promise((resolve, reject) => {
        const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
        const urlObj = new URL(searchUrl);
        const opts = {
          hostname: urlObj.hostname,
          port: 443,
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
          }
        };

        if (proxyUrl) {
          const proxy = new URL(proxyUrl);
          const proxyMod = proxy.protocol === 'https:' ? https : http;
          const connectOpts = {
            method: 'CONNECT',
            hostname: proxy.hostname,
            port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
            path: `${urlObj.hostname}:443`,
            headers: {}
          };
          const connectReq = proxyMod.request(connectOpts);
          connectReq.on('connect', (res, socket) => {
            if (res.statusCode !== 200) {
              socket.destroy();
              reject(new Error(`Proxy connect failed: ${res.statusCode}`));
              return;
            }
            const tunnelReq = https.request({ ...opts, socket }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => resolve(data));
            });
            tunnelReq.on('error', reject);
            tunnelReq.end();
          });
          connectReq.on('error', reject);
          connectReq.end();
        } else {
          const req2 = https.request(opts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
          });
          req2.on('error', reject);
          req2.end();
        }
      });

      const items = [];
      const resultRegex = /<div class="result[^"]*"[^>]*>[\s\S]*?<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>[\s\S]*?(?:<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>)?/g;
      let match;
      while ((match = resultRegex.exec(results)) !== null && items.length < 10) {
        const title = match[2].replace(/<[^>]+>/g, '').trim();
        const link = match[1];
        const abstract = match[3] ? match[3].replace(/<[^>]+>/g, '').trim() : '';
        if (title) {
          items.push({ title, link, abstract });
        }
      }

      if (items.length === 0) {
        const mobileRegex = /<div class="c-result[^"]*"[^>]*>[\s\S]*?<header[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/header>[\s\S]*?(?:<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>)?/g;
        while ((match = mobileRegex.exec(results)) !== null && items.length < 10) {
          const title = match[2].replace(/<[^>]+>/g, '').trim();
          const link = match[1];
          const abstract = match[3] ? match[3].replace(/<[^>]+>/g, '').trim() : '';
          if (title) {
            items.push({ title, link, abstract });
          }
        }
      }

      return send(res, 200, { success: true, items, keyword });
    } catch (e) {
      console.error('[ERROR] Baidu search failed:', e.message);
      return send(res, 200, {
        success: true,
        items: [
          { title: `${keyword} - 百度搜索`, link: `https://www.baidu.com/s?wd=${encodeURIComponent(keyword)}`, abstract: '点击跳转到百度搜索查看完整结果' }
        ],
        keyword
      });
    }
  }

  /* ====== 获取头像 ====== */
  if (req.method === 'GET' && url.startsWith('/api/avatar/')) {
    const filename = url.slice(13);
    const avatarPath = path.join(AVATAR_DIR, filename);
    if (AVATAR_DIR && fs.existsSync(avatarPath)) {
      const content = fs.readFileSync(avatarPath);
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': Buffer.byteLength(content),
        'Cache-Control': 'public, max-age=86400'
      });
      res.end(content);
      return;
    }
    return send(res, 404, { error: 'Avatar not found' });
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
initDefaultData().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('[INFO] 无聊聊天服务 v3.0');
    console.log('[INFO] 端口:', PORT);
    console.log('[INFO] 数据目录:', DATA_DIR || '仅内存');
    console.log('[INFO] Supabase:', supabaseEnabled() ? '已启用' : '未启用');
    console.log('[INFO] 用户数:', getAllUsers().length);
    console.log('[INFO] 朋友圈数:', getAllMoments().length);
    console.log('========================================');
  });
});