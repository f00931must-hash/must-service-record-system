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

async function exportStudentWorkbook(student, records){
  const wb = new ExcelJS.Workbook();
  wb.creator = "MUST Resource Center Service Record System";
  const ws = wb.addWorksheet("學生服務記錄表", {properties:{defaultRowHeight:20}});
  ws.pageSetup = {
    paperSize:9,
    orientation:"portrait",
    fitToPage:true,
    fitToWidth:1,
    fitToHeight:0,
    margins:{left:0.28,right:0.28,top:0.3,bottom:0.3,header:0.15,footer:0.15}
  };
  ws.pageMargins = {left:0.28,right:0.28,top:0.3,bottom:0.3,header:0.15,footer:0.15};
  ws.columns = [
    {width:10.5},  // 次數／基本資料標題
    {width:13.5},  // 日期
    {width:13.5},  // 對象
    {width:13.5},  // 方式
    {width:13.5},  // 類型
    {width:38.5}   // 內容摘述
  ];

  ws.mergeCells("A1:F1");
  ws.getCell("A1").value = "明新科技大學　學務處　健康與諮商中心資源教室\n學生服務記錄表";
  ws.getCell("A1").alignment = {horizontal:"center",vertical:"middle",wrapText:true};
  ws.getCell("A1").font = {name:"標楷體",size:18,bold:true};
  ws.getRow(1).height = 48;

  ws.mergeCells("A2:F2");
  ws.getCell("A2").value="一、基本資料";

  ws.getCell("A3").value="學生姓名"; ws.mergeCells("B3:C3"); ws.getCell("B3").value=student.name;
  ws.getCell("D3").value="生理性別"; ws.mergeCells("E3:F3");
  ws.getCell("E3").value=student.biologicalSex==="男" ? "■ 1. 男　□ 2. 女" : student.biologicalSex==="女" ? "□ 1. 男　■ 2. 女" : "□ 1. 男　□ 2. 女";

  ws.getCell("A4").value="學號"; ws.mergeCells("B4:C4"); ws.getCell("B4").value=student.studentId;
  ws.getCell("D4").value="科系／班級"; ws.mergeCells("E4:F4"); ws.getCell("E4").value=student.department;

  ws.getCell("A5").value="學制"; ws.mergeCells("B5:C5"); ws.getCell("B5").value=student.program;
  ws.getCell("D5").value="年級"; ws.mergeCells("E5:F5"); ws.getCell("E5").value=student.grade;

  ws.getCell("A6").value="學生障別"; ws.mergeCells("B6:F6");
  ws.getCell("B6").value=displayMulti(student.disabilities || student.issues || []) || "未填";
  ws.getCell("A7").value="備註"; ws.mergeCells("B7:F7"); ws.getCell("B7").value=student.studentNote || "";

  const typeCounts = {};
  records.forEach(r => asArray(r.types || r.type).forEach(t => {
    if(t) typeCounts[t] = (typeCounts[t] || 0) + 1;
  }));
  const typeEntries = Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]);
  ws.mergeCells("A8:B9"); ws.getCell("A8").value="服務類型統計";
  ws.mergeCells("C8:F9");
  ws.getCell("C8").value=typeEntries.length
    ? typeEntries.map(([name,count])=>`${name}：${count} 次`).join("　")
    : "";
  ws.getRow(8).height = typeEntries.length > 5 ? 36 : 24;
  ws.getRow(9).height = typeEntries.length > 5 ? 24 : 18;

  ws.mergeCells("A10:F10"); ws.getCell("A10").value="二、服務紀錄";
  ["次數","日期","對象","方式","類型","內容摘述"].forEach((x,i)=>ws.getCell(11,i+1).value=x);

  const minRows=Math.max(records.length,8);
  for(let i=0;i<minRows;i++){
    const row=12+i;
    const r=records[i];
    ws.getCell(row,1).value=i+1;
    if(r){
      const targets=displayMulti(r.targets || r.target);
      const methods=displayMulti(r.methods || r.method);
      const types=displayMulti(r.types || r.type);
      const summary=String(r.summary || "");
      ws.getCell(row,2).value=r.date;
      ws.getCell(row,3).value=targets;
      ws.getCell(row,4).value=methods;
      ws.getCell(row,5).value=types;
      ws.getCell(row,6).value=summary;

      const charsPerLine=23;
      const manualLines = summary.split(/\r?\n/);
      const summaryLines = manualLines.reduce((total,line) => {
        return total + Math.max(1, Math.ceil(String(line).length / charsPerLine));
      }, 0);
      const estimatedLines=Math.max(
        1,
        summaryLines,
        asArray(r.targets || r.target).length,
        asArray(r.methods || r.method).length,
        asArray(r.types || r.type).length
      );
      // Excel 列高以 point 計算；保留完整文字，不再把長內容限制在縮小的格子內。
      ws.getRow(row).height=Math.max(42, Math.min(390, 16 + estimatedLines*16.5));
    }else{
      ws.getRow(row).height=38;
    }
  }

  const end=11+minRows;
  for(let r=2;r<=end;r++){
    for(let c=1;c<=6;c++){
      const cell=ws.getCell(r,c);
      cell.font={...(cell.font||{}),name:"標楷體",size:12};
      const isServiceDataRow = r >= 12;
      cell.alignment={
        vertical:isServiceDataRow ? "top" : "middle",
        horizontal:c===6 || (r===8 && c===3) ? "left" : "center",
        wrapText:true,
        shrinkToFit:false
      };
      cell.border={
        top:{style:"thin",color:{argb:"FF000000"}},
        left:{style:"thin",color:{argb:"FF000000"}},
        bottom:{style:"thin",color:{argb:"FF000000"}},
        right:{style:"thin",color:{argb:"FF000000"}}
      };
    }
  }

  [2,10].forEach(r => {
    ws.getCell(r,1).font={name:"標楷體",size:14,bold:true};
    ws.getCell(r,1).alignment={horizontal:"left",vertical:"middle"};
  });
  for(let c=1;c<=6;c++){
    ws.getCell(11,c).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFE7E6E6"}};
    ws.getCell(11,c).font={name:"標楷體",size:12,bold:true};
  }
  ["A3","D3","A4","D4","A5","D5","A6","A7","A8"].forEach(addr=>{
    ws.getCell(addr).font={name:"標楷體",size:12,bold:true};
    ws.getCell(addr).alignment={horizontal:"center",vertical:"middle",wrapText:false,shrinkToFit:false};
  });

  ws.getRow(6).height=24;
  ws.getRow(7).height=Math.max(24, Math.min(60, 18 + Math.ceil(String(student.studentNote||"").length/50)*15));
  ws.views=[{showGridLines:false}];

  const blob = await wb.xlsx.writeBuffer();
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([blob],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  a.download=`${student.name}_服務紀錄表.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
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
