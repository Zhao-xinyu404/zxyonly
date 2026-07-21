# 无聊 - 极简实时聊天应用

一个类似微信的简化版实时聊天网页应用，支持注册、登录、加好友、实时聊天等功能。

## 功能特性

- 👤 用户注册与登录
- 👥 添加好友
- 💬 实时一对一聊天（WebSocket）
- 📱 响应式设计，移动端友好
- 💾 数据持久化（JSON 文件存储）
- 🎨 微信风格界面

## 技术栈

- **前端**: 原生 HTML/CSS/JavaScript + Font Awesome
- **后端**: Node.js + Express + Socket.io
- **数据存储**: JSON 文件（无需数据库）

## 项目结构

```
├── public/          # 前端静态文件
│   └── index.html   # 主页面
├── data/            # 数据存储目录（自动生成）
│   ├── users.json   # 用户数据
│   ├── friends.json # 好友关系
│   └── messages.json # 聊天记录
├── server.js        # 后端服务
├── package.json     # 项目配置
├── .env             # 环境变量
└── .gitignore       # Git 忽略文件
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
npm start
```

服务启动后访问：`http://localhost:3000`

### 环境变量

在 `.env` 文件中配置：

```
PORT=3000  # 服务端口，默认 3000
```

## 部署到服务器

### 1. 上传代码

将项目上传到你的服务器，或通过 Git 克隆：

```bash
git clone <你的仓库地址>
cd <项目目录>
npm install
```

### 2. 使用 PM2 守护进程（推荐）

```bash
npm install -g pm2
pm2 start server.js --name wuliao-chat
pm2 save
pm2 startup
```

### 3. 使用 Nginx 反向代理（配置域名）

在 Nginx 配置中添加：

```nginx
server {
    listen 80;
    server_name 你的域名.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 4. 配置 HTTPS（推荐）

使用 Let's Encrypt 免费证书：

```bash
certbot --nginx -d 你的域名.com
```

## 预设测试账号

| 用户名 | 密码 | 昵称 |
|--------|------|------|
| alice | 1234 | Alice |
| bob | 1234 | Bob |
| charlie | 1234 | Charlie |

## API 接口

### 用户注册
`POST /api/register`

### 用户登录
`POST /api/login`

### 获取用户信息
`GET /api/user/:username`

### 添加好友
`POST /api/add-friend`

### 获取好友列表
`GET /api/friends/:username`

### 获取聊天记录
`GET /api/messages/:from/:to`

### 搜索用户
`GET /api/search/:keyword`

## License

MIT
