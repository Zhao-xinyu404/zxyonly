// pages/chat-detail/chat-detail.js
const { api } = require('../../utils/api.js');
const app = getApp();

Page({
  data: {
    friend: '',
    nickname: '',
    messages: [],
    inputText: '',
    scrollToView: '',
    loading: true
  },

  onLoad(options) {
    const friend = decodeURIComponent(options.friend || '');
    const nickname = decodeURIComponent(options.nickname || '');
    this.setData({ friend, nickname });
    wx.setNavigationBarTitle({ title: nickname || friend });
    this.loadMessages();
  },

  async loadMessages() {
    const user = app.globalData.user;
    try {
      const res = await api.getMessages(user.username, this.data.friend);
      if (res.success) {
        const messages = (res.messages || []).map(m => ({
          ...m,
          isMe: m.from === user.username,
          timeText: this.formatTime(m.timestamp)
        }));
        this.setData({ messages, loading: false });
        // 标记已读
        api.markRead(user.username, this.data.friend).catch(() => {});
        // 滚动到底部
        this.scrollToBottom();
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  async onSend() {
    const content = this.data.inputText.trim();
    if (!content) return;
    const user = app.globalData.user;
    this.setData({ inputText: '' });
    try {
      const res = await api.sendMessage(user.username, this.data.friend, content);
      if (res.success) {
        this.loadMessages();
      } else {
        wx.showToast({ title: res.msg || '发送失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  scrollToBottom() {
    if (this.data.messages.length === 0) return;
    const lastId = 'msg-' + (this.data.messages.length - 1);
    this.setData({ scrollToView: lastId });
  },

  formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }
});
