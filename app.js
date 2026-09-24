const cfg=window.APP_CONFIG||{};
const $=s=>document.querySelector(s);
const authView=$('#authView'),passwordSetupView=$('#passwordSetupView'),appView=$('#appView'),view=$('#view'),tabs=$('#tabs'),headerUser=$('#headerUser');
let currentUser=null,profile=null,participantProfile=null,activeTab='home';
const staffRoles=['owner','researcher'];
const staffTabs=['home','participants','athlete','attendance','wellness','training','tests','history','report','settings'];
const participantTabs=['home','athlete','attendance','wellness','training','tests','history','report'];
const labels={home:'Home',participants:'Partecipanti',athlete:'Area personale',attendance:'Presenze',wellness:'Wellness',training:'Allenamento',tests:'Test',history:'Storico',report:'Report atleta',settings:'Amministrazione'};
const phases=['T0','T1','T2'];
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('it-IT'):'';
const fmtDate=d=>d?new Date(d+'T12:00:00').toLocaleDateString('it-IT'):'';
const localDateISO=(d=new Date())=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`};
const dateAtNoonISO=d=>`${d}T12:00:00`;
const mondayOfWeek=(base=new Date())=>{const d=new Date(base);d.setHours(12,0,0,0);const day=d.getDay()||7;d.setDate(d.getDate()-day+1);return d};
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const dayName=d=>d.toLocaleDateString('it-IT',{weekday:'long'});
const stat=(l,v)=>`<div class="stat"><span>${esc(l)}</span><b>${esc(v)}</b></div>`;
const toast=t=>{const x=$('#toast');x.textContent=t;x.classList.remove('hidden');setTimeout(()=>x.classList.add('hidden'),2600)};
const isStaff=()=>staffRoles.includes(profile?.role);

// V10 — riferimenti individuali descrittivi, non soglie cliniche né predittive.
const mean=a=>a.length?a.reduce((s,v)=>s+Number(v||0),0)/a.length:null;
const sd=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(Number(v)-m)**2,0)/(a.length-1))};
function individualStatus(current,previous,direction='high'){
  const a=previous.map(Number).filter(Number.isFinite);
  if(a.length<5||!Number.isFinite(Number(current)))return {level:'building',label:'Baseline in costruzione',detail:`${a.length}/5 osservazioni precedenti disponibili`};
  const m=mean(a),s=sd(a),v=Number(current),z=s>0?(v-m)/s:0;
  const adverse=direction==='low'?-z:z;
  const level=adverse>=2?'red':adverse>=1?'orange':'green';
  return {level,label:level==='red'?'Anomalia marcata':level==='orange'?'Da monitorare':'Nella norma personale',detail:`Valore ${Math.round(v*10)/10} · riferimento recente ${Math.round(m*10)/10} ± ${Math.round(s*10)/10}`,mean:m,sd:s,z};
}
function seriesStatus(rows,key,direction='high'){
  return rows.map((r,i)=>({...r,_status:individualStatus(Number(r[key]),rows.slice(Math.max(0,i-10),i).map(x=>Number(x[key])),direction)}));
}
function alertBadge(s){const icon=s.level==='red'?'🔴':s.level==='orange'?'⚠️':s.level==='green'?'✓':'◌';return `<span class="monitorBadge ${s.level}" title="${esc(s.detail)}">${icon} ${esc(s.label)}</span>`}
function ymKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function monthTitle(d){return d.toLocaleDateString('it-IT',{month:'long',year:'numeric'})}



// Primo accesso da invito/reset password.
// Supabase può restituire token nell'hash oppure un code PKCE nella query.
const initialUrl = new URL(window.location.href);
const initialHash = new URLSearchParams(initialUrl.hash.replace(/^#/,''));
const authCallbackType = initialHash.get('type') || initialUrl.searchParams.get('type') || '';
const inviteContext = ['invite','recovery'].includes(authCallbackType)
  || initialHash.has('access_token')
  || initialUrl.searchParams.has('code')
  || initialUrl.searchParams.get('password_recovery') === '1';
let awaitingPasswordSetup = inviteContext;

function appBaseUrl(){
  // Fondamentale per GitHub Pages: conserva /nome-repository/ e non solo location.origin.
  return new URL('./', window.location.href).href;
}

function showPasswordSetup(message=''){
  authView?.classList.add('hidden');
  appView?.classList.add('hidden');
  passwordSetupView?.classList.remove('hidden');
  const m=$('#passwordMsg'); if(m)m.textContent=message;
}
function clearAuthCallbackUrl(){
  try{ history.replaceState({},document.title,appBaseUrl()); }catch(_e){}
}
async function finishFirstAccess(session, reason=''){
  if(!session?.user) return false;
  const recovery = reason === 'recovery' || authCallbackType === 'recovery' || initialUrl.searchParams.get('password_recovery') === '1';
  showPasswordSetup(recovery
    ? 'Recupero verificato. Inserisci e conferma la tua nuova password.'
    : 'Invito verificato. Scegli ora la tua password personale.');
  return true;
}

let sb=null;
try{
  if(!window.supabase) throw new Error('Libreria Supabase non caricata dal CDN.');
  if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.startsWith('INSERISCI')) throw new Error('config.js incompleto.');
  sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
}catch(e){ console.error('Init Supabase:',e); }

function showAuth(message,kind=''){
  const m=$('#authMsg');
  if(m){m.textContent=message||'';m.dataset.kind=kind;}
  authView?.classList.remove('hidden');
}
function detailError(prefix,err){
  console.error(prefix,err);
  const msg=err?.message||err?.error_description||String(err||'errore sconosciuto');
  return `${prefix}: ${msg}`;
}

async function boot(user){
  try{
    currentUser=user;
    showAuth('Login valido. Caricamento profilo owner…');
    const {data:p,error}=await sb.from('profiles').select('id,full_name,role,active').eq('id',user.id).maybeSingle();
    if(error) throw new Error('Lettura profilo: '+error.message);
    if(!p) throw new Error('Profilo Tesi non trovato per questo account.');
    if(p.active===false) throw new Error('Profilo disattivato.');
    profile=p;
    if(profile.role==='participant'){
      const {data:a,error:aerr}=await sb.from('participants').select('*').eq('user_id',user.id).maybeSingle();
      if(aerr) throw new Error('Lettura partecipante: '+aerr.message);
      if(!a) throw new Error('Account non associato a un partecipante.');
      participantProfile=a;
    }
    authView.classList.add('hidden');
    appView.classList.remove('hidden');
    headerUser.classList.remove('hidden');
    headerUser.innerHTML=`<span>${esc(profile.full_name)}<br><small>${profile.role==='owner'?'Titolare':profile.role==='researcher'?'Ricercatore':'Partecipante'}</small></span><button class="secondary" id="logoutBtn">Esci</button>`;
    $('#logoutBtn').onclick=async()=>{await sb.auth.signOut();location.reload()};
    activeTab='home';
    renderTabs();
    try { await render(); }
    catch(renderErr){
      console.error('Render iniziale',renderErr);
      view.innerHTML=`<div class="card"><h2>Login riuscito</h2><p>Il collegamento con Supabase e il profilo <b>${esc(profile.role)}</b> funzionano.</p><p class="msg">Errore nel caricamento della dashboard: ${esc(renderErr?.message||String(renderErr))}</p><p class="muted">Se il problema persiste, contatta il Titolare del progetto.</p></div>`;
    }
    return true;
  }catch(err){
    showAuth(detailError('Errore dopo il login',err),'error');
    return false;
  }
}

async function doLogin(){
  const msg=$('#authMsg');
  if(!sb){msg.textContent='Supabase non inizializzato. Controlla connessione/config.js.';return}
  const email=$('#loginEmail').value.trim();
  const password=$('#loginPassword').value;
  if(!email||!password){msg.textContent='Inserisci email e password.';return}
  msg.textContent='Accesso in corso…';
  $('#loginBtn').disabled=true;
  try{
    const {data,error}=await sb.auth.signInWithPassword({email,password});
    if(error){msg.textContent='Login non riuscito: '+error.message;return}
    if(!data?.user){msg.textContent='Login non riuscito: utente non restituito.';return}
    await boot(data.user);
  }catch(err){
    msg.textContent=detailError('Errore login/app',err);
  }finally{
    $('#loginBtn').disabled=false;
  }
}

$('#loginForm').addEventListener('submit',e=>{e.preventDefault();doLogin()});
$('#loginBtn').addEventListener('click',e=>{e.preventDefault();doLogin()});
showAuth(sb ? 'Collegamento Supabase configurato.' : 'Errore inizializzazione Supabase. Controlla config.js.');


// Recupero password interamente dall'interfaccia Patruno Monitor.
// Supabase resta il provider Auth dietro le quinte: l'utente non deve entrare nella dashboard.
$('#forgotPasswordBtn')?.addEventListener('click',()=>{
  const box=$('#recoveryRequestBox');
  box?.classList.toggle('hidden');
  const loginMail=$('#loginEmail')?.value?.trim();
  if(loginMail && $('#recoveryEmail')) $('#recoveryEmail').value=loginMail;
  if(!box?.classList.contains('hidden')) $('#recoveryEmail')?.focus();
});
$('#cancelRecoveryBtn')?.addEventListener('click',()=>{
  $('#recoveryRequestBox')?.classList.add('hidden');
  if($('#recoveryMsg')) $('#recoveryMsg').textContent='';
});
$('#recoveryRequestForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const email=$('#recoveryEmail')?.value?.trim();
  const m=$('#recoveryMsg');
  const btn=$('#sendRecoveryBtn');
  if(!email){ if(m)m.textContent='Inserisci la tua email.'; return; }
  if(!sb){ if(m)m.textContent='Servizio di autenticazione non disponibile.'; return; }
  btn.disabled=true;
  if(m)m.textContent='Invio del link di recupero…';
  try{
    // Il marker rende il ritorno riconoscibile anche se l'evento PASSWORD_RECOVERY
    // avviene molto presto durante l'inizializzazione del client.
    const redirectUrl = new URL(appBaseUrl());
    redirectUrl.searchParams.set('password_recovery','1');
    const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:redirectUrl.href});
    if(error) throw error;
    if(m)m.textContent='Se l’indirizzo è associato a un account, riceverai una email con il link per scegliere una nuova password. Controlla anche Spam/Posta indesiderata.';
  }catch(err){
    if(m)m.textContent='Impossibile inviare il recupero: '+(err?.message||String(err));
  }finally{btn.disabled=false;}
});

// Gli errori globali vengono registrati in console ma NON sovrascrivono il messaggio di login.
window.addEventListener('error',e=>console.error('Global error',e.error||e.message,e.filename,e.lineno,e.colno));
window.addEventListener('unhandledrejection',e=>console.error('Unhandled promise rejection',e.reason));

async function restore(){
  if(!sb)return;
  try{
    const {data,error}=await sb.auth.getSession();
    if(error) throw error;
    if(data?.session?.user){ if(awaitingPasswordSetup) await finishFirstAccess(data.session, initialUrl.searchParams.get('password_recovery')==='1'?'recovery':''); else await boot(data.session.user); }
  }catch(e){console.error('Restore session',e)}
}

if(sb){
  sb.auth.onAuthStateChange((event,session)=>{
    if((awaitingPasswordSetup || event==='PASSWORD_RECOVERY') && session?.user){
      awaitingPasswordSetup=true;
      // Evita operazioni Supabase asincrone dentro il callback Auth.
      setTimeout(()=>finishFirstAccess(session,event==='PASSWORD_RECOVERY'?'recovery':''),0);
    }
  });
}

$('#passwordSetupForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const p1=$('#newPassword').value;
  const p2=$('#confirmPassword').value;
  const m=$('#passwordMsg');
  if(p1.length<8){m.textContent='La password deve contenere almeno 8 caratteri.';return;}
  if(p1!==p2){m.textContent='Le due password non coincidono.';return;}
  $('#setPasswordBtn').disabled=true;
  m.textContent='Salvataggio password…';
  try{
    const {data,error}=await sb.auth.updateUser({password:p1});
    if(error) throw error;
    awaitingPasswordSetup=false;
    clearAuthCallbackUrl();
    passwordSetupView.classList.add('hidden');
    try{ await sb.auth.signOut(); }catch(_e){}
    showAuth('Password aggiornata correttamente. Ora accedi con email e nuova password.','success');
    if($('#loginEmail') && data?.user?.email) $('#loginEmail').value=data.user.email;
    if($('#loginPassword')) $('#loginPassword').value='';
  }catch(err){
    m.textContent='Impossibile impostare la password: '+(err?.message||String(err));
  }finally{$('#setPasswordBtn').disabled=false;}
});

setTimeout(restore,0);
function renderTabs(){const arr=isStaff()?staffTabs:participantTabs;tabs.innerHTML=arr.map(t=>`<button class="tabBtn ${activeTab===t?'active':''}" data-tab="${t}">${labels[t]}</button>`).join('');tabs.querySelectorAll('button').forEach(b=>b.onclick=async()=>{activeTab=b.dataset.tab;renderTabs();await render()})}
async function render(){const fn={home:renderHome,participants:renderParticipants,athlete:renderAthleteArea,attendance:renderAttendance,wellness:renderWellness,training:renderTraining,tests:renderTests,history:renderHistory,report:renderReport,settings:renderSettings}[activeTab];await fn()}
async function getParticipants(){if(profile.role==='participant')return [participantProfile];const {data}=await sb.from('participants').select('*').eq('active',true).order('code');return data||[]}
async function identityMap(){if(!isStaff())return{};const {data}=await sb.from('participant_identity').select('*');return Object.fromEntries((data||[]).map(x=>[x.participant_id,x]))}
const fullName=i=>[i?.first_name,i?.last_name].filter(Boolean).join(' ').trim();
const participantLabel=(p,ids={})=>{const n=fullName(ids[p?.id]);return n?`${p.code} — ${n}`:(p?.code||'Partecipante')};
async function participantOptions(id='participantId',selected=''){const pp=await getParticipants();if(profile.role==='participant')return `<input type="hidden" id="${id}" value="${participantProfile.id}"><p><b>Partecipante:</b> ${esc(participantProfile.code)}</p>`;const ids=await identityMap();return `<label>Partecipante<select id="${id}">${pp.map(p=>`<option value="${p.id}" ${selected===p.id?'selected':''}>${esc(participantLabel(p,ids))}</option>`).join('')}</select></label>`}

async function renderHome(){
 const pid=profile.role==='participant'?participantProfile.id:null;
 let qlogs=sb.from('session_logs').select('*,session_templates(session_number,week_number,session_type,title)').order('performed_at',{ascending:false});
 let qw=sb.from('wellness').select('*').order('wellness_date',{ascending:false}).order('recorded_at',{ascending:false});
 let qt=sb.from('test_results').select('*,test_catalog(code,name,unit,higher_better)').order('recorded_at',{ascending:false});
 if(pid){qlogs=qlogs.eq('participant_id',pid);qw=qw.eq('participant_id',pid);qt=qt.eq('participant_id',pid)}
 const [{data:logs},{data:wells},{data:tests},{data:parts}]=await Promise.all([qlogs,qw,qt,sb.from('participants').select('*').eq('active',true).order('code')]);
 const load=(logs||[]).reduce((s,x)=>s+Number(x.session_load||0),0);
 const completed=new Set((logs||[]).filter(x=>x.completed&&Number(x.session_templates?.session_number)<=42).map(x=>x.session_template_id)).size;
 const latestW=(wells||[])[0];
 if(profile.role==='participant'){
   view.innerHTML=`<div class="card hero dashboardHero"><div><div class="eyebrow">PATRUNO MONITOR · TESI</div><h2>${esc(participantProfile.code)}</h2><p>Il tuo percorso di monitoraggio</p></div><div class="stats">${stat('Sedute completate',completed+'/42')}${stat('Aderenza',Math.round(completed/42*100)+'%')}${stat('Training Load',Math.round(load)+' AU')}${stat('Test registrati',(tests||[]).length)}</div></div>
   <div class="card"><h2>Stato ultimo wellness</h2>${latestW?`<div class="stats">${stat('Score',latestW.score+'/20')}${stat('Dolore',latestW.pain_present?(latestW.pain_score??'—')+'/10':'No')}${stat('Data',fmtDate(latestW.wellness_date)||fmt(latestW.recorded_at))}</div>`:'<p class="muted">Nessun wellness ancora registrato.</p>'}</div>
   <div class="actionGrid"><button class="actionBtn" data-go="athlete">La mia area</button><button class="actionBtn" data-go="wellness">Compila wellness</button><button class="actionBtn" data-go="training">Seduta / sRPE</button><button class="actionBtn" data-go="tests">I miei test</button><button class="actionBtn" data-go="report">Il mio report</button></div>`;
 } else {
   const ids=await identityMap();
   const today=localDateISO();
   const active=parts||[];
   const wellToday=(wells||[]).filter(x=>x.wellness_date===today);
   const avgWell=wellToday.length?(wellToday.reduce((s,x)=>s+Number(x.score||0),0)/wellToday.length):null;
   const completedProtocol=(logs||[]).filter(x=>x.completed && Number(x.session_templates?.session_number)<=42).length;
   const avgTL=active.length?load/active.length:0;
   const byPid={};
   active.forEach(p=>byPid[p.id]={p,doneIds:new Set(),load:0,w:null,lastLog:null,t0:0});
   (logs||[]).forEach(x=>{const o=byPid[x.participant_id];if(!o)return;o.load+=Number(x.session_load||0);if(x.completed&&Number(x.session_templates?.session_number)<=42)o.doneIds.add(x.session_template_id);if(!o.lastLog)o.lastLog=x});
   (wells||[]).forEach(x=>{const o=byPid[x.participant_id];if(o&&!o.w)o.w=x});
   (tests||[]).forEach(x=>{if(byPid[x.participant_id]&&x.phase==='T0')byPid[x.participant_id].t0++});
   const cards=Object.values(byPid).map(o=>{const done=o.doneIds.size,pct=Math.min(100,Math.round(done/42*100));const last=o.lastLog;return `<div class="athleteDashCard"><div class="athleteDashHead"><div><span class="codeBadge">${esc(o.p.code)}</span><h3>${esc(fullName(ids[o.p.id])||'Nome non inserito')}</h3></div><div class="rowActions"><button class="miniEdit" data-open-athlete="${o.p.id}">Area</button><button class="miniEdit" data-open-participant="${o.p.id}">Modifica</button></div></div><div class="progressTrack"><div class="progressFill" style="width:${pct}%"></div></div><div class="dashMetricGrid"><div><small>Sedute</small><strong>${done}/42</strong><em>${pct}%</em></div><div><small>Carico totale</small><strong>${Math.round(o.load)}</strong><em>AU</em></div><div><small>Ultima seduta</small><strong>${last?'N° '+(last.session_templates?.session_number??'—'):'—'}</strong><em>${last?fmtDate((last.performed_at||'').slice(0,10)):'nessun dato'}</em></div><div><small>Ultimo sRPE</small><strong>${last?.srpe??'—'}</strong><em>${last?Math.round(Number(last.session_load||0))+' AU':'—'}</em></div><div><small>Wellness</small><strong>${o.w?o.w.score+'/20':'—'}</strong><em>${o.w?fmtDate(o.w.wellness_date):'nessun dato'}</em></div><div><small>Test T0</small><strong>${o.t0}</strong><em>registrati</em></div></div></div>`}).join('');
   const watch=[]; Object.values(byPid).forEach(o=>{const pl=(logs||[]).filter(x=>x.participant_id===o.p.id).slice().reverse(),pw=(wells||[]).filter(x=>x.participant_id===o.p.id).slice().reverse();const ls=pl.length?individualStatus(Number(pl.at(-1).session_load||0),pl.slice(Math.max(0,pl.length-11),-1).map(x=>Number(x.session_load||0)),'high'):null;const ws=pw.length?individualStatus(Number(pw.at(-1).score||0),pw.slice(Math.max(0,pw.length-11),-1).map(x=>Number(x.score||0)),'low'):null;const levels=[ls,ws].filter(Boolean);const worst=levels.find(x=>x.level==='red')||levels.find(x=>x.level==='orange');if(worst)watch.push({p:o.p,ls,ws})});
   const watchHtml=watch.map(x=>`<div class="watchAthlete"><b>${esc(participantLabel(x.p,ids))}</b><div>${x.ls&&['orange','red'].includes(x.ls.level)?alertBadge(x.ls):''} ${x.ws&&['orange','red'].includes(x.ws.level)?alertBadge(x.ws):''}</div><button class="miniEdit" data-open-athlete="${x.p.id}">Apri area</button></div>`).join('');

   view.innerHTML=`<div class="card hero dashboardHero"><div><div class="eyebrow">PATRUNO MONITOR · TESI</div><h2>Dashboard di studio</h2><p>Vista operativa del campione e del protocollo</p></div><div class="stats">${stat('Partecipanti',active.length)}${stat('Wellness oggi',wellToday.length+'/'+active.length)}${stat('TL gruppo',Math.round(load)+' AU')}${stat('Test registrati',(tests||[]).length)}</div></div>
   <div class="grid two"><div class="card"><h2>Indicatori gruppo</h2><div class="stats">${stat('Sedute protocollo',completedProtocol)}${stat('TL medio/atleta',Math.round(avgTL)+' AU')}${stat('Wellness medio oggi',avgWell?avgWell.toFixed(1)+'/20':'—')}${stat('Struttura','42 + extra')}</div></div><div class="card"><h2>Disegno</h2><p><b>14 settimane · 42 sedute</b></p><p>HIIT — FORZA — HIIT</p><p>Valutazioni: <b>T0 · T1 · T2</b></p><div class="protocolLine"><span>T0</span><i></i><span>T1</span><i></i><span>T2</span></div></div></div>
   <div class="card"><div class="sectionTitle"><div><h2>Atleti da controllare</h2><p class="muted">Alert descrittivi rispetto alla baseline personale recente; non sono diagnosi né stime di rischio infortunio.</p></div><span class="sectionPill">${watch.length} alert</span></div><div class="watchGrid">${watchHtml||'<p class="muted">Nessun alert attivo con baseline sufficiente.</p>'}</div></div><div class="card"><div class="sectionTitle"><div><h2>Partecipanti — stato rapido</h2><p class="muted">Codice e nome sempre associati nella vista staff.</p></div></div><div class="athleteDashGrid">${cards||'<p class="muted">Nessun partecipante attivo.</p>'}</div></div>`;
   document.querySelectorAll('[data-open-athlete]').forEach(b=>b.onclick=async()=>{sessionStorage.setItem('athleteAreaPid',b.dataset.openAthlete);activeTab='athlete';renderTabs();await renderAthleteArea()});
   document.querySelectorAll('[data-open-participant]').forEach(b=>b.onclick=async()=>{activeTab='participants';renderTabs();await renderParticipants();setTimeout(()=>document.querySelector(`[data-edit="${b.dataset.openParticipant}"]`)?.click(),0)});
 }
 document.querySelectorAll('[data-go]').forEach(b=>b.onclick=async()=>{activeTab=b.dataset.go;renderTabs();await render()});
}


function svgLineChart(rows, series, opts={}){
  if(!rows.length)return '<div class="emptyChart">Dati non ancora disponibili.</div>';
  const W=760,H=250,L=42,R=18,T=18,B=42,pw=W-L-R,ph=H-T-B;
  const vals=rows.flatMap(r=>series.map(q=>Number(r[q.key])).filter(Number.isFinite));
  if(!vals.length)return '<div class="emptyChart">Dati non ancora disponibili.</div>';
  let min=opts.min!=null?opts.min:Math.min(...vals),max=opts.max!=null?opts.max:Math.max(...vals);
  if(min===max){min-=1;max+=1} const x=i=>L+(rows.length===1?pw/2:i*pw/(rows.length-1)); const y=v=>T+(max-v)*ph/(max-min);
  const grid=[0,.25,.5,.75,1].map(f=>{const yy=T+ph*f,v=max-(max-min)*f;return `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" class="chartGrid"/><text x="${L-7}" y="${yy+4}" text-anchor="end" class="chartTick">${Math.round(v*10)/10}</text>`}).join('');
  const lines=series.map((q,si)=>{const pts=rows.map((r,i)=>Number.isFinite(Number(r[q.key]))?`${x(i)},${y(Number(r[q.key]))}`:null).filter(Boolean).join(' ');const dots=rows.map((r,i)=>Number.isFinite(Number(r[q.key]))?`<circle cx="${x(i)}" cy="${y(Number(r[q.key]))}" r="3.5" class="chartSeries s${si}"/>`:'').join('');return `<polyline points="${pts}" class="chartSeriesLine s${si}"/>${dots}`}).join('');
  const every=Math.max(1,Math.ceil(rows.length/7));const labs=rows.map((r,i)=>(i%every===0||i===rows.length-1)?`<text x="${x(i)}" y="${H-14}" text-anchor="middle" class="chartTick">${esc(r.label)}</text>`:'').join('');
  const legend=series.length>1?`<div class="chartLegend">${series.map((q,i)=>`<span><i class="legendDot s${i}"></i>${esc(q.label)}</span>`).join('')}</div>`:'';
  return `<div class="analyticsChart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title||'Grafico')}">${grid}${lines}${labs}</svg>${legend}</div>`;
}

async function renderAthleteArea(){
 const parts=await getParticipants(),ids=await identityMap();
 let pid=profile.role==='participant'?participantProfile.id:(sessionStorage.getItem('athleteAreaPid')||parts[0]?.id||'');
 if(!parts.some(p=>p.id===pid))pid=parts[0]?.id||'';
 if(!pid){view.innerHTML='<div class="card"><h2>Area personale</h2><p class="muted">Nessun partecipante disponibile.</p></div>';return}
 const selector=profile.role==='participant'?`<div class="athleteIdentity"><span class="codeBadge">${esc(participantProfile.code)}</span><b>La mia area personale</b></div>`:`<label class="athletePicker">Partecipante<select id="athletePid">${parts.map(p=>`<option value="${p.id}" ${p.id===pid?'selected':''}>${esc(participantLabel(p,ids))}</option>`).join('')}</select></label>`;
 view.innerHTML=`<div class="card athleteAreaTop"><div><div class="eyebrow dark">MONITORAGGIO INDIVIDUALE</div><h2>Area personale atleta</h2><p class="muted">Vista sintetica e navigabile del monitoraggio longitudinale.</p></div>${selector}</div><div id="athleteAreaBody"><div class="card"><p class="muted">Caricamento dati…</p></div></div>`;
 const load=async()=>{
   const chosen=profile.role==='participant'?participantProfile.id:$('#athletePid').value; sessionStorage.setItem('athleteAreaPid',chosen);
   const p=parts.find(x=>x.id===chosen)||participantProfile; const label=participantLabel(p,ids);
   const [{data:logs,error:le},{data:wells,error:we},{data:tests,error:te},{data:attendance,error:ae}]=await Promise.all([
    sb.from('session_logs').select('*,session_templates(session_number,week_number,session_type,title)').eq('participant_id',chosen).order('performed_at',{ascending:true}),
    sb.from('wellness').select('*').eq('participant_id',chosen).order('wellness_date',{ascending:true}).order('recorded_at',{ascending:true}),
    sb.from('test_results').select('*,test_catalog(name,unit)').eq('participant_id',chosen).order('recorded_at',{ascending:true}),
    sb.from('attendance').select('*').eq('participant_id',chosen).order('attendance_date',{ascending:true})
   ]);
   if(le||we||te||ae){$('#athleteAreaBody').innerHTML=`<div class="card"><p class="msg">${esc((le||we||te||ae).message)}</p></div>`;return}
   const ALLL=logs||[],ALLW=wells||[],T=tests||[],ALLA=attendance||[];
   const protocol=ALLL.filter(x=>x.completed&&Number(x.session_templates?.session_number)<=42), extra=ALLL.filter(x=>x.completed&&Number(x.session_templates?.session_number)>42);
   const range=sessionStorage.getItem('athleteAnalyticsRange')||'14', section=sessionStorage.getItem('athleteAnalyticsSection')||'overview';
   const cutoff=(days)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-days+1);return d};
   const inRange=(d,days)=>days==='all'||new Date(d)>=cutoff(Number(days));
   const L=ALLL.filter(x=>inRange(x.performed_at,range)),W=ALLW.filter(x=>inRange((x.wellness_date||'')+'T12:00:00',range));
   const totalAU=L.reduce((a,x)=>a+Number(x.session_load||0),0), avgR=L.length?L.reduce((a,x)=>a+Number(x.srpe||0),0)/L.length:0, avgAU=L.length?totalAU/L.length:0, avgWell=W.length?W.reduce((a,x)=>a+Number(x.score||0),0)/W.length:0;
   const loadRows=L.map(x=>({label:new Date(x.performed_at).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'}),au:Number(x.session_load||0)}));
   const wellRows=W.map(x=>({label:fmtDate(x.wellness_date).slice(0,5),score:Number(x.score||0),sleep:Number(x.sleep),fatigue:Number(x.fatigue),doms:Number(x.doms),stress:Number(x.stress)}));
   const loadStatus=seriesStatus(ALLL.map(x=>({date:(x.performed_at||'').slice(0,10),au:Number(x.session_load||0)})),'au','high');
   const wellStatus=seriesStatus(ALLW.map(x=>({date:x.wellness_date,score:Number(x.score||0)})),'score','low');
   const latestLoadStatus=loadStatus.length?loadStatus.at(-1)._status:{level:'building',label:'Baseline in costruzione',detail:'Servono almeno 5 sedute precedenti'};
   const latestWellStatus=wellStatus.length?wellStatus.at(-1)._status:{level:'building',label:'Baseline in costruzione',detail:'Servono almeno 5 rilevazioni precedenti'};
   const loadRef=loadStatus.length?loadStatus.at(-1)._status:null, wellRef=wellStatus.length?wellStatus.at(-1)._status:null;
   const refText=(s,unit='')=>s&&Number.isFinite(s.mean)?`Fascia abituale descrittiva: ${Math.max(0,s.mean-s.sd).toFixed(1)}–${(s.mean+s.sd).toFixed(1)} ${unit}`:'Baseline in costruzione: servono almeno 5 osservazioni precedenti.';

   const rangeBar=`<div class="analyticsRange" role="group" aria-label="Intervallo temporale">${[['7','7 gg'],['14','14 gg'],['28','28 gg'],['all','Tutto']].map(([v,l])=>`<button type="button" class="rangeBtn ${range===v?'active':''}" data-range="${v}">${l}</button>`).join('')}</div>`;
   const nav=`<div class="athleteSubnav">${[['overview','Panoramica'],['training','Allenamenti'],['wellness','Wellness'],['tests','Test'],['tables','Tabelle']].map(([v,l])=>`<button type="button" class="subnavBtn ${section===v?'active':''}" data-section="${v}">${l}</button>`).join('')}</div>`;
   const detail=[...L].reverse().map(x=>`<tr><td>${fmt(x.performed_at)}</td><td><b>${x.session_templates?.session_number??'—'}</b></td><td>${esc(x.session_templates?.session_type||'—')}</td><td>${esc(x.actual_work||x.session_templates?.title||'—')}</td><td>${x.duration_min??'—'} min</td><td><span class="rpeChip">${x.srpe??'—'}</span></td><td><b>${Math.round(Number(x.session_load||0))} AU</b></td><td>${x.pain_post?`Sì · ${esc(x.pain_site||'')} ${x.pain_score??'—'}/10`:'No'}</td><td>${esc(x.notes||'—')}</td></tr>`).join('');
   const rpeRows=[...L].reverse().map(x=>`<tr><td>${fmt(x.performed_at)}</td><td>Seduta ${x.session_templates?.session_number??'—'}</td><td>${x.duration_min??'—'}</td><td><b>${x.srpe??'—'}</b></td><td>${Math.round(Number(x.session_load||0))}</td></tr>`).join('');
   const wellCards=[...W].reverse().map(x=>`<article class="wellnessResultCard"><div class="wellnessResultHead"><div><b>${fmtDate(x.wellness_date)}</b></div><div class="wellnessTotal"><strong>${x.score}</strong><span>/20</span></div></div><div class="wellnessMetricGrid"><div><span>Sonno</span><b>${x.sleep}/5</b></div><div><span>Stanchezza</span><b>${x.fatigue}/5</b></div><div><span>DOMS</span><b>${x.doms}/5</b></div><div><span>Stress</span><b>${x.stress}/5</b></div></div></article>`).join('');
   const trainCards=[...L].reverse().map(x=>`<article class="trainingResultCard"><div class="trainingResultHead"><div><span class="typeChip">${esc(x.session_templates?.session_type||'SEDUTA')}</span><h3>Seduta ${x.session_templates?.session_number??'—'}</h3><small>${fmtDate((x.performed_at||'').slice(0,10))}</small></div><div class="auHero"><strong>${Math.round(Number(x.session_load||0))}</strong><span>AU</span></div></div><div class="trainingMetricGrid"><div><span>Durata</span><b>${x.duration_min??'—'} min</b></div><div><span>sRPE</span><b>${x.srpe??'—'}/10</b></div><div><span>Completata</span><b>${x.completed?'Sì':'No'}</b></div></div>${x.actual_work?`<p class="trainingWork"><b>Lavoro:</b> ${esc(x.actual_work)}</p>`:''}</article>`).join('');
   const testRows=T.map(x=>`<tr><td>${esc(x.phase)}</td><td>${esc(x.test_catalog?.name||'—')}</td><td>${x.mean_value!=null?Number(x.mean_value).toFixed(2):'—'} ${esc(x.test_catalog?.unit||'')}</td><td><b>${x.best_value!=null?Number(x.best_value).toFixed(2):'—'} ${esc(x.test_catalog?.unit||'')}</b></td></tr>`).join('');
   let content='';
   if(section==='overview') content=`<div class="analyticsGrid"><div class="card"><div class="sectionTitle"><div><h2>Carico di allenamento</h2><p class="muted">AU = durata × session-RPE</p></div><span class="sectionPill">${L.length} sedute</span></div>${svgLineChart(loadRows,[{key:'au',label:'AU'}],{title:'Carico AU',min:0})}</div><div class="card"><div class="sectionTitle"><div><h2>Wellness</h2><p class="muted">Score complessivo /20</p></div><span class="sectionPill">${W.length} rilevazioni</span></div>${svgLineChart(wellRows,[{key:'score',label:'Score'}],{title:'Wellness score',min:4,max:20})}</div></div><div class="card"><h2>Ultimi allenamenti nel periodo</h2><div class="trainingCardGrid">${trainCards||'<p class="muted">Nessun allenamento nel periodo.</p>'}</div></div>`;
   if(section==='training') content=`<div class="card diaryCard"><div class="sectionTitle"><div><h2>Diario di allenamento</h2><p class="muted">Calendario sincronizzato con Presenze e allenamenti registrati.</p></div><div class="calendarNav"><button class="secondary" id="calPrev">‹</button><b id="calTitle"></b><button class="secondary" id="calNext">›</button></div></div><div id="trainingCalendar"></div><div id="calendarDetail"></div></div><div class="card"><div class="sectionTitle"><div><h2>Andamento Training Load</h2><p class="muted">${esc(refText(loadRef,'AU'))}. La fascia è un riferimento individuale descrittivo, non una soglia di rischio.</p></div><div>${alertBadge(latestLoadStatus)} <span class="sectionPill">${Math.round(totalAU)} AU</span></div></div>${svgLineChart(loadRows,[{key:'au',label:'AU'}],{title:'Carico AU',min:0})}</div><div class="card"><div class="trainingCardGrid">${trainCards||'<p class="muted">Nessun allenamento nel periodo.</p>'}</div></div>`;
   if(section==='wellness') content=`<div class="card monitorSummary"><div><h2>Stato Wellness</h2><p class="muted">${esc(refText(wellRef,'punti'))}. Confronto con lo storico personale recente.</p></div>${alertBadge(latestWellStatus)}</div><div class="analyticsGrid"><div class="card"><h2>Wellness totale</h2>${svgLineChart(wellRows,[{key:'score',label:'Score'}],{title:'Wellness score',min:4,max:20})}</div><div class="card"><h2>Componenti wellness</h2>${svgLineChart(wellRows,[{key:'sleep',label:'Sonno'},{key:'fatigue',label:'Stanchezza'},{key:'doms',label:'DOMS'},{key:'stress',label:'Stress'}],{title:'Componenti wellness',min:1,max:5})}</div></div><div class="card"><div class="wellnessCardGrid compact">${wellCards||'<p class="muted">Nessun wellness nel periodo.</p>'}</div></div>`;
   if(section==='tests') content=`<div class="card"><div class="sectionTitle"><div><h2>Test T0 · T1 · T2</h2><p class="muted">I test non sono limitati dal filtro temporale.</p></div></div><div class="tableWrap"><table><thead><tr><th>Fase</th><th>Test</th><th>Media</th><th>Best</th></tr></thead><tbody>${testRows||'<tr><td colspan="4">Nessun test registrato.</td></tr>'}</tbody></table></div></div>`;
   if(section==='tables') content=`<div class="card"><h2>Allenamenti · tabella completa del periodo</h2><div class="tableWrap athleteTable"><table><thead><tr><th>Data</th><th>N°</th><th>Tipo</th><th>Lavoro svolto</th><th>Durata</th><th>sRPE</th><th>AU</th><th>Dolore post</th><th>Note</th></tr></thead><tbody>${detail||'<tr><td colspan="9">Nessun allenamento.</td></tr>'}</tbody></table></div></div><div class="card"><h2>RPE / Training Load</h2><div class="tableWrap"><table><thead><tr><th>Data</th><th>Seduta</th><th>Durata min</th><th>sRPE CR10</th><th>Carico AU</th></tr></thead><tbody>${rpeRows||'<tr><td colspan="5">Nessun dato.</td></tr>'}</tbody></table></div></div>`;
   $('#athleteAreaBody').innerHTML=`<div class="card athleteProfileHero"><div><span class="codeBadge">${esc(p.code)}</span><h2>${esc(profile.role==='participant'?'Il mio monitoraggio':label)}</h2></div><div class="stats">${stat('Sedute protocollo',protocol.length+'/42')}${stat('Aderenza',Math.round(protocol.length/42*100)+'%')}${stat('AU periodo',Math.round(totalAU)+' AU')}${stat('sRPE medio',L.length?avgR.toFixed(1):'—')}${stat('AU medio/seduta',L.length?Math.round(avgAU):'—')}${stat('Wellness medio',W.length?avgWell.toFixed(1)+'/20':'—')}</div></div>${nav}<div class="card filterCard"><div><b>Periodo visualizzato</b><p class="muted">Il filtro aggiorna grafici, card e tabelle della sezione. Aderenza e sedute /42 restano globali.</p></div>${rangeBar}</div>${content}`;
   if(section==='training'){
     let calBase=new Date(); const stored=sessionStorage.getItem('athleteCalendarMonth'); if(stored&&/^\d{4}-\d{2}$/.test(stored)){const [yy,mm]=stored.split('-').map(Number);calBase=new Date(yy,mm-1,1)} else calBase=new Date(calBase.getFullYear(),calBase.getMonth(),1);
     const renderCalendar=()=>{
       sessionStorage.setItem('athleteCalendarMonth',ymKey(calBase));
       const title=$('#calTitle'); if(title)title.textContent=monthTitle(calBase);
       const y=calBase.getFullYear(),m=calBase.getMonth(),first=new Date(y,m,1),last=new Date(y,m+1,0),lead=(first.getDay()+6)%7,today=localDateISO();
       const logsBy={}; ALLL.forEach(x=>{const d=(x.performed_at||'').slice(0,10);(logsBy[d]??=[]).push(x)});
       const attBy={}; ALLA.forEach(x=>(attBy[x.attendance_date]??=[]).push(x));
       const wellBy={}; ALLW.forEach(x=>wellBy[x.wellness_date]=x);
       let cells=''; for(let i=0;i<lead;i++)cells+='<div class="calendarCell outside"></div>';
       for(let day=1;day<=last.getDate();day++){const d=new Date(y,m,day),iso=localDateISO(d),ls=logsBy[iso]||[],as=attBy[iso]||[],w=wellBy[iso],past=iso<today,future=iso>today;
         let state='rest',label='Riposo',icon='💤'; if(ls.length){state='trained';label=`Seduta ${ls.map(x=>x.session_templates?.session_number??'—').join(', ')}`;icon='🏃'}else if(as.length){state=past?'missing':'planned';label=past?'Presenza · seduta mancante':'Presenza programmata';icon=past?'⚠️':'📅'}else if(future){state='future';label='';icon=''}
         const au=ls.reduce((s,x)=>s+Number(x.session_load||0),0);cells+=`<button class="calendarCell ${state} ${iso===today?'today':''}" data-cal-day="${iso}"><span class="calDay">${day}</span>${label?`<span class="calState">${icon} ${esc(label)}</span>`:''}${au?`<span class="calAU">${Math.round(au)} AU</span>`:''}${w?`<span class="calWell">W ${w.score}/20</span>`:''}</button>`}
       $('#trainingCalendar').innerHTML=`<div class="calendarWeekdays">${['L','M','M','G','V','S','D'].map(x=>`<b>${x}</b>`).join('')}</div><div class="calendarGrid">${cells}</div><div class="calendarLegend"><span>🏃 Allenamento</span><span>📅 Presenza</span><span>⚠️ Seduta mancante</span><span>💤 Riposo</span></div>`;
       document.querySelectorAll('[data-cal-day]').forEach(b=>b.onclick=()=>{const iso=b.dataset.calDay,ls=logsBy[iso]||[],as=attBy[iso]||[],w=wellBy[iso];let h=`<div class="calendarDetailCard"><h3>${fmtDate(iso)}</h3>`;if(ls.length)h+=ls.map(x=>`<div class="calendarSession"><b>Seduta ${x.session_templates?.session_number??'—'} · ${esc(x.session_templates?.session_type||'')}</b><span>${x.duration_min??'—'} min · sRPE ${x.srpe??'—'}/10 · <strong>${Math.round(Number(x.session_load||0))} AU</strong></span>${x.actual_work?`<small>${esc(x.actual_work)}</small>`:''}</div>`).join('');else h+=`<p><b>${as.length?'Presenza registrata, nessun allenamento inserito':'Riposo'}</b></p>`;if(as.length)h+=`<p class="muted">Presenza: ${as.map(a=>a.period==='morning'?'mattina':'pomeriggio').join(', ')}</p>`;if(w)h+=`<p>Wellness: <b>${w.score}/20</b> · Sonno ${w.sleep}/5 · Stanchezza ${w.fatigue}/5 · DOMS ${w.doms}/5 · Stress ${w.stress}/5</p>`;h+='</div>';$('#calendarDetail').innerHTML=h});
     };
     $('#calPrev').onclick=()=>{calBase=new Date(calBase.getFullYear(),calBase.getMonth()-1,1);renderCalendar()}; $('#calNext').onclick=()=>{calBase=new Date(calBase.getFullYear(),calBase.getMonth()+1,1);renderCalendar()}; renderCalendar();
   }

   document.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{sessionStorage.setItem('athleteAnalyticsRange',b.dataset.range);load()});
   document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{sessionStorage.setItem('athleteAnalyticsSection',b.dataset.section);load()});
 };
 if($('#athletePid'))$('#athletePid').onchange=load; await load();
}

async function renderParticipants(){
 if(!isStaff())return renderHome();
 const {data:pp}=await sb.from('participants').select('*').order('code');
 const ids=await identityMap();
 const {data:anth}=await sb.from('anthropometry').select('*');
 const rows=(pp||[]).map(p=>{const i=ids[p.id]||{};const a=(anth||[]).filter(x=>x.participant_id===p.id);const status=p.active?'<span class="statusActive">Attivo</span>':'<span class="statusInactive">Disattivato</span>';const manage=profile.role==='owner'?`<button class="${p.active?'warning':'secondary'} miniDelete" data-toggle-participant="${p.id}" data-user-id="${p.user_id||''}" data-active="${p.active?'1':'0'}">${p.active?'Disattiva':'Riattiva'}</button> <button class="danger miniDelete" data-delete-participant="${p.id}" data-user-id="${p.user_id||''}" data-code="${esc(p.code)}">Elimina definitivamente</button>`:'';return `<tr class="${p.active?'':'inactiveRow'}"><td><span class="codeBadge">${esc(p.code)}</span></td><td>${esc([i.first_name,i.last_name].filter(Boolean).join(' ')||'—')}</td><td>${i.age_years??'—'}</td><td>${status}</td><td>${a.find(x=>x.phase==='T0')?.weight_kg??'—'}</td><td>${a.find(x=>x.phase==='T1')?.weight_kg??'—'}</td><td>${a.find(x=>x.phase==='T2')?.weight_kg??'—'}</td><td><button class="secondary" data-edit="${p.id}">Modifica</button>${manage?`<div class="participantActions">${manage}</div>`:''}</td></tr>`}).join('');
 view.innerHTML=`<div class="card"><div class="sectionTitle"><div><h2>Partecipanti</h2><p class="privacyNote">Nome, cognome e misure MyJump sono nella sezione riservata, visibile solo a Titolare/Ricercatore. Un partecipante disattivato viene escluso dagli elenchi operativi e non può accedere, ma i dati della tesi restano conservati.</p></div></div>
 <form id="newParticipant" class="grid two"><label>Codice<select id="newCode">${Array.from({length:30},(_,i)=>`<option>P${String(i+1).padStart(2,'0')}</option>`).join('')}</select></label><label>Nome<input id="newFirst"></label><label>Cognome<input id="newLast"></label><label>Età<input id="newAge" type="number" min="18" max="100"></label><div><button class="primary">Crea partecipante</button></div></form></div>
 <div class="card"><div class="tableWrap"><table><thead><tr><th>Codice</th><th>Identità riservata</th><th>Età</th><th>Stato</th><th>Peso T0</th><th>Peso T1</th><th>Peso T2</th><th>Azioni</th></tr></thead><tbody>${rows}</tbody></table></div></div><div id="participantEditor"></div>`;
 $('#newParticipant').onsubmit=async e=>{e.preventDefault();const code=$('#newCode').value;const {data:p,error}=await sb.from('participants').insert({code}).select().single();if(error)return toast(error.message);const {error:e2}=await sb.from('participant_identity').insert({participant_id:p.id,first_name:$('#newFirst').value.trim(),last_name:$('#newLast').value.trim(),age_years:+$('#newAge').value||null});if(e2)return toast(e2.message);toast('Partecipante creato');await renderParticipants()};
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openParticipantEditor(b.dataset.edit,ids,(anth||[])));
 document.querySelectorAll('[data-toggle-participant]').forEach(b=>b.onclick=async()=>{
   if(profile.role!=='owner')return;
   const wasActive=b.dataset.active==='1',nextActive=!wasActive,pid=b.dataset.toggleParticipant,uid=b.dataset.userId||null;
   if(!confirm(wasActive?'Disattivare questo partecipante? I dati resteranno conservati e il partecipante non potrà accedere.':'Riattivare questo partecipante?'))return;
   const {error}=await sb.from('participants').update({active:nextActive}).eq('id',pid);
   if(error)return toast(error.message);
   if(uid){const pr=await sb.from('profiles').update({active:nextActive}).eq('id',uid);if(pr.error)return toast('Partecipante aggiornato, ma errore sul profilo accesso: '+pr.error.message)}
   toast(nextActive?'Partecipante riattivato':'Partecipante disattivato');await renderParticipants();
 });
 document.querySelectorAll('[data-delete-participant]').forEach(b=>b.onclick=async()=>{
   if(profile.role!=='owner')return;
   const code=b.dataset.code,pid=b.dataset.deleteParticipant,uid=b.dataset.userId||null;
   if(!confirm(`ATTENZIONE: eliminare definitivamente ${code}? Verranno cancellati dal database Tesi anche wellness, allenamenti, test, antropometria e identità collegati. Questa operazione non è reversibile.`))return;
   if(!confirm(`Conferma finale: vuoi davvero cancellare ${code} e tutti i suoi dati di studio?`))return;
   if(uid){const pr=await sb.from('profiles').update({active:false}).eq('id',uid);if(pr.error)return toast(pr.error.message)}
   const {error}=await sb.from('participants').delete().eq('id',pid);
   if(error)return toast(error.message);
   toast(`${code} eliminato definitivamente dall'app Tesi`);await renderParticipants();
 });
}
function phaseAnthBox(pid,phase,row={}){return `<div class="phaseBox"><h3>${phase}</h3><label>Peso kg<input id="w_${phase}" type="number" step="0.1" value="${row.weight_kg??''}"></label><label>Circonferenza addome/vita cm<input id="wa_${phase}" type="number" step="0.1" value="${row.waist_cm??''}"></label><label>Circonferenza fianchi cm<input id="hi_${phase}" type="number" step="0.1" value="${row.hips_cm??''}"></label></div>`}
async function openParticipantEditor(pid,ids,anth){const p=(await sb.from('participants').select('*').eq('id',pid).single()).data;const i=ids[pid]||{};const a=Object.fromEntries(anth.filter(x=>x.participant_id===pid).map(x=>[x.phase,x]));$('#participantEditor').innerHTML=`<div class="card"><div class="sectionTitle"><h2>${esc(p.code)} — Profilo riservato</h2><button class="secondary" id="closeEditor">Chiudi</button></div><div class="grid two"><label>Nome<input id="edFirst" value="${esc(i.first_name||'')}"></label><label>Cognome<input id="edLast" value="${esc(i.last_name||'')}"></label><label>Età<input id="edAge" type="number" value="${i.age_years??''}"></label><label>Altezza cm<input id="edHeight" type="number" step="0.1" value="${i.height_cm??''}"></label><label>Lunghezza gamba cm<input id="edLeg" type="number" step="0.1" value="${i.leg_length_cm??''}"></label><label>Lunghezza gamba 1/2 squat cm<input id="edHalf" type="number" step="0.1" value="${i.half_squat_leg_cm??''}"></label><label>Leva MyJump cm<input id="edLever" type="number" step="0.1" value="${i.lever_cm??''}"></label></div><h3>Antropometria T0-T1-T2</h3><div class="phaseGrid">${phases.map(ph=>phaseAnthBox(pid,ph,a[ph]||{})).join('')}</div><div class="toolbar"><button class="primary" id="saveParticipant">Salva profilo</button>${profile.role==='owner'?`<label>Email invito<input id="inviteEmail" type="email" placeholder="partecipante@email.it"></label><button class="secondary" id="inviteBtn">Invia link accesso</button>`:''}</div></div>`;$('#closeEditor').onclick=()=>$('#participantEditor').innerHTML='';$('#saveParticipant').onclick=async()=>{const payload={participant_id:pid,first_name:$('#edFirst').value.trim(),last_name:$('#edLast').value.trim(),age_years:+$('#edAge').value||null,height_cm:+$('#edHeight').value||null,leg_length_cm:+$('#edLeg').value||null,half_squat_leg_cm:+$('#edHalf').value||null,lever_cm:+$('#edLever').value||null,updated_at:new Date().toISOString()};let {error}=await sb.from('participant_identity').upsert(payload);if(error)return toast(error.message);for(const ph of phases){const r={participant_id:pid,phase:ph,weight_kg:+$(`#w_${ph}`).value||null,waist_cm:+$(`#wa_${ph}`).value||null,hips_cm:+$(`#hi_${ph}`).value||null};const res=await sb.from('anthropometry').upsert(r,{onConflict:'participant_id,phase'});if(res.error)return toast(res.error.message)}toast('Profilo salvato');await renderParticipants()};if($('#inviteBtn'))$('#inviteBtn').onclick=async()=>{
  const email=$('#inviteEmail').value.trim();
  if(!email)return toast('Inserisci email');
  $('#inviteBtn').disabled=true;
  try{
    const {data,error}=await sb.functions.invoke('invite-participant',{body:{participant_id:pid,email,redirect_to:appBaseUrl()}});
    if(error){
      let detail=error.message||'Errore invito';
      try{
        if(error.context && typeof error.context.json==='function'){
          const body=await error.context.clone().json();
          if(body?.error) detail=body.error;
        }
      }catch(_){}
      if(/rate limit/i.test(detail)) detail='Limite temporaneo di invio email raggiunto. Attendi e riprova più tardi.';
      return toast(detail);
    }
    if(!data?.ok)return toast(data?.error||'Errore invito');
    toast('Invito inviato');
  }finally{
    $('#inviteBtn').disabled=false;
  }
};}

async function renderAttendance(){
  const parts=await getParticipants();
  const ids=await identityMap();
  let weekStart=mondayOfWeek();
  const canChoose=isStaff();
  const selectedDefault=profile.role==='participant'?participantProfile.id:(parts[0]?.id||'');

  const draw=async()=>{
    const dates=Array.from({length:6},(_,i)=>addDays(weekStart,i));
    const start=localDateISO(dates[0]),end=localDateISO(dates[5]);
    const {data:rows,error}=await sb.from('attendance').select('*').gte('attendance_date',start).lte('attendance_date',end).order('attendance_date').order('period');
    if(error){view.innerHTML=`<div class="card"><h2>Presenze</h2><p class="msg">${esc(error.message)}</p><p class="muted">Esegui prima UPGRADE_V4_ATTENDANCE.sql sul Supabase Tesi.</p></div>`;return;}
    const grouped={};
    (rows||[]).forEach(r=>{const k=`${r.attendance_date}|${r.period}`;(grouped[k]??=[]).push(r)});
    const selectedPid=profile.role==='participant'?participantProfile.id:($('#attendancePid')?.value||selectedDefault);
    const board=dates.map(d=>{
      const iso=localDateISO(d);
      const cells=['morning','afternoon'].map(period=>{
        const list=grouped[`${iso}|${period}`]||[];
        const mine=list.some(r=>r.participant_id===selectedPid);
        const people=list.map(r=>`<span class="attendancePerson">${esc(r.display_name||'Partecipante')}</span>`).join('')||'<span class="muted">Nessuna presenza</span>';
        return `<div class="attendanceSlot"><div class="attendanceSlotHead"><b>${period==='morning'?'Mattina':'Pomeriggio'}</b><button class="${mine?'danger':'primary'} attendanceToggle" data-date="${iso}" data-period="${period}" data-mine="${mine?'1':'0'}">${mine?'Rimuovi':'Ci sono'}</button></div><div class="attendancePeople">${people}</div></div>`;
      }).join('');
      return `<div class="attendanceDay ${iso===localDateISO()?'today':''}"><div class="attendanceDate"><b>${esc(dayName(d))}</b><span>${fmtDate(iso)}</span></div>${cells}</div>`;
    }).join('');
    const weekTitle=`${fmtDate(start)} – ${fmtDate(end)}`;
    view.innerHTML=`<div class="card"><div class="sectionTitle"><div><h2>Presenze settimanali</h2><p class="muted">Bacheca condivisa da lunedì a sabato. Tutti gli utenti autenticati vedono chi si allena al mattino o al pomeriggio.</p></div><span class="sectionPill">${weekTitle}</span></div><div class="attendanceToolbar"><button class="secondary" id="prevWeek">← Settimana</button><button class="secondary" id="thisWeek">Questa settimana</button><button class="secondary" id="nextWeek">Settimana →</button>${canChoose?`<label>Segna per<select id="attendancePid">${parts.map(p=>`<option value="${p.id}" ${p.id===selectedPid?'selected':''}>${esc(participantLabel(p,ids))}</option>`).join('')}</select></label>`:''}</div></div><div class="attendanceBoard">${board}</div>`;
    $('#prevWeek').onclick=()=>{weekStart=addDays(weekStart,-7);draw()};
    $('#thisWeek').onclick=()=>{weekStart=mondayOfWeek();draw()};
    $('#nextWeek').onclick=()=>{weekStart=addDays(weekStart,7);draw()};
    $('#attendancePid')?.addEventListener('change',draw);
    document.querySelectorAll('.attendanceToggle').forEach(b=>b.onclick=async()=>{
      const participant_id=profile.role==='participant'?participantProfile.id:($('#attendancePid')?.value||selectedDefault);
      if(!participant_id)return toast('Seleziona un partecipante');
      if(b.dataset.mine==='1'){
        const {error}=await sb.from('attendance').delete().eq('participant_id',participant_id).eq('attendance_date',b.dataset.date).eq('period',b.dataset.period);
        if(error)return toast(error.message);
        toast('Presenza rimossa');
      }else{
        const {error}=await sb.from('attendance').insert({participant_id,attendance_date:b.dataset.date,period:b.dataset.period});
        if(error)return toast(error.message);
        toast('Presenza inserita');
      }
      await draw();
    });
  };
  await draw();
}

function wellnessScale(label,id,anchors){return `<label>${label}<select id="${id}">${anchors.map((x,i)=>`<option value="${i+1}">${i+1} — ${x}</option>`).join('')}</select></label>`}
async function renderWellness(){
  const pf=await participantOptions();
  const ids=await identityMap();
  const parts=await getParticipants();
  const partMap=Object.fromEntries(parts.map(p=>[p.id,p]));
  const today=localDateISO();
  view.innerHTML=`<div class="card"><div class="sectionTitle"><div><h2>Wellness / readiness</h2><p class="muted">Una sola compilazione per partecipante per ciascuna data. Puoi recuperare un giorno dimenticato selezionando la data corretta.</p></div><span class="sectionPill">Readiness</span></div><form id="wellForm">${pf}<label>Data di riferimento<input id="wellDate" type="date" value="${today}" max="${today}" required></label>${wellnessScale('Qualità del sonno','sleep',['Pessima','Scarsa','Discreta','Buona','Ottima'])}${wellnessScale('Stanchezza generale','fatigue',['Molto alta','Alta','Media','Bassa','Nessuna'])}${wellnessScale('DOMS','doms',['Molto elevati','Elevati','Moderati','Lievi','Nessuno'])}${wellnessScale('Stress percepito','stress',['Molto alto','Alto','Medio','Basso','Molto basso'])}<label><input type="checkbox" id="painPresent"> Dolore/problema fisico</label><div class="grid two"><label>Sede<input id="painSite"></label><label>Intensità 0-10<input id="painScore" type="number" min="0" max="10"></label></div><div class="toolbar"><button class="primary" id="wellSaveBtn">Salva wellness</button><button type="button" class="secondary hidden" id="wellCancelEdit">Annulla modifica</button></div></form></div><div id="wellList"></div>`;
  let editingWellId=null;
  $('#wellForm').onsubmit=async e=>{
    e.preventDefault();
    const participant_id=$('#participantId').value,wellness_date=$('#wellDate').value;
    if(!wellness_date||wellness_date>today)return toast('La data non può essere futura');
    const payload={participant_id,wellness_date,sleep:+$('#sleep').value,fatigue:+$('#fatigue').value,doms:+$('#doms').value,stress:+$('#stress').value,pain_present:$('#painPresent').checked,pain_site:$('#painSite').value.trim()||null,pain_score:$('#painPresent').checked?(+$('#painScore').value||0):null};
    let error;
    if(editingWellId)({error}=await sb.from('wellness').update(payload).eq('id',editingWellId));
    else ({error}=await sb.from('wellness').insert(payload));
    if(error){if(error.code==='23505'||/duplicate|unique/i.test(error.message||''))return toast('Esiste già un wellness per questa data');return toast(error.message)}
    toast(editingWellId?'Wellness aggiornato':'Wellness salvato');await renderWellness();
  };
  const recentFrom=localDateISO(addDays(new Date(),-2));let q=sb.from('wellness').select('*,participants(code)').gte('wellness_date',recentFrom).order('wellness_date',{ascending:false}).order('recorded_at',{ascending:false});if(profile.role==='participant')q=q.eq('participant_id',participantProfile.id);const {data}=await q;
  $('#wellList').innerHTML=`<div class="card"><div class="sectionTitle"><div><h2>Wellness · ultimi 3 giorni</h2><p class="muted">Vista operativa recente. Lo storico completo resta disponibile nell’Area personale.</p></div><span class="sectionPill">scala 1–5</span></div><div class="wellnessCardGrid">${(data||[]).map(x=>{const p=partMap[x.participant_id]||{id:x.participant_id,code:x.participants?.code||''};return `<article class="wellnessResultCard"><div class="wellnessResultHead"><div><b>${esc(participantLabel(p,ids))}</b><small>${fmtDate(x.wellness_date)||fmt(x.recorded_at)}</small></div><div class="wellnessTotal"><strong>${x.score}</strong><span>/20</span></div></div><div class="wellnessMetricGrid"><div><span>Sonno</span><b>${x.sleep}/5</b></div><div><span>Stanchezza</span><b>${x.fatigue}/5</b></div><div><span>DOMS</span><b>${x.doms}/5</b></div><div><span>Stress</span><b>${x.stress}/5</b></div></div><div class="wellnessFoot"><span>${x.pain_present?`Dolore: ${esc(x.pain_site||'sede non indicata')} · ${x.pain_score??'—'}/10`:'Nessun dolore segnalato'}</span>${profile.role==='owner'?`<div class="rowActions"><button class="secondary miniDelete" data-edit-well="${x.id}">Modifica</button><button class="danger miniDelete" data-del-well="${x.id}">Elimina</button></div>`:''}</div></article>`}).join('')||'<p class="muted">Nessun wellness registrato.</p>'}</div></div>`;
  document.querySelectorAll('[data-edit-well]').forEach(b=>b.onclick=()=>{const row=(data||[]).find(x=>x.id===b.dataset.editWell);if(!row)return;editingWellId=row.id;$('#participantId').value=row.participant_id;$('#wellDate').value=row.wellness_date||today;$('#sleep').value=row.sleep;$('#fatigue').value=row.fatigue;$('#doms').value=row.doms;$('#stress').value=row.stress;$('#painPresent').checked=!!row.pain_present;$('#painSite').value=row.pain_site||'';$('#painScore').value=row.pain_score??'';$('#wellSaveBtn').textContent='Aggiorna wellness';$('#wellCancelEdit').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})});
  $('#wellCancelEdit')?.addEventListener('click',()=>renderWellness());
  document.querySelectorAll('[data-del-well]').forEach(b=>b.onclick=async()=>{if(!confirm('Eliminare questo wellness?'))return;const {error}=await sb.from('wellness').delete().eq('id',b.dataset.delWell);if(error)return toast(error.message);toast('Wellness eliminato');await renderWellness();});
}

async function renderTraining(){
  const pf=await participantOptions();const ids=await identityMap();const parts=await getParticipants();const partMap=Object.fromEntries(parts.map(p=>[p.id,p]));
  const {data:sessions}=await sb.from('session_templates').select('*').order('session_number');
  view.innerHTML=`<div class="card"><div class="sectionTitle"><div><h2>Allenamento</h2><p class="muted">Ogni numero di seduta può essere registrato una sola volta per partecipante. Le sedute già completate non sono più selezionabili.</p></div><span class="sectionPill">sRPE × durata</span></div><form id="logForm">${pf}<label>Data allenamento<input id="trainingDate" type="date" value="${localDateISO()}" max="${localDateISO()}" required></label><label>Seduta<select id="sessionId"></select></label><div id="plannedBox"></div><label>Lavoro realmente svolto<textarea id="actualWork"></textarea></label><div class="grid two"><label>Durata effettiva (min)<input id="duration" type="number" step="1" required></label><label>session-RPE CR10<input id="srpe" type="number" min="0" max="10" step="0.5" required></label></div><label><input id="completed" type="checkbox" checked> Seduta completata</label><label><input id="painPost" type="checkbox"> Dolore/problema durante o dopo</label><div class="grid two"><label>Sede<input id="painPostSite"></label><label>Intensità 0-10<input id="painPostScore" type="number" min="0" max="10"></label></div><label>Note<textarea id="logNotes"></textarea></label><div class="toolbar"><button class="primary" id="logSaveBtn">Salva seduta</button><button type="button" class="secondary hidden" id="logCancelEdit">Annulla modifica</button></div></form></div><div id="logList"></div>`;

  let editingLogId=null;
  const sessionLabel=s=>`${s.session_number}. ${s.session_type}${s.week_number?` — settimana ${s.week_number}`:''}${s.session_number>42?' — aggiuntiva':''}`;
  const updatePlan=()=>{const s=(sessions||[]).find(x=>x.id===$('#sessionId').value);$('#plannedBox').innerHTML=s?`<div class="card sessionCard ${s.session_type==='FORZA'?'forza':''}"><b>Programmato</b><p>${esc(s.planned_work)}</p></div>`:''};
  const refreshAvailableSessions=async(selectedId=null)=>{
    const pid=$('#participantId').value;
    let used=new Set();
    if(pid){const {data:done,error}=await sb.from('session_logs').select('session_template_id').eq('participant_id',pid);if(error)return toast(error.message);used=new Set((done||[]).map(x=>x.session_template_id));}
    const available=(sessions||[]).filter(s=>!used.has(s.id)||s.id===selectedId);
    $('#sessionId').innerHTML=available.length?available.map(s=>`<option value="${s.id}">${sessionLabel(s)}</option>`).join(''):'<option value="">Tutte le sedute disponibili sono già registrate</option>';
    if(selectedId&&available.some(s=>s.id===selectedId))$('#sessionId').value=selectedId;
    $('#logSaveBtn').disabled=!available.length;
    updatePlan();
  };
  $('#sessionId').onchange=updatePlan;
  $('#participantId')?.addEventListener('change',()=>{if(!editingLogId)refreshAvailableSessions()});
  await refreshAvailableSessions();

  $('#logForm').onsubmit=async e=>{
    e.preventDefault();
    const trainingDate=$('#trainingDate').value;if(!trainingDate||trainingDate>localDateISO())return toast('La data non può essere futura');
    if(!$('#sessionId').value)return toast('Non ci sono sedute disponibili da registrare');
    const payload={participant_id:$('#participantId').value,session_template_id:$('#sessionId').value,completed:$('#completed').checked,duration_min:+$('#duration').value,srpe:+$('#srpe').value,actual_work:$('#actualWork').value.trim()||null,pain_post:$('#painPost').checked,pain_site:$('#painPostSite').value.trim()||null,pain_score:$('#painPost').checked?(+$('#painPostScore').value||0):null,notes:$('#logNotes').value.trim()||null,performed_at:dateAtNoonISO(trainingDate)};
    let error;
    if(editingLogId){({error}=await sb.from('session_logs').update(payload).eq('id',editingLogId));}
    else{({error}=await sb.from('session_logs').insert(payload));}
    if(error){
      if(error.code==='23505'||/duplicate|unique/i.test(error.message||''))return toast('Seduta già registrata: scegli il numero corretto. Nessun dato precedente è stato modificato.');
      return toast(error.message);
    }
    toast(editingLogId?'Seduta aggiornata':'Seduta salvata');await renderTraining();
  };

  const recentTrainingFrom=dateAtNoonISO(localDateISO(addDays(new Date(),-2)));let q=sb.from('session_logs').select('*,participants(code),session_templates(session_number,session_type,week_number)').gte('performed_at',recentTrainingFrom).order('performed_at',{ascending:false});if(profile.role==='participant')q=q.eq('participant_id',participantProfile.id);const {data:logs}=await q;
  $('#logList').innerHTML=`<div class="card"><div class="sectionTitle"><div><h2>Allenamenti · ultimi 3 giorni</h2><p class="muted">Vista operativa recente. Lo storico completo e i grafici restano disponibili nell’Area personale.</p></div><span class="sectionPill">AU = min × sRPE</span></div><div class="trainingCardGrid">${(logs||[]).map(x=>{const p=partMap[x.participant_id]||{id:x.participant_id,code:x.participants?.code||''};const au=Math.round(Number(x.session_load||0));return `<article class="trainingResultCard"><div class="trainingResultHead"><div><span class="typeChip">${esc(x.session_templates?.session_type||'SEDUTA')}</span><h3>Seduta ${x.session_templates?.session_number||'—'}</h3><small>${esc(participantLabel(p,ids))} · ${fmtDate((x.performed_at||'').slice(0,10))}</small></div><div class="auHero"><strong>${au}</strong><span>AU</span></div></div><div class="trainingMetricGrid"><div><span>Durata</span><b>${x.duration_min??'—'} min</b></div><div><span>sRPE</span><b>${x.srpe??'—'}/10</b></div><div><span>Completata</span><b>${x.completed?'Sì':'No'}</b></div></div>${x.actual_work?`<p class="trainingWork"><b>Lavoro svolto:</b> ${esc(x.actual_work)}</p>`:''}${x.pain_post?`<p class="trainingPain">Dolore post: ${esc(x.pain_site||'sede non indicata')} · ${x.pain_score??'—'}/10</p>`:''}${x.notes?`<p class="muted">${esc(x.notes)}</p>`:''}${profile.role==='owner'?`<div class="trainingActions rowActions"><button class="secondary miniDelete" data-edit-log="${x.id}">Modifica</button><button class="danger miniDelete" data-del-log="${x.id}">Elimina</button></div>`:''}</article>`}).join('')||'<p class="muted">Nessuna seduta registrata.</p>'}</div></div>`;
  document.querySelectorAll('[data-edit-log]').forEach(b=>b.onclick=async()=>{const row=(logs||[]).find(x=>x.id===b.dataset.editLog);if(!row)return;editingLogId=row.id;$('#participantId').value=row.participant_id;await refreshAvailableSessions(row.session_template_id);$('#trainingDate').value=(row.performed_at||'').slice(0,10)||localDateISO();$('#sessionId').value=row.session_template_id;updatePlan();$('#actualWork').value=row.actual_work||'';$('#duration').value=row.duration_min??'';$('#srpe').value=row.srpe??'';$('#completed').checked=!!row.completed;$('#painPost').checked=!!row.pain_post;$('#painPostSite').value=row.pain_site||'';$('#painPostScore').value=row.pain_score??'';$('#logNotes').value=row.notes||'';$('#logSaveBtn').textContent='Aggiorna registrazione';$('#logSaveBtn').disabled=false;$('#logCancelEdit').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})});
  $('#logCancelEdit')?.addEventListener('click',()=>renderTraining());
  document.querySelectorAll('[data-del-log]').forEach(b=>b.onclick=async()=>{if(!confirm('Eliminare questa registrazione di allenamento?'))return;const {error}=await sb.from('session_logs').delete().eq('id',b.dataset.delLog);if(error)return toast(error.message);toast('Registrazione eliminata');await renderTraining();});
}

async function renderTests(){
 const pf=await participantOptions();const ids=await identityMap();const parts=await getParticipants();const partMap=Object.fromEntries(parts.map(p=>[p.id,p]));const {data:catalog}=await sb.from('test_catalog').select('*').eq('active',true).order('name');
 view.innerHTML=`<div class="card"><div class="sectionTitle"><div><h2>Test T0 · T1 · T2</h2><p class="muted">Inserimento e revisione dei test della batteria.</p></div><span class="sectionPill">Baseline & retest</span></div><form id="testForm">${pf}<div class="grid two"><label>Fase<select id="testPhase">${phases.map(x=>`<option>${x}</option>`).join('')}</select></label><label>Test<select id="testId">${(catalog||[]).map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label></div><div id="attemptFields"></div><div id="testExtras"></div><label>Note<textarea id="testNotes"></textarea></label>${isStaff()?'<div class="toolbar"><button class="primary" id="testSaveBtn">Salva / aggiorna test</button><button type="button" class="secondary hidden" id="testCancelEdit">Annulla modifica</button></div>':'<p class="note">I risultati dei test vengono inseriti dal Titolare/Ricercatore.</p>'}</form></div><div id="testList"></div>`;
 const draw=()=>{const t=catalog.find(x=>x.id===$('#testId').value);if(!t)return;$('#attemptFields').innerHTML=`<div class="grid two">${Array.from({length:t.attempts},(_,i)=>`<label>Prova ${i+1} (${t.unit})<input class="attempt" type="number" step="0.01"></label>`).join('')}</div>`;$('#testExtras').innerHTML=t.code==='6MIN'?`<h3>Dati aggiuntivi test 6'</h3><div class="grid two"><label>FC finale bpm<input id="fcFinal" type="number"></label><label>FC a 1' bpm<input id="fc1" type="number"></label><label>RPE CR10<input id="testRpe" type="number" min="0" max="10"></label><label>Modalità<select id="testMode"><option>Corsa</option><option>Cammino</option><option>Mista</option></select></label></div>`:''};$('#testId').onchange=draw;draw();
 let editingTestId=null;
 if(isStaff())$('#testForm').onsubmit=async e=>{e.preventDefault();const t=catalog.find(x=>x.id===$('#testId').value);const values=[...document.querySelectorAll('.attempt')].map(x=>+x.value).filter(Number.isFinite);if(!values.length)return toast('Inserisci almeno una prova');const mean=values.reduce((s,x)=>s+x,0)/values.length;const best=t.higher_better?Math.max(...values):Math.min(...values);const extra=t.code==='6MIN'?{fc_final:+$('#fcFinal').value||null,fc_1min:+$('#fc1').value||null,rpe:+$('#testRpe').value||null,mode:$('#testMode').value}:{};const payload={participant_id:$('#participantId').value,test_id:t.id,phase:$('#testPhase').value,values,mean_value:mean,best_value:best,extra,notes:$('#testNotes').value.trim()||null,recorded_at:new Date().toISOString()};let error;if(editingTestId){({error}=await sb.from('test_results').update(payload).eq('id',editingTestId));}else{({error}=await sb.from('test_results').upsert(payload,{onConflict:'participant_id,test_id,phase'}));}if(error)return toast(error.message);toast(editingTestId?'Test aggiornato':'Test salvato');await renderTests()};
 let q=sb.from('test_results').select('*,participants(code),test_catalog(code,name,unit,higher_better)').order('recorded_at',{ascending:false});if(profile.role==='participant')q=q.eq('participant_id',participantProfile.id);const {data:r}=await q;
 $('#testList').innerHTML=`<div class="card"><h2>Risultati</h2><div class="tableWrap"><table><thead><tr><th>Partecipante</th><th>Fase</th><th>Test</th><th>Media</th><th>Best</th>${profile.role==='owner'?'<th>Azioni</th>':''}</tr></thead><tbody>${(r||[]).map(x=>{const p=partMap[x.participant_id]||{id:x.participant_id,code:x.participants?.code||participantProfile?.code||''};return `<tr><td><b>${esc(participantLabel(p,ids))}</b></td><td><span class="phaseChip">${x.phase}</span></td><td>${esc(x.test_catalog?.name||'')}</td><td>${x.mean_value!=null?Number(x.mean_value).toFixed(2):'—'} ${x.test_catalog?.unit||''}</td><td><b>${x.best_value!=null?Number(x.best_value).toFixed(2):'—'} ${x.test_catalog?.unit||''}</b></td>${profile.role==='owner'?`<td><div class="rowActions"><button class="secondary miniDelete" data-edit-test="${x.id}">Modifica</button><button class="danger miniDelete" data-del-test="${x.id}">Elimina</button></div></td>`:''}</tr>`}).join('')}</tbody></table></div></div>`;
 document.querySelectorAll('[data-edit-test]').forEach(b=>b.onclick=()=>{const row=(r||[]).find(x=>x.id===b.dataset.editTest);if(!row)return;editingTestId=row.id;$('#participantId').value=row.participant_id;$('#testPhase').value=row.phase;$('#testId').value=row.test_id;draw();const vals=row.values||[];document.querySelectorAll('.attempt').forEach((el,i)=>el.value=vals[i]??'');if(row.test_catalog?.code==='6MIN'){const ex=row.extra||{};$('#fcFinal').value=ex.fc_final??'';$('#fc1').value=ex.fc_1min??'';$('#testRpe').value=ex.rpe??'';$('#testMode').value=ex.mode||'Corsa'}$('#testNotes').value=row.notes||'';$('#testSaveBtn').textContent='Aggiorna test';$('#testCancelEdit').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})});
 $('#testCancelEdit')?.addEventListener('click',()=>renderTests());
 document.querySelectorAll('[data-del-test]').forEach(b=>b.onclick=async()=>{if(!confirm('Eliminare questo risultato test?'))return;const {error}=await sb.from('test_results').delete().eq('id',b.dataset.delTest);if(error)return toast(error.message);toast('Test eliminato');await renderTests();});
}

async function renderHistory(){const pf=await participantOptions('histPid');const ids=await identityMap();const parts=await getParticipants();const pmap=Object.fromEntries(parts.map(p=>[p.id,p]));view.innerHTML=`<div class="card"><h2>Storico individuale</h2><div class="toolbar">${pf}<button class="primary" id="loadHistory">Carica</button></div></div><div id="historyBody"></div>`;const load=async()=>{const pid=$('#histPid').value;const [{data:w},{data:l},{data:t}]=await Promise.all([sb.from('wellness').select('*').eq('participant_id',pid).order('recorded_at',{ascending:false}),sb.from('session_logs').select('*,session_templates(session_number,week_number,session_type,title)').eq('participant_id',pid).order('performed_at',{ascending:false}),sb.from('test_results').select('*,test_catalog(name,unit)').eq('participant_id',pid).order('recorded_at',{ascending:false})]);const events=[];(w||[]).forEach(x=>events.push({d:dateAtNoonISO(x.wellness_date||String(x.recorded_at).slice(0,10)),k:'Wellness',v:`Score ${x.score}/20${x.pain_present?` · dolore ${x.pain_score??'—'}/10`:''}`}));(l||[]).forEach(x=>events.push({d:x.performed_at,k:`Seduta ${x.session_templates?.session_number} ${x.session_templates?.session_type}`,v:`${x.duration_min||'—'} min · RPE ${x.srpe??'—'} · TL ${x.session_load?Math.round(x.session_load):'—'} AU`}));(t||[]).forEach(x=>events.push({d:x.recorded_at,k:`${x.phase} · ${x.test_catalog?.name}`,v:`Best ${x.best_value??'—'} ${x.test_catalog?.unit||''}`}));events.sort((a,b)=>new Date(b.d)-new Date(a.d));const hp=pmap[pid]||participantProfile||{id:pid,code:''};$('#historyBody').innerHTML=`<div class="card"><div class="sectionTitle"><h2>${esc(participantLabel(hp,ids))}</h2></div><div class="tableWrap"><table><thead><tr><th>Data</th><th>Evento</th><th>Dato</th></tr></thead><tbody>${events.map(e=>`<tr><td>${fmt(e.d)}</td><td>${esc(e.k)}</td><td>${esc(e.v)}</td></tr>`).join('')}</tbody></table></div></div>`};$('#loadHistory').onclick=load;await load()}

async function renderReport(){const pf=await participantOptions('reportPid');view.innerHTML=`<div class="card"><h2>Report atleta</h2><div class="toolbar">${pf}<button class="primary" id="genReport">Genera report</button><button class="secondary" id="printReport">Stampa / PDF</button></div></div><div id="reportBody"></div>`;$('#genReport').onclick=generateReport;$('#printReport').onclick=()=>window.print();await generateReport()}
async function generateReport(){const pid=$('#reportPid')?.value||participantProfile.id;const p=(await sb.from('participants').select('*').eq('id',pid).single()).data;let id={};if(isStaff()){id=(await sb.from('participant_identity').select('*').eq('participant_id',pid).maybeSingle()).data||{}}const [{data:a},{data:l},{data:w},{data:r}]=await Promise.all([sb.from('anthropometry').select('*').eq('participant_id',pid),sb.from('session_logs').select('*,session_templates(session_number,session_type)').eq('participant_id',pid),sb.from('wellness').select('*').eq('participant_id',pid),sb.from('test_results').select('*,test_catalog(code,name,unit)').eq('participant_id',pid)]);const prescribedDone=(l||[]).filter(x=>x.completed && Number(x.session_templates?.session_number)<=42).length,extraDone=(l||[]).filter(x=>x.completed && Number(x.session_templates?.session_number)>42).length,load=(l||[]).reduce((s,x)=>s+Number(x.session_load||0),0),wellAvg=(w||[]).length?(w||[]).reduce((s,x)=>s+x.score,0)/(w||[]).length:null;const anth=Object.fromEntries((a||[]).map(x=>[x.phase,x]));const tests={};(r||[]).forEach(x=>{tests[x.test_catalog.code]??={name:x.test_catalog.name,unit:x.test_catalog.unit};tests[x.test_catalog.code][x.phase]=x.best_value});const pct=(x0,x2,higher=true)=>x0!=null&&x2!=null?(((Number(x2)-Number(x0))/Number(x0))*100).toFixed(1)+'%':'—';$('#reportBody').innerHTML=`<div class="card reportHero"><h2>${esc(p.code)}${isStaff()&&id.first_name?' — '+esc(id.first_name+' '+(id.last_name||'')):''}</h2><div class="stats">${stat('Aderenza',prescribedDone+'/42 ('+Math.round(prescribedDone/42*100)+'%)')}${stat('TL cumulativo',Math.round(load)+' AU')}${stat('Wellness medio',wellAvg?wellAvg.toFixed(1)+'/20':'—')}${stat('Sedute extra',extraDone)}</div></div><div class="card"><h2>Antropometria</h2><div class="tableWrap"><table><thead><tr><th>Variabile</th><th>T0</th><th>T1</th><th>T2</th><th>Δ T0-T2</th></tr></thead><tbody><tr><td>Peso kg</td><td>${anth.T0?.weight_kg??'—'}</td><td>${anth.T1?.weight_kg??'—'}</td><td>${anth.T2?.weight_kg??'—'}</td><td>${pct(anth.T0?.weight_kg,anth.T2?.weight_kg)}</td></tr><tr><td>Vita cm</td><td>${anth.T0?.waist_cm??'—'}</td><td>${anth.T1?.waist_cm??'—'}</td><td>${anth.T2?.waist_cm??'—'}</td><td>${pct(anth.T0?.waist_cm,anth.T2?.waist_cm)}</td></tr><tr><td>Fianchi cm</td><td>${anth.T0?.hips_cm??'—'}</td><td>${anth.T1?.hips_cm??'—'}</td><td>${anth.T2?.hips_cm??'—'}</td><td>${pct(anth.T0?.hips_cm,anth.T2?.hips_cm)}</td></tr></tbody></table></div></div><div class="card"><h2>Performance T0-T1-T2</h2><div class="tableWrap"><table><thead><tr><th>Test</th><th>T0</th><th>T1</th><th>T2</th><th>Δ T0-T2</th></tr></thead><tbody>${Object.values(tests).map(t=>`<tr><td>${esc(t.name)}</td><td>${t.T0??'—'} ${t.unit}</td><td>${t.T1??'—'} ${t.unit}</td><td>${t.T2??'—'} ${t.unit}</td><td>${pct(t.T0,t.T2)}</td></tr>`).join('')}</tbody></table></div></div>`}

async function renderSettings(){
  if(!isStaff())return renderHome();
  const {data:sessions}=await sb.from('session_templates').select('*').order('session_number');
  const {data:settings}=await sb.from('app_settings').select('*').eq('id',1).single();
  const maxNo=(sessions||[]).reduce((m,x)=>Math.max(m,Number(x.session_number)||0),0);
  view.innerHTML=`<div class="card"><h2>Amministrazione progetto</h2><p class="muted">Gestisci il protocollo operativo. Le sedute non hanno più una data prestabilita: conta l'ordine cronologico.</p><div class="grid two"><label>Nome studio<input id="studyName" value="${esc(settings?.study_name||'')}"></label></div>${profile.role==='owner'?'<button class="primary" id="saveSettings">Salva impostazioni</button>':'<p class="note">Solo il Titolare può modificare le impostazioni generali.</p>'}</div><div class="card"><h2>Programmazione sedute</h2><p class="muted">Le sedute 1-42 sono quelle del protocollo. Puoi modificarle e aggiungere sedute extra dalla n. ${maxNo+1} in poi.</p><label>Seduta<select id="editSession">${(sessions||[]).map(s=>`<option value="${s.id}">${s.session_number} — ${s.session_type}${s.week_number?` — settimana ${s.week_number}`:''}${s.session_number>42?' — extra':''}</option>`).join('')}</select></label><div class="grid two"><label>Tipo<select id="editType"><option>HIIT</option><option>FORZA</option><option>ALTRO</option></select></label><label>Titolo<input id="editTitle"></label></div><label>Lavoro programmato<textarea id="editPlanned" rows="10"></textarea></label><button class="primary" id="saveSession">Aggiorna seduta</button></div>${profile.role==='owner'?`<div class="card"><h2>Aggiungi seduta</h2><p class="muted">La nuova seduta sarà inserita in coda, senza data prefissata.</p><div class="grid two"><label>Numero<input id="newSessionNo" type="number" value="${maxNo+1}" min="43"></label><label>Tipo<select id="newSessionType"><option>HIIT</option><option>FORZA</option><option>ALTRO</option></select></label></div><label>Titolo<input id="newSessionTitle" value="Seduta ${maxNo+1} - Extra"></label><label>Lavoro programmato<textarea id="newSessionWork" rows="7"></textarea></label><button class="success" id="addSession">Aggiungi seduta</button></div>`:''}`;
  const draw=()=>{const s=sessions.find(x=>x.id===$('#editSession').value);$('#editPlanned').value=s?.planned_work||'';$('#editType').value=s?.session_type||'HIIT';$('#editTitle').value=s?.title||''};
  $('#editSession').onchange=draw;draw();
  $('#saveSession').onclick=async()=>{const {error}=await sb.from('session_templates').update({planned_work:$('#editPlanned').value,session_type:$('#editType').value,title:$('#editTitle').value.trim()||`Seduta`,planned_date:null,updated_at:new Date().toISOString()}).eq('id',$('#editSession').value);if(error)return toast(error.message);toast('Seduta aggiornata');await renderSettings();};
  if($('#saveSettings'))$('#saveSettings').onclick=async()=>{const {error}=await sb.from('app_settings').update({study_name:$('#studyName').value,updated_at:new Date().toISOString()}).eq('id',1);if(error)return toast(error.message);toast('Impostazioni salvate')};
  if($('#addSession'))$('#addSession').onclick=async()=>{const n=+$('#newSessionNo').value;if(!Number.isInteger(n)||n<43)return toast('Numero seduta non valido');const payload={session_number:n,week_number:null,session_slot:null,session_type:$('#newSessionType').value,planned_date:null,title:$('#newSessionTitle').value.trim()||`Seduta ${n} - Extra`,planned_work:$('#newSessionWork').value.trim()||'Seduta aggiuntiva',editable:true,updated_at:new Date().toISOString()};const {error}=await sb.from('session_templates').insert(payload);if(error)return toast(error.message);toast('Seduta aggiunta');await renderSettings();};
}


// PWA: registra il service worker solo su HTTPS o localhost.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker non registrato:', err));
  });
}
