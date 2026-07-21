const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
    if (fs.existsSync(FRIENDS_FILE)) {
      friends = JSON.parse(fs.readFileSync(FRIENDS_FILE, 'utf8'));
    }
    if (fs.existsSync(MESSAGES_FILE)) {
      messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('加载数据失败:', e.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    fs.writeFileSync(FRIENDS_FILE, JSON.stringify(friends, null, 2));
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (e) {
    console.error('保存数据失败:', e.message);
  }
}

let users = [];
let friends = {};
let messages = {};
let socketMap = {};

loadData();

if (users.length === 0) {
  users = [
    { username: 'alice', password: '1234', nickname: 'Alice', avatar: 2, bio: '爱丽丝的奇幻世界', createdAt: Date.now() },
    { username: 'bob', password: '1234', nickname: 'Bob', avatar: 4, bio: '今天也是元气满满', createdAt: Date.now() },
    { username: 'charlie', password: '1234', nickname: 'Charlie', avatar: 5, bio: '咖啡 · 代码 · 生活', createdAt: Date.now() }
  ];
  friends['alice'] = ['bob'];
  friends['bob'] = ['alice'];
  friends['charlie'] = [];
  saveData();
  console.log('初始化示例数据');
}

function getUserByUsername(username) {
  return users.find(u => u.username === username);
}

function getFriends(username) {
  return friends[username] || [];
}

function addFriend(a, b) {
  if (!friends[a]) friends[a] = [];
  if (!friends[b]) friends[b] = [];
  if (!friends[a].includes(b)) friends[a].push(b);
  if (!friends[b].includes(a)) friends[b].push(a);
  saveData();
}

function getMsgKey(a, b) {
  return [a, b].sort().join('__');
}

function getMessages(a, b) {
  return messages[getMsgKey(a, b)] || [];
}

function addMessage(from, to, content) {
  const key = getMsgKey(from, to);
  if (!messages[key]) messages[key] = [];
  const msg = { from, to, content, time: Date.now() };
  messages[key].push(msg);
  saveData();
  return msg;
}

app.post('/api/register', (req, res) => {
  const { username, password, nickname, avatar } = req.body;
  if (!username || !password || !nickname) {
    return res.json({ success: false, msg: '请填写完整信息' });
  }
  if (username.length < 3) {
    return res.json({ success: false, msg: '用户名至少3个字符' });
  }
  if (password.length < 4) {
    return res.json({ success: false, msg: '密码至少4位' });
  }
  if (getUserByUsername(username)) {
    return res.json({ success: false, msg: '该用户名已被注册' });
  }
  const user = { username, password, nickname, avatar: avatar || 1, bio: '', createdAt: Date.now() };
  users.push(user);
  friends[username] = [];
  messages[getMsgKey(username, username)] = [];
  saveData();
  res.json({ success: true, user });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = getUserByUsername(username);
  if (!user || user.password !== password) {
    return res.json({ success: false, msg: '用户名或密码错误' });
  }
  res.json({ success: true, user });
});

app.post('/api/add-friend', (req, res) => {
  const { from, to } = req.body;
  if (from === to) {
    return res.json({ success: false, msg: '不能添加自己为好友' });
  }
  const target = getUserByUsername(to);
  if (!target) {
    return res.json({ success: false, msg: '用户不存在' });
  }
  if (getFriends(from).includes(to)) {
    return res.json({ success: false, msg: '你们已经是好友了' });
  }
  addFriend(from, to);
  res.json({ success: true, target });
});

app.get('/api/user/:username', (req, res) => {
  const user = getUserByUsername(req.params.username);
  if (!user) {
    return res.json({ success: false, msg: '用户不存在' });
  }
  res.json({ success: true, user });
});

app.get('/api/friends/:username', (req, res) => {
  const friendUsernames = getFriends(req.params.username);
  const friendList = friendUsernames.map(u => getUserByUsername(u)).filter(Boolean);
  res.json({ success: true, friends: friendList });
});

app.get('/api/messages/:from/:to', (req, res) => {
  const msgs = getMessages(req.params.from, req.params.to);
  res.json({ success: true, messages: msgs });
});

app.get('/api/search/:keyword', (req, res) => {
  const keyword = req.params.keyword.toLowerCase();
  const results = users.filter(u =>
    u.username.toLowerCase().includes(keyword) ||
    u.nickname.toLowerCase().includes(keyword)
  );
  res.json({ success: true, users: results });
});

io.on('connection', (socket) => {
  socket.on('login', (username) => {
    socketMap[username] = socket.id;
    socket.username = username;
    console.log(`用户 ${username} 上线`);
  });

  socket.on('logout', (username) => {
    delete socketMap[username];
    console.log(`用户 ${username} 下线`);
  });

  socket.on('send-message', (data) => {
    const { from, to, content } = data;
    const msg = addMessage(from, to, content);
    const targetSocket = socketMap[to];
    if (targetSocket) {
      io.to(targetSocket).emit('new-message', msg);
    }
    socket.emit('message-sent', msg);
    console.log(`消息: ${from} -> ${to}: ${content}`);
  });

  socket.on('typing', (data) => {
    const { from, to } = data;
    const targetSocket = socketMap[to];
    if (targetSocket) {
      io.to(targetSocket).emit('typing', { from });
    }
  });

  socket.on('stop-typing', (data) => {
    const { from, to } = data;
    const targetSocket = socketMap[to];
    if (targetSocket) {
      io.to(targetSocket).emit('stop-typing', { from });
    }
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      delete socketMap[socket.username];
      console.log(`用户 ${socket.username} 断开连接`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`无聊聊天服务已启动`);
  console.log(`端口: ${PORT}`);
  console.log(`访问地址: http://localhost:${PORT}`);
});
