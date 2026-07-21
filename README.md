# 无聊 - 极简实时聊天应用

一个类似微信的简化版实时聊天网页应用，支持注册、登录、加好友、实时聊天等功能。

## 功能特性

- 👤 用户注册与登录
- 👥 添加好友
- 💬 实时一对一聊天（HTTP轮询）
- 📱 响应式设计，移动端友好
- 💾 数据持久化（JSON 文件存储）
- 🎨 微信风格界面

## 技术栈

- **前端**: 原生 HTML/CSS/JavaScript + Font Awesome
- **后端**: Node.js 原生 http 模块
- **数据存储**: JSON 文件（无需数据库）

## 项目结构

```
├── public/          # 前端静态文件
│   └── index.html   # 主页面
├── server.js        # 后端服务
├── package.json     # 项目配置
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

## 部署

前端已部署到 GitHub Pages，后端已部署到 Render。

## License

MIT