// pages/login/login.js
const { api } = require('../../utils/api.js');
const app = getApp();

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    isRegister: false,
    nickname: '',
    email: ''
  },

  onLoad() {
    // 已登录直接跳转
    if (app.globalData.user) {
      wx.switchTab({ url: '/pages/chat-list/chat-list' });
    }
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [field]: e.detail.value });
  },

  toggleRegister() {
    this.setData({ isRegister: !this.data.isRegister });
  },

  async handleSubmit() {
    const { username, password, isRegister, nickname, email } = this.data;
    if (!username || !password) {
      wx.showToast({ title: '请输入无聊号和密码', icon: 'none' });
      return;
    }

    if (isRegister && !nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    try {
      let res;
      if (isRegister) {
        res = await api.register(username, password, nickname, email);
      } else {
        res = await api.login(username, password);
      }

      if (res.success) {
        app.saveLogin(res.user);
        wx.showToast({ title: isRegister ? '注册成功' : '登录成功', icon: 'success' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/chat-list/chat-list' });
        }, 1000);
      } else {
        wx.showToast({ title: res.msg || '操作失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误，请检查后端服务', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
