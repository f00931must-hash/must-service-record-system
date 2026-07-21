const SERVICE_RECORD_BUILD = "v0.4.0";
const DEFAULT_AI_ENDPOINT = "https://must-resource-ai.f00931-must.workers.dev/ai/polish";
console.log("MUST Service Record System build", SERVICE_RECORD_BUILD);
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

function currentAcademicYearROC(){
  const now = new Date();
  const y = now.getFullYear() - 1911;
  return now.getMonth() >= 7 ? y : y - 1;
}

function gradeNumberToText(n){
  const map = {1:"一",2:"二",3:"三",4:"四",5:"五",6:"六",7:"七"};
  return map[n] || String(n);
}

function calculatedGrade(student){
  const entry = Number(student.entryAcademicYear || 0);
  if(!entry) return student.grade || "";
  const n = currentAcademicYearROC() - entry + 1;
  if(n < 1) return "尚未入學";
  const prefix = String(student.program || "").includes("研") ? "研" : "大";
  const suffix = student.gradeSuffix || "";
  return `${prefix}${gradeNumberToText(n)}${suffix}`;
}

function splitTextByDisplayUnits(text, maxUnits=820){
  const source = String(text || "");
  if(!source) return [""];
  const parts = [];
  let current = "";
  let units = 0;

  const charUnits = ch => /[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60]/.test(ch) ? 2 : 1;

  for(const ch of source){
    const u = ch === "\n" ? 0 : charUnits(ch);
    if((units + u > maxUnits) && current){
      parts.push(current);
      current = "";
      units = 0;
    }
    current += ch;
    units += u;
    if(ch === "\n" && units > maxUnits * 0.82){
      parts.push(current);
      current = "";
      units = 0;
    }
  }
  if(current || !parts.length) parts.push(current);
  return parts;
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
  const endpoint = $("aiEndpoint").value.trim() || DEFAULT_AI_ENDPOINT;
  localStorage.setItem("service_ai_endpoint", endpoint);
  $("aiEndpoint").value = endpoint;
  toast("AI 安全代理網址已儲存");
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
  $("aiEndpoint").value = localStorage.getItem("service_ai_endpoint") || DEFAULT_AI_ENDPOINT;
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
  const list = students.filter(s => [s.name,s.studentId,s.department,calculatedGrade(s)].join(" ").toLowerCase().includes(key));
  $("studentList").innerHTML = list.length ? list.map(s => `
    <article class="student-card">
      <h3>${esc(s.name)}</h3>
      <div class="meta">
        學號：${esc(s.studentId)}<br>
        科系／班級：${esc(s.department)}<br>
        學制／年級：${esc(s.program || "")} ${esc(calculatedGrade(s))}<br>
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
      <div><label>學制</label><input name="program" class="field" value="${esc(s.program||"")}" placeholder="例如：四技、二技、碩士班"></div>
      <div><label>入學學年度（民國）</label><input id="entryAcademicYearInput" name="entryAcademicYear" type="number" class="field" value="${esc(s.entryAcademicYear||"")}" placeholder="例如：114"></div>
      <div><label>班級後綴</label><input id="gradeSuffixInput" name="gradeSuffix" class="field" value="${esc(s.gradeSuffix||"")}" placeholder="例如：甲"></div>
      <div><label>目前年級（自動計算）</label><input id="gradePreview" class="field" readonly value="${esc(calculatedGrade(s))}" placeholder="填入學年度後自動顯示"></div>
      <div class="full"><label>舊資料年級（僅未填入學年度時使用）</label><input name="grade" class="field" value="${esc(s.grade||"")}" placeholder="例如：大一甲"></div>
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

  const updateGradePreview = () => {
    const entry = Number($("entryAcademicYearInput")?.value || 0);
    const program = $("studentForm")?.elements?.program?.value || "";
    const suffix = $("gradeSuffixInput")?.value || "";
    if(!entry){
      $("gradePreview").value = $("studentForm")?.elements?.grade?.value || "";
      return;
    }
    const n = currentAcademicYearROC() - entry + 1;
    const prefix = program.includes("研") ? "研" : "大";
    $("gradePreview").value = n < 1 ? "尚未入學" : `${prefix}${gradeNumberToText(n)}${suffix}`;
  };
  $("entryAcademicYearInput")?.addEventListener("input", updateGradePreview);
  $("gradeSuffixInput")?.addEventListener("input", updateGradePreview);
  $("studentForm")?.elements?.program?.addEventListener("input", updateGradePreview);
  $("studentForm")?.elements?.grade?.addEventListener("input", updateGradePreview);
  updateGradePreview();

  $("studentForm").onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      name: fd.get("name"),
      biologicalSex: fd.get("biologicalSex"),
      studentId: fd.get("studentId"),
      department: fd.get("department"),
      program: fd.get("program"),
      entryAcademicYear: fd.get("entryAcademicYear") ? Number(fd.get("entryAcademicYear")) : null,
      gradeSuffix: fd.get("gradeSuffix") || "",
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
    const endpoint = localStorage.getItem("service_ai_endpoint") || DEFAULT_AI_ENDPOINT;
    $("aiPolishBtn").disabled = true;
    $("aiPolishBtn").textContent = "AI 潤飾中...";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try{
      const res = await fetch(endpoint,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"polish", text}),
        signal:controller.signal
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok || data.success === false){
        throw new Error(data.error || `伺服器回應錯誤（${res.status}）`);
      }
      const polished = String(data.polished || data.result || data.text || "").trim();
      if(!polished) throw new Error("AI 未回傳潤飾內容");
      $("summaryInput").value = polished;
      toast("AI 潤飾完成，請確認內容後再儲存");
    }catch(err){
      console.error(err);
      const message = err?.name === "AbortError"
        ? "AI 回應逾時，請稍後再試。"
        : (err?.message || "未知錯誤");
      alert("AI 潤飾失敗：" + message);
    }finally{
      clearTimeout(timeoutId);
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
      學號：${esc(s.studentId)}　科系／班級：${esc(s.department||"")}　生理性別：${esc(s.biologicalSex||"")}　年級：${esc(calculatedGrade(s))}<br>
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
    const wb = new ExcelJS.Workbook();
    wb.creator = "MUST Resource Center";
    wb.created = new Date();

    const ws = wb.addWorksheet("學生服務記錄表", {
      properties:{defaultRowHeight:20},
      pageSetup:{
        paperSize:9,
        orientation:"portrait",
        fitToPage:true,
        fitToWidth:1,
        fitToHeight:0,
        horizontalCentered:true,
        verticalCentered:false,
        margins:{left:0.18,right:0.18,top:0.25,bottom:0.25,header:0.1,footer:0.1}
      }
    });

    /*
      使用 30 個細欄位建立固定版面。
      基本資料與服務紀錄各自使用不同合併範圍，
      不會再出現加寬「學生障別」後擠壓「學生姓名」的情況。
    */
    for(let c=1;c<=30;c++){
      ws.getColumn(c).width = 3.35;
    }

    const border = {
      top:{style:"thin",color:{argb:"FF000000"}},
      left:{style:"thin",color:{argb:"FF000000"}},
      bottom:{style:"thin",color:{argb:"FF000000"}},
      right:{style:"thin",color:{argb:"FF000000"}}
    };

    const merge = (row, startCol, endCol, value="") => {
      ws.mergeCells(row,startCol,row,endCol);
      const cell=ws.getCell(row,startCol);
      cell.value=value;
      return cell;
    };

    const styleArea = (r1,c1,r2,c2,{
      size=11,
      bold=false,
      horizontal="center",
      vertical="middle",
      wrap=true,
      fill=null
    }={}) => {
      for(let r=r1;r<=r2;r++){
        for(let c=c1;c<=c2;c++){
          const cell=ws.getCell(r,c);
          cell.font={name:"標楷體",size,bold};
          cell.alignment={
            horizontal,
            vertical,
            wrapText:wrap,
            shrinkToFit:false
          };
          cell.border=border;
          if(fill){
            cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:fill}};
          }
        }
      }
    };

    // 標題
    merge(1,1,30,"明新科技大學　學務處　健康與諮商中心資源教室\n學生服務記錄表");
    ws.getCell("A1").font={name:"標楷體",size:17,bold:true};
    ws.getCell("A1").alignment={horizontal:"center",vertical:"middle",wrapText:true};
    ws.getRow(1).height=45;

    // 一、基本資料
    merge(2,1,30,"一、基本資料");
    styleArea(2,1,2,30,{size:13,bold:true,horizontal:"left",wrap:false});
    ws.getRow(2).height=22;

    // 基本資料欄位：左標題 4 格、左內容 7 格、右標題 4 格、右內容 15 格
    merge(3,1,4,"學生姓名");
    merge(3,5,11,student.name || "");
    merge(3,12,15,"生理性別");
    merge(3,16,30,
      student.biologicalSex==="男"
        ? "■ 1. 男　□ 2. 女"
        : student.biologicalSex==="女"
          ? "□ 1. 男　■ 2. 女"
          : "□ 1. 男　□ 2. 女"
    );

    merge(4,1,4,"學號");
    merge(4,5,11,student.studentId || "");
    merge(4,12,15,"科系／班級");
    merge(4,16,30,student.department || "");

    merge(5,1,4,"學制");
    merge(5,5,11,student.program || "");
    merge(5,12,15,"年級");
    merge(5,16,30,calculatedGrade(student));

    merge(6,1,4,"學生障別");
    merge(6,5,30,displayMulti(student.disabilities || student.issues || []) || "未填");

    merge(7,1,4,"備註");
    merge(7,5,30,student.studentNote || "");

    styleArea(3,1,7,30,{size:11});
    ["A3","L3","A4","L4","A5","L5","A6","A7"].forEach(addr=>{
      ws.getCell(addr).font={name:"標楷體",size:11,bold:true};
      ws.getCell(addr).alignment={
        horizontal:"center",
        vertical:"middle",
        wrapText:false,
        shrinkToFit:false
      };
    });
    ["E3","P3","E4","P4","E5","P5","E6","E7"].forEach(addr=>{
      ws.getCell(addr).alignment={
        horizontal:"left",
        vertical:"middle",
        wrapText:true,
        shrinkToFit:false
      };
    });

    ws.getRow(3).height=23;
    ws.getRow(4).height=23;
    ws.getRow(5).height=23;
    ws.getRow(6).height=Math.max(
      23,
      Math.min(55, 14 + estimateExcelTextLines(
        displayMulti(student.disabilities || student.issues || []), 70
      ) * 15)
    );
    ws.getRow(7).height=Math.max(
      23,
      Math.min(85, 14 + estimateExcelTextLines(student.studentNote || "",70) * 15)
    );

    // 服務類型統計
    const typeCounts={};
    records.forEach(r=>{
      asArray(r.types || r.type).forEach(type=>{
        if(type) typeCounts[type]=(typeCounts[type] || 0)+1;
      });
    });
    const typeText=Object.entries(typeCounts)
      .sort((a,b)=>b[1]-a[1])
      .map(([name,count])=>`${name}：${count} 次`)
      .join("　");

    merge(8,1,7,"服務類型統計");
    merge(8,8,30,typeText);
    styleArea(8,1,8,30,{size:11});
    ws.getCell("A8").font={name:"標楷體",size:11,bold:true};
    ws.getCell("A8").alignment={horizontal:"center",vertical:"middle",wrapText:false};
    ws.getCell("H8").alignment={horizontal:"left",vertical:"middle",wrapText:true};
    ws.getRow(8).height=Math.max(
      26,
      Math.min(60, 14 + estimateExcelTextLines(typeText,60) * 15)
    );

    // 二、服務紀錄
    merge(9,1,30,"二、服務紀錄");
    styleArea(9,1,9,30,{size:13,bold:true,horizontal:"left",wrap:false});
    ws.getRow(9).height=22;

    /*
      服務紀錄欄位重新分配：
      次數 A:B（2欄）
      日期 C:E（3欄）
      對象 F:H（3欄）
      方式 I:K（3欄）
      類型 L:N（3欄）
      內容摘述 O:AD（16欄）
      配合整體欄寬加大，內容摘述可容納更多文字，減少列高與頁數。
    */
    merge(10,1,2,"次數");
    merge(10,3,5,"日期");
    merge(10,6,8,"對象");
    merge(10,9,11,"方式");
    merge(10,12,14,"類型");
    merge(10,15,30,"內容摘述");
    styleArea(10,1,10,30,{
      size:11,
      bold:true,
      fill:"FFE7E6E6",
      wrap:false
    });
    ws.getRow(10).height=23;

    /*
      內容摘述的列高依實際文字量精準估算：
      - estimateExcelTextLines 已包含手動換行，不再重複計算。
      - 每行只保留少量安全空間，避免列高過度放大。
      - 超過 Excel 單列安全高度時才拆成續列。
    */
    let outputRow = 11;

    records.forEach((r,recordIndex)=>{
      const targets=displayMulti(r.targets || r.target);
      const methods=displayMulti(r.methods || r.method);
      const types=displayMulti(r.types || r.type);
      const summary=String(r.summary || "");

      // 內容摘述欄更寬，單一續列可容納更多內容。
      const summaryParts=splitTextByDisplayUnits(summary, 1320);
      const firstRow=outputRow;
      const lastRow=outputRow + summaryParts.length - 1;

      if(lastRow > firstRow){
        ws.mergeCells(firstRow,1,lastRow,2);
        ws.mergeCells(firstRow,3,lastRow,5);
        ws.mergeCells(firstRow,6,lastRow,8);
        ws.mergeCells(firstRow,9,lastRow,11);
        ws.mergeCells(firstRow,12,lastRow,14);
      }else{
        ws.mergeCells(firstRow,1,firstRow,2);
        ws.mergeCells(firstRow,3,firstRow,5);
        ws.mergeCells(firstRow,6,firstRow,8);
        ws.mergeCells(firstRow,9,firstRow,11);
        ws.mergeCells(firstRow,12,firstRow,14);
      }

      ws.getCell(firstRow,1).value=recordIndex+1;
      ws.getCell(firstRow,3).value=r.date || "";
      ws.getCell(firstRow,6).value=targets;
      ws.getCell(firstRow,9).value=methods;
      ws.getCell(firstRow,12).value=types;

      summaryParts.forEach((part,partIndex)=>{
        const row=firstRow+partIndex;
        ws.mergeCells(row,15,row,30);
        ws.getCell(row,15).value=part;

        styleArea(row,1,row,30,{size:10.5,vertical:"middle"});

        [1,3,6,9,12].forEach(col=>{
          ws.getCell(row,col).alignment={
            horizontal:"center",
            vertical:"middle",
            wrapText:true,
            shrinkToFit:false
          };
        });

        ws.getCell(row,15).alignment={
          horizontal:"left",
          vertical:"top",
          wrapText:true,
          shrinkToFit:false
        };

        /*
          O:AD 共 16 個細欄；以 62 個顯示單位估算每行。
          不再額外重複加入換行數，只加固定上下留白。
        */
        /*
          Excel 的標楷體實際換行會比字元估算再多一點，
          尤其包含全形標點、引號與編號時更容易多換一行。
          因此每行容量由 62 調低為 56，並增加半行安全高度，
          只補足最後一行，不會像前版一樣留下大片空白。
        */
        const textLines=estimateExcelTextLines(part,56);
        const calculatedHeight=10 + textLines*15.8;
        ws.getRow(row).height=Math.max(
          35,
          Math.min(390, calculatedHeight)
        );
      });

      outputRow=lastRow+1;
    });

    // 至少保留八筆紀錄的空白列外觀。
    const minimumEndRow=18;
    while(outputRow<=minimumEndRow){
      ws.mergeCells(outputRow,1,outputRow,2);
      ws.mergeCells(outputRow,3,outputRow,5);
      ws.mergeCells(outputRow,6,outputRow,8);
      ws.mergeCells(outputRow,9,outputRow,11);
      ws.mergeCells(outputRow,12,outputRow,14);
      ws.mergeCells(outputRow,15,outputRow,30);
      ws.getCell(outputRow,1).value=outputRow-10;
      styleArea(outputRow,1,outputRow,30,{size:10.5,vertical:"middle"});
      ws.getRow(outputRow).height=32;
      outputRow++;
    }

    ws.views=[{showGridLines:false}];
    ws.pageSetup.printTitlesRow="10:10";
    ws.pageSetup.horizontalCentered=true;
    ws.printArea=`A1:AD${outputRow-1}`;

    const buffer=await wb.xlsx.writeBuffer();
    const link=document.createElement("a");
    link.href=URL.createObjectURL(new Blob([buffer],{
      type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }));
    link.download=`${student.name}_服務紀錄表.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
  }catch(err){
    console.error("Export failed",err);
    alert(`服務紀錄表產生失敗（${SERVICE_RECORD_BUILD}）：` + (err.message || err));
  }
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
