// pages/chat-list/chat-list.js
const { api } = require('../../utils/api.js');
const app = getApp();

Page({
  data: {
    friends: [],
    unreadMap: {},
    loading: true
  },

  onShow() {
    if (!app.checkLogin()) return;
    this.loadFriends();
  },

  onPullDownRefresh() {
    this.loadFriends().then(() => wx.stopPullDownRefresh());
  },

  async loadFriends() {
    const user = app.globalData.user;
    try {
      const [friendRes, unreadRes] = await Promise.all([
        api.getFriends(user.username),
        api.getUnread(user.username)
      ]);
      if (friendRes.success) {
        // 按 nickname 排序
        const friends = (friendRes.friends || []).sort((a, b) =>
          (a.nickname || a.username).localeCompare(b.nickname || b.username)
        );
        this.setData({
          friends,
          unreadMap: unreadRes.success ? unreadRes.perConversation : {},
          loading: false
        });
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onTapFriend(e) {
    const { username, nickname } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/chat-detail/chat-detail?friend=${encodeURIComponent(username)}&nickname=${encodeURIComponent(nickname)}`
    });
  }
});
