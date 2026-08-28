const APP='https://merosite.github.io/bell/';
const UH='a6c9feb58d388cbd5398b3f7f93c4e98aabe9a3950660be030fe8bbea5d0ca2b';
const PH='8dd26e3fc0aa34aab26b142ab78c3564a5798d335ccfbd044f65478e58f8c5c7';
let current={authenticated:false,schedule:[],online:false};
const $=id=>document.getElementById(id);
const send=async m=>{try{return await chrome.runtime.sendMessage(m)}catch(e){return {ok:false,error:String(e)}}};
async function sha(v){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function toast(t){const x=$('toast');x.textContent=t;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>x.classList.remove('show'),1700);}
function clickTone(){try{const c=new AudioContext(),o=c.createOscillator(),g=c.createGain();o.frequency.value=720;g.gain.value=.045;o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+.055)}catch(e){}}
let actionBusy=false;
async function act(fn,msg){
  if(actionBusy) return {ok:false,error:'Please wait'};
  actionBusy=true; clickTone();
  try{const r=await fn(); if(r&&r.ok===false){toast(r.error==='LOGIN_REQUIRED'?'🔐 Please login first':'Action failed');return r} toast(msg||'Done'); return r}
  catch(e){toast('Action failed');return {ok:false,error:String(e)}}
  finally{actionBusy=false}
}
async function state(){return (await send({type:'GET_STATE'}))||{authenticated:false,schedule:[]}}
function fmt(t){if(!t)return '';let [h,m]=t.split(':').map(Number);const ap=h>=12?'PM':'AM';h=h%12||12;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ap}`}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function countdownText(at){
  if(!at) return '';
  let ms=Number(at)-Date.now();
  if(ms<0) ms=0;
  const total=Math.floor(ms/1000), h=Math.floor(total/3600), m=Math.floor((total%3600)/60), sec=total%60;
  if(h>0) return `${h}h ${String(m).padStart(2,'0')}m remaining`;
  if(m>0) return `${m}m ${String(sec).padStart(2,'0')}s remaining`;
  return `${sec}s remaining`;
}
function render(s){current=s||{authenticated:false,schedule:[]};const auth=!!current.authenticated;const em=!!current.emergency;const active=!!current.active;$('status').textContent=auth?(em?'🚨 EMERGENCY ACTIVE':active?'🔊 AUDIO ACTIVE':'System Running'):'Login Required';$('dot').className='dot '+(auth?'on':'');if($('appStatus')){const open=!!current.appOpen && (Date.now()-(current.appLastSeen||0)<7000);$('appStatus').textContent=open?'🟢 App Open':'⚪ App Closed';$('appStatus').className='value '+(open?'online':'offline')}$('network').textContent=current.online?'● Online':'● Offline';$('network').className='value '+(current.online?'online':'offline');$('next').textContent=current.nextEvent?`${fmt(current.nextEvent.time)} — ${current.nextEvent.title}`:'No Event';$('countdown').textContent=current.nextEvent?.at?countdownText(current.nextEvent.at):'';$('pname').textContent=auth?(current.username||'Admin'):'Profile';$('profileState').textContent=auth?'Logged in • Always active':'Click to Login';$('accountState').textContent=auth?'Logged in • Always active':'Not logged in';$('settings').style.display=auth?'grid':'none';if(!auth)closeModal('settingsModal');renderAvatar(current.profileImage);renderPeriods(current.schedule||[]);renderSchedule(current.schedule||[])}
function renderAvatar(src){$('avatar').innerHTML=src?`<img src="${src}" alt="profile">`:'👤';$('bigAvatar').innerHTML=src?`<img src="${src}" alt="profile">`:'👤'}
function renderPeriods(arr){const box=$('periodGrid');box.innerHTML='';const periods=(arr||[]).filter(x=>/period/i.test(x.title||'')&&x.type==='tone').sort((a,b)=>(a.count||0)-(b.count||0));periods.forEach(x=>{const b=document.createElement('button');b.className='btn blue periodBtn';b.textContent=`🔔 ${x.title.replace(/\s+/g,' ').trim()}`;b.onclick=()=>act(()=>send({type:'TRIGGER',item:{...x}}),`${x.title} started`);box.appendChild(b)})}
function renderSchedule(arr){const body=$('scheduleBody');body.innerHTML='';(arr||[]).forEach((x,i)=>{const tr=document.createElement('tr');tr.innerHTML=`<td><input type="time" data-k="time" value="${x.time||''}"></td><td><input data-k="title" value="${escapeHtml(x.title)}"></td><td><select data-k="type"><option value="tone" ${x.type==='tone'?'selected':''}>Period</option><option value="mp3_anthem" ${x.type==='mp3_anthem'?'selected':''}>Anthem</option><option value="mp3_start" ${x.type==='mp3_start'?'selected':''}>Campus Bell</option><option value="emergency" ${x.type==='emergency'?'selected':''}>Emergency</option></select></td><td><input type="checkbox" data-k="enabled" ${x.enabled!==false?'checked':''}></td><td><button class="mini" data-del="${i}">✕</button></td>`;body.appendChild(tr)})}
function collect(){return [...$('scheduleBody').querySelectorAll('tr')].map((tr,i)=>{const q=k=>tr.querySelector(`[data-k="${k}"]`),old=current.schedule?.[i]||{};const type=q('type').value;return {...old,time:q('time').value,title:q('title').value,type,count:type==='tone'?(old.count||1):0,enabled:q('enabled').checked,id:old.id||Date.now()+i}})}
async function loadRemembered(){const r=await chrome.storage.local.get({rememberLogin:false,rememberUser:'',rememberPass:''});if(r.rememberLogin){$('user').value=r.rememberUser||'';$('pass').value=r.rememberPass||'';$('remember').checked=true}}
function openModal(id){$(id).classList.add('show')};function closeModal(id){$(id).classList.remove('show')}
$('profile').onclick=async()=>{if(current.authenticated){$('infoUser').textContent=current.username||'Admin';$('infoId').textContent=current.username||'Admin';openModal('profileModal')}else{await loadRemembered();openModal('loginModal');setTimeout(()=>($('user').value?$('pass'):$('user')).focus(),30)}};
$('settings').onclick=()=>{if(!current.authenticated){toast('Login required');return}openModal('settingsModal')};
$('passEye').onclick=()=>{$('pass').type=$('pass').type==='password'?'text':'password';$('passEye').textContent=$('pass').type==='password'?'👁️':'🙈'};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
document.querySelectorAll('.modalWrap').forEach(w=>w.addEventListener('click',e=>{if(e.target===w)closeModal(w.id)}));
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modalWrap.show').forEach(w=>closeModal(w.id))});
$('loginForm').onsubmit=async(ev)=>{ev.preventDefault();const u=$('user').value.trim(),p=$('pass').value,e=$('loginMsg');e.style.color='#64748b';e.textContent='Checking credentials…';if(await sha(u)!==UH||await sha(p)!==PH){e.style.color='#dc2626';e.textContent='Invalid User ID or Password.';clickTone();return}if($('remember').checked)await chrome.storage.local.set({rememberLogin:true,rememberUser:u,rememberPass:p});else await chrome.storage.local.set({rememberLogin:false,rememberUser:'',rememberPass:''});const r=await send({type:'SET_AUTH',value:true,username:u});if(!r||r.ok===false){e.style.color='#dc2626';e.textContent='Could not activate the background engine. Please try again.';return}await send({type:'SYNC_NOW'});e.style.color='#16a34a';e.textContent='Login successful. Background engine is active.';toast('✓ Logged in • Always active');await refresh();setTimeout(()=>closeModal('loginModal'),450)};
$('logout').onclick=async()=>{const r=await act(()=>send({type:'SET_AUTH',value:false}),'✓ Logged out');if(r?.ok!==false){closeModal('settingsModal');await refresh()}};
$('emergency').onclick=async()=>{await act(()=>send({type:'TRIGGER',item:{title:'Emergency Bell',type:'emergency',count:0}}),'🚨 Emergency Bell active');await refresh()};
$('stop').onclick=async()=>{await act(()=>send({type:'STOP'}),'🛑 All bells stopped');await refresh()};
$('anthem').onclick=async()=>{await act(()=>send({type:'TRIGGER',item:{title:'National Anthem',type:'mp3_anthem',count:0}}),'🇳🇵 Anthem started');await refresh()};
$('bell').onclick=async()=>{await act(()=>send({type:'TRIGGER',item:{title:'Campus Start/End Bell',type:'mp3_start',count:0}}),'🔔 Campus Bell started');await refresh()};
$('sync').onclick=async()=>{await act(()=>send({type:'SYNC_NOW'}),'✓ Schedule synced');await refresh()};$('open').onclick=()=>{clickTone();chrome.tabs.create({url:APP});toast('Opening Bell App…')};
function toggle(el){el.classList.toggle('hidden')};$('manualEye').onclick=()=>{toggle($('manualArea'));$('manualEye').textContent=$('manualArea').classList.contains('hidden')?'🙈':'👁️';toast($('manualArea').classList.contains('hidden')?'Manual actions hidden':'Manual actions shown')};$('scheduleEye').onclick=()=>{toggle($('scheduleArea'));const hidden=$('scheduleArea').classList.contains('hidden');$('scheduleEye').textContent=hidden?'🙈':'👁️';toast(hidden?'Schedule hidden':'Schedule shown')};
$('add').onclick=()=>{current.schedule=[...(current.schedule||[]),{id:Date.now(),time:'12:00',title:'New Period',count:1,type:'tone',enabled:true}];renderPeriods(current.schedule);renderSchedule(current.schedule);toast('New schedule row added')};
$('scheduleBody').onclick=e=>{const b=e.target.closest('[data-del]');if(!b)return;const a=collect();a.splice(+b.dataset.del,1);current.schedule=a;renderPeriods(a);renderSchedule(a);toast('Schedule row removed')};
$('save').onclick=async()=>{const a=collect();await act(()=>send({type:'SAVE_SCHEDULE',schedule:a}),'✓ Schedule saved & synced');await refresh()};
$('profileFile').onchange=async()=>{const f=$('profileFile').files[0];if(!f)return;if(!/^image\/(jpeg|png|webp)$/.test(f.type)||f.size>1024*1024){$('profileMsg').style.color='#dc2626';$('profileMsg').textContent='Please choose JPG, PNG or WebP up to 1 MB.';return}const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)});await chrome.storage.local.set({profileImage:data});$('profileMsg').style.color='#16a34a';$('profileMsg').textContent='✓ Profile image saved';await refresh()};
$('removeProfile').onclick=async()=>{await chrome.storage.local.remove('profileImage');$('profileMsg').style.color='#16a34a';$('profileMsg').textContent='✓ Profile image removed';await refresh()};
$('resetBell').onclick=async()=>{await act(()=>send({type:'RESET_BELL_DEFAULT'}),'✓ Bell defaults restored');await refresh()};$('setBellDefault').onclick=async()=>{await act(()=>send({type:'SET_BELL_DEFAULT'}),'⭐ Current bell set as default')};$('resetSchedule').onclick=async()=>{await act(()=>send({type:'RESET_SCHEDULE_DEFAULT'}),'✓ Saved default schedule restored');await refresh()};$('setScheduleDefault').onclick=async()=>{await act(()=>send({type:'SET_SCHEDULE_DEFAULT',schedule:collect()}),'⭐ Current time schedule set as default');await refresh()};
async function refresh(){const s=await state();const p=await chrome.storage.local.get({profileImage:''});s.profileImage=p.profileImage||'';render(s)}
loadRemembered();refresh();setInterval(()=>{ if(current.nextEvent?.at) $('countdown').textContent=countdownText(current.nextEvent.at); },1000);setInterval(refresh,1500);
