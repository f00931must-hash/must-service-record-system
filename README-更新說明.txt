# 資源教室服務紀錄系統 v0.4.0 AI 串接更新

## 更新內容

- 正式接上 Cloudflare Worker + Gemini。
- AI 只傳送「內容摘述」文字。
- 預設安全代理網址已填入：
  https://must-resource-ai.f00931-must.workers.dev/ai/polish
- 加入 60 秒逾時、錯誤訊息及空白回應檢查。
- 保留「還原原文」功能。
- 保留 v0.3.7 所有匯出及列高修正。

## GitHub 覆蓋檔案

請同時覆蓋：

- index.html
- app.js

不要動 firebase-config.js、style.css 或其他既有檔案。

## 使用順序

1. 先完成 Cloudflare Worker 的 worker.js 部署。
2. 再把 index.html 與 app.js 上傳到服務紀錄系統 GitHub。
3. 網頁登入頁應顯示 v0.4.0。
4. 新增服務紀錄，輸入內容摘述後按「✨ AI 潤飾內容摘述」。
5. 確認潤飾結果後再儲存。
