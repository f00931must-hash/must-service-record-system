const OLD_SERVICE_AI="https://must-resource-ai.f00931-must.workers.dev/ai/polish";
const NEW_SERVICE_AI="https://must-isp-ai-697793258377.asia-east1.run.app/ai/polish";

const nativeFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{
  try{
    if(typeof input==="string"&&input===OLD_SERVICE_AI)return nativeFetch(NEW_SERVICE_AI,init);
    if(input instanceof URL&&input.href===OLD_SERVICE_AI)return nativeFetch(new URL(NEW_SERVICE_AI),init);
    if(input instanceof Request&&input.url===OLD_SERVICE_AI)return nativeFetch(new Request(NEW_SERVICE_AI,input),init);
  }catch(error){
    console.warn("Service AI route fallback",error);
  }
  return nativeFetch(input,init);
};

// 將尚未設定或仍使用舊 Worker 的瀏覽器，切到新的 Cloud Run 路徑。
try{
  const stored=localStorage.getItem("service_ai_endpoint");
  if(!stored||stored===OLD_SERVICE_AI){
    localStorage.setItem("service_ai_endpoint",NEW_SERVICE_AI);
  }
}catch(error){
  console.warn("Unable to migrate service AI endpoint setting",error);
}

console.log("Service Record AI route: Cloud Run");
