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
    'moment_comments': (id, data) => { memMomentComments[id] = data; },
    'groups': (id, data) => { memGroups[id] = data; },
    'group_messages': (id, data) => { memGroupMessages[id] = data; },
    'oa_articles': (id, data) => { memOAArticles = data; },
    'oa_comments': (id, data) => { memOAComments[id] = data; }
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
    Object.values(memGroups).forEach(g => writeJSON(groupFile(g.id), g));
    Object.entries(memGroupMessages).forEach(([k, v]) => writeJSON(groupMsgFile(k), v));
    writeJSON(oaArticlesFile(), memOAArticles);
    Object.entries(memOAComments).forEach(([k, v]) => writeJSON(oaCommentsFile(k), v));
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
const OA_ARTICLES_DIR = DATA_DIR ? path.join(DATA_DIR, 'oa-articles') : null;
const OA_COMMENTS_DIR = DATA_DIR ? path.join(DATA_DIR, 'oa-comments') : null;

if (DATA_DIR) {
  [USERS_DIR, FRIENDS_DIR, MSG_DIR, REQ_DIR, MOMENTS_DIR, MOMENT_LIKES_DIR, MOMENT_COMMENTS_DIR, AVATAR_DIR, groupsDir(), OA_ARTICLES_DIR, OA_COMMENTS_DIR].forEach(d => {
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
let memFeatureFlags = { scanEnabled: true };
let memReadMarkers = {};
let memGroups = {};
let memGroupMessages = {};
let memOAArticles = [];
let memOAComments = {};

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
function readMarkersFile(username) { return path.join(MSG_DIR, 'read_' + username + '.json'); }
function groupsDir() { return DATA_DIR ? path.join(DATA_DIR, 'groups') : null; }
function groupFile(groupId) { return path.join(groupsDir(), groupId + '.json'); }
function groupMsgFile(groupId) { return path.join(groupsDir(), groupId + '_msgs.json'); }
function oaArticlesFile() { return path.join(OA_ARTICLES_DIR, 'all.json'); }
function oaCommentsFile(articleId) { return path.join(OA_COMMENTS_DIR, articleId + '.json'); }

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

/* ============ 已读标记 ============ */
function getReadMarkers(username) {
  if (DATA_DIR) {
    const m = readJSON(readMarkersFile(username), null);
    if (m) return m;
  }
  return memReadMarkers[username] || {};
}

function saveReadMarkers(username, markers) {
  memReadMarkers[username] = markers;
  if (DATA_DIR) writeJSON(readMarkersFile(username), markers);
}

function markConversationRead(username, withUser) {
  const markers = getReadMarkers(username);
  const msgs = getMsgs(username, withUser);
  const lastMsg = msgs[msgs.length - 1];
  markers[withUser] = lastMsg ? lastMsg.time : Date.now();
  saveReadMarkers(username, markers);
  return markers[withUser];
}

function countUnread(username, withUser) {
  const markers = getReadMarkers(username);
  let lastRead = markers[withUser];
  const msgs = getMsgs(username, withUser);
  
  if (lastRead === undefined) {
    if (msgs.length > 0) {
      const lastMsg = msgs[msgs.length - 1];
      markers[withUser] = lastMsg.time;
      saveReadMarkers(username, markers);
      lastRead = lastMsg.time;
    } else {
      lastRead = Date.now();
      markers[withUser] = lastRead;
      saveReadMarkers(username, markers);
    }
  }
  
  let count = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].time > lastRead && msgs[i].from === withUser) count++;
    else if (msgs[i].time <= lastRead) break;
  }
  return count;
}

function getTotalUnread(username) {
  const friends = getFriends(username);
  const contacts = [...friends];
  if (!contacts.includes('admin')) contacts.push('admin');
  let total = 0;
  contacts.forEach(f => {
    total += countUnread(username, f);
  });
  return total;
}

/* ============ 群聊 ============ */
function getGroup(groupId) {
  if (DATA_DIR) {
    const g = readJSON(groupFile(groupId), null);
    if (g) return g;
  }
  return memGroups[groupId] || null;
}

function saveGroup(group) {
  memGroups[group.id] = group;
  if (DATA_DIR) writeJSON(groupFile(group.id), group);
  if (supabaseEnabled()) supabaseUpsert(group.id, 'groups', group).catch(e => console.error('[Supabase] saveGroup failed:', e.message));
  return true;
}

function getGroupMessages(groupId) {
  if (DATA_DIR) {
    const m = readJSON(groupMsgFile(groupId), null);
    if (m) return m;
  }
  return memGroupMessages[groupId] || [];
}

function saveGroupMessages(groupId, messages) {
  memGroupMessages[groupId] = messages;
  if (DATA_DIR) writeJSON(groupMsgFile(groupId), messages);
  if (supabaseEnabled()) supabaseUpsert(groupId, 'group_messages', messages).catch(e => console.error('[Supabase] saveGroupMessages failed:', e.message));
  return true;
}

function createGroup(creator, members, name) {
  const groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const allMembers = [...new Set([creator, ...members])];
  const group = {
    id: groupId,
    name: name || `${getUser(creator)?.nickname}的群聊`,
    creator,
    members: allMembers,
    createdAt: Date.now()
  };
  saveGroup(group);
  saveGroupMessages(groupId, []);
  return group;
}

function addGroupMember(groupId, username) {
  const group = getGroup(groupId);
  if (!group) return { success: false, msg: '群不存在' };
  if (!group.members) group.members = [];
  if (group.members.includes(username)) return { success: false, msg: '已在群内' };
  group.members.push(username);
  memGroups[groupId] = group;
  saveGroup(group);
  return { success: true };
}

function removeGroupMember(groupId, username) {
  const group = getGroup(groupId);
  if (!group) return { success: false, msg: '群不存在' };
  if (!group.members) group.members = [];
  group.members = group.members.filter(m => m !== username);
  memGroups[groupId] = group;
  saveGroup(group);
  return { success: true };
}

function sendGroupMessage(groupId, from, content) {
  const group = getGroup(groupId);
  if (!group) return { success: false, msg: '群不存在' };
  if (!group.members.includes(from)) return { success: false, msg: '不是群成员' };
  
  const msg = {
    id: 'gm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    groupId,
    from,
    content,
    time: Date.now()
  };
  
  const msgs = getGroupMessages(groupId);
  msgs.push(msg);
  saveGroupMessages(groupId, msgs);
  
  return { success: true, message: msg };
}

function getUserGroups(username) {
  const result = [];
  Object.values(memGroups).forEach(g => {
    if (g.members.includes(username)) {
      result.push(g);
    }
  });
  return result;
}

/* ============ 公众号 ============ */
function getOAArticles() {
  if (DATA_DIR) {
    const a = readJSON(oaArticlesFile(), null);
    if (a) return a;
  }
  return memOAArticles;
}

function saveOAArticles(list) {
  memOAArticles = list;
  if (DATA_DIR) writeJSON(oaArticlesFile(), list);
  if (supabaseEnabled()) supabaseUpsert('all', 'oa_articles', list).catch(e => console.error('[Supabase] saveOAArticles failed:', e.message));
  return true;
}

function createOAArticle(username, title, excerpt, content) {
  const article = {
    id: 'oa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    author: username,
    title: title || '',
    excerpt: excerpt || '',
    content: content || '',
    time: Date.now()
  };
  const list = getOAArticles();
  list.unshift(article);
  saveOAArticles(list);
  saveOAComments(article.id, []);
  return article;
}

function getOAComments(articleId) {
  if (DATA_DIR) {
    const c = readJSON(oaCommentsFile(articleId), null);
    if (c) return c;
  }
  return memOAComments[articleId] || [];
}

function saveOAComments(articleId, list) {
  memOAComments[articleId] = list;
  if (DATA_DIR) writeJSON(oaCommentsFile(articleId), list);
  if (supabaseEnabled()) supabaseUpsert(articleId, 'oa_comments', list).catch(e => console.error('[Supabase] saveOAComments failed:', e.message));
  return true;
}

function addOAComment(articleId, username, content) {
  const article = getOAArticles().find(a => a.id === articleId);
  if (!article) return { success: false, msg: '文章不存在' };
  const comments = getOAComments(articleId);
  const user = getUser(username);
  comments.push({
    id: 'oac_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    articleId,
    from: username,
    fromUser: user ? { username: user.username, nickname: user.nickname, avatar: user.avatar, customAvatar: user.customAvatar, avatarData: user.avatarData } : null,
    content,
    createdAt: Date.now()
  });
  saveOAComments(articleId, comments);
  return { success: true, comments };
}

function initDefaultOAArticles() {
  const existing = getOAArticles();
  if (existing.length === 0) {
    const defaults = [
      { id: 'oa_default_1', author: 'admin', title: '欢迎关注无聊官方公众号', excerpt: '无聊是一款简洁的即时通讯应用，支持加好友、聊天等功能。在这里你可以查看最新公告和使用指南。', content: '无聊是一款简洁的即时通讯应用，支持加好友、聊天等功能。在这里你可以查看最新公告和使用指南。', time: Date.now() - 86400000 },
      { id: 'oa_default_2', author: 'admin', title: '如何添加好友？', excerpt: '点击通讯录 → 添加朋友 → 输入对方的无聊号即可添加好友。添加成功后，好友会出现在通讯录和聊天列表中，点击即可开始聊天。', content: '点击通讯录 → 添加朋友 → 输入对方的无聊号即可添加好友。添加成功后，好友会出现在通讯录和聊天列表中，点击即可开始聊天。', time: Date.now() - 172800000 },
      { id: 'oa_default_3', author: 'admin', title: '无聊使用小贴士', excerpt: '1. 在"我"页面可以设置个性签名\n2. 聊天列表按最近消息时间排序\n3. 支持多设备同时登录\n4. 消息实时同步，不用担心遗漏', content: '1. 在"我"页面可以设置个性签名\n2. 聊天列表按最近消息时间排序\n3. 支持多设备同时登录\n4. 消息实时同步，不用担心遗漏', time: Date.now() - 259200000 }
    ];
    saveOAArticles(defaults);
    defaults.forEach(a => saveOAComments(a.id, []));
  }
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
  memOAArticles = [];
  memOAComments = {};

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
        initDefaultOAArticles();
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
    initDefaultOAArticles();
    console.log('[INFO] Default data initialized');
  } else {
    console.log('[INFO] Supabase enabled but no data found, starting with empty state');
    initDefaultOAArticles();
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
    const status = {
      ok: true,
      service: 'wuliao-chat',
      version: '3.1',
      timestamp: Date.now(),
      server: {
        status: 'online',
        port: PORT,
        dataDir: DATA_DIR || '仅内存',
        userCount: getAllUsers().length,
        momentCount: getAllMoments().length,
        groupCount: Object.keys(memGroups).length
      },
      supabase: {
        enabled: supabaseEnabled(),
        url: SUPABASE_URL ? 'configured' : 'not set',
        key: SUPABASE_KEY ? 'configured' : 'not set',
        connected: false,
        latency: null,
        error: null
      }
    };
    if (supabaseEnabled()) {
      const startTime = Date.now();
      try {
        await supabaseRequest('/wuliao_data', 'GET', null, { limit: 1 });
        status.supabase.connected = true;
        status.supabase.latency = Date.now() - startTime;
      } catch (e) {
        status.supabase.connected = false;
        status.supabase.error = e.message;
      }
    }
    return send(res, 200, status);
  }

  /* ====== 歌单配置 ====== */
  if (req.method === 'GET' && url === '/api/playlists') {
    const playlists = [
      { id: 'mahanda', name: '马汉达歌单', coverColor: '#e74c3c', icon: 'fa-fire', songs: [] },
      { id: 'yuanhaochen', name: '袁浩宸歌单', coverColor: '#3498db', icon: 'fa-bolt', songs: [] },
      { id: 'liuyuduo', name: '刘煜铎歌单', coverColor: '#9b59b6', icon: 'fa-star', songs: [] },
    ];
    if (DATA_DIR) {
      const playlistFile = path.join(DATA_DIR, 'playlists.json');
      if (fs.existsSync(playlistFile)) {
        try {
          const saved = JSON.parse(fs.readFileSync(playlistFile, 'utf8'));
          if (saved.playlists && Array.isArray(saved.playlists)) {
            saved.playlists.forEach(p => {
              const existing = playlists.find(x => x.id === p.id);
              if (existing) Object.assign(existing, p);
              else playlists.push(p);
            });
          }
        } catch (e) {}
      }
    }
    return send(res, 200, { success: true, playlists });
  }

  if (req.method === 'POST' && url === '/api/playlists') {
    if (!DATA_DIR) return send(res, 200, { success: false, msg: '数据目录不可用' });
    const body = await readBody(req);
    const playlistFile = path.join(DATA_DIR, 'playlists.json');
    try {
      fs.writeFileSync(playlistFile, JSON.stringify({ playlists: body.playlists || [], updatedAt: Date.now() }, null, 2));
      return send(res, 200, { success: true });
    } catch (e) {
      return send(res, 200, { success: false, msg: e.message });
    }
  }

  /* ====== 音频代理 ====== */
  if (req.method === 'GET' && url.startsWith('/api/audio/proxy/')) {
    const encodedUrl = url.slice('/api/audio/proxy/'.length);
    let targetUrl;
    try {
      targetUrl = decodeURIComponent(encodedUrl);
    } catch (e) {
      return send(res, 400, { error: 'Invalid URL' });
    }

    const isHttps = targetUrl.startsWith('https://');
    const mod = isHttps ? https : http;
    const target = new URL(targetUrl);

    const opts = {
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      timeout: 60000
    };

    let headersSent = false;

    const proxyReq = mod.get(opts, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        if (!headersSent) {
          headersSent = true;
          send(res, proxyRes.statusCode, { error: 'Audio server error' });
        }
        return;
      }

      headersSent = true;
      res.writeHead(200, {
        'Content-Type': proxyRes.headers['content-type'] || 'audio/mpeg',
        'Content-Length': proxyRes.headers['content-length'],
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      });

      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      console.error('[ERROR] Audio proxy error:', e.message);
      if (!headersSent) {
        headersSent = true;
        send(res, 500, { error: 'Audio proxy error: ' + e.message });
      }
    });

    proxyReq.setTimeout(60000, () => {
      proxyReq.destroy();
      if (!headersSent) {
        headersSent = true;
        send(res, 504, { error: 'Audio proxy timeout' });
      }
    });

    return;
  }

  /* ====== 注册 ====== */
  if (req.method === 'POST' && url === '/api/register') {
    const body = await readBody(req);
    const { username, password, nickname, avatar, email } = body;
    if (!username || !password || !nickname) return send(res, 200, { success: false, msg: '请填写完整信息' });
    if (getUser(username)) return send(res, 200, { success: false, msg: '该无聊号已被注册' });
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
    let { username, password } = body;
    username = (username || '').trim();
    if (!username || !password) return send(res, 200, { success: false, msg: '请输入无聊号和密码' });
    let user = getUser(username);
    if (!user) {
      const allUsers = getAllUsers();
      user = allUsers.find(u => u.email === username);
    }
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    if (user.password !== password) return send(res, 200, { success: false, msg: '密码错误' });
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

  /* ====== 创建群聊 ====== */
  if (req.method === 'POST' && url === '/api/groups/create') {
    const body = await readBody(req);
    const { username, members, name } = body;
    if (!username || !members || !Array.isArray(members)) return send(res, 200, { success: false, msg: '参数错误' });
    if (members.length === 0) return send(res, 200, { success: false, msg: '至少添加一位好友' });
    for (const m of members) {
      if (!getUser(m) || !areFriends(username, m)) return send(res, 200, { success: false, msg: `${m}不是你的好友` });
    }
    const group = createGroup(username, members, name);
    return send(res, 200, { success: true, group });
  }

  /* ====== 获取用户群列表 ====== */
  if (req.method === 'GET' && url.startsWith('/api/groups/user/')) {
    const username = decodeURIComponent(url.slice(17));
    const groups = getUserGroups(username);
    return send(res, 200, { success: true, groups });
  }

  /* ====== 获取群详情 ====== */
  if (req.method === 'GET' && url.startsWith('/api/groups/')) {
    const groupId = decodeURIComponent(url.slice(12));
    const group = getGroup(groupId);
    if (!group) return send(res, 200, { success: false, msg: '群不存在' });
    return send(res, 200, { success: true, group });
  }

  /* ====== 获取群消息 ====== */
  if (req.method === 'GET' && url.startsWith('/api/group-messages/')) {
    const groupId = decodeURIComponent(url.slice(20));
    const msgs = getGroupMessages(groupId);
    return send(res, 200, { success: true, messages: msgs });
  }

  /* ====== 发送群消息 ====== */
  if (req.method === 'POST' && url === '/api/group-messages/send') {
    const body = await readBody(req);
    const { username, groupId, content } = body;
    if (!username || !groupId || !content) return send(res, 200, { success: false, msg: '参数错误' });
    const result = sendGroupMessage(groupId, username, content);
    return send(res, 200, result);
  }

  /* ====== 添加群成员 ====== */
  if (req.method === 'POST' && url === '/api/groups/add-member') {
    const body = await readBody(req);
    const { username, groupId, member } = body;
    if (!username || !groupId || !member) return send(res, 200, { success: false, msg: '参数错误' });
    const group = getGroup(groupId);
    if (!group) return send(res, 200, { success: false, msg: '群不存在' });
    if (!group.members) group.members = [];
    if (!group.members.includes(username)) return send(res, 200, { success: false, msg: '你不是群成员' });
    if (!getUser(member)) return send(res, 200, { success: false, msg: '用户不存在' });
    if (!areFriends(username, member)) return send(res, 200, { success: false, msg: `${member}不是你的好友，请先添加好友` });
    if (group.members.includes(member)) return send(res, 200, { success: false, msg: '该用户已在群内' });
    const result = addGroupMember(groupId, member);
    return send(res, 200, result);
  }

  /* ====== 解散群聊 ====== */
  if (req.method === 'DELETE' && url === '/api/groups/dissolve') {
    const body = await readBody(req);
    const { username, groupId } = body;
    if (!username || !groupId) return send(res, 200, { success: false, msg: '参数错误' });
    const group = getGroup(groupId);
    if (!group) return send(res, 200, { success: false, msg: '群不存在' });
    if (group.creator !== username) return send(res, 200, { success: false, msg: '只有群主可以解散群聊' });
    
    delete memGroups[groupId];
    delete memGroupMessages[groupId];
    
    if (DATA_DIR) {
      const gFile = groupFile(groupId);
      const gmFile = groupMsgFile(groupId);
      if (fs.existsSync(gFile)) fs.unlinkSync(gFile);
      if (fs.existsSync(gmFile)) fs.unlinkSync(gmFile);
    }
    
    return send(res, 200, { success: true, msg: '群聊已解散' });
  }

  /* ====== 移除群成员（踢人） ====== */
  if (req.method === 'DELETE' && url.startsWith('/api/group-member/')) {
    const parts = url.slice('/api/group-member/'.length).split('/');
    const groupId = decodeURIComponent(parts[0] || '');
    const member = decodeURIComponent(parts[1] || '');
    if (!groupId || !member) return send(res, 200, { success: false, msg: '参数错误' });
    const group = getGroup(groupId);
    if (!group) return send(res, 200, { success: false, msg: '群不存在' });
    if (group.creator !== member) {
      /* 仅群主或本人可操作，这里用 query 传 username */
    }
    const q = new URL(req.url, 'http://localhost').searchParams;
    const operator = q.get('username') || '';
    if (!group.members.includes(operator)) return send(res, 200, { success: false, msg: '你不是群成员' });
    if (operator !== group.creator && operator !== member) return send(res, 200, { success: false, msg: '只有群主或本人可操作' });
    const result = removeGroupMember(groupId, member);
    return send(res, 200, result);
  }

  /* ====== 修改群名称 ====== */
  if (req.method === 'POST' && url === '/api/groups/rename') {
    const body = await readBody(req);
    const { username, groupId, name } = body;
    if (!username || !groupId || !name) return send(res, 200, { success: false, msg: '参数错误' });
    const group = getGroup(groupId);
    if (!group) return send(res, 200, { success: false, msg: '群不存在' });
    if (group.creator !== username) return send(res, 200, { success: false, msg: '只有群主可以修改群名称' });
    group.name = String(name).trim().slice(0, 30);
    saveGroup(group);
    return send(res, 200, { success: true, group });
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

  /* ====== 获取未读消息数 ====== */
  if (req.method === 'GET' && url.startsWith('/api/messages/unread/')) {
    const parts = url.slice(21).split('/');
    if (parts.length >= 1) {
      const username = decodeURIComponent(parts[0]);
      const total = getTotalUnread(username);
      const perConversation = {};
      const friends = getFriends(username);
      const contacts = [...friends];
      if (!contacts.includes('admin')) contacts.push('admin');
      contacts.forEach(f => {
        const c = countUnread(username, f);
        if (c > 0) perConversation[f] = c;
      });
      return send(res, 200, { success: true, total, perConversation });
    }
    return send(res, 200, { success: true, total: 0, perConversation: {} });
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
    if (to !== 'admin' && from !== 'admin' && !areFriends(from, to)) return send(res, 200, { success: false, msg: '对方不是你的好友' });
    const msg = addMsg(from, to, content);
    return send(res, 200, { success: true, message: msg });
  }

  /* ====== 标记消息已读 ====== */
  if (req.method === 'POST' && url === '/api/messages/read') {
    const body = await readBody(req);
    const { username, withUser } = body;
    if (!username || !withUser) return send(res, 200, { success: false, msg: '参数错误' });
    const time = markConversationRead(username, withUser);
    return send(res, 200, { success: true, readTime: time });
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

  /* ====== 公众号：获取文章列表 ====== */
  if (req.method === 'GET' && url === '/api/oa/articles') {
    const articles = getOAArticles();
    return send(res, 200, { success: true, articles });
  }

  /* ====== 公众号：发布文章（仅admin） ====== */
  if (req.method === 'POST' && url === '/api/oa/articles/create') {
    const body = await readBody(req);
    const { username, title, excerpt, content } = body;
    if (!username || !title || !content) return send(res, 200, { success: false, msg: '参数错误' });
    if (username !== 'admin') return send(res, 200, { success: false, msg: '无权限发布' });
    const article = createOAArticle(username, title, excerpt, content);
    return send(res, 200, { success: true, article });
  }

  /* ====== 公众号：获取文章评论 ====== */
  if (req.method === 'GET' && url.startsWith('/api/oa/comments/')) {
    const articleId = decodeURIComponent(url.slice('/api/oa/comments/'.length));
    const comments = getOAComments(articleId);
    return send(res, 200, { success: true, comments });
  }

  /* ====== 公众号：发表评论 ====== */
  if (req.method === 'POST' && url === '/api/oa/comments/create') {
    const body = await readBody(req);
    const { articleId, username, content } = body;
    if (!articleId || !username || !content) return send(res, 200, { success: false, msg: '参数错误' });
    const result = addOAComment(articleId, username, content);
    return send(res, 200, result);
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

  /* ====== Admin: 删除用户账号 ====== */
  if (req.method === 'DELETE' && url.startsWith('/api/admin/users/')) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const adminUsername = q.get('username') || '';
    if (adminUsername !== 'admin') return send(res, 200, { success: false, msg: '无权限' });
    const targetUsername = url.split('/').pop();
    if (targetUsername === 'admin') return send(res, 200, { success: false, msg: '不能删除管理员账号' });
    const user = getUser(targetUsername);
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    
    delete memUsers[targetUsername];
    saveAllUsers(Object.values(memUsers));
    
    delete memFriends[targetUsername];
    delete memIncomingRequests[targetUsername];
    delete memOutgoingRequests[targetUsername];
    
    Object.keys(memFriends).forEach(k => {
      memFriends[k] = memFriends[k].filter(f => f !== targetUsername);
      saveFriends(k, memFriends[k]);
    });
    Object.keys(memIncomingRequests).forEach(k => {
      memIncomingRequests[k] = memIncomingRequests[k].filter(r => r.from !== targetUsername);
      saveIncomingRequests(k, memIncomingRequests[k]);
    });
    Object.keys(memOutgoingRequests).forEach(k => {
      memOutgoingRequests[k] = memOutgoingRequests[k].filter(r => r.to !== targetUsername);
      saveOutgoingRequests(k, memOutgoingRequests[k]);
    });
    
    return send(res, 200, { success: true, msg: `已删除用户 ${targetUsername}` });
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

  /* ====== Admin: 获取功能开关 ====== */
  if (req.method === 'GET' && url === '/api/admin/feature-flags') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const username = q.get('username') || '';
    if (username !== 'admin') return send(res, 200, { success: false, msg: '无权限' });
    return send(res, 200, { success: true, flags: memFeatureFlags });
  }

  /* ====== Admin: 更新功能开关 ====== */
  if (req.method === 'POST' && url === '/api/admin/feature-flags') {
    const body = await readBody(req);
    const { username, flags } = body;
    if (username !== 'admin') return send(res, 200, { success: false, msg: '无权限' });
    memFeatureFlags = { ...memFeatureFlags, ...flags };
    return send(res, 200, { success: true, flags: memFeatureFlags });
  }

  /* ====== 获取功能开关（公开） ====== */
  if (req.method === 'GET' && url === '/api/feature-flags') {
    return send(res, 200, { success: true, flags: memFeatureFlags });
  }

  /* ====== 获取个人设置 ====== */
  if (req.method === 'GET' && url.startsWith('/api/settings/')) {
    const username = decodeURIComponent(url.slice('/api/settings/'.length));
    const user = getUser(username);
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    return send(res, 200, { success: true, settings: { cameraEnabled: user.cameraEnabled !== false } });
  }

  /* ====== 更新个人设置 ====== */
  if (req.method === 'POST' && url === '/api/settings/update') {
    const body = await readBody(req);
    const { username, settings } = body;
    if (!username || !settings) return send(res, 200, { success: false, msg: '参数错误' });
    const user = getUser(username);
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    if (typeof settings.cameraEnabled === 'boolean') user.cameraEnabled = settings.cameraEnabled;
    saveUser(user);
    return send(res, 200, { success: true, settings: { cameraEnabled: user.cameraEnabled !== false } });
  }

  /* ====== 更新个人资料 ====== */
  if (req.method === 'POST' && url === '/api/profile/update') {
    const body = await readBody(req);
    const { username, nickname, bio } = body;
    if (!username) return send(res, 200, { success: false, msg: '参数错误' });
    
    const user = getUser(username);
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    
    if (nickname !== undefined) user.nickname = nickname;
    if (bio !== undefined) user.bio = bio;
    memUsers[username] = user;
    saveUser(user);
    return send(res, 200, { success: true, user });
  }

  /* ====== 修改无聊号（每周一次） ====== */
  if (req.method === 'POST' && url === '/api/profile/change-username') {
    const body = await readBody(req);
    const { oldUsername, newUsername } = body;
    if (!oldUsername || !newUsername) return send(res, 200, { success: false, msg: '参数错误' });
    
    const user = getUser(oldUsername);
    if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
    
    if (oldUsername === newUsername) return send(res, 200, { success: false, msg: '新无聊号与旧无聊号相同' });
    
    if (getUser(newUsername)) return send(res, 200, { success: false, msg: '该无聊号已被使用' });
    
    const lastChange = user.lastUsernameChange || 0;
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    if (lastChange && (now - lastChange) < oneWeek) {
      const remaining = oneWeek - (now - lastChange);
      const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
      const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      return send(res, 200, { success: false, msg: `距离下次修改还剩 ${days}天${hours}小时` });
    }
    
    const oldFile = userFile(oldUsername);
    const newFile = userFile(newUsername);
    user.username = newUsername;
    user.lastUsernameChange = now;
    memUsers[newUsername] = user;
    delete memUsers[oldUsername];
    saveUser(user);
    if (DATA_DIR && fs.existsSync(oldFile)) {
      fs.unlinkSync(oldFile);
    }
    
    const oldFriends = getFriends(oldUsername);
    const oldIncoming = getIncomingRequests(oldUsername);
    const oldOutgoing = getOutgoingRequests(oldUsername);
    const oldRead = getReadMarkers(oldUsername);
    
    saveFriends(newUsername, oldFriends);
    saveIncomingRequests(newUsername, oldIncoming);
    saveOutgoingRequests(newUsername, oldOutgoing);
    saveReadMarkers(newUsername, oldRead);
    
    if (DATA_DIR) {
      const oldF = friendsFile(oldUsername);
      const oldI = incomingReqFile(oldUsername);
      const oldO = outgoingReqFile(oldUsername);
      const oldR = readMarkersFile(oldUsername);
      if (fs.existsSync(oldF)) fs.unlinkSync(oldF);
      if (fs.existsSync(oldI)) fs.unlinkSync(oldI);
      if (fs.existsSync(oldO)) fs.unlinkSync(oldO);
      if (fs.existsSync(oldR)) fs.unlinkSync(oldR);
    }
    
    delete memFriends[oldUsername];
    delete memIncomingRequests[oldUsername];
    delete memOutgoingRequests[oldUsername];
    
    const allUsers = getAllUsers();
    for (const u of allUsers) {
      if (u.username === newUsername) continue;
      
      const uFriends = getFriends(u.username);
      const idx = uFriends.indexOf(oldUsername);
      if (idx > -1) {
        uFriends[idx] = newUsername;
        memFriends[u.username] = uFriends;
        saveFriends(u.username, uFriends);
      }
      
      const uIncoming = getIncomingRequests(u.username);
      uIncoming.forEach(r => { if (r.from === oldUsername) r.from = newUsername; });
      memIncomingRequests[u.username] = uIncoming;
      saveIncomingRequests(u.username, uIncoming);
      
      const uOutgoing = getOutgoingRequests(u.username);
      uOutgoing.forEach(r => { if (r.to === oldUsername) r.to = newUsername; });
      memOutgoingRequests[u.username] = uOutgoing;
      saveOutgoingRequests(u.username, uOutgoing);
    }
    
    const allGroups = Object.values(memGroups);
    for (const g of allGroups) {
      let changed = false;
      if (g.creator === oldUsername) {
        g.creator = newUsername;
        changed = true;
      }
      if (g.members && g.members.includes(oldUsername)) {
        g.members = g.members.map(m => m === oldUsername ? newUsername : m);
        changed = true;
      }
      if (changed) {
        memGroups[g.id] = g;
        saveGroup(g);
      }
    }
    
    return send(res, 200, { success: true, user, msg: '无聊号修改成功' });
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