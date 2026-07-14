// 請把 Firebase 專案的 Web App 設定貼在這裡。
export const firebaseConfig = {
  apiKey: "AIzaSyB3rVyZb9VzDgQ90CQmLF_JXlM-wDskGxE",
  authDomain: "must-service-record-system.firebaseapp.com",
  projectId: "must-service-record-system",
  storageBucket: "must-service-record-system.firebasestorage.app",
  messagingSenderId: "1066337913135",
  appId: "1:1066337913135:web:3080eb1e05b176de77b9da"
};

// 可選：限制只有指定學校網域登入，例如 must.edu.tw。
// 留空陣列代表暫不限制網域，改由 Firestore 授權名單控管。
export const allowedDomains = [];
