// pages/profile/profile.js
const app = getApp();

Page({
  data: {
    user: null,
    displayAvatar: '',
    displayName: '',
    displayEmail: '',
    displayBio: '',
    displayCreatedAt: '',
    // APP 下载地址（蓝奏云）
    appDownload: {
      url: 'https://wwats.lanzouu.com/b01eun0h0h',
      password: '6gmg'
    }
  },

  onShow() {
    if (!app.checkLogin()) return;
    const user = app.globalData.user;
    // 预处理 WXML 中无法表达的字段
    this.setData({
      user: user,
      displayAvatar: ((user.nickname || user.username) + '').charAt(0),
      displayName: user.nickname || user.username,
      displayEmail: user.email || '未设置',
      displayBio: user.bio || '这个人很懒',
      displayCreatedAt: user.createdAt || '未知'
    });
  },

  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success(res) {
        if (res.confirm) {
          app.logout();
        }
      }
    });
  },

  // APP 下载：弹出蓝奏云链接与密码，并提供复制
  onDownloadApp() {
    const { url, password } = this.data.appDownload;
    wx.showModal({
      title: '下载无聊Chat APP',
      content: `请复制链接到浏览器打开：\n${url}\n密码：${password}`,
      confirmText: '复制链接',
      cancelText: '复制密码',
      success: (res) => {
        const copyText = res.confirm ? url : password;
        wx.setClipboardData({
          data: copyText,
          success: () => {
            wx.showToast({ title: res.confirm ? '链接已复制' : '密码已复制', icon: 'none' });
          }
        });
      }
    });
  },

  // 复制完整下载信息（链接+密码）
  onCopyDownloadAll() {
    const { url, password } = this.data.appDownload;
    wx.setClipboardData({
      data: `无聊Chat APP 下载\n链接：${url}\n密码：${password}`,
      success: () => {
        wx.showToast({ title: '已复制完整信息', icon: 'none' });
      }
    });
  }
});
