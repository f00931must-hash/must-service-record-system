import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig, allowedDomains } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const $ = id => document.getElementById(id);
let currentUser = null;
let students = [];
let recentRecords = [];

const DISABILITY_OPTIONS = ["自閉症","情緒障礙","學習障礙","肢體障礙","智能障礙","視覺障礙","聽覺障礙","腦性麻痺","多重障礙"];
const TARGET_OPTIONS = ["學生本人","家長","導師","授課教師","同儕","校內行政人員","其他"];
const METHOD_OPTIONS = ["面談","電話","LINE／訊息","電子郵件","會議","到班觀察","其他"];
const SERVICE_TYPE_OPTIONS = ["關懷與追蹤","學習輔導","生活輔導","心理支持","行政協助","人際關係","轉介與資源連結","合理調整","ISP／個案會議","其他"];

function asArray(value){
  if(Array.isArray(value)) return value.filter(Boolean);
  if(value === null || value === undefined || value === "") return [];
  return [String(value)];
}
function displayMulti(value){
  return asArray(value).join("、");
}
function checkboxOptions(name, options, selected=[]){
  const values = asArray(selected);
  return options.map(x => `<label class="option-chip"><input type="checkbox" name="${name}" value="${esc(x)}" ${values.includes(x)?"checked":""}> <span>${esc(x)}</span></label>`).join("");
}


$("loginBtn").onclick = async () => {
  const btn = $("loginBtn");
  btn.disabled = true;
  btn.textContent = "登入中...";
  try{
    await signInWithPopup(auth, provider);
  }catch(err){
    console.error("Google login failed", err);
    const code = err?.code || "";
    if(code === "auth/popup-blocked" || code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request"){
      try{
        await signInWithRedirect(auth, provider);
        return;
      }catch(redirectErr){
        console.error("Redirect login failed", redirectErr);
        alert("Google 登入失敗：" + (redirectErr.message || redirectErr.code || "未知錯誤"));
      }
    }else if(code === "auth/network-request-failed"){
      alert("目前無法連線到 Google 登入服務。請先確認網路連線，重新整理頁面後再試一次。");
    }else if(code === "auth/unauthorized-domain"){
      alert("目前網址尚未加入 Firebase Authentication 的授權網域。請到 Firebase → Authentication → Settings → Authorized domains 新增此 GitHub Pages 網域。");
    }else{
      alert("Google 登入失敗：" + (err.message || code || "未知錯誤"));
    }
  }finally{
    btn.disabled = false;
    btn.textContent = "使用 Google 帳號登入";
  }
};
$("logoutBtn").onclick = () => signOut(auth);
$("modalClose").onclick = closeModal;
$("addStudentBtn").onclick = () => openStudentForm();
$("studentSearch").oninput = renderStudents;
$("saveSettingsBtn").onclick = () => {
  localStorage.setItem("service_ai_endpoint", $("aiEndpoint").value.trim());
  toast("設定已儲存");
};

document.querySelectorAll(".nav").forEach(btn => btn.onclick = () => switchView(btn.dataset.view));
$("modal").onclick = e => { if(e.target === $("modal")) closeModal(); };

getRedirectResult(auth).catch(err => {
  console.error("Google redirect result failed", err);
  if(err?.code === "auth/network-request-failed"){
    alert("Google 登入連線失敗，請確認網路後重新整理頁面。");
  }
});

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if(!user){
    $("loginView").classList.remove("hidden");
    $("appView").classList.add("hidden");
    return;
  }

  const domain = (user.email || "").split("@")[1] || "";
  if(allowedDomains.length && !allowedDomains.includes(domain)){
    await signOut(auth);
    alert("此帳號不在允許的學校網域內。");
    return;
  }

  const accessRef = doc(db, "authorizedTeachers", user.uid);
  const accessSnap = await getDoc(accessRef);
  if(!accessSnap.exists() || accessSnap.data().enabled !== true){
    await signOut(auth);
    alert("此教師帳號尚未授權，請由系統管理者加入授權名單。");
    return;
  }

  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("userEmail").textContent = user.email || "";
  $("aiEndpoint").value = localStorage.getItem("service_ai_endpoint") || "";
  await loadAll();
});

async function loadAll(){
  await loadStudents();
  await loadRecentRecords();
}

async function loadStudents(){
  const ref = collection(db, "teachers", currentUser.uid, "students");
  const snap = await getDocs(query(ref, orderBy("name")));
  students = snap.docs.map(d => ({id:d.id, ...d.data()}));
  renderStudents();
}

function renderStudents(){
  const key = ($("studentSearch").value || "").trim().toLowerCase();
  const list = students.filter(s => [s.name,s.studentId,s.department,s.grade].join(" ").toLowerCase().includes(key));
  $("studentList").innerHTML = list.length ? list.map(s => `
    <article class="student-card">
      <h3>${esc(s.name)}</h3>
      <div class="meta">
        學號：${esc(s.studentId)}<br>
        科系／班級：${esc(s.department)}<br>
        學制／年級：${esc(s.program || "")} ${esc(s.grade || "")}<br>
        生理性別：${esc(s.biologicalSex || "")}<br>
        學生障別：${esc(displayMulti(s.disabilities || s.issues || [])) || "未填"}
      </div>
      <div class="card-actions">
        <button class="primary-btn" data-add-record="${s.id}">新增服務紀錄</button>
        <button class="ghost-btn" data-view-student="${s.id}">查看紀錄</button>
        <button class="ghost-btn" data-edit-student="${s.id}">修改學生</button>
      </div>
    </article>
  `).join("") : '<div class="empty">目前沒有學生資料。</div>';

  document.querySelectorAll("[data-add-record]").forEach(b => b.onclick = () => openRecordForm(b.dataset.addRecord));
  document.querySelectorAll("[data-view-student]").forEach(b => b.onclick = () => openStudentRecords(b.dataset.viewStudent));
  document.querySelectorAll("[data-edit-student]").forEach(b => b.onclick = () => openStudentForm(b.dataset.editStudent));
}

function openStudentForm(id=""){
  if(typeof id !== "string") id = "";
  const s = students.find(x => x.id === id) || {};
  const existingDisabilities = s.disabilities || s.issues || [];
  openModal(`
    <h2>${id ? "修改學生資料" : "新增學生"}</h2>
    <form id="studentForm" class="form-grid">
      <div><label>學生姓名</label><input name="name" class="field" required value="${esc(s.name||"")}"></div>
      <div><label>生理性別</label><select name="biologicalSex" class="field"><option></option><option ${s.biologicalSex==="男"?"selected":""}>男</option><option ${s.biologicalSex==="女"?"selected":""}>女</option></select></div>
      <div><label>學號</label><input name="studentId" class="field" required value="${esc(s.studentId||"")}"></div>
      <div><label>科系／班級</label><input name="department" class="field" value="${esc(s.department||"")}"></div>
      <div><label>學制</label><input name="program" class="field" value="${esc(s.program||"")}"></div>
      <div><label>年級</label><input name="grade" class="field" value="${esc(s.grade||"")}"></div>
      <div class="full">
        <label>學生障別</label>
        <div class="option-grid">${checkboxOptions("disabilities",DISABILITY_OPTIONS,existingDisabilities)}</div>
      </div>
      <div class="full">
        <label>備註</label>
        <textarea name="studentNote" class="field" placeholder="例如：障別補充、學習特性或其他需要記錄的資訊。">${esc(s.studentNote||"")}</textarea>
      </div>
      <div class="full card-actions">
        <button class="primary-btn" type="submit">儲存學生資料</button>
        ${id ? `<button class="danger-btn" type="button" id="deleteStudentBtn">刪除學生</button>` : ""}
      </div>
    </form>
  `);

  $("studentForm").onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      name: fd.get("name"),
      biologicalSex: fd.get("biologicalSex"),
      studentId: fd.get("studentId"),
      department: fd.get("department"),
      program: fd.get("program"),
      grade: fd.get("grade"),
      disabilities: fd.getAll("disabilities"),
      studentNote: fd.get("studentNote") || "",
      updatedAt: serverTimestamp()
    };
    if(id) await updateDoc(doc(db,"teachers",currentUser.uid,"students",id),data);
    else await addDoc(collection(db,"teachers",currentUser.uid,"students"),{...data,createdAt:serverTimestamp()});
    closeModal(); toast("學生資料已儲存"); await loadStudents();
  };

  if(id){
    $("deleteStudentBtn").onclick = async () => {
      if(!confirm("刪除學生資料後，該學生的服務紀錄也應一併處理。第一版暫時只允許無紀錄學生刪除，確定繼續？")) return;
      const recSnap = await getDocs(collection(db,"teachers",currentUser.uid,"students",id,"records"));
      if(!recSnap.empty) return alert("此學生已有服務紀錄，請先刪除紀錄。");
      await deleteDoc(doc(db,"teachers",currentUser.uid,"students",id));
      closeModal(); await loadStudents();
    };
  }
}

function openRecordForm(studentId){
  const s = students.find(x => x.id === studentId);
  if(!s) return;
  openModal(`
    <h2>新增服務紀錄｜${esc(s.name)}</h2>
    <form id="recordForm" class="form-grid">
      <div class="full"><label>日期</label><input name="date" type="date" class="field date-field" required value="${new Date().toISOString().slice(0,10)}"></div>

      <div class="full multi-section">
        <label>對象（可複選）</label>
        <div class="option-grid">${checkboxOptions("targets",TARGET_OPTIONS)}</div>
      </div>

      <div class="full multi-section">
        <label>方式（可複選）</label>
        <div class="option-grid">${checkboxOptions("methods",METHOD_OPTIONS)}</div>
      </div>

      <div class="full multi-section">
        <label>類型（可複選）</label>
        <div class="option-grid">${checkboxOptions("types",SERVICE_TYPE_OPTIONS)}</div>
      </div>

      <div class="full ai-box">
        <label>內容摘述</label>
        <textarea id="summaryInput" name="summary" class="field summary-editor" placeholder="先用口語輸入這次服務內容，再按 AI 潤飾。" required></textarea>
        <div class="ai-actions">
          <button type="button" id="aiPolishBtn" class="ghost-btn">✨ AI 潤飾內容摘述</button>
          <button type="button" id="restoreOriginalBtn" class="ghost-btn">還原原文</button>
        </div>
        <p class="hint">AI 只會收到此欄文字，不會送出學生姓名、學號、障別或基本資料。</p>
      </div>
      <div class="full"><button class="primary-btn" type="submit">儲存服務紀錄</button></div>
    </form>
  `);

  let originalText = "";
  $("aiPolishBtn").onclick = async () => {
    const text = $("summaryInput").value.trim();
    if(!text) return alert("請先輸入內容摘述。");
    originalText = text;
    const endpoint = localStorage.getItem("service_ai_endpoint") || "";
    if(!endpoint) return alert("尚未設定 AI 安全代理網址，請先到系統設定填寫。");
    $("aiPolishBtn").disabled = true;
    $("aiPolishBtn").textContent = "潤飾中...";
    try{
      const res = await fetch(endpoint,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({text})
      });
      if(!res.ok) throw new Error(await res.text());
      const data = await res.json();
      $("summaryInput").value = data.polished || data.text || "";
      toast("AI 潤飾完成，請確認內容後再儲存");
    }catch(err){
      console.error(err);
      alert("AI 潤飾失敗：" + err.message);
    }finally{
      $("aiPolishBtn").disabled = false;
      $("aiPolishBtn").textContent = "✨ AI 潤飾內容摘述";
    }
  };
  $("restoreOriginalBtn").onclick = () => { if(originalText) $("summaryInput").value = originalText; };

  $("recordForm").onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const targets = fd.getAll("targets");
    const methods = fd.getAll("methods");
    const types = fd.getAll("types");
    if(!targets.length) return alert("請至少勾選一個對象。");
    if(!methods.length) return alert("請至少勾選一個方式。");
    if(!types.length) return alert("請至少勾選一個類型。");
    await addDoc(collection(db,"teachers",currentUser.uid,"students",studentId,"records"),{
      studentId,
      studentName:s.name,
      date:fd.get("date"),
      targets,
      methods,
      types,
      summary:fd.get("summary"),
      createdAt:serverTimestamp(),
      updatedAt:serverTimestamp()
    });
    closeModal(); toast("服務紀錄已儲存"); await loadRecentRecords();
  };
}

async function openStudentRecords(studentId){
  const s = students.find(x => x.id === studentId);
  const snap = await getDocs(query(collection(db,"teachers",currentUser.uid,"students",studentId,"records"),orderBy("date","asc")));
  const records = snap.docs.map(d=>({id:d.id,...d.data()}));
  openModal(`
    <h2>${esc(s.name)}｜服務紀錄</h2>
    <div class="meta">
      學號：${esc(s.studentId)}　科系／班級：${esc(s.department||"")}　生理性別：${esc(s.biologicalSex||"")}<br>
      學生障別：${esc(displayMulti(s.disabilities || s.issues || [])) || "未填"}
      ${s.studentNote ? `<br>備註：${esc(s.studentNote)}` : ""}
    </div>
    <table class="record-table">
      <thead><tr><th>次數</th><th>日期</th><th>對象</th><th>方式</th><th>類型</th><th>內容摘述</th><th>操作</th></tr></thead>
      <tbody>${records.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.date)}</td><td>${esc(displayMulti(r.targets || r.target))}</td><td>${esc(displayMulti(r.methods || r.method))}</td><td>${esc(displayMulti(r.types || r.type))}</td><td class="summary-cell">${esc(r.summary)}</td><td><button class="danger-btn" data-delete-record="${r.id}">刪除</button></td></tr>`).join("")}</tbody>
    </table>
    <div class="card-actions">
      <button id="downloadExcelBtn" class="primary-btn">下載服務紀錄表</button>
      <button class="ghost-btn" id="addRecordFromList">新增服務紀錄</button>
    </div>
  `);
  $("downloadExcelBtn").onclick = () => exportStudentWorkbook(s,records);
  $("addRecordFromList").onclick = () => openRecordForm(studentId);
  document.querySelectorAll("[data-delete-record]").forEach(b => b.onclick = async () => {
    if(!confirm("確定刪除這筆紀錄？")) return;
    await deleteDoc(doc(db,"teachers",currentUser.uid,"students",studentId,"records",b.dataset.deleteRecord));
    openStudentRecords(studentId);
  });
}

async function loadRecentRecords(){
  recentRecords = [];
  for(const s of students){
    const snap = await getDocs(query(collection(db,"teachers",currentUser.uid,"students",s.id,"records"),orderBy("date","desc")));
    snap.docs.slice(0,3).forEach(d => recentRecords.push({student:s,...d.data()}));
  }
  recentRecords.sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  $("recentRecords").innerHTML = recentRecords.length ? `<table class="record-table"><thead><tr><th>日期</th><th>學生</th><th>對象</th><th>方式</th><th>類型</th><th>內容摘述</th></tr></thead><tbody>${recentRecords.slice(0,30).map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.student.name)}</td><td>${esc(displayMulti(r.targets || r.target))}</td><td>${esc(displayMulti(r.methods || r.method))}</td><td>${esc(displayMulti(r.types || r.type))}</td><td class="summary-cell">${esc(r.summary)}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">目前沒有服務紀錄。</div>';
}

function estimateExcelTextLines(text, capacity=40){
  const source = String(text || "");
  if(!source) return 1;
  return source.split(/\r?\n/).reduce((total, line) => {
    let units = 0;
    for(const ch of String(line)){
      // 中文、日文、韓文及全形字以較寬字元計算。
      units += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60]/.test(ch) ? 2 : 1;
    }
    return total + Math.max(1, Math.ceil(units / capacity));
  }, 0);
}

async function exportStudentWorkbook(student, records){
  try{
    const response = await fetch("./service-record-template.xlsx", {cache:"no-store"});
    if(!response.ok) throw new Error("無法載入服務紀錄範本檔案");

    const templateBuffer = await response.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBuffer);
    const ws = wb.getWorksheet("初始範本") || wb.worksheets[0];
    if(!ws) throw new Error("範本內找不到工作表");

    // 基本資料：只填值，不再由程式重畫表格或改欄寬。
    ws.getCell("B3").value = student.name || "";
    ws.getCell("E3").value = student.biologicalSex === "男"
      ? "■ 1. 男　□ 2. 女"
      : student.biologicalSex === "女"
        ? "□ 1. 男　■ 2. 女"
        : "□ 1. 男　□ 2. 女";
    ws.getCell("B4").value = student.studentId || "";
    ws.getCell("E4").value = student.department || "";
    ws.getCell("B5").value = student.program || "";
    ws.getCell("E5").value = student.grade || "";
    ws.getCell("C6").value = displayMulti(student.disabilities || student.issues || []) || "未填";
    ws.getCell("C7").value = student.studentNote || "";

    // 依所有服務紀錄統計類型，只顯示有出現的項目。
    const typeCounts = {};
    records.forEach(r => asArray(r.types || r.type).forEach(type => {
      if(type) typeCounts[type] = (typeCounts[type] || 0) + 1;
    }));
    ws.getCell("C8").value = Object.entries(typeCounts)
      .sort((a,b)=>b[1]-a[1])
      .map(([name,count]) => `${name}：${count} 次`)
      .join("　");

    const maxTemplateRows = 60;
    if(records.length > maxTemplateRows){
      alert(`目前範本最多輸出 ${maxTemplateRows} 筆紀錄，本次將先輸出前 ${maxTemplateRows} 筆。`);
    }
    const outputRecords = records.slice(0,maxTemplateRows);
    const minDisplayRows = Math.max(outputRecords.length, 8);

    // 清空範本預留列，再填入實際資料。
    for(let i=0;i<maxTemplateRows;i++){
      const rowNumber = 12 + i;
      const row = ws.getRow(rowNumber);
      for(let col=1;col<=6;col++) row.getCell(col).value = null;
      row.height = 38;
    }

    outputRecords.forEach((record,index) => {
      const rowNumber = 12 + index;
      const row = ws.getRow(rowNumber);
      const targets = displayMulti(record.targets || record.target);
      const methods = displayMulti(record.methods || record.method);
      const types = displayMulti(record.types || record.type);
      const summary = String(record.summary || "");

      row.getCell(1).value = index + 1;
      row.getCell(2).value = record.date || "";
      row.getCell(3).value = targets;
      row.getCell(4).value = methods;
      row.getCell(5).value = types;
      row.getCell(6).value = summary;

      // 只調整內容列高，不動範本欄寬與合併方式。
      const summaryLines = estimateTemplateLines(summary, 46);
      const targetLines = estimateTemplateLines(targets, 14);
      const methodLines = estimateTemplateLines(methods, 14);
      const typeLines = estimateTemplateLines(types, 14);
      const neededLines = Math.max(1,summaryLines,targetLines,methodLines,typeLines);
      row.height = Math.max(38, Math.min(409, 8 + neededLines * 18));

      for(let col=1;col<=6;col++){
        const cell=row.getCell(col);
        cell.font={name:"標楷體",size:12};
        cell.alignment={
          horizontal:col===6 ? "left" : "center",
          vertical:"top",
          wrapText:true,
          shrinkToFit:false
        };
      }
    });

    // 空白預留列保留最少 8 筆，避免只有一筆時版面太短。
    for(let i=outputRecords.length;i<minDisplayRows;i++){
      const row = ws.getRow(12+i);
      row.getCell(1).value = i+1;
      row.height = 38;
    }

    ws.pageSetup = {
      ...ws.pageSetup,
      paperSize:9,
      orientation:"portrait",
      fitToPage:true,
      fitToWidth:1,
      fitToHeight:0,
      margins:{left:0.28,right:0.28,top:0.32,bottom:0.32,header:0.15,footer:0.15},
      printArea:`A1:F${11+minDisplayRows}`,
      printTitlesRow:"1:11"
    };
    ws.views=[{showGridLines:false}];

    const output = await wb.xlsx.writeBuffer();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([output],{
      type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }));
    link.download = `${student.name}_服務紀錄表.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
  }catch(err){
    console.error("Template export failed",err);
    alert("服務紀錄表產生失敗：" + (err.message || err));
  }
}

function estimateTemplateLines(text, capacity){
  const value=String(text || "");
  if(!value) return 1;
  return value.split(/\r?\n/).reduce((total,line)=>{
    let units=0;
    for(const ch of String(line)){
      units += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60]/.test(ch) ? 2 : 1;
    }
    return total + Math.max(1,Math.ceil(units/capacity));
  },0);
}

function switchView(view){
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  $("view-"+view).classList.remove("hidden");
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $("pageTitle").textContent={students:"我的學生",records:"最近紀錄",settings:"系統設定"}[view]||"";
}

function openModal(html){ $("modalContent").innerHTML=html; $("modal").classList.remove("hidden"); }
function closeModal(){ $("modal").classList.add("hidden"); $("modalContent").innerHTML=""; }
function toast(text){ $("toast").textContent=text; $("toast").classList.remove("hidden"); setTimeout(()=>$("toast").classList.add("hidden"),2200); }
function esc(v){ return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }
