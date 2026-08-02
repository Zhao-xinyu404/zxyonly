// app.js - 无聊Chat小程序
const { api } = require('./utils/api.js');

App({
  globalData: {
    // 后端地址（部署后改为你的 HTTPS 域名）
    apiBase: 'https://wuliao-chat.onrender.com',
    // 当前登录用户
    user: null,
    // 后台音频管理器
    bgAudio: null
  },

  onLaunch() {
    // 从本地存储恢复登录状态
    const user = wx.getStorageSync('user');
    if (user) {
      this.globalData.user = user;
    }
    // 初始化后台音频管理器
    this.globalData.bgAudio = wx.getBackgroundAudioManager();
  },

  // 检查登录状态，未登录跳转登录页
  checkLogin() {
    if (!this.globalData.user) {
      wx.reLaunch({ url: '/pages/login/login' });
      return false;
    }
    return true;
  },

  // 保存登录状态
  saveLogin(user) {
    this.globalData.user = user;
    wx.setStorageSync('user', user);
  },

  // 退出登录
  logout() {
    this.globalData.user = null;
    wx.removeStorageSync('user');
    wx.reLaunch({ url: '/pages/login/login' });
  }
});
