# MUST Service Record System v0.1

第一版功能：

- 教師 Google 登入
- 授權教師名單
- 每位教師只看得到自己的學生
- 建立、修改、刪除學生資料
- 每位學生可累積多筆服務紀錄
- 只有「內容摘述」會送 AI 潤飾
- 彈窗查看學生歷次紀錄
- 一鍵下載專用格式 Excel
- Firestore Security Rules 完整隔離教師資料

## 資料結構

```text
authorizedTeachers/{teacherUid}

teachers/{teacherUid}/students/{studentId}
teachers/{teacherUid}/students/{studentId}/records/{recordId}
```

## Firebase 設定

1. 建立新的 Firebase 專案。
2. 啟用 Authentication → Google。
3. 建立 Firestore Database。
4. 建立 Web App，將設定貼到 `firebase-config.js`。
5. 把 `firestore.rules` 全部貼到 Firestore Rules 並發布。
6. 第一次登入後，到 Authentication 找老師 UID。
7. 在 Firestore 建立：
   `authorizedTeachers/{老師UID}`
   內容：
   `enabled: true`

## GitHub Pages

建立新的 Repository，建議名稱：

`must-service-record-system`

把檔案全部上傳到根目錄，再到：

Settings → Pages → Deploy from a branch → main → /(root)

## AI

前端不放 AI API Key。

請部署 `ai-worker-example.js` 到 Cloudflare Worker，
並將 Worker 網址貼到系統設定中的「AI 安全代理網址」。

AI 只接收內容摘述文字；姓名、學號與學生基本資料不會送出。
