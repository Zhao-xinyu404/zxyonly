# 技术架构文档 — 微聊（WeiChat Lite）

## 一、技术选型

| 项目 | 选型 | 理由 |
|---|---|---|
| 框架 | 原生 HTML + CSS + JavaScript | 单文件部署，零依赖，秒开 |
| 存储 | localStorage | 无后端，前端持久化 |
| 图标 | Font Awesome 6 CDN | 微信风格图标 |
| 字体 | system-ui + PingFang SC | 还原微信原生质感 |
| 部署 | 单 index.html | 直接打开即用 |

## 二、项目结构

```
/workspace
└── index.html    （单文件包含 HTML/CSS/JS）
```

## 三、模块划分

### 3.1 数据层（DataLayer）
- `Storage` 对象：封装 localStorage 增删改查
- 用户、好友、消息的 CRUD

### 3.2 视图层（ViewLayer）
- 登录/注册页（auth-view）
- 主容器（main-view），内含 4 个 tab 子页：
  - chat-tab：聊天列表
  - contacts-tab：通讯录
  - discover-tab：发现
  - profile-tab：我
- 聊天详情页（chat-detail-view）

### 3.3 控制层（Controller）
- 路由切换（hash 或状态机）
- 事件绑定
- 业务逻辑（注册/登录/添加好友/发送消息）

## 四、关键流程

### 4.1 注册流程
1. 用户填写用户名/密码/昵称
2. 校验用户名唯一性
3. 写入 `weichat_users`
4. 自动登录

### 4.2 发送消息流程
1. 输入框输入文本
2. 生成消息对象 `{from, to, content, time}`
3. 写入共享 key（按用户名字典序排列）`weichat_msgs_<a>_<b>`
4. 重新渲染聊天区域

### 4.3 会话列表更新
- 每次发送/接收消息后，按最后消息时间排序聊天列表

## 五、视觉规范

- 主色：#07c160（微信绿）
- 背景灰：#ededed（微信经典背景）
- 文字：#191919 / #888
- 边框：#e5e5e5
- 圆角：8px / 12px
- 手机框：max-width 480px，居中，桌面带阴影

## 六、兼容性

- 现代浏览器（Chrome 90+/Edge 90+/Safari 14+/Firefox 90+）
- localStorage 可用
- JavaScript ES6+ 支持
