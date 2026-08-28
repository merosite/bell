(function(){
  'use strict';
  const KEY='campus_bell_schedule_v15';
  const AUTH='umc_bell_authenticated';
  const GLOBAL_AUTH='umc_bell_global_authenticated';
  const REMEMBER='umc_bell_remember_password_v1';
  const APP='https://merosite.github.io/bell/';
  const POS='umc_ext_float_position_v4';
  const HIDE='umc_ext_float_hidden_v4';
  let lastAppSig='';
  let lastExtSig='';
  let bar, root, state={authenticated:false,schedule:[],online:false,nextEvent:null,active:false,emergency:false};

  function safeJSON(v,f){try{return JSON.parse(v)}catch(e){return f}}
  function getAppState(){
    const authenticated=localStorage.getItem(AUTH)==='1' || localStorage.getItem(GLOBAL_AUTH)==='1';
    let schedule=safeJSON(localStorage.getItem(KEY)||'[]',[]);
    if(!Array.isArray(schedule)) schedule=[];
    const campusStartDuration=Math.max(0,parseInt(localStorage.getItem('campus_start_duration')||'0',10)||0);
    return {authenticated,schedule,campusStartDuration};
  }
  function blobToBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(blob)})}
  async function readDB(){
    return new Promise(resolve=>{
      try{
        const r=indexedDB.open('CampusAudioDB',3);
        r.onsuccess=()=>{
          const db=r.result;
          if(!db.objectStoreNames.contains('audios')) return resolve({});
          const tx=db.transaction('audios','readonly'), st=tx.objectStore('audios'), out={};
          let left=2;
          ['mp3_anthem','mp3_start'].forEach(k=>{const q=st.get(k);q.onsuccess=async()=>{try{if(q.result)out[k]=await blobToBase64(q.result)}catch(e){}if(--left===0)resolve(out)};q.onerror=()=>{if(--left===0)resolve(out)}});
        };
        r.onerror=()=>resolve({});
      }catch(e){resolve({})}
    });
  }
  async function syncAppToExtension(force){
    // IMPORTANT: content-script runs on every website, but only the Bell App
    // is allowed to publish its local authentication/schedule state.
    // Otherwise another tab/site has origin-localStorage with no auth and
    // could accidentally log the extension out.
    if(!location.href.startsWith(APP)) return;
    const a=getAppState();
    const sig=JSON.stringify(a);
    if(!force && sig===lastAppSig) return;
    lastAppSig=sig;
    const blobs=a.authenticated?await readDB():{};
    try{
      const msg={type:'APP_STATE',authenticated:a.authenticated,schedule:a.schedule,campusStartDuration:a.campusStartDuration,audioBlobs:blobs,force:true};
      // A normal false state is not treated as logout by the background.
      // Explicit logout is sent separately below.
      await chrome.runtime.sendMessage(msg);
    }catch(e){}
  }
  async function syncExtensionToApp(){
    try{
      const s=await chrome.runtime.sendMessage({type:'GET_STATE'});
      if(!s) return;
      const app=getAppState();
      const sig=JSON.stringify({a:s.authenticated,s:s.schedule||[]});
      if(sig===lastExtSig) return;
      lastExtSig=sig;
      if(Array.isArray(s.schedule) && s.schedule.length) localStorage.setItem(KEY,JSON.stringify(s.schedule));
      localStorage.setItem(AUTH,s.authenticated?'1':'0');
      localStorage.setItem(GLOBAL_AUTH,s.authenticated?'1':'0');
      window.postMessage({source:'UMC_EXTENSION',type:'STATE_APPLIED',state:s},'*');
      // Reload the main app only when extension auth/schedule actually changes it.
      const scheduleChanged=JSON.stringify(app.schedule||[])!==JSON.stringify(s.schedule||[]);
      const authChanged=app.authenticated!==!!s.authenticated;
      if(location.href.startsWith(APP) && (scheduleChanged||authChanged)){
        sessionStorage.setItem('umc_ext_reloaded_once','1');
        setTimeout(()=>location.reload(),80);
      }
    }catch(e){}
  }

  function getPos(){return safeJSON(localStorage.getItem(POS)||'null',null)}
  function setPos(p){try{localStorage.setItem(POS,JSON.stringify(p))}catch(e){} try{chrome.storage.local.set({floatPosition:p})}catch(e){}}
  function applyPos(p){if(!bar||!p)return;bar.style.transform='none';bar.style.left=Math.max(0,Number(p.left)||0)+'px';bar.style.top=Math.max(0,Number(p.top)||0)+'px';bar.style.right='auto';bar.style.bottom='auto'}
  function fmt(t){if(!t)return 'No Event';const [h,m]=t.split(':').map(Number);const ap=h>=12?'PM':'AM';return `${String(h%12||12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ap}`}

  function mountBar(){
    if(!/^https?:$/.test(location.protocol) || document.getElementById('umc-ext-host')) return;
    const host=document.createElement('div');host.id='umc-ext-host';host.style.cssText='position:fixed!important;z-index:2147483647!important;left:50%!important;top:auto!important;right:auto!important;bottom:12px!important;transform:translateX(-50%)!important;display:block!important;visibility:visible!important;pointer-events:auto!important;all:initial!important;';
    root=host.attachShadow({mode:'open'});
    const box=document.createElement('div');
    box.innerHTML=`<style>
      :host{all:initial!important}*{box-sizing:border-box}.bar{font-family:Segoe UI,Arial,sans-serif;width:390px;background:linear-gradient(135deg,#0f172a,#172554);color:#fff;border:1px solid #475569;border-radius:15px;box-shadow:0 12px 35px rgba(0,0,0,.35);padding:10px;user-select:none}.head{display:flex;align-items:center;justify-content:space-between;cursor:move;gap:8px}.title{font-size:14px;font-weight:900}.sub{font-size:10px;color:#cbd5e1}.pill{font-size:10px;font-weight:900;padding:4px 7px;border-radius:20px;background:#166534;white-space:nowrap}.off{background:#991b1b}.auth{margin-top:7px;font-size:11px;color:#cbd5e1}.next{margin-top:7px;background:#1e293b;border-radius:9px;padding:8px;font-size:12px;font-weight:700;min-height:34px}.grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:5px;margin-top:7px}.btn{border:0;border-radius:7px;padding:7px 5px;font-weight:900;font-size:10px;cursor:pointer}.blue{background:#2563eb;color:#fff}.red{background:#dc2626;color:#fff}.orange{background:#f59e0b;color:#111}.gray{background:#334155;color:#fff}.hide{background:none;color:#cbd5e1;border:0;font-size:16px;cursor:pointer}.drag{opacity:.75;font-size:11px}
    </style><div class="bar" id="bar"><div class="head" id="drag"><div><div class="title">🏫 UMC Bell System</div><div class="sub">Background Extension • Drag to move</div></div><div><span class="pill" id="net">OFFLINE</span><button class="hide" id="hide" title="Hide">×</button></div></div><div class="auth" id="auth">🔒 Login from Extension → Admin profile</div><div class="next" id="next">Checking system…</div><div class="grid"><button class="btn blue" id="app">APP</button><button class="btn gray" id="sync">SYNC</button><button class="btn orange" id="em">EMERGENCY</button><button class="btn red" id="stop">STOP</button></div></div>`;
    root.appendChild(box);host.appendChild(root);document.documentElement.appendChild(host);bar=host;
    const $=id=>root.querySelector('#'+id);
    function render(s){state=s||state||{};bar.style.display='block';bar.style.visibility='visible';const auth=!!state.authenticated;$('net').textContent=state.online?'ONLINE':'OFFLINE';$('net').className='pill '+(state.online?'':'off');$('auth').textContent=auth?'👤 Admin • Logged in':'🔒 Login from Extension → Admin profile';$('next').textContent=auth?(state.emergency?'🚨 EMERGENCY BELL ACTIVE':state.active?'🔊 AUDIO ACTIVE':state.nextEvent?`NEXT: ${fmt(state.nextEvent.time)} — ${state.nextEvent.title}`:'No schedule event'):'Login Required — click Extension Admin profile';}
    chrome.runtime.onMessage.addListener(m=>{if(m&&m.type==='EXT_STATE')render(m.state)});
    $('app').onclick=()=>chrome.runtime.sendMessage({type:'OPEN_DASH'}).catch(()=>{});
    $('sync').onclick=async()=>{await chrome.runtime.sendMessage({type:'SYNC_NOW'}).catch(()=>{});await syncExtensionToApp()};
    $('em').onclick=()=>chrome.runtime.sendMessage({type:'TRIGGER',item:{title:'Emergency Bell',type:'emergency',count:0}}).catch(()=>{});
    $('stop').onclick=()=>chrome.runtime.sendMessage({type:'STOP'}).catch(()=>{});
    $('hide').onclick=()=>{bar.style.display='none';setTimeout(()=>{bar.style.display='block';bar.style.visibility='visible'},250)};
    let dragging=false,sx=0,sy=0,ox=0,oy=0;
    $('drag').addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;dragging=true;const r=bar.getBoundingClientRect();sx=e.clientX;sy=e.clientY;ox=r.left;oy=r.top;$('drag').setPointerCapture(e.pointerId)});
    $('drag').addEventListener('pointermove',e=>{if(!dragging)return;bar.style.left=Math.max(0,Math.min(innerWidth-bar.offsetWidth,ox+e.clientX-sx))+'px';bar.style.top=Math.max(0,Math.min(innerHeight-bar.offsetHeight,oy+e.clientY-sy))+'px';bar.style.right='auto'});
    $('drag').addEventListener('pointerup',()=>{if(dragging){dragging=false;setPos({left:parseInt(bar.style.left)||0,top:parseInt(bar.style.top)||0})}});
    const p=getPos();if(p)applyPos(p);
    chrome.runtime.sendMessage({type:'GET_STATE'}).then(render).catch(()=>render(state));
  }
  mountBar();
  // The extension never opens a popup/modal when the main app loads; the floating bar is the only UI injected into webpages.
  window.addEventListener('pageshow',()=>{try{syncExtensionToApp()}catch(e){}});
  window.addEventListener('focus',()=>{try{syncExtensionToApp()}catch(e){}});
  // Bootstrap without a race: if the app is already logged in, its schedule/auth
  // is the source for the extension. If only the extension is logged in, restore
  // that state into the app. This prevents the extension's default schedule from
  // overwriting a real main-app schedule on page load.
  (async()=>{
    try{
      const ext=await chrome.runtime.sendMessage({type:'GET_STATE'});
      if(location.href.startsWith(APP)){
        const app=getAppState();
        if(app.authenticated){
          await syncAppToExtension(true);
        }else if(ext?.authenticated){
          await syncExtensionToApp();
        }else{
          await syncAppToExtension(true);
        }
      }
    }catch(e){}
  })();
  setInterval(async()=>{
    try{
      if(!location.href.startsWith(APP)) return;
      const app=getAppState();
      const ext=await chrome.runtime.sendMessage({type:'GET_STATE'});
      if(app.authenticated && (!ext?.authenticated || JSON.stringify(app.schedule)!==JSON.stringify(ext.schedule||[]))){
        await syncAppToExtension(true);
      }else if(!app.authenticated && ext?.authenticated){
        await syncExtensionToApp();
      }else if(app.authenticated && ext?.authenticated){
        await syncAppToExtension(false);
      }
    }catch(e){}
  },1500);
  window.addEventListener('storage',()=>syncAppToExtension(true));
  window.addEventListener('message',e=>{
    if(e.source!==window || e.data?.source!=='UMC_BELL_APP') return;
    // Main-app logout must not terminate the persistent Extension session.
    // The Extension can be logged out only from its own Settings > Account.
    if(e.data?.type==='LOGOUT'){ return; }
    if(e.data?.type==='SCHEDULE_RESET' && Array.isArray(e.data.schedule)){ chrome.runtime.sendMessage({type:'SAVE_SCHEDULE',schedule:e.data.schedule}).catch(()=>{}); return; }
    syncAppToExtension(true);
  });
})();
