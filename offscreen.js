const aud={
  mp3_anthem:document.getElementById('anthem'),
  mp3_start:document.getElementById('start'),
  emergency:document.getElementById('emergency')
};
const custom={};
let timers=[];
let ctx=null;
function clearTimers(){timers.forEach(clearTimeout);timers=[];}
function stopAll(notify=true){
  clearTimers();
  try{ if(window.speechSynthesis) window.speechSynthesis.cancel(); }catch(e){}
  Object.values(aud).forEach(a=>{a.pause();a.currentTime=0;a.loop=false;a.onended=null;});
  Object.values(custom).forEach(a=>{a.pause();a.currentTime=0;a.loop=false;a.onended=null;});
  if(notify) chrome.runtime.sendMessage({type:'OFFSCREEN_FINISHED'}).catch(()=>{});
}
function tone(count){
  if(!ctx) ctx=new (window.AudioContext||window.webkitAudioContext)();
  if(ctx.state==='suspended') ctx.resume().catch(()=>{});
  const freqs=[523.25,1046.5,1567.98,2637.02,3135.96], gains=[1,.6,.4,.25,.15], dec=[3,2.2,1.8,1.2,.8];
  const strikes=Math.max(1,Number(count)||1);
  for(let n=0;n<strikes;n++){
    const base=ctx.currentTime+n*1.2;
    freqs.forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=f;g.gain.setValueAtTime(gains[i],base);g.gain.exponentialRampToValueAtTime(.0001,base+dec[i]);o.connect(g).connect(ctx.destination);o.start(base);o.stop(base+dec[i]);});
  }
  timers.push(setTimeout(()=>chrome.runtime.sendMessage({type:'OFFSCREEN_FINISHED'}).catch(()=>{}),(strikes*1.2+3)*1000));
}
async function speakPeriod(count){
  const ord={1:'1st',2:'2nd',3:'3rd',4:'4th',5:'5th',6:'6th',7:'7th',8:'8th'};
  const text='Attention! This is '+(ord[count]||count)+' Period.';
  if(!('speechSynthesis' in window)){await new Promise(r=>setTimeout(r,350));return;}
  await new Promise(resolve=>{
    let done=false; const finish=()=>{if(done)return;done=true;resolve()};
    try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.rate=.9;u.pitch=.85;u.volume=1;u.onend=finish;u.onerror=finish;window.speechSynthesis.speak(u);setTimeout(finish,3800)}catch(e){finish()}
  });
}
async function play(item){
  // Replacing an existing bell must not emit OFFSCREEN_FINISHED in the middle
  // of the new action; that used to race the background status update.
  stopAll(false);
  if(item.type==='tone'){
    const count=Math.max(1,Number(item.count)||1);
    const duration=Math.max(0,Number(item.campusStartDuration)||0);
    const start=custom.mp3_start||aud.mp3_start;
    if(duration>0 && start){try{start.currentTime=0;start.loop=false;await start.play();await new Promise(r=>setTimeout(r,duration*1000));start.pause();start.currentTime=0;}catch(e){}}
    await speakPeriod(count);
    await new Promise(r=>setTimeout(r,400));
    tone(count); return;
  }
  const a=custom[item.type]||aud[item.type];
  if(!a) throw new Error('Audio not found: '+item.type);
  a.currentTime=0; a.loop=item.type==='emergency';
  a.onended=()=>{ if(a.loop) a.play().catch(()=>{}); else chrome.runtime.sendMessage({type:'OFFSCREEN_FINISHED'}).catch(()=>{}); };
  await a.play();
}
function fromBase64(s){
  const bin=atob(s); const arr=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i); return new Blob([arr],{type:'audio/mpeg'});
}
async function store(key,data){
  try{ if(custom[key]) URL.revokeObjectURL(custom[key].src); const blob=typeof data==='string'?fromBase64(data):data; const url=URL.createObjectURL(blob); const a=new Audio(url); a.preload='auto'; custom[key]=a; }catch(e){console.warn(e);}
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  (async()=>{
    try{
      if(msg.type==='OFFSCREEN_STOP'){ stopAll(true); }
      else if(msg.type==='OFFSCREEN_PLAY'){ await play(msg.item); }
      else if(msg.type==='OFFSCREEN_STORE_AUDIO'){
        for(const [k,v] of Object.entries(msg.blobs||{})) await store(k,v);
      }
      else if(msg.type==='OFFSCREEN_CLEAR_AUDIO'){
        if(custom[msg.key]){ URL.revokeObjectURL(custom[msg.key].src); delete custom[msg.key]; }
      }
      sendResponse({ok:true});
    }catch(e){
      chrome.runtime.sendMessage({type:'OFFSCREEN_ERROR',error:String(e)}).catch(()=>{});
      sendResponse({ok:false,error:String(e)});
    }
  })();
  return true;
});
// Custom audio is hydrated by the background service worker. No chrome.storage access is needed here.
