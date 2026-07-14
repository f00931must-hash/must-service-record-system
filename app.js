import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
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

$("loginBtn").onclick = () => signInWithPopup(auth, provider);
$("logoutBtn").onclick = () => signOut(auth);
$("modalClose").onclick = closeModal;
$("addStudentBtn").onclick = openStudentForm;
$("studentSearch").oninput = renderStudents;
$("saveSettingsBtn").onclick = () => {
  localStorage.setItem("service_ai_endpoint", $("aiEndpoint").value.trim());
  toast("設定已儲存");
};

document.querySelectorAll(".nav").forEach(btn => btn.onclick = () => switchView(btn.dataset.view));
$("modal").onclick = e => { if(e.target === $("modal")) closeModal(); };

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
        生理性別：${esc(s.biologicalSex || "")}
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
  const s = students.find(x => x.id === id) || {};
  openModal(`
    <h2>${id ? "修改學生資料" : "新增學生"}</h2>
    <form id="studentForm" class="form-grid">
      <div><label>學生姓名</label><input name="name" class="field" required value="${esc(s.name||"")}"></div>
      <div><label>生理性別</label><select name="biologicalSex" class="field"><option></option><option ${s.biologicalSex==="男"?"selected":""}>男</option><option ${s.biologicalSex==="女"?"selected":""}>女</option></select></div>
      <div><label>學號</label><input name="studentId" class="field" required value="${esc(s.studentId||"")}"></div>
      <div><label>科系／班級</label><input name="department" class="field" value="${esc(s.department||"")}"></div>
      <div><label>學制</label><input name="program" class="field" value="${esc(s.program||"")}"></div>
      <div><label>年級</label><input name="grade" class="field" value="${esc(s.grade||"")}"></div>
      <div class="full"><label>問題類型</label>
        <div class="check-grid">${["心理困擾","精神疾病","感情交往","人際關係","生涯學習","行為問題","諮詢服務","申訴事件","其他"].map(x => `<label><input type="checkbox" name="issues" value="${x}" ${(s.issues||[]).includes(x)?"checked":""}> ${x}</label>`).join("")}</div>
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
      issues: fd.getAll("issues"),
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
      <div><label>日期</label><input name="date" type="date" class="field" required value="${new Date().toISOString().slice(0,10)}"></div>
      <div><label>對象</label><select name="target" class="field"><option>學生本人</option><option>家長</option><option>導師</option><option>授課教師</option><option>其他</option></select></div>
      <div><label>方式</label><select name="method" class="field"><option>面談</option><option>電話</option><option>LINE／訊息</option><option>電子郵件</option><option>會議</option><option>其他</option></select></div>
      <div><label>類型</label><select name="type" class="field"><option>關懷與追蹤</option><option>學習輔導</option><option>生活輔導</option><option>心理支持</option><option>行政協助</option><option>轉介與資源連結</option><option>其他</option></select></div>
      <div class="full ai-box">
        <label>內容摘述</label>
        <textarea id="summaryInput" name="summary" class="field" placeholder="先用口語輸入這次服務內容，再按 AI 潤飾。" required></textarea>
        <div class="ai-actions">
          <button type="button" id="aiPolishBtn" class="ghost-btn">✨ AI 潤飾內容摘述</button>
          <button type="button" id="restoreOriginalBtn" class="ghost-btn">還原原文</button>
        </div>
        <p class="hint">AI 只會收到此欄文字，請仍避免輸入學生姓名、學號等直接識別資料。</p>
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
    await addDoc(collection(db,"teachers",currentUser.uid,"students",studentId,"records"),{
      studentId,
      studentName:s.name,
      date:fd.get("date"),
      target:fd.get("target"),
      method:fd.get("method"),
      type:fd.get("type"),
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
    <div class="meta">學號：${esc(s.studentId)}　科系／班級：${esc(s.department||"")}　生理性別：${esc(s.biologicalSex||"")}</div>
    <table class="record-table">
      <thead><tr><th>次數</th><th>日期</th><th>對象</th><th>方式</th><th>類型</th><th>內容摘述</th><th>操作</th></tr></thead>
      <tbody>${records.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.date)}</td><td>${esc(r.target)}</td><td>${esc(r.method)}</td><td>${esc(r.type)}</td><td>${esc(r.summary)}</td><td><button class="danger-btn" data-delete-record="${r.id}">刪除</button></td></tr>`).join("")}</tbody>
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
  $("recentRecords").innerHTML = recentRecords.length ? `<table class="record-table"><thead><tr><th>日期</th><th>學生</th><th>對象</th><th>方式</th><th>類型</th><th>內容摘述</th></tr></thead><tbody>${recentRecords.slice(0,30).map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.student.name)}</td><td>${esc(r.target)}</td><td>${esc(r.method)}</td><td>${esc(r.type)}</td><td>${esc(r.summary)}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">目前沒有服務紀錄。</div>';
}

async function exportStudentWorkbook(student, records){
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("服務紀錄");
  ws.pageSetup = {paperSize:9, orientation:"portrait", fitToPage:true, fitToWidth:1, fitToHeight:0, margins:{left:0.5,right:0.5,top:0.5,bottom:0.5,header:0.2,footer:0.2}};
  ws.columns = [
    {width:8},{width:13},{width:13},{width:13},{width:13},{width:45}
  ];
  ws.mergeCells("A1:F1");
  ws.getCell("A1").value = "明新科技大學 學務處 健康與諮商中心資源教室\n學生服務記錄表";
  ws.getCell("A1").alignment = {horizontal:"center",vertical:"middle",wrapText:true};
  ws.getCell("A1").font = {name:"標楷體",size:18,bold:true};
  ws.getRow(1).height = 48;

  ws.mergeCells("A2:F2"); ws.getCell("A2").value="一、基本資料";
  ws.getCell("A2").font={name:"標楷體",size:14,bold:true};

  ws.getCell("A3").value="學生姓名"; ws.mergeCells("B3:C3"); ws.getCell("B3").value=student.name;
  ws.getCell("D3").value="生理性別"; ws.mergeCells("E3:F3"); ws.getCell("E3").value=student.biologicalSex==="男" ? "■ 1. 男  □ 2. 女" : student.biologicalSex==="女" ? "□ 1. 男  ■ 2. 女" : "□ 1. 男  □ 2. 女";
  ws.getCell("A4").value="學號"; ws.mergeCells("B4:C4"); ws.getCell("B4").value=student.studentId;
  ws.getCell("D4").value="科系"; ws.mergeCells("E4:F4"); ws.getCell("E4").value=student.department;
  ws.getCell("A5").value="學制"; ws.mergeCells("B5:C5"); ws.getCell("B5").value=student.program;
  ws.getCell("D5").value="年級"; ws.mergeCells("E5:F5"); ws.getCell("E5").value=student.grade;

  ws.mergeCells("A6:B8"); ws.getCell("A6").value="問題類型";
  const issues=["心理困擾","精神疾病","感情交往","人際關係","生涯學習","行為問題","諮詢服務","申訴事件","其他"];
  const cells=["C6","D6","F6","C7","D7","F7","C8","D8","F8"];
  issues.forEach((x,i)=>ws.getCell(cells[i]).value=`${(student.issues||[]).includes(x)?"■":"□"}${i+1}.${x}`);

  ws.mergeCells("A10:F10"); ws.getCell("A10").value="二、服務紀錄";
  ws.getCell("A10").font={name:"標楷體",size:14,bold:true};
  ["次數","日期","對象","方式","類型","內容摘述"].forEach((x,i)=>ws.getCell(11,i+1).value=x);

  const minRows=Math.max(records.length,10);
  for(let i=0;i<minRows;i++){
    const row=12+i;
    const r=records[i];
    ws.getCell(row,1).value=i+1;
    if(r){
      ws.getCell(row,2).value=r.date;
      ws.getCell(row,3).value=r.target;
      ws.getCell(row,4).value=r.method;
      ws.getCell(row,5).value=r.type;
      ws.getCell(row,6).value=r.summary;
    }
    ws.getRow(row).height=45;
  }

  const end=11+minRows;
  ws.getRange = undefined;
  for(let r=2;r<=end;r++){
    for(let c=1;c<=6;c++){
      const cell=ws.getCell(r,c);
      cell.font={...(cell.font||{}),name:"標楷體",size:12};
      cell.alignment={vertical:"middle",horizontal:c===6?"left":"center",wrapText:true};
      cell.border={top:{style:"thin"},left:{style:"thin"},bottom:{style:"thin"},right:{style:"thin"}};
    }
  }
  for(let c=1;c<=6;c++){ ws.getCell(11,c).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFE7E6E6"}}; ws.getCell(11,c).font={name:"標楷體",size:12,bold:true}; }

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
