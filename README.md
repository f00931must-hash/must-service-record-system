# MUST Service Record System v0.3.3

本更新修正瀏覽器仍讀取舊版 app.js 的快取問題。

請同時覆蓋：
- index.html
- app.js

index.html 已改為載入：
`./app.js?v=0.3.3`

正確載入後，F12 Console 最上方會顯示：
`MUST Service Record System build v0.3.3`

這版完全不讀取 service-record-template.xlsx 或 service-record-template.xlsm。
