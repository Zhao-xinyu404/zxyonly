// utils/api.js - API 接口定义
const { request } = require('./request.js');

const api = {
  // ====== 登录注册 ======
  login(username, password) {
    return request({ url: '/api/login', method: 'POST', data: { username, password } });
  },

  register(username, password, nickname, email) {
    return request({ url: '/api/register', method: 'POST', data: { username, password, nickname, email } });
  },

  // ====== 用户信息 ======
  getUser(username) {
    return request({ url: '/api/user/' + encodeURIComponent(username) });
  },

  updateProfile(data) {
    return request({ url: '/api/profile/update', method: 'POST', data });
  },

  // ====== 好友 ======
  getFriends(username) {
    return request({ url: '/api/friends/' + encodeURIComponent(username) });
  },

  sendFriendRequest(from, to) {
    return request({ url: '/api/friend-request/send', method: 'POST', data: { from, to } });
  },

  getIncomingRequests(username) {
    return request({ url: '/api/friend-requests/incoming/' + encodeURIComponent(username) });
  },

  acceptFriendRequest(from, to) {
    return request({ url: '/api/friend-request/accept', method: 'POST', data: { from, to } });
  },

  rejectFriendRequest(from, to) {
    return request({ url: '/api/friend-request/reject', method: 'POST', data: { from, to } });
  },

  deleteFriend(from, to) {
    return request({ url: '/api/friend/delete', method: 'POST', data: { from, to } });
  },

  // ====== 消息 ======
  getMessages(a, b) {
    return request({ url: '/api/messages/' + encodeURIComponent(a) + '/' + encodeURIComponent(b) });
  },

  sendMessage(from, to, content) {
    return request({ url: '/api/messages/send', method: 'POST', data: { from, to, content } });
  },

  markRead(username, friend) {
    return request({ url: '/api/messages/read', method: 'POST', data: { username, friend } });
  },

  getUnread(username) {
    return request({ url: '/api/messages/unread/' + encodeURIComponent(username) });
  },

  // ====== 歌单 ======
  getPlaylists() {
    return request({ url: '/api/playlists' });
  },

  // 获取音频代理URL（HTTP音频源通过HTTPS代理播放）
  getAudioProxyUrl(originalUrl) {
    const app = getApp();
    const base = app.globalData.audioProxyBase || app.globalData.apiBase;
    return base + '/proxy?url=' + encodeURIComponent(originalUrl);
  }
};

module.exports = { api };
