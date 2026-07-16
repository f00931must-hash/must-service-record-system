# MUST Service Record System v0.3.0

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

## v0.2.2
- 學生障別與備註標題改為合併兩欄，確保中文字不再拆行。
- 內容摘述欄加寬，其他欄位重新分配以維持 A4 直式。
- 列高改以中文全形字寬與手動換行估算，並提高到 Excel 單列安全上限。
- 長內容改為完整換行顯示，不再壓到下一筆服務紀錄。

## v0.2.3
- 表格底層由 6 欄改為 12 欄，再依不同區塊合併，解決基本資料與服務紀錄共用欄寬造成的互相擠壓。
- 「學生姓名、學生障別、科系／班級」皆有獨立足夠寬度。
- 內容摘述保留完整顯示，但列高改為較精準的雙寬中文字估算，不再過度放大。
- 長紀錄可自然跨 A4 頁面，表頭會在每頁重複列印。

## v0.3.0 範本填值版
- Excel 匯出不再由 JavaScript 重畫表格。
- 改為讀取 `service-record-template.xlsx` 固定範本，只填入學生與服務紀錄資料。
- 欄寬、合併儲存格、框線與 A4 版面全部由範本控制。
- 程式只依文字量調整服務紀錄列高。
- 未來調整表格格式時，可直接修改範本檔，不必重寫整段匯出程式。
