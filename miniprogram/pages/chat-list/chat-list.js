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
        // 按 nickname 排序，并预处理 WXML 中无法直接表达的字段
        const friends = (friendRes.friends || []).sort((a, b) =>
          (a.nickname || a.username).localeCompare(b.nickname || b.username)
        ).map(f => ({
          ...f,
          avatarStyle: 'background:' + (f.avatarColor || '#07c160'),
          avatarText: ((f.nickname || f.username) + '').charAt(0),
          displayName: f.nickname || f.username,
          displayBio: f.bio || '这个人很懒'
        }));
        const unreadMap = unreadRes.success ? unreadRes.perConversation : {};
        // 计算每个好友的未读数
        friends.forEach(f => {
          f.unreadCount = unreadMap[f.username] || 0;
        });
        this.setData({
          friends,
          unreadMap,
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
