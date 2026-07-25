# MUST Service Record System

**版本：v1.1.0**  
明新科技大學資源教室使用的學生服務紀錄與個案管理系統。

## 本版重點

- 修正協作者登入後讀取學生時出現 `Missing or insufficient permissions`。
- 統一 `settings/serviceAccess`、`serviceAssistants/{email}` 與舊版 `authorizedTeachers/{uid}` 的授權判斷。
- 個管老師與所屬協作者共用同一組學生、服務紀錄及操作紀錄。
- 小幫手可新增、修改學生與服務紀錄，但不能刪除學生、轉移學生或進入系統設定。
- 老師可看到自己與所屬小幫手的團隊操作紀錄。
- 修正登入期間畫面跳動，完成權限確認與資料載入後才顯示主畫面。
- 補上網站圖示，避免 favicon 404。
- 轉移功能支援 Portal 同步老師名單，並保留舊名單過渡相容。

## 權限角色

### 個管老師／系統管理員

可新增、修改、刪除與還原學生及服務紀錄，可單筆或批次轉移學生，並可使用系統設定。

### 小幫手

可查看所屬老師的學生與團隊操作紀錄，可新增、修改學生及服務紀錄，也可將服務紀錄移至回收桶或還原；不可刪除或還原學生、轉移學生及使用系統設定。

## 部署方式

1. 先到 Firebase Console 的 Firestore Rules 覆蓋並發布本版 `firestore.rules`。
2. 將本專案檔案覆蓋至 GitHub Repository。
3. 等待 GitHub Pages 完成部署後，使用強制重新整理（Windows：`Ctrl + F5`）。
4. 先以個管老師登入確認學生資料，再以小幫手帳號測試。

> Firestore Rules 必須先發布。只更新 GitHub 程式碼，協作者仍會被舊規則拒絕。

## 主要資料結構

- `settings/serviceAccess`：Portal 集中同步的使用者權限。
- `serviceAssistants/{email}`：個管老師自行同步的小幫手授權。
- `students`：學生資料，以 `ownerEmail` 表示目前個管老師。
- `records`：服務紀錄，以 `ownerEmail` 與學生同步歸屬。
- `auditLogs`：新增、修改、刪除、還原與轉移操作紀錄。
- `transferLogs`：學生轉移紀錄。

## 版本紀錄

完整更新內容請見 [CHANGELOG.md](./CHANGELOG.md)。


## v1.1.0 批次下載

- 個管老師與小幫手皆可使用。
- 可全選、取消全選或勾選多位學生。
- 可下載全部紀錄、本學期、本學年或自訂日期。
- 每位學生產生一份 Excel，並以 ZIP 一次下載。
- ZIP 內附「批次下載清單.txt」，列出下載範圍、學生及紀錄筆數。
- 產生過程會顯示進度，避免誤以為系統停止回應。
