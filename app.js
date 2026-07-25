const SERVICE_RECORD_BUILD = "v1.0.3-migration-names-excel-readability";
const DEFAULT_AI_ENDPOINT = "https://must-resource-ai.f00931-must.workers.dev/ai/polish";
console.log("MUST Service Record System build", SERVICE_RECORD_BUILD);

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDocs, getDoc,
  query, where, orderBy, limit, serverTimestamp, writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig, allowedDomains } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
const $ = id => document.getElementById(id);

let currentUser = null;
let accessProfile = null;
let students = [];
let recentRecords = [];
let teacherDirectory = [];

const DISABILITY_OPTIONS = ["自閉症","情緒障礙","學習障礙","肢體障礙","智能障礙","視覺障礙","聽覺障礙","腦性麻痺","多重障礙"];
const TARGET_OPTIONS = ["學生本人","家長","導師","授課教師","同儕","校內行政人員","其他"];
const METHOD_OPTIONS = ["面談","電話","LINE／訊息","電子郵件","會議","到班觀察","其他"];
const SERVICE_TYPE_OPTIONS = ["關懷與追蹤","學習輔導","生活輔導","心理支持","行政協助","人際關係","轉介與資源連結","合理調整","ISP／個案會議","其他"];

function asArray(value){ if(Array.isArray(value)) return value.filter(Boolean); if(value===null||value===undefined||value==="") return []; return [String(value)]; }
function esc(v){ return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }
function currentAcademicYearROC(){ const now=new Date(); const y=now.getFullYear()-1911; return now.getMonth()>=7?y:y-1; }
function gradeNumberToText(n){ return ({1:"一",2:"二",3:"三",4:"四",5:"五",6:"六",7:"七"})[n]||String(n); }
function calculatedGrade(student){ const entry=Number(student.entryAcademicYear||0); if(!entry) return student.grade||""; const n=currentAcademicYearROC()-entry+1; if(n<1) return "尚未入學"; const prefix=String(student.program||"").includes("研")?"研":"大"; return `${prefix}${gradeNumberToText(n)}${student.gradeSuffix||""}`; }
function displayMulti(value){ return asArray(value).join("、"); }
function checkboxOptions(name,options,selected=[]){ const values=asArray(selected); return options.map(x=>`<label class="option-chip"><input type="checkbox" name="${name}" value="${esc(x)}" ${values.includes(x)?"checked":""}><span>${esc(x)}</span></label>`).join(""); }
function splitTextByDisplayUnits(text,maxUnits=820){ const source=String(text||""); if(!source) return [""]; const parts=[]; let current="",units=0; const charUnits=ch=>/[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60]/.test(ch)?2:1; for(const ch of source){ const u=ch==="\n"?0:charUnits(ch); if(units+u>maxUnits&&current){parts.push(current);current="";units=0;} current+=ch;units+=u;if(ch==="\n"&&units>maxUnits*.82){parts.push(current);current="";units=0;} } if(current||!parts.length)parts.push(current); return parts; }

function isAssistant(){ return accessProfile?.role === "assistant"; }
function isTeacher(){ return accessProfile?.role === "teacher" || accessProfile?.role === "admin"; }
function effectiveOwnerEmail(){ return isAssistant() ? accessProfile.ownerEmail : (currentUser?.email||"").toLowerCase(); }
function baseActorName(){ return accessProfile?.displayName || currentUser?.displayName || currentUser?.email || ""; }
function nameWithRole(name,role=accessProfile?.role){
  const raw=String(name||"").trim();
  if(!raw) return "";
  const suffix=role==="assistant"?"協作者":(role==="teacher"||role==="admin"?"老師":"");
  if(!suffix||raw.endsWith(suffix)) return raw;
  return `${raw}${suffix}`;
}
function actorLabel(){ return nameWithRole(baseActorName(),accessProfile?.role); }
function safeClone(obj){ return JSON.parse(JSON.stringify(obj||{})); }
function dateText(v){ if(!v) return ""; if(v?.toDate) return v.toDate().toLocaleString("zh-TW"); if(v instanceof Date) return v.toLocaleString("zh-TW"); return String(v); }

async function resolveAccess(user){
  const email=(user.email||"").toLowerCase();

  // 先沿用舊系統已存在的 authorizedTeachers/{uid}，避免尚未建立
  // settings/serviceAccess 時整個系統無法登入。
  try{
    const legacy=await getDoc(doc(db,"authorizedTeachers",user.uid));
    if(legacy.exists()&&legacy.data().enabled===true){
      const d=legacy.data();
      return {
        email,
        role:d.role||"teacher",
        ownerEmail:(d.ownerEmail||email).toLowerCase(),
        displayName:d.displayName||d.name||user.displayName||email
      };
    }
  }catch(err){
    console.warn("讀取既有 authorizedTeachers 授權失敗",err);
  }

  // Portal 新版同步完成後，再自動採用集中式 serviceAccess。
  try{
    const accessDoc=await getDoc(doc(db,"settings","serviceAccess"));
    if(accessDoc.exists()){
      const item=accessDoc.data()?.users?.[email];
      if(item?.enabled===true){
        return {email,role:item.role||"teacher",ownerEmail:(item.ownerEmail||email).toLowerCase(),displayName:item.displayName||item.name||user.displayName||email};
      }
    }
  }catch(err){
    console.warn("serviceAccess 尚未建立或暫時無法讀取，改用既有授權名單",err);
  }
  return null;
}

async function loadTeacherDirectory(){
  teacherDirectory=[{email:effectiveOwnerEmail(),displayName:actorLabel()}];
  let loaded=false;

  // Portal 新版同步名單：正式上線後優先採用。
  try{
    const snap=await getDoc(doc(db,"settings","serviceAccess"));
    const users=snap.exists()?snap.data().users||{}:{};
    const synced=Object.entries(users)
      .filter(([,u])=>u.enabled===true&&(u.role||"teacher")==="teacher")
      .map(([email,u])=>({email:email.toLowerCase(),displayName:nameWithRole(u.displayName||u.name||email,"teacher")}));
    if(synced.length){
      teacherDirectory=[...synced];
      loaded=true;
    }
  }catch(err){
    console.warn("Portal 服務紀錄權限名單尚未同步",err);
  }

  // 過渡期沿用既有 authorizedTeachers，讓目前所有老師即可互相轉移測試。
  if(!loaded){
    try{
      const legacySnap=await getDocs(collection(db,"authorizedTeachers"));
      const legacyTeachers=legacySnap.docs
        .map(d=>d.data())
        .filter(u=>u.enabled===true && u.email)
        .map(u=>({
          email:String(u.email).toLowerCase(),
          displayName:nameWithRole(u.displayName||u.name||u.email,"teacher")
        }));
      if(legacyTeachers.length) teacherDirectory=legacyTeachers;
    }catch(err){
      console.warn("無法讀取既有老師名單",err);
    }
  }

  if(!teacherDirectory.some(x=>x.email===effectiveOwnerEmail())){
    teacherDirectory.push({email:effectiveOwnerEmail(),displayName:actorLabel()});
  }
  teacherDirectory=[...new Map(teacherDirectory.map(x=>[x.email,x])).values()]
    .sort((a,b)=>a.displayName.localeCompare(b.displayName,"zh-Hant"));
}

async function writeAudit({action,targetType,targetId,studentId="",studentName="",ownerEmail=effectiveOwnerEmail(),before=null,after=null,detail=""}){
  await addDoc(collection(db,"auditLogs"),{
    system:"service-record",action,targetType,targetId,studentId,studentName,ownerEmail,
    actorEmail:(currentUser.email||"").toLowerCase(),actorName:actorLabel(),actorRole:accessProfile.role,
    before:before?safeClone(before):null,after:after?safeClone(after):null,detail,createdAt:serverTimestamp()
  });
}

$("loginBtn").onclick=async()=>{ const btn=$("loginBtn");btn.disabled=true;btn.textContent="登入中...";try{await signInWithPopup(auth,provider);}catch(err){const code=err?.code||"";if(["auth/popup-blocked","auth/popup-closed-by-user","auth/cancelled-popup-request"].includes(code)){await signInWithRedirect(auth,provider);return;}alert("Google 登入失敗："+(err.message||code||"未知錯誤"));}finally{btn.disabled=false;btn.textContent="使用 Google 帳號登入";} };
$("logoutBtn").onclick=()=>signOut(auth);
$("modalClose").onclick=closeModal;
$("addStudentBtn").onclick=()=>openStudentForm();
$("studentSearch").oninput=renderStudents;
$("saveSettingsBtn").onclick=()=>{const endpoint=$("aiEndpoint").value.trim()||DEFAULT_AI_ENDPOINT;localStorage.setItem("service_ai_endpoint",endpoint);$("aiEndpoint").value=endpoint;toast("AI 安全代理網址已儲存");};
document.querySelectorAll(".nav").forEach(btn=>btn.onclick=()=>switchView(btn.dataset.view));
$("modal").onclick=e=>{if(e.target===$("modal"))closeModal();};
getRedirectResult(auth).catch(err=>console.error("Google redirect result failed",err));

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(!user){$("loginView").classList.remove("hidden");$("appView").classList.add("hidden");return;}
  const domain=(user.email||"").split("@")[1]||"";
  if(allowedDomains.length&&!allowedDomains.includes(domain)){await signOut(auth);alert("此帳號不在允許的學校網域內。");return;}
  accessProfile=await resolveAccess(user);
  if(!accessProfile){await signOut(auth);alert("此帳號尚未取得服務紀錄系統權限，請由入口網站同步權限。");return;}
  $("loginView").classList.add("hidden");$("appView").classList.remove("hidden");
  $("userEmail").textContent=user.email||"";
  $("roleBadge").textContent=isAssistant()?"小幫手":"個管老師";
  document.querySelectorAll(".teacher-only").forEach(el=>el.classList.toggle("hidden",!isTeacher()));
  $("aiEndpoint").value=localStorage.getItem("service_ai_endpoint")||DEFAULT_AI_ENDPOINT;
  await loadTeacherDirectory(); await loadAll(); renderMigrationBox();
});

async function loadAll(){await loadStudents();await Promise.all([loadRecentRecords(),loadAuditLogs(),loadRecycleBin()]);if(isTeacher())renderTransferView();}
async function loadStudents(){const snap=await getDocs(query(collection(db,"students"),where("ownerEmail","==",effectiveOwnerEmail())));students=snap.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.deleted!==true).sort((a,b)=>(a.name||"").localeCompare(b.name||"","zh-Hant"));renderStudents();}

function renderStudents(){
  const key=($("studentSearch").value||"").trim().toLowerCase();
  const list=students.filter(s=>[s.name,s.studentId,s.department,calculatedGrade(s)].join(" ").toLowerCase().includes(key));
  $("studentList").innerHTML=list.length?list.map(s=>`<article class="student-card"><h3>${esc(s.name)}</h3><div class="meta">學號：${esc(s.studentId)}<br>科系／班級：${esc(s.department)}<br>學制／年級：${esc(s.program||"")} ${esc(calculatedGrade(s))}<br>生理性別：${esc(s.biologicalSex||"")}<br>學生障別：${esc(displayMulti(s.disabilities||s.issues||[]))||"未填"}</div><div class="card-actions"><button class="primary-btn" data-add-record="${s.id}">新增服務紀錄</button><button class="ghost-btn" data-view-student="${s.id}">查看紀錄</button><button class="ghost-btn" data-edit-student="${s.id}">修改學生</button>${isTeacher()?`<button class="ghost-btn" data-transfer-student="${s.id}">轉移</button>`:""}</div></article>`).join(""):'<div class="empty">目前沒有學生資料。</div>';
  document.querySelectorAll("[data-add-record]").forEach(b=>b.onclick=()=>openRecordForm(b.dataset.addRecord));
  document.querySelectorAll("[data-view-student]").forEach(b=>b.onclick=()=>openStudentRecords(b.dataset.viewStudent));
  document.querySelectorAll("[data-edit-student]").forEach(b=>b.onclick=()=>openStudentForm(b.dataset.editStudent));
  document.querySelectorAll("[data-transfer-student]").forEach(b=>b.onclick=()=>openTransferDialog([b.dataset.transferStudent]));
}

function studentPayload(fd){return {name:fd.get("name"),biologicalSex:fd.get("biologicalSex"),studentId:fd.get("studentId"),department:fd.get("department"),program:fd.get("program"),entryAcademicYear:fd.get("entryAcademicYear")?Number(fd.get("entryAcademicYear")):null,gradeSuffix:fd.get("gradeSuffix")||"",grade:fd.get("grade"),disabilities:fd.getAll("disabilities"),studentNote:fd.get("studentNote")||""};}

function openStudentForm(id=""){
  const s=students.find(x=>x.id===id)||{};const existing=s.disabilities||s.issues||[];
  openModal(`<h2>${id?"修改學生資料":"新增學生"}</h2><form id="studentForm" class="form-grid"><div><label>學生姓名</label><input name="name" class="field" required value="${esc(s.name||"")}"></div><div><label>生理性別</label><select name="biologicalSex" class="field"><option></option><option ${s.biologicalSex==="男"?"selected":""}>男</option><option ${s.biologicalSex==="女"?"selected":""}>女</option></select></div><div><label>學號</label><input name="studentId" class="field" required value="${esc(s.studentId||"")}"></div><div><label>科系／班級</label><input name="department" class="field" value="${esc(s.department||"")}"></div><div><label>學制</label><input name="program" class="field" value="${esc(s.program||"")}" placeholder="例如：四技、二技、碩士班"></div><div><label>入學學年度（民國）</label><input id="entryAcademicYearInput" name="entryAcademicYear" type="number" class="field" value="${esc(s.entryAcademicYear||"")}"></div><div><label>班級後綴</label><input id="gradeSuffixInput" name="gradeSuffix" class="field" value="${esc(s.gradeSuffix||"")}"></div><div><label>目前年級（自動計算）</label><input id="gradePreview" class="field" readonly value="${esc(calculatedGrade(s))}"></div><div class="full"><label>舊資料年級</label><input name="grade" class="field" value="${esc(s.grade||"")}"></div><div class="full"><label>學生障別</label><div class="option-grid">${checkboxOptions("disabilities",DISABILITY_OPTIONS,existing)}</div></div><div class="full"><label>備註</label><textarea name="studentNote" class="field">${esc(s.studentNote||"")}</textarea></div><div class="full card-actions"><button class="primary-btn" type="submit">儲存學生資料</button>${id&&isTeacher()?'<button class="danger-btn" type="button" id="deleteStudentBtn">移至回收桶</button>':""}</div></form>`);
  const updatePreview=()=>{$("gradePreview").value=calculatedGrade({entryAcademicYear:Number($("entryAcademicYearInput")?.value||0),program:$("studentForm")?.elements?.program?.value||"",gradeSuffix:$("gradeSuffixInput")?.value||"",grade:$("studentForm")?.elements?.grade?.value||""});};
  [$("entryAcademicYearInput"),$("gradeSuffixInput"),$("studentForm")?.elements?.program,$("studentForm")?.elements?.grade].forEach(el=>el?.addEventListener("input",updatePreview));
  $("studentForm").onsubmit=async e=>{e.preventDefault();const data=studentPayload(new FormData(e.target));if(id){const before=safeClone(s);await updateDoc(doc(db,"students",id),{...data,updatedAt:serverTimestamp(),updatedBy:(currentUser.email||"").toLowerCase()});await writeAudit({action:"update",targetType:"student",targetId:id,studentId:id,studentName:data.name,before,after:data});}else{const ref=await addDoc(collection(db,"students"),{...data,ownerEmail:effectiveOwnerEmail(),createdAt:serverTimestamp(),createdBy:(currentUser.email||"").toLowerCase(),updatedAt:serverTimestamp(),updatedBy:(currentUser.email||"").toLowerCase(),deleted:false});await writeAudit({action:"create",targetType:"student",targetId:ref.id,studentId:ref.id,studentName:data.name,after:data});}closeModal();toast("學生資料已儲存");await loadAll();};
  if(id&&isTeacher()) $("deleteStudentBtn").onclick=()=>softDeleteStudent(s);
}

async function softDeleteStudent(s){
  if(!confirm(`確定將「${s.name}」及其服務紀錄移至你的回收桶？資料仍可還原。`))return;
  const recSnap=await getDocs(query(collection(db,"records"),where("studentId","==",s.id),where("ownerEmail","==",effectiveOwnerEmail())));
  const batch=writeBatch(db);batch.update(doc(db,"students",s.id),{deleted:true,deletedAt:serverTimestamp(),deletedBy:(currentUser.email||"").toLowerCase(),updatedAt:serverTimestamp()});recSnap.docs.forEach(r=>batch.update(r.ref,{deleted:true,deletedAt:serverTimestamp(),deletedBy:(currentUser.email||"").toLowerCase()}));await batch.commit();
  await writeAudit({action:"delete",targetType:"student",targetId:s.id,studentId:s.id,studentName:s.name,before:s,detail:`學生與 ${recSnap.size} 筆服務紀錄移至回收桶`});closeModal();await loadAll();toast("已移至回收桶");
}

async function getStudentRecords(studentId,{includeDeleted=false}={}){const snap=await getDocs(query(collection(db,"records"),where("studentId","==",studentId),where("ownerEmail","==",effectiveOwnerEmail())));return snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>includeDeleted||r.deleted!==true).sort((a,b)=>(a.date||"").localeCompare(b.date||""));}

async function openRecordForm(studentId,recordId=""){
  const s=students.find(x=>x.id===studentId);if(!s)return;let existing={};if(recordId){const snap=await getDoc(doc(db,"records",recordId));existing=snap.exists()?{id:snap.id,...snap.data()}:{};}
  openModal(`<h2>${recordId?"修改":"新增"}服務紀錄｜${esc(s.name)}</h2><form id="recordForm" class="form-grid"><div class="full"><label>日期</label><input name="date" type="date" class="field date-field" required value="${esc(existing.date||new Date().toISOString().slice(0,10))}"></div><div class="full multi-section"><label>對象（可複選）</label><div class="option-grid">${checkboxOptions("targets",TARGET_OPTIONS,existing.targets||existing.target)}</div></div><div class="full multi-section"><label>方式（可複選）</label><div class="option-grid">${checkboxOptions("methods",METHOD_OPTIONS,existing.methods||existing.method)}</div></div><div class="full multi-section"><label>類型（可複選）</label><div class="option-grid">${checkboxOptions("types",SERVICE_TYPE_OPTIONS,existing.types||existing.type)}</div></div><div class="full ai-box"><label>內容摘述</label><textarea id="summaryInput" name="summary" class="field summary-editor" required>${esc(existing.summary||"")}</textarea><div class="ai-actions"><button type="button" id="aiPolishBtn" class="ghost-btn">✨ AI 潤飾內容摘述</button><button type="button" id="restoreOriginalBtn" class="ghost-btn">還原原文</button></div><p class="hint">AI 只會收到此欄文字。</p></div><div class="full"><button class="primary-btn" type="submit">儲存服務紀錄</button></div></form>`);
  let originalText=$("summaryInput").value;
  $("restoreOriginalBtn").onclick=()=>$("summaryInput").value=originalText;
  $("aiPolishBtn").onclick=async()=>{const text=$("summaryInput").value.trim();if(!text)return alert("請先輸入內容摘述。");originalText=text;const btn=$("aiPolishBtn");btn.disabled=true;btn.textContent="AI 潤飾中...";try{const res=await fetch(localStorage.getItem("service_ai_endpoint")||DEFAULT_AI_ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"polish",text})});const data=await res.json();if(!res.ok||data.success===false)throw new Error(data.error||`錯誤 ${res.status}`);$("summaryInput").value=String(data.polished||data.result||data.text||"").trim();toast("AI 潤飾完成");}catch(err){alert("AI 潤飾失敗："+(err.message||err));}finally{btn.disabled=false;btn.textContent="✨ AI 潤飾內容摘述";}};
  $("recordForm").onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const data={studentId,studentName:s.name,date:fd.get("date"),targets:fd.getAll("targets"),methods:fd.getAll("methods"),types:fd.getAll("types"),summary:fd.get("summary")};if(!data.targets.length||!data.methods.length||!data.types.length)return alert("對象、方式、類型都至少勾選一項。");if(recordId){const before=safeClone(existing);await updateDoc(doc(db,"records",recordId),{...data,updatedAt:serverTimestamp(),updatedBy:(currentUser.email||"").toLowerCase()});await writeAudit({action:"update",targetType:"record",targetId:recordId,studentId,studentName:s.name,before,after:data});}else{const ref=await addDoc(collection(db,"records"),{...data,ownerEmail:effectiveOwnerEmail(),createdAt:serverTimestamp(),createdBy:(currentUser.email||"").toLowerCase(),updatedAt:serverTimestamp(),updatedBy:(currentUser.email||"").toLowerCase(),deleted:false});await writeAudit({action:"create",targetType:"record",targetId:ref.id,studentId,studentName:s.name,after:data});}closeModal();toast("服務紀錄已儲存");await loadAll();};
}

async function openStudentRecords(studentId){
  const s=students.find(x=>x.id===studentId);const records=await getStudentRecords(studentId);
  openModal(`<h2>${esc(s.name)}｜服務紀錄</h2><div class="meta">學號：${esc(s.studentId)}　科系／班級：${esc(s.department||"")}　生理性別：${esc(s.biologicalSex||"")}　年級：${esc(calculatedGrade(s))}<br>學生障別：${esc(displayMulti(s.disabilities||s.issues||[]))||"未填"}${s.studentNote?`<br>備註：${esc(s.studentNote)}`:""}</div><table class="record-table"><thead><tr><th>次數</th><th>日期</th><th>對象</th><th>方式</th><th>類型</th><th>內容摘述</th><th>操作</th></tr></thead><tbody>${records.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.date)}</td><td>${esc(displayMulti(r.targets||r.target))}</td><td>${esc(displayMulti(r.methods||r.method))}</td><td>${esc(displayMulti(r.types||r.type))}</td><td class="summary-cell">${esc(r.summary)}</td><td><div class="record-actions"><button class="ghost-btn small-btn" data-edit-record="${r.id}">修改</button><button class="danger-btn small-btn" data-delete-record="${r.id}">移至回收桶</button></div></td></tr>`).join("")}</tbody></table><div class="card-actions"><button id="downloadExcelBtn" class="primary-btn">下載服務紀錄表</button><button class="ghost-btn" id="addRecordFromList">新增服務紀錄</button></div>`);
  $("downloadExcelBtn").onclick=()=>exportStudentWorkbook(s,records);$("addRecordFromList").onclick=()=>openRecordForm(studentId);
  document.querySelectorAll("[data-edit-record]").forEach(b=>b.onclick=()=>openRecordForm(studentId,b.dataset.editRecord));
  document.querySelectorAll("[data-delete-record]").forEach(b=>b.onclick=async()=>{const r=records.find(x=>x.id===b.dataset.deleteRecord);if(!confirm("確定移至回收桶？"))return;await updateDoc(doc(db,"records",r.id),{deleted:true,deletedAt:serverTimestamp(),deletedBy:(currentUser.email||"").toLowerCase()});await writeAudit({action:"delete",targetType:"record",targetId:r.id,studentId,studentName:s.name,before:r});await openStudentRecords(studentId);await loadAll();});
}

async function loadRecentRecords(){recentRecords=[];const snap=await getDocs(query(collection(db,"records"),where("ownerEmail","==",effectiveOwnerEmail())));recentRecords=snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.deleted!==true).sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,30);$("recentRecords").innerHTML=recentRecords.length?`<table class="record-table"><thead><tr><th>日期</th><th>學生</th><th>對象</th><th>方式</th><th>類型</th><th>內容摘述</th></tr></thead><tbody>${recentRecords.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.studentName)}</td><td>${esc(displayMulti(r.targets||r.target))}</td><td>${esc(displayMulti(r.methods||r.method))}</td><td>${esc(displayMulti(r.types||r.type))}</td><td class="summary-cell">${esc(r.summary)}</td></tr>`).join("")}</tbody></table>`:'<div class="empty">目前沒有服務紀錄。</div>';}

async function loadAuditLogs(){
  const email=(currentUser.email||"").toLowerCase();
  const snap=await getDocs(query(collection(db,"auditLogs"),where("actorEmail","==",email)));
  const logs=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).slice(0,100);
  const actionMap={create:"新增",update:"修改",delete:"移至回收桶",restore:"還原",transfer:"轉移"};
  const roleMap={teacher:"個管老師",assistant:"小幫手",admin:"系統管理員"};
  $("auditList").innerHTML=logs.length?logs.map(l=>{
    const actor=nameWithRole(l.actorName||l.actorEmail||"未記錄",l.actorRole);
    const role=roleMap[l.actorRole]||l.actorRole||"";
    return `<div class="audit-item"><div class="audit-head"><div><span class="audit-action">${actionMap[l.action]||esc(l.action)}｜${l.targetType==="student"?"學生":"服務紀錄"}</span><div class="audit-meta">${esc(l.studentName||"")}　${esc(dateText(l.createdAt))}<br>操作人：${esc(actor)}${role?`（${esc(role)}）`:""}</div></div><span class="status-pill">${esc(actor)}</span></div>${l.detail?`<div class="audit-detail">${esc(l.detail)}</div>`:""}</div>`;
  }).join(""):'<div class="empty">目前沒有操作紀錄。</div>';
}

async function loadRecycleBin(){
  const [ss,rs]=await Promise.all([getDocs(query(collection(db,"students"),where("ownerEmail","==",effectiveOwnerEmail()),where("deleted","==",true))),getDocs(query(collection(db,"records"),where("ownerEmail","==",effectiveOwnerEmail()),where("deleted","==",true)))]);
  const deletedStudents=ss.docs.map(d=>({id:d.id,...d.data()}));const deletedRecords=rs.docs.map(d=>({id:d.id,...d.data()}));
  const items=[...deletedStudents.map(x=>({...x,_type:"student"})),...deletedRecords.map(x=>({...x,_type:"record"}))].sort((a,b)=>(b.deletedAt?.seconds||0)-(a.deletedAt?.seconds||0));
  $("recycleList").innerHTML=items.length?items.map(x=>`<div class="recycle-item"><div class="recycle-head"><div><strong>${x._type==="student"?"學生":"服務紀錄"}｜${esc(x.name||x.studentName||"")}</strong><div class="audit-meta">刪除者：${esc(x.deletedBy||"")}　${esc(dateText(x.deletedAt))}</div>${x._type==="record"?`<div class="audit-detail">${esc(x.summary||"")}</div>`:""}</div><button class="primary-btn small-btn" data-restore-type="${x._type}" data-restore-id="${x.id}">還原</button></div></div>`).join(""):'<div class="empty">回收桶是空的。</div>';
  document.querySelectorAll("[data-restore-id]").forEach(b=>b.onclick=()=>restoreItem(b.dataset.restoreType,b.dataset.restoreId));
}

async function restoreItem(type,id){
  if(type==="student"){
    const snap=await getDoc(doc(db,"students",id));const s={id:snap.id,...snap.data()};const recSnap=await getDocs(query(collection(db,"records"),where("studentId","==",id),where("ownerEmail","==",effectiveOwnerEmail())));const batch=writeBatch(db);batch.update(doc(db,"students",id),{deleted:false,deletedAt:null,deletedBy:null,updatedAt:serverTimestamp(),updatedBy:(currentUser.email||"").toLowerCase()});recSnap.docs.forEach(r=>batch.update(r.ref,{deleted:false,deletedAt:null,deletedBy:null}));await batch.commit();await writeAudit({action:"restore",targetType:"student",targetId:id,studentId:id,studentName:s.name,after:s,detail:`學生與 ${recSnap.size} 筆紀錄已還原`});
  }else{const snap=await getDoc(doc(db,"records",id));const r={id:snap.id,...snap.data()};await updateDoc(doc(db,"records",id),{deleted:false,deletedAt:null,deletedBy:null,updatedAt:serverTimestamp(),updatedBy:(currentUser.email||"").toLowerCase()});await writeAudit({action:"restore",targetType:"record",targetId:id,studentId:r.studentId,studentName:r.studentName,after:r});}
  toast("資料已還原");await loadAll();
}

function renderTransferView(){
  const options=teacherDirectory.filter(t=>t.email!==effectiveOwnerEmail()).map(t=>`<option value="${esc(t.email)}">${esc(t.displayName)}（${esc(t.email)}）</option>`).join("");
  $("transferList").innerHTML=`<div class="transfer-bar"><div><label>轉交給</label><select id="batchTransferTarget" class="field"><option value="">請選擇個管老師</option>${options}</select></div><div><label>轉移原因</label><input id="batchTransferReason" class="field" placeholder="例如：學生轉系、個管分工調整"></div><button id="batchTransferBtn" class="primary-btn">轉移已勾選學生</button></div>${students.length?students.map(s=>`<label class="student-card student-select"><input type="checkbox" name="transferStudent" value="${s.id}"><span><strong>${esc(s.name)}</strong><br><span class="meta">${esc(s.studentId)}｜${esc(s.department||"")}</span></span></label>`).join(""):'<div class="empty">目前沒有學生資料。</div>'}`;
  $("batchTransferBtn")?.addEventListener("click",()=>{const ids=[...document.querySelectorAll('input[name="transferStudent"]:checked')].map(x=>x.value);openTransferDialog(ids,$("batchTransferTarget").value,$("batchTransferReason").value);});
}

function openTransferDialog(ids,presetTarget="",presetReason=""){
  if(!isTeacher())return alert("小幫手不能轉移學生。");if(!ids.length)return alert("請至少選擇一位學生。");
  const options=teacherDirectory.filter(t=>t.email!==effectiveOwnerEmail()).map(t=>`<option value="${esc(t.email)}" ${t.email===presetTarget?"selected":""}>${esc(t.displayName)}（${esc(t.email)}）</option>`).join("");
  openModal(`<h2>${ids.length===1?"轉移學生":"批次轉移學生"}</h2><p>即將轉移：${ids.map(id=>esc(students.find(s=>s.id===id)?.name||id)).join("、")}</p><label>新個管老師</label><select id="transferTarget" class="field"><option value="">請選擇</option>${options}</select><label style="margin-top:14px">轉移原因</label><textarea id="transferReason" class="field" required>${esc(presetReason)}</textarea><p class="danger-note">轉移後，原個管老師與其小幫手會立即看不到這些學生；新個管老師可立即接手。</p><button id="confirmTransferBtn" class="primary-btn">確認轉移</button>`);
  $("confirmTransferBtn").onclick=()=>executeTransfer(ids,$("transferTarget").value,$("transferReason").value.trim());
}

async function executeTransfer(ids,targetEmail,reason){
  if(!targetEmail)return alert("請選擇新個管老師。");if(!reason)return alert("請填寫轉移原因。");if(!confirm(`確定將 ${ids.length} 位學生轉交給 ${targetEmail}？`))return;
  for(const studentId of ids){const s=students.find(x=>x.id===studentId);const recSnap=await getDocs(query(collection(db,"records"),where("studentId","==",studentId),where("ownerEmail","==",effectiveOwnerEmail())));const batch=writeBatch(db);batch.update(doc(db,"students",studentId),{ownerEmail:targetEmail,updatedAt:serverTimestamp(),updatedBy:(currentUser.email||"").toLowerCase()});recSnap.docs.forEach(r=>batch.update(r.ref,{ownerEmail:targetEmail,updatedAt:serverTimestamp(),updatedBy:(currentUser.email||"").toLowerCase()}));await batch.commit();await writeAudit({action:"transfer",targetType:"student",targetId:studentId,studentId,studentName:s.name,ownerEmail:effectiveOwnerEmail(),before:{ownerEmail:effectiveOwnerEmail()},after:{ownerEmail:targetEmail},detail:`${effectiveOwnerEmail()} → ${targetEmail}\n原因：${reason}\n服務紀錄：${recSnap.size} 筆`});await addDoc(collection(db,"transferLogs"),{studentId,studentName:s.name,fromEmail:effectiveOwnerEmail(),toEmail:targetEmail,reason,operatorEmail:(currentUser.email||"").toLowerCase(),operatorName:actorLabel(),createdAt:serverTimestamp()});}
  closeModal();toast("學生已完成轉移");await loadAll();
}

function renderMigrationBox(){
  if(!isTeacher())return;
  $("migrationBox").innerHTML=`<h3>舊版資料移轉</h3><p class="hint">僅首次升級需要。會把目前帳號舊路徑 <code>teachers/{uid}/students</code> 複製到新版個人權限資料表，不會刪除舊資料。</p><button id="migrateLegacyBtn" class="ghost-btn">檢查並移轉我的舊資料</button><div id="migrationStatus" class="hint"></div>`;
  $("migrateLegacyBtn").onclick=migrateLegacyData;
}

async function migrateLegacyData(){
  const status=$("migrationStatus");status.textContent="檢查中…";
  try{const legacyStudents=await getDocs(collection(db,"teachers",currentUser.uid,"students"));if(legacyStudents.empty){status.textContent="沒有找到舊版資料。";return;}let studentCount=0,recordCount=0;for(const oldStudent of legacyStudents.docs){const old=oldStudent.data();const newRef=doc(db,"students",oldStudent.id);const existing=await getDoc(newRef);if(!existing.exists())await setDoc(newRef,{...old,ownerEmail:effectiveOwnerEmail(),createdBy:(currentUser.email||"").toLowerCase(),updatedBy:(currentUser.email||"").toLowerCase(),deleted:false,migratedFrom:`teachers/${currentUser.uid}/students/${oldStudent.id}`,migratedAt:serverTimestamp()});studentCount++;const oldRecords=await getDocs(collection(db,"teachers",currentUser.uid,"students",oldStudent.id,"records"));for(const oldRecord of oldRecords.docs){const newRecordRef=doc(db,"records",oldRecord.id);const exists=await getDoc(newRecordRef);if(!exists.exists())await setDoc(newRecordRef,{...oldRecord.data(),studentId:oldStudent.id,studentName:old.name||oldRecord.data().studentName||"",ownerEmail:effectiveOwnerEmail(),createdBy:(currentUser.email||"").toLowerCase(),updatedBy:(currentUser.email||"").toLowerCase(),deleted:false,migratedAt:serverTimestamp()});recordCount++;}}
    await writeAudit({action:"create",targetType:"migration",targetId:currentUser.uid,detail:`移轉 ${studentCount} 位學生、${recordCount} 筆服務紀錄`});status.className="success";status.textContent=`完成：${studentCount} 位學生、${recordCount} 筆服務紀錄。舊資料仍保留。`;await loadAll();
  }catch(err){console.error(err);status.className="danger-note";status.textContent="移轉失敗："+(err.message||err);}
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
      對象 F:I（4欄）
      方式 J:M（4欄）
      類型 N:R（5欄）
      內容摘述 S:AD（12欄）
      配合整體欄寬加大，內容摘述可容納更多文字，減少列高與頁數。
    */
    merge(10,1,2,"次數");
    merge(10,3,5,"日期");
    merge(10,6,9,"對象");
    merge(10,10,13,"方式");
    merge(10,14,18,"類型");
    merge(10,19,30,"內容摘述");
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
      const methodsExcel=asArray(r.methods || r.method).join("\n");
      const typesExcel=asArray(r.types || r.type).join("\n");
      const summary=String(r.summary || "");

      // 內容摘述欄更寬，單一續列可容納更多內容。
      const summaryParts=splitTextByDisplayUnits(summary, 1040);
      const firstRow=outputRow;
      const lastRow=outputRow + summaryParts.length - 1;

      if(lastRow > firstRow){
        ws.mergeCells(firstRow,1,lastRow,2);
        ws.mergeCells(firstRow,3,lastRow,5);
        ws.mergeCells(firstRow,6,lastRow,9);
        ws.mergeCells(firstRow,10,lastRow,13);
        ws.mergeCells(firstRow,14,lastRow,18);
      }else{
        ws.mergeCells(firstRow,1,firstRow,2);
        ws.mergeCells(firstRow,3,firstRow,5);
        ws.mergeCells(firstRow,6,firstRow,9);
        ws.mergeCells(firstRow,10,firstRow,13);
        ws.mergeCells(firstRow,14,firstRow,18);
      }

      ws.getCell(firstRow,1).value=recordIndex+1;
      ws.getCell(firstRow,3).value=r.date || "";
      ws.getCell(firstRow,6).value=targets;
      ws.getCell(firstRow,10).value=methodsExcel;
      ws.getCell(firstRow,14).value=typesExcel;

      summaryParts.forEach((part,partIndex)=>{
        const row=firstRow+partIndex;
        ws.mergeCells(row,19,row,30);
        ws.getCell(row,19).value=part;

        styleArea(row,1,row,30,{size:10.5,vertical:"middle"});

        [1,3,6,10,14].forEach(col=>{
          ws.getCell(row,col).alignment={
            horizontal:"center",
            vertical:"middle",
            wrapText:true,
            shrinkToFit:false
          };
        });

        ws.getCell(row,19).alignment={
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
        const summaryLines=estimateExcelTextLines(part,44);
        // 「對象／方式／類型」欄位較窄，也必須納入列高估算，
        // 避免複選項目較多時文字被壓住或截斷。
        const targetLines=partIndex===0 ? estimateExcelTextLines(targets,16) : 1;
        const methodLines=partIndex===0 ? Math.max(asArray(r.methods || r.method).length,estimateExcelTextLines(methodsExcel,16)) : 1;
        const typeLines=partIndex===0 ? Math.max(asArray(r.types || r.type).length,estimateExcelTextLines(typesExcel,20)) : 1;
        const requiredLines=Math.max(summaryLines,targetLines,methodLines,typeLines);
        const calculatedHeight=10 + requiredLines*15.8;
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
      ws.mergeCells(outputRow,6,outputRow,9);
      ws.mergeCells(outputRow,10,outputRow,13);
      ws.mergeCells(outputRow,14,outputRow,18);
      ws.mergeCells(outputRow,19,outputRow,30);
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
  const target=$("view-"+view); if(!target)return;
  target.classList.remove("hidden");
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $("pageTitle").textContent={students:"我的學生",records:"最近紀錄",history:"我的操作紀錄",recycle:"我的回收桶",transfer:"批次轉移",settings:"系統設定"}[view]||"";
  if(view==="history")loadAuditLogs(); if(view==="recycle")loadRecycleBin(); if(view==="transfer"&&isTeacher())renderTransferView();
}
function openModal(html){$("modalContent").innerHTML=html;$("modal").classList.remove("hidden");}
function closeModal(){$("modal").classList.add("hidden");$("modalContent").innerHTML="";}
function toast(text){$("toast").textContent=text;$("toast").classList.remove("hidden");setTimeout(()=>$("toast").classList.add("hidden"),2200);}
