'use strict';
// 示例服务：一个极简 HTTP 服务，用于演示 dfd 服务探测/启动/打开功能
const http = require('http');

const PORT = 9111;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>示例 API 服务</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #101418; color: #e6e9f0; }
  .box { text-align: center; padding: 40px; border: 1px solid #2a3040; border-radius: 16px; background: #1c2029; }
  h1 { margin: 0 0 10px; } p { color: #9aa3b2; } .tag { color: #4f8cff; }
</style></head>
<body>
  <div class="box">
    <h1>🛠️ 示例 API 服务</h1>
    <p>这是 <code>services/sample-api</code> 启动的独立服务。</p>
    <p>回到 dfd 门户，点击 <b>🔍 探测</b> 可看到本服务状态为「在线」。</p>
  </div>
</body></html>`);
});

server.listen(9111, '127.0.0.1', () => {
  console.log('sample-api 已启动: http://127.0.0.1:9111/');
});