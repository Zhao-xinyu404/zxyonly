// pages/profile/profile.js
const app = getApp();

Page({
  data: {
    user: null
  },

  onShow() {
    if (!app.checkLogin()) return;
    this.setData({ user: app.globalData.user });
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
  }
});
