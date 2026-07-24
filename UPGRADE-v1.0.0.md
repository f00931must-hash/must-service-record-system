# 服務紀錄系統 v1.0.0 升級說明

## 本版完成

- 個管老師只看自己的學生與服務紀錄。
- 小幫手可新增、修改學生與服務紀錄，但不能刪除學生、轉移學生或改變個管老師。
- 單一學生轉移與批次轉移。
- 學生及服務紀錄採軟刪除，可由各自個管老師在「我的回收桶」還原。
- 新增、修改、刪除、還原及轉移均寫入操作紀錄。
- 歷史紀錄保留原始建立者、最後修改者及轉移原因。
- 提供舊版 `teachers/{uid}/students` 資料的一次性移轉工具；舊資料不會被刪除。

## 權限同步資料格式

Portal 應同步至服務紀錄 Firebase：

Collection：`settings`

Document：`serviceAccess`

```js
{
  users: {
    "teacher@must.edu.tw": {
      enabled: true,
      role: "teacher",
      displayName: "王老師",
      ownerEmail: "teacher@must.edu.tw"
    },
    "assistant@must.edu.tw": {
      enabled: true,
      role: "assistant",
      displayName: "小幫手",
      ownerEmail: "teacher@must.edu.tw"
    }
  },
  updatedAt: serverTimestamp()
}
```

## 上線順序

1. 先在服務紀錄 Firebase 建立 `settings/serviceAccess`。
2. 將本版 `firestore.rules` 發布。
3. 覆蓋 GitHub 專案檔案。
4. 個管老師登入後，到「系統設定」按「檢查並移轉我的舊資料」。
5. 確認學生與紀錄正常後，再開始測試小幫手、回收桶與轉移。

## 注意

Firestore 複合查詢若第一次出現索引提示，請依錯誤訊息連結建立索引。常見索引：

- `students`: ownerEmail + deleted
- `records`: ownerEmail + deleted
- `records`: studentId + ownerEmail
