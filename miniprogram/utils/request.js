// utils/request.js - 封装 wx.request
const app = getApp();

function request(options) {
  const { url, method = 'GET', data, header } = options;
  const apiBase = app.globalData.apiBase;
  const fullUrl = url.startsWith('http') ? url : apiBase + url;

  return new Promise((resolve, reject) => {
    wx.request({
      url: fullUrl,
      method,
      data,
      header: Object.assign({ 'Content-Type': 'application/json' }, header || {}),
      timeout: 15000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error('网络错误: ' + res.statusCode));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '请求失败'));
      }
    });
  });
}

module.exports = { request };
