const APP = 'https://merosite.github.io/bell/';
const ALARM = 'umc-bell-minute-check';
const SYNC_ALARM = 'umc-bell-network-sync';
const STATE_ALARM = 'umc-bell-state-refresh';
const EXT_AUDIO = { mp3_anthem:'audioAnthem.mp3', mp3_start:'audioStart.mp3', emergency:'audioEmergency.mp3' };
const DEFAULT_SCHEDULE = [
  {id:1,time:'05:58',title:'National Anthem 🇳🇵',count:0,type:'mp3_anthem',enabled:true},
  {id:2,time:'06:00',title:'Campus Start Time 🔔',count:0,type:'mp3_start',enabled:true},
  {id:3,time:'06:02',title:'1st Period',count:1,type:'tone',enabled:true},
  {id:4,time:'06:45',title:'2nd Period',count:2,type:'tone',enabled:true},
  {id:5,time:'07:30',title:'3rd Period',count:3,type:'tone',enabled:true},
  {id:6,time:'08:15',title:'4th Period',count:4,type:'tone',enabled:true},
  {id:7,time:'09:00',title:'5th Period',count:5,type:'tone',enabled:true},
  {id:8,time:'09:45',title:'6th Period',count:6,type:'tone',enabled:true},
  {id:9,time:'10:30',title:'Campus Final Bell 🔔',count:0,type:'mp3_start',enabled:true}
];

async function getState(){
  const s=await chrome.storage.local.get({
    authenticated:false, authLock:false, username:'', schedule:DEFAULT_SCHEDULE, scheduleDefault:DEFAULT_SCHEDULE, bellDefault:{}, nextEvent:null, active:false,
    emergency:false, lastTrigger:null, lastEvent:null, online:true,
    lastSync:0, campusStartDuration:0, customAudio:{}, engine:'ready', floatPosition:null
  });
  // Persistent authentication latch: only explicit Extension logout may clear it.
  if(s.authLock && !s.authenticated){ s.authenticated=true; await chrome.storage.local.set({authenticated:true}); }
  return s;
}
function dayOk(item, now){
  if (!Array.isArray(item.days) || !item.days.length) return true;
  const d = now.toLocaleDateString('en-US',{weekday:'short'}).toLowerCase().slice(0,3);
  return item.days.map(x=>String(x).toLowerCase().slice(0,3)).includes(d);
}
function nextEvent(schedule, now){
  const items=(schedule||[]).filter(x=>x.enabled!==false && /^\d\d:\d\d$/.test(x.time));
  if(!items.length) return null;
  for(let add=0; add<8; add++){
    const d=new Date(now); d.setDate(now.getDate()+add);
    const candidates=items.filter(x=>dayOk(x,d)).map(x=>{
      const [h,m]=x.time.split(':').map(Number);
      const at=new Date(d); at.setHours(h,m,0,0);
      return {...x,_at:at.getTime()};
    }).filter(x=>x._at>now.getTime()).sort((a,b)=>a._at-b._at);
    if(candidates[0]){ const { _at, ...item }=candidates[0]; return {...item,at:_at}; }
  }
  return null;
}
async function updateNext(){
  const s=await getState();
  if(!s.authenticated){ await chrome.storage.local.set({nextEvent:null}); return; }
  await chrome.storage.local.set({nextEvent:nextEvent(s.schedule,new Date())});
}
async function ensureAlarm(){
  if(!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM,{periodInMinutes:1});
  if(!(await chrome.alarms.get(SYNC_ALARM))) await chrome.alarms.create(SYNC_ALARM,{periodInMinutes:1});
  if(!(await chrome.alarms.get(STATE_ALARM))) await chrome.alarms.create(STATE_ALARM,{periodInMinutes:1});
}
async function ensureOffscreen(){
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
  if(contexts.length) return true;
  await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['AUDIO_PLAYBACK'],justification:'Play UMC scheduled bells and emergency audio while the main app is closed.'});
  for(let i=0;i<10;i++){
    const c=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
    if(c.length) return true;
    await new Promise(r=>setTimeout(r,50));
  }
  return false;
}
async function sendOffscreen(msg){
  try{
    await ensureOffscreen();
    return await chrome.runtime.sendMessage(msg);
  }catch(e){
    // The offscreen document can disappear during extension reload/Chrome shutdown.
    // Retry once after recreating it; never leak an unhandled promise rejection.
    try{
      await new Promise(r=>setTimeout(r,120));
      await ensureOffscreen();
      return await chrome.runtime.sendMessage(msg);
    }catch(e2){
      await chrome.storage.local.set({lastError:String(e2)}).catch(()=>{});
      return {ok:false,error:String(e2)};
    }
  }
}
async function hydrateOffscreen(){ const s=await getState(); if(s.customAudio&&Object.keys(s.customAudio).length) await sendOffscreen({type:'OFFSCREEN_STORE_AUDIO',blobs:s.customAudio}).catch(()=>{}); }
async function play(item){
  const st=await getState(); if(!st.authenticated) return;
  await chrome.storage.local.set({active:true,emergency:item.type==='emergency',lastEvent:{...item,at:Date.now()}});
  try { await sendOffscreen({type:'OFFSCREEN_PLAY',item}); } catch(e) { await chrome.storage.local.set({active:false,emergency:false,lastError:String(e)}); }
}
async function stop(){
  await chrome.storage.local.set({active:false,emergency:false});
  try { await sendOffscreen({type:'OFFSCREEN_STOP'}); } catch(e) {}
}
async function checkSchedule(){
  const st=await getState();
  if(!st.authenticated){ await chrome.storage.local.set({nextEvent:null}); return; }
  const now=new Date();
  const hhmm=now.toTimeString().slice(0,5);
  const minuteKey=`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${hhmm}`;
  await chrome.storage.local.set({nextEvent:nextEvent(st.schedule,now)});
  if(st.lastTrigger===minuteKey) return;
  const due=(st.schedule||[]).filter(x=>x.enabled!==false && x.time===hhmm && dayOk(x,now));
  if(!due.length) return;
  await chrome.storage.local.set({lastTrigger:minuteKey});
  for(const item of due) await play(item);
}
async function probeOnline(){
  let online=navigator.onLine;
  try { await fetch(APP,{method:'HEAD',cache:'no-store',mode:'no-cors'}); online=true; } catch(e) { online=!!navigator.onLine; }
  await chrome.storage.local.set({online,lastNetworkCheck:Date.now()});
}
async function broadcastState(){
  const st=await getState();
  const tabs=await chrome.tabs.query({url:['http://*/*','https://*/*']});
  for(const tab of tabs){
    try { if(tab.id) await chrome.tabs.sendMessage(tab.id,{type:'EXT_STATE',state:st}); } catch(e) {}
  }
}
async function syncToApp(){
  const st=await getState();
  const tabs=await chrome.tabs.query({url:APP+'*'});
  for(const tab of tabs){
    try { if(tab.id) await chrome.tabs.sendMessage(tab.id,{type:'EXT_STATE_TO_APP',state:st}); } catch(e) {}
  }
}

chrome.runtime.onInstalled.addListener(async()=>{
  const s=await chrome.storage.local.get(['schedule','authenticated','authLock']);
  if(!s.schedule) await chrome.storage.local.set({schedule:DEFAULT_SCHEDULE});
  if(!s.scheduleDefault) await chrome.storage.local.set({scheduleDefault:DEFAULT_SCHEDULE});
  if(s.authLock && !s.authenticated) await chrome.storage.local.set({authenticated:true});
  await ensureAlarm(); await updateNext(); await probeOnline(); await hydrateOffscreen();
});
chrome.runtime.onStartup.addListener(async()=>{await ensureAlarm();await updateNext();await probeOnline();await hydrateOffscreen();});
ensureAlarm();

chrome.alarms.onAlarm.addListener(async a=>{
  if(a.name===ALARM) await checkSchedule();
  if(a.name===SYNC_ALARM){ await probeOnline(); await updateNext(); await broadcastState(); }
  if(a.name===STATE_ALARM){ await checkSchedule(); await broadcastState(); }
});

chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  (async()=>{
    if(msg.type==='APP_STATE'){
      const patch={};
      // Never log out the persistent extension session from a passive page sync.
      // Logout is handled only by the explicit SET_AUTH(false) action.
      if(msg.authenticated===true) patch.authenticated=true;
      if(typeof msg.username==='string') patch.username=msg.username;
      if(Array.isArray(msg.schedule) && (msg.schedule.length || msg.force)) patch.schedule=msg.schedule;
      if(Number.isFinite(Number(msg.campusStartDuration))) patch.campusStartDuration=Math.max(0,Number(msg.campusStartDuration));
      if(typeof msg.online==='boolean') patch.online=msg.online;
      if(msg.audioReady) patch.audioReady=msg.audioReady;
      if(msg.audioBlobs && typeof msg.audioBlobs==='object'){
        patch.customAudio=msg.audioBlobs;
        await sendOffscreen({type:'OFFSCREEN_STORE_AUDIO',blobs:msg.audioBlobs}).catch(()=>{});
      }
      if(msg.authenticated===false){patch.active=false;patch.emergency=false;}
      // Do not write authenticated:false here; an app/page bootstrap may briefly report false.
      // Only SET_AUTH(false) below is an explicit logout.
      patch.lastSync=Date.now();
      await chrome.storage.local.set(patch); await ensureAlarm(); await updateNext(); await broadcastState();
      sendResponse({ok:true}); return;
    }
    if(msg.type==='GET_STATE'){sendResponse(await getState());return;}
    if(msg.type==='SET_AUTH'){
      // Authentication is persistent. Only the Extension popup is allowed to
      // perform an explicit logout; page/content-script state can never log
      // the extension out. This is the core session-stability rule.
      const fromPopup = !!sender && typeof sender.url==='string' && /\/popup\.html(?:$|[?#])/.test(sender.url);
      if(msg.value===false && !fromPopup){ sendResponse({ok:false,error:'Logout is allowed only from Extension Settings.'}); return; }
      const patch={authenticated:!!msg.value,authLock:!!msg.value,lastSync:Date.now()};
      if(msg.value && msg.username) patch.username=String(msg.username);
      await chrome.storage.local.set(patch);
      if(!msg.value) await stop(); else await checkSchedule();
      await broadcastState(); sendResponse({ok:true}); return;
    }
    if(msg.type==='TRIGGER'){ const st=await getState(); if(!st.authenticated){sendResponse({ok:false,error:'LOGIN_REQUIRED'});return;} await play(msg.item); sendResponse({ok:true});return;}
    if(msg.type==='STOP'){ const st=await getState(); if(!st.authenticated){sendResponse({ok:false,error:'LOGIN_REQUIRED'});return;} await stop();await broadcastState();sendResponse({ok:true});return;}
    if(msg.type==='SAVE_SCHEDULE'){
      if(!Array.isArray(msg.schedule)) throw new Error('Invalid schedule');
      await chrome.storage.local.set({schedule:msg.schedule,lastSync:Date.now()}); await updateNext(); await syncToApp(); await broadcastState(); sendResponse({ok:true}); return;
    }
    if(msg.type==='SET_SCHEDULE_DEFAULT'){ const a=Array.isArray(msg.schedule)?msg.schedule:[]; await chrome.storage.local.set({scheduleDefault:structuredClone(a),lastSync:Date.now()}); sendResponse({ok:true}); return;}
    if(msg.type==='RESET_SCHEDULE_DEFAULT'){ const s=await getState(); const a=Array.isArray(s.scheduleDefault)&&s.scheduleDefault.length?s.scheduleDefault:DEFAULT_SCHEDULE; await chrome.storage.local.set({schedule:structuredClone(a),lastSync:Date.now()}); await updateNext(); await syncToApp(); await broadcastState(); sendResponse({ok:true}); return;}
    if(msg.type==='SET_BELL_DEFAULT'){ const s=await getState(); await chrome.storage.local.set({bellDefault:{customAudio:s.customAudio||{},manual:'default'},lastSync:Date.now()}); sendResponse({ok:true}); return;}
    if(msg.type==='RESET_BELL_DEFAULT'){ const s=await getState(); const b=s.bellDefault||{}; if(b.customAudio) { await chrome.storage.local.set({customAudio:b.customAudio}); await sendOffscreen({type:'OFFSCREEN_STORE_AUDIO',blobs:b.customAudio}).catch(()=>{}); } await stop(); sendResponse({ok:true}); return;}
    if(msg.type==='REQUEST_APP_SYNC'){
      const tabs=await chrome.tabs.query({url:APP+'*'});
      for(const tab of tabs){ try{ if(tab.id) await chrome.tabs.sendMessage(tab.id,{type:'REQUEST_APP_SYNC'}); }catch(e){} }
      sendResponse({ok:true}); return;
    }
    if(msg.type==='SYNC_NOW'){
      // Ask the live Bell App to publish its current schedule/audio/auth state
      // first. Then mirror the resulting extension state back to the app.
      const tabs=await chrome.tabs.query({url:APP+'*'});
      for(const tab of tabs){ try{ if(tab.id) await chrome.tabs.sendMessage(tab.id,{type:'REQUEST_APP_SYNC'}); }catch(e){} }
      await new Promise(r=>setTimeout(r,120));
      await probeOnline();await updateNext();await hydrateOffscreen();await syncToApp();await broadcastState();
      sendResponse(await getState());return;
    }
    if(msg.type==='OPEN_DASH'){await chrome.tabs.create({url:APP});sendResponse({ok:true});return;}
    if(msg.type==='SAVE_AUDIO'){
      const key=msg.key, data=msg.data;
      if(!key||!data) throw new Error('Audio data missing');
      const cur=await getState(); const customAudio={...(cur.customAudio||{}),[key]:data};
      await chrome.storage.local.set({customAudio,lastSync:Date.now()}); await sendOffscreen({type:'OFFSCREEN_STORE_AUDIO',blobs:{[key]:data}}).catch(()=>{}); await syncToApp(); await broadcastState(); sendResponse({ok:true});return;
    }
    if(msg.type==='CLEAR_AUDIO'){
      const cur=await getState(); const customAudio={...(cur.customAudio||{})}; delete customAudio[msg.key]; await chrome.storage.local.set({customAudio}); await sendOffscreen({type:'OFFSCREEN_CLEAR_AUDIO',key:msg.key}).catch(()=>{}); sendResponse({ok:true});return;
    }
    if(msg.type==='OFFSCREEN_FINISHED' || msg.type==='OFFSCREEN_ERROR'){
      await chrome.storage.local.set({active:false,emergency:false,lastError:msg.error||null}); await broadcastState(); sendResponse({ok:true});return;
    }
    // Messages intended only for the offscreen document are not commands for
    // the service worker. Avoid generating connection/response noise.
    if(String(msg.type||'').startsWith('OFFSCREEN_')) { sendResponse({ok:true}); return; }
    sendResponse({ok:true});
  })().catch(e=>sendResponse({ok:false,error:String(e)}));
  return true;
});
