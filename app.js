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
  const wb = new ExcelJS.Workbook();
  wb.creator = "MUST Resource Center Service Record System";
  const ws = wb.addWorksheet("學生服務記錄表", {properties:{defaultRowHeight:20}});

  ws.pageSetup = {
    paperSize:9,
    orientation:"portrait",
    fitToPage:true,
    fitToWidth:1,
    fitToHeight:0,
    margins:{left:0.24,right:0.24,top:0.28,bottom:0.28,header:0.12,footer:0.12}
  };

  /*
    使用 12 個窄欄位，再依區塊合併。
    這樣基本資料的「學生姓名、學生障別」不會被壓縮，
    服務紀錄表也能維持 A4 直式與較寬的內容摘述欄。
  */
  ws.columns = [
    {width:4.2},{width:4.2},          // A-B：次數／基本資料標題
    {width:6.2},{width:6.2},          // C-D：日期／姓名內容
    {width:5.8},{width:5.8},          // E-F：對象／學號內容
    {width:5.8},{width:5.8},          // G-H：方式／科系內容
    {width:5.8},{width:5.8},          // I-J：類型／其他內容
    {width:15.5},{width:15.5}         // K-L：內容摘述
  ];

  const thinBorder = {
    top:{style:"thin",color:{argb:"FF000000"}},
    left:{style:"thin",color:{argb:"FF000000"}},
    bottom:{style:"thin",color:{argb:"FF000000"}},
    right:{style:"thin",color:{argb:"FF000000"}}
  };

  function styleRange(r1,c1,r2,c2,{bold=false,size=12,align="center",vertical="middle",fill=null,wrap=true}={}){
    for(let r=r1;r<=r2;r++){
      for(let c=c1;c<=c2;c++){
        const cell=ws.getCell(r,c);
        cell.font={name:"標楷體",size,bold};
        cell.alignment={horizontal:align,vertical,wrapText:wrap,shrinkToFit:false};
        cell.border=thinBorder;
        if(fill) cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:fill}};
      }
    }
  }

  // 標題
  ws.mergeCells("A1:L1");
  ws.getCell("A1").value="明新科技大學　學務處　健康與諮商中心資源教室\n學生服務記錄表";
  ws.getCell("A1").font={name:"標楷體",size:18,bold:true};
  ws.getCell("A1").alignment={horizontal:"center",vertical:"middle",wrapText:true};
  ws.getRow(1).height=46;

  // 一、基本資料
  ws.mergeCells("A2:L2");
  ws.getCell("A2").value="一、基本資料";
  styleRange(2,1,2,12,{bold:true,size:14,align:"left",wrap:false});

  // 第3列：學生姓名／生理性別
  ws.mergeCells("A3:B3"); ws.getCell("A3").value="學生姓名";
  ws.mergeCells("C3:F3"); ws.getCell("C3").value=student.name || "";
  ws.mergeCells("G3:H3"); ws.getCell("G3").value="生理性別";
  ws.mergeCells("I3:L3");
  ws.getCell("I3").value=student.biologicalSex==="男"
    ? "■ 1. 男　□ 2. 女"
    : student.biologicalSex==="女"
      ? "□ 1. 男　■ 2. 女"
      : "□ 1. 男　□ 2. 女";

  // 第4列：學號／科系班級
  ws.mergeCells("A4:B4"); ws.getCell("A4").value="學號";
  ws.mergeCells("C4:F4"); ws.getCell("C4").value=student.studentId || "";
  ws.mergeCells("G4:H4"); ws.getCell("G4").value="科系／班級";
  ws.mergeCells("I4:L4"); ws.getCell("I4").value=student.department || "";

  // 第5列：學制／年級
  ws.mergeCells("A5:B5"); ws.getCell("A5").value="學制";
  ws.mergeCells("C5:F5"); ws.getCell("C5").value=student.program || "";
  ws.mergeCells("G5:H5"); ws.getCell("G5").value="年級";
  ws.mergeCells("I5:L5"); ws.getCell("I5").value=student.grade || "";

  // 第6、7列：學生障別／備註
  ws.mergeCells("A6:B6"); ws.getCell("A6").value="學生障別";
  ws.mergeCells("C6:L6"); ws.getCell("C6").value=displayMulti(student.disabilities || student.issues || []) || "未填";

  ws.mergeCells("A7:B7"); ws.getCell("A7").value="備註";
  ws.mergeCells("C7:L7"); ws.getCell("C7").value=student.studentNote || "";

  styleRange(3,1,7,12,{size:12});
  ["A3","G3","A4","G4","A5","G5","A6","A7"].forEach(addr=>{
    ws.getCell(addr).font={name:"標楷體",size:12,bold:true};
    ws.getCell(addr).alignment={horizontal:"center",vertical:"middle",wrapText:false,shrinkToFit:false};
  });
  ["C3","I3","C4","I4","C5","I5","C6","C7"].forEach(addr=>{
    ws.getCell(addr).alignment={horizontal:"left",vertical:"middle",wrapText:true,shrinkToFit:false};
  });

  ws.getRow(3).height=25;
  ws.getRow(4).height=25;
  ws.getRow(5).height=25;
  ws.getRow(6).height=Math.max(25, Math.min(55, 18 + estimateExcelTextLines(ws.getCell("C6").value, 78)*15));
  ws.getRow(7).height=Math.max(25, Math.min(90, 18 + estimateExcelTextLines(ws.getCell("C7").value, 78)*15));

  // 服務類型統計
  const typeCounts={};
  records.forEach(r=>asArray(r.types || r.type).forEach(t=>{
    if(t) typeCounts[t]=(typeCounts[t]||0)+1;
  }));
  const typeEntries=Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]);

  ws.mergeCells("A8:D9"); ws.getCell("A8").value="服務類型統計";
  ws.mergeCells("E8:L9");
  ws.getCell("E8").value=typeEntries.length
    ? typeEntries.map(([name,count])=>`${name}：${count} 次`).join("　")
    : "";
  styleRange(8,1,9,12,{size:12});
  ws.getCell("A8").font={name:"標楷體",size:12,bold:true};
  ws.getCell("A8").alignment={horizontal:"center",vertical:"middle",wrapText:false};
  ws.getCell("E8").alignment={horizontal:"left",vertical:"middle",wrapText:true};
  const statsLines=estimateExcelTextLines(ws.getCell("E8").value, 72);
  ws.getRow(8).height=Math.max(24,Math.min(60,18+statsLines*15));
  ws.getRow(9).height=18;

  // 二、服務紀錄
  ws.mergeCells("A10:L10");
  ws.getCell("A10").value="二、服務紀錄";
  styleRange(10,1,10,12,{bold:true,size:14,align:"left",wrap:false});

  // 表頭：用合併儲存格建立較精準欄寬
  ws.mergeCells("A11:B11"); ws.getCell("A11").value="次數";
  ws.mergeCells("C11:D11"); ws.getCell("C11").value="日期";
  ws.mergeCells("E11:F11"); ws.getCell("E11").value="對象";
  ws.mergeCells("G11:H11"); ws.getCell("G11").value="方式";
  ws.mergeCells("I11:J11"); ws.getCell("I11").value="類型";
  ws.mergeCells("K11:L11"); ws.getCell("K11").value="內容摘述";
  styleRange(11,1,11,12,{bold:true,size:12,fill:"FFE7E6E6",wrap:false});
  ws.getRow(11).height=24;

  const minRows=Math.max(records.length,8);

  for(let i=0;i<minRows;i++){
    const row=12+i;
    ws.mergeCells(row,1,row,2);
    ws.mergeCells(row,3,row,4);
    ws.mergeCells(row,5,row,6);
    ws.mergeCells(row,7,row,8);
    ws.mergeCells(row,9,row,10);
    ws.mergeCells(row,11,row,12);

    const r=records[i];
    ws.getCell(row,1).value=i+1;

    let rowHeight=38;
    if(r){
      const targets=displayMulti(r.targets || r.target);
      const methods=displayMulti(r.methods || r.method);
      const types=displayMulti(r.types || r.type);
      const summary=String(r.summary || "");

      ws.getCell(row,3).value=r.date || "";
      ws.getCell(row,5).value=targets;
      ws.getCell(row,7).value=methods;
      ws.getCell(row,9).value=types;
      ws.getCell(row,11).value=summary;

      /*
        K:L 合併後實際內容寬度約 31 個英文寬字元；
        中文以雙寬估算。列高只保留必要空間，不再過度放大。
      */
      const summaryLines=estimateExcelTextLines(summary,58);
      const otherLines=Math.max(
        estimateExcelTextLines(targets,18),
        estimateExcelTextLines(methods,18),
        estimateExcelTextLines(types,18),
        1
      );
      const neededLines=Math.max(summaryLines,otherLines);
      rowHeight=Math.max(38,Math.min(409,10+neededLines*16.8));
    }

    styleRange(row,1,row,12,{size:12,vertical:"top"});
    [1,3,5,7,9].forEach(c=>{
      ws.getCell(row,c).alignment={horizontal:"center",vertical:"top",wrapText:true,shrinkToFit:false};
    });
    ws.getCell(row,11).alignment={horizontal:"left",vertical:"top",wrapText:true,shrinkToFit:false};
    ws.getRow(row).height=rowHeight;
  }

  ws.views=[{showGridLines:false}];
  ws.printArea=`A1:L${11+minRows}`;
  ws.pageSetup.printTitlesRow="1:11";

  const buffer=await wb.xlsx.writeBuffer();
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([buffer],{
    type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }));
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
