const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let users = [];
let friendsData = {};
let messagesData = {};

let db = null;

async function connectMongo() {
  if (!process.env.MONGODB_URI) {
    console.warn('[WARN] MONGODB_URI not set, using memory storage');
    return false;
  }
  
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db();
    console.log('[INFO] Connected to MongoDB');
    await initCollections();
    return true;
  } catch (e) {
    console.error('[ERROR] Failed to connect to MongoDB:', e.message);
    return false;
  }
}

async function initCollections() {
  if (!db) return;
  
  const collections = await db.listCollections().toArray();
  const names = collections.map(c => c.name);
  
  if (!names.includes('users')) {
    await db.createCollection('users');
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    console.log('[INFO] Created users collection');
  }
  
  if (!names.includes('friends')) {
    await db.createCollection('friends');
    await db.collection('friends').createIndex({ username: 1 });
    console.log('[INFO] Created friends collection');
  }
  
  if (!names.includes('messages')) {
    await db.createCollection('messages');
    await db.collection('messages').createIndex({ from: 1, to: 1 });
    console.log('[INFO] Created messages collection');
  }
}

async function getUser(username) {
  if (db) {
    return await db.collection('users').findOne({ username });
  }
  return users.find(u => u.username === username);
}

async function saveUser(user) {
  if (db) {
    try {
      await db.collection('users').updateOne(
        { username: user.username },
        { $set: user },
        { upsert: true }
      );
      return true;
    } catch (e) {
      console.error('[ERROR] Failed to save user:', e.message);
      return false;
    }
  }
  const idx = users.findIndex(u => u.username === user.username);
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  return true;
}

async function getAllUsers() {
  if (db) {
    return await db.collection('users').find({}).toArray();
  }
  return users;
}

async function getFriends(username) {
  if (db) {
    const doc = await db.collection('friends').findOne({ username });
    return doc ? doc.list : [];
  }
  return friendsData[username] || [];
}

async function saveFriends(username, list) {
  if (db) {
    try {
      await db.collection('friends').updateOne(
        { username },
        { $set: { list } },
        { upsert: true }
      );
      return true;
    } catch (e) {
      console.error('[ERROR] Failed to save friends:', e.message);
      return false;
    }
  }
  friendsData[username] = list;
  return true;
}

async function addFriend(a, b) {
  const fa = await getFriends(a);
  const fb = await getFriends(b);
  
  if (!fa.includes(b)) {
    fa.push(b);
    await saveFriends(a, fa);
  }
  if (!fb.includes(a)) {
    fb.push(a);
    await saveFriends(b, fb);
  }
}

async function getMsgs(a, b) {
  if (db) {
    const msgs = await db.collection('messages').find({
      $or: [
        { from: a, to: b },
        { from: b, to: a }
      ]
    }).sort({ time: 1 }).toArray();
    return msgs;
  }
  const key = [a, b].sort().join('__');
  return messagesData[key] || [];
}

async function addMsg(from, to, content) {
  const msg = { from, to, content, time: Date.now() };
  
  if (db) {
    try {
      await db.collection('messages').insertOne(msg);
    } catch (e) {
      console.error('[ERROR] Failed to save message:', e.message);
    }
  } else {
    const key = [from, to].sort().join('__');
    if (!messagesData[key]) messagesData[key] = [];
    messagesData[key].push(msg);
  }
  
  return msg;
}

const DEFAULT_USERS = [
  { username: 'admin', password: 'admin123', nickname: '无聊官方', avatar: 1, bio: '无聊官方公众号 · 发布最新公告和使用指南', createdAt: Date.now() },
  { username: 'alice', password: '1234', nickname: 'Alice', avatar: 2, bio: 'hello', createdAt: Date.now() },
  { username: 'bob', password: '1234', nickname: 'Bob', avatar: 4, bio: 'hi', createdAt: Date.now() },
  { username: 'charlie', password: '1234', nickname: 'Charlie', avatar: 5, bio: 'hey', createdAt: Date.now() }
];

async function initDefaultData() {
  const all = await getAllUsers();
  if (all.length > 0) {
    console.log('[INFO] Users already exist, skipping initialization');
    return;
  }
  console.log('[INFO] Initializing default users');
  for (const u of DEFAULT_USERS) {
    await saveUser(u);
    await saveFriends(u.username, []);
  }
  await addFriend('alice', 'bob');
  console.log('[INFO] Default data initialized');
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

async function createServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

    const url = req.url;

    if (req.method === 'POST' && url === '/api/register') {
      const body = await readBody(req);
      const { username, password, nickname, avatar } = body;
      if (!username || !password || !nickname) return send(res, 200, { success: false, msg: '请填写完整信息' });
      if (username.length < 3) return send(res, 200, { success: false, msg: '无聊号至少3个字符' });
      if (password.length < 4) return send(res, 200, { success: false, msg: '密码至少4位' });
      if (await getUser(username)) return send(res, 200, { success: false, msg: '该无聊号已被注册' });
      const user = { username, password, nickname, avatar: avatar || 1, bio: '', createdAt: Date.now() };
      await saveUser(user);
      await saveFriends(username, []);
      return send(res, 200, { success: true, user });
    }

    if (req.method === 'POST' && url === '/api/login') {
      const body = await readBody(req);
      const { username, password } = body;
      const user = await getUser(username);
      if (!user || user.password !== password) return send(res, 200, { success: false, msg: '无聊号或密码错误' });
      return send(res, 200, { success: true, user });
    }

    if (req.method === 'POST' && url === '/api/add-friend') {
      const body = await readBody(req);
      const { from, to } = body;
      if (from === to) return send(res, 200, { success: false, msg: '不能添加自己为好友' });
      const target = await getUser(to);
      if (!target) return send(res, 200, { success: false, msg: '用户不存在' });
      const friendsList = await getFriends(from);
      if (friendsList.includes(to)) return send(res, 200, { success: false, msg: '你们已经是好友了' });
      await addFriend(from, to);
      return send(res, 200, { success: true, target });
    }

    if (req.method === 'GET' && url.startsWith('/api/user/')) {
      const username = decodeURIComponent(url.slice(10));
      const user = await getUser(username);
      if (!user) return send(res, 200, { success: false, msg: '用户不存在' });
      return send(res, 200, { success: true, user });
    }

    if (req.method === 'GET' && url.startsWith('/api/friends/')) {
      const username = decodeURIComponent(url.slice(13));
      const friendNames = await getFriends(username);
      const list = await Promise.all(friendNames.map(async name => await getUser(name)));
      return send(res, 200, { success: true, friends: list.filter(Boolean) });
    }

    if (req.method === 'GET' && url.startsWith('/api/messages/')) {
      const parts = url.slice(14).split('/');
      if (parts.length >= 2) {
        const a = decodeURIComponent(parts[0]);
        const b = decodeURIComponent(parts[1]);
        const msgs = await getMsgs(a, b);
        return send(res, 200, { success: true, messages: msgs });
      }
      return send(res, 200, { success: true, messages: [] });
    }

    if (req.method === 'POST' && url === '/api/messages/send') {
      const body = await readBody(req);
      const { from, to, content } = body;
      if (!from || !to || !content) return send(res, 200, { success: false, msg: '参数错误' });
      if (!await getUser(from) || !await getUser(to)) return send(res, 200, { success: false, msg: '用户不存在' });
      const friendsList = await getFriends(from);
      if (!friendsList.includes(to)) return send(res, 200, { success: false, msg: '对方不是你的好友' });
      const msg = await addMsg(from, to, content);
      return send(res, 200, { success: true, message: msg });
    }

    if (req.method === 'GET' && url === '/api/debug') {
      return send(res, 200, {
        mongoConnected: !!db,
        storage: db ? 'mongodb' : 'memory'
      });
    }

    send(res, 404, { error: 'Not found' });
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log('[INFO] Server running on port ' + PORT);
    console.log('[INFO] Storage:', db ? 'MongoDB' : 'Memory');
  });
}

async function main() {
  await connectMongo();
  await initDefaultData();
  await createServer();
}

main().catch(e => {
  console.error('[ERROR] Main error:', e.message);
  process.exit(1);
});