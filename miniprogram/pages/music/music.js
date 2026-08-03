// pages/music/music.js
const { api } = require('../../utils/api.js');
const audio = require('../../utils/audio.js');

Page({
  data: {
    playlists: [],
    currentPlaylist: null,
    currentPlaylistIndex: -1,  // 选中的歌单索引
    songs: [],
    // 播放状态
    playingSong: null,
    isPlaying: false,
    currentIndex: -1
  },

  onShow() {
    this.loadPlaylists();
    this.refreshPlayStatus();
  },

  async loadPlaylists() {
    try {
      const res = await api.getPlaylists();
      if (res.success && res.playlists) {
        const playlists = res.playlists.filter(p => p.songs && p.songs.length > 0)
          .map(p => ({
            ...p,
            coverBg: p.coverColor || '#07c160'
          }));
        this.setData({ playlists });
        if (playlists.length > 0 && !this.data.currentPlaylist) {
          this.selectPlaylist(0);
        }
      }
    } catch (e) {
      wx.showToast({ title: '加载歌单失败', icon: 'none' });
    }
  },

  selectPlaylist(e) {
    const index = typeof e === 'number' ? e : e.currentTarget.dataset.index;
    const playlist = this.data.playlists[index];
    if (!playlist) return;
    this.setData({
      currentPlaylist: playlist,
      currentPlaylistIndex: index,
      songs: playlist.songs
    });
  },

  onPlaySong(e) {
    const index = e.currentTarget.dataset.index;
    const playlist = this.data.currentPlaylist;
    if (!playlist) return;
    audio.play(playlist, index);
    // 延迟一下让播放器状态更新
    setTimeout(() => this.refreshPlayStatus(), 200);
  },

  onTogglePlay() {
    audio.togglePlay();
    setTimeout(() => this.refreshPlayStatus(), 200);
  },

  onNext() {
    audio.next();
    setTimeout(() => this.refreshPlayStatus(), 200);
  },

  onPrev() {
    audio.prev();
    setTimeout(() => this.refreshPlayStatus(), 200);
  },

  refreshPlayStatus() {
    const status = audio.getStatus();
    this.setData({
      playingSong: status.song,
      isPlaying: status.playing,
      currentIndex: status.index
    });
  }
});
