# MUST Service Record System v0.2.1

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

## v0.1.1
- 修正新增學生時，瀏覽器把點擊事件誤當成學生文件 ID，造成 `s.indexOf is not a function`。

## v0.1.2
- Google 登入加入完整錯誤處理。
- Popup 被封鎖時改用 Redirect 登入。
- 網路錯誤與未授權網域會顯示明確提示。

## v0.2.0
- 「問題類型」改為「學生障別」，新增九種障別及備註欄。
- 服務紀錄的對象、方式與類型改為可複選。
- 服務類型新增「人際關係」等常用選項。
- 下載表格原問題類型區改為依歷次服務紀錄自動統計服務類型。
- 內容摘述欄位與下載表格改為自動換行、依全文調整高度。
- 保留 AI 內容摘述潤飾功能與安全代理架構。
- 完整版已保留目前 Firebase Web App 設定。

## v0.2.1
- 加寬第一欄，避免「學生障別」等標題被拆字擠壓。
- 重新分配 A4 直式表格欄寬，日期、對象、方式、類型標題維持完整。
- 內容摘述依全文與手動換行自動增加列高，避免文字重疊或只顯示部分內容。
- 服務紀錄資料列改為靠上對齊，長文字閱讀更清楚。
