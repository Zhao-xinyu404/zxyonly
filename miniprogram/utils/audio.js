// utils/audio.js - 后台音频管理（支持锁屏/后台继续播放）
const { api } = require('./api.js');

/**
 * 使用 wx.getBackgroundAudioManager() 实现后台音频播放
 * - 锁屏/切后台继续播放
 * - 系统通知栏/锁屏显示控制条
 * - title 属性必填，否则无法播放
 */
let bgAudio = null;
let currentPlaylist = null;  // 当前歌单
let currentIndex = -1;       // 当前歌曲索引

function init() {
  if (bgAudio) return bgAudio;
  const app = getApp();
  bgAudio = app.globalData.bgAudio || wx.getBackgroundAudioManager();

  // 播放结束自动下一首
  bgAudio.onEnded(() => {
    next();
  });

  // 播放错误处理
  bgAudio.onError((err) => {
    console.error('[Audio] 播放错误:', err);
  });

  return bgAudio;
}

// 播放指定歌单的指定歌曲
function play(playlist, index) {
  const manager = init();
  currentPlaylist = playlist;
  currentIndex = index;
  const song = playlist.songs[index];
  if (!song) return;

  // BackgroundAudioManager 的 src 必须是 HTTPS
  // 通过后端音频代理将 HTTP 音频源转为 HTTPS
  const proxyUrl = api.getAudioProxyUrl(song.url);

  manager.title = song.title;
  manager.singer = song.artist;
  manager.epname = playlist.name;
  manager.src = proxyUrl;  // 设置 src 即开始播放
}

// 播放/暂停切换
function togglePlay() {
  const manager = init();
  if (manager.paused) {
    manager.play();
  } else {
    manager.pause();
  }
}

// 下一首
function next() {
  if (!currentPlaylist || currentIndex < 0) return;
  const nextIndex = (currentIndex + 1) % currentPlaylist.songs.length;
  play(currentPlaylist, nextIndex);
}

// 上一首
function prev() {
  if (!currentPlaylist || currentIndex < 0) return;
  const prevIndex = (currentIndex - 1 + currentPlaylist.songs.length) % currentPlaylist.songs.length;
  play(currentPlaylist, prevIndex);
}

// 获取当前播放状态
function getStatus() {
  const manager = init();
  return {
    playlist: currentPlaylist,
    index: currentIndex,
    song: currentPlaylist && currentIndex >= 0 ? currentPlaylist.songs[currentIndex] : null,
    playing: !manager.paused,
    currentTime: manager.currentTime,
    duration: manager.duration
  };
}

// 停止播放
function stop() {
  const manager = init();
  manager.stop();
  currentPlaylist = null;
  currentIndex = -1;
}

module.exports = {
  init,
  play,
  togglePlay,
  next,
  prev,
  getStatus,
  stop
};
