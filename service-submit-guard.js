(() => {
  const FORM_CONFIG = {
    studentForm: {
      busyText: "儲存學生資料中，請勿重複點擊…",
      defaultText: "儲存學生資料"
    },
    recordForm: {
      busyText: "儲存服務紀錄中，請勿重複點擊…",
      defaultText: "儲存服務紀錄"
    }
  };

  function submitButton(form){
    return form?.querySelector('button[type="submit"]');
  }

  function setBusy(form, busy){
    const config = FORM_CONFIG[form?.id];
    if(!config) return;
    form.dataset.submitBusy = busy ? "1" : "0";
    const btn = submitButton(form);
    if(!btn) return;
    btn.disabled = !!busy;
    if(busy){
      btn.setAttribute("aria-busy", "true");
      btn.dataset.originalText = btn.textContent || config.defaultText;
      btn.textContent = config.busyText;
    }else{
      btn.removeAttribute("aria-busy");
      btn.textContent = btn.dataset.originalText || config.defaultText;
    }
  }

  function protect(form){
    if(!form || !FORM_CONFIG[form.id] || form.dataset.submitGuardReady === "1") return;
    const original = form.onsubmit;
    if(typeof original !== "function") return;

    form.dataset.submitGuardReady = "1";
    form.onsubmit = async function(event){
      if(form.dataset.submitBusy === "1"){
        event?.preventDefault();
        return;
      }

      setBusy(form, true);
      try{
        return await original.call(this, event);
      } finally {
        // 成功時原程式會關閉視窗；失敗或驗證未通過時恢復按鈕，讓使用者可修正後再送。
        if(form.isConnected) setBusy(form, false);
      }
    };
  }

  function scan(){
    Object.keys(FORM_CONFIG).forEach(id => protect(document.getElementById(id)));
  }

  // 學生與服務紀錄表單都是動態開啟，監看 Modal 後自動套用防連點。
  const observer = new MutationObserver(() => queueMicrotask(scan));
  observer.observe(document.documentElement, { childList:true, subtree:true });
  queueMicrotask(scan);
})();
