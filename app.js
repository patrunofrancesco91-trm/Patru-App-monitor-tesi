const cfg=window.APP_CONFIG||{};
const $=s=>document.querySelector(s);
const authView=$('#authView'),passwordSetupView=$('#passwordSetupView'),appView=$('#appView'),view=$('#view'),tabs=$('#tabs'),headerUser=$('#headerUser');
let currentUser=null,profile=null,participantProfile=null,activeTab='home';
const staffRoles=['owner','researcher'];
const staffTabs=['home','participants','wellness','training','tests','history','report','settings'];
const participantTabs=['home','wellness','training','tests','history','report'];
const labels={home:'Home',participants:'Partecipanti',wellness:'Wellness',training:'Allenamento',tests:'Test',history:'Storico',report:'Report atleta',settings:'Amministrazione'};
const phases=['T0','T1','T2'];
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=d=>d?new Date(d).toLocaleString('it-IT'):'';
const fmtDate=d=>d?new Date(d+'T12:00:00').toLocaleDateString('it-IT'):'';
const stat=(l,v)=>`<div class="stat"><span>${esc(l)}</span><b>${esc(v)}</b></div>`;
const toast=t=>{const x=$('#toast');x.textContent=t;x.classList.remove('hidden');setTimeout(()=>x.classList.add('hidden'),2600)};
const isStaff=()=>staffRoles.includes(profile?.role);


// Primo accesso da invito/reset password.
// Supabase può restituire token nell'hash oppure un code PKCE nella query.
const initialUrl = new URL(window.location.href);
const initialHash = new URLSearchParams(initialUrl.hash.replace(/^#/,''));
const inviteContext = ['invite','recovery'].includes(initialHash.get('type')||initialUrl.searchParams.get('type')||'')
  || initialHash.has('access_token')
  || initialUrl.searchParams.has('code');
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
async function finishFirstAccess(session){
  if(!session?.user) return false;
  showPasswordSetup('Invito verificato. Scegli ora la tua password personale.');
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

// Gli errori globali vengono registrati in console ma NON sovrascrivono il messaggio di login.
window.addEventListener('error',e=>console.error('Global error',e.error||e.message,e.filename,e.lineno,e.colno));
window.addEventListener('unhandledrejection',e=>console.error('Unhandled promise rejection',e.reason));

async function restore(){
  if(!sb)return;
  try{
    const {data,error}=await sb.auth.getSession();
    if(error) throw error;
    if(data?.session?.user){ if(awaitingPasswordSetup) await finishFirstAccess(data.session); else await boot(data.session.user); }
  }catch(e){console.error('Restore session',e)}
}

if(sb){
  sb.auth.onAuthStateChange(async (event,session)=>{
    if((awaitingPasswordSetup || event==='PASSWORD_RECOVERY') && session?.user){
      awaitingPasswordSetup=true;
      await finishFirstAccess(session);
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
    m.textContent='Password impostata.';
    if(data?.user) await boot(data.user);
    else {
      const {data:sess}=await sb.auth.getSession();
      if(sess?.session?.user) await boot(sess.session.user);
      else showAuth('Password impostata. Accedi con email e nuova password.');
    }
  }catch(err){
    m.textContent='Impossibile impostare la password: '+(err?.message||String(err));
  }finally{$('#setPasswordBtn').disabled=false;}
});

setTimeout(restore,0);
function renderTabs(){const arr=isStaff()?staffTabs:participantTabs;tabs.innerHTML=arr.map(t=>`<button class="tabBtn ${activeTab===t?'active':''}" data-tab="${t}">${labels[t]}</button>`).join('');tabs.querySelectorAll('button').forEach(b=>b.onclick=async()=>{activeTab=b.dataset.tab;renderTabs();await render()})}
async function render(){const fn={home:renderHome,participants:renderParticipants,wellness:renderWellness,training:renderTraining,tests:renderTests,history:renderHistory,report:renderReport,settings:renderSettings}[activeTab];await fn()}
async function getParticipants(){if(profile.role==='participant')return [participantProfile];const {data}=await sb.from('participants').select('*').eq('active',true).order('code');return data||[]}
async function participantOptions(id='participantId',selected=''){const pp=await getParticipants();if(profile.role==='participant')return `<input type="hidden" id="${id}" value="${participantProfile.id}"><p><b>Partecipante:</b> ${esc(participantProfile.code)}</p>`;return `<label>Partecipante<select id="${id}">${pp.map(p=>`<option value="${p.id}" ${selected===p.id?'selected':''}>${esc(p.code)}</option>`).join('')}</select></label>`}
async function identityMap(){if(!isStaff())return{};const {data}=await sb.from('participant_identity').select('*');return Object.fromEntries((data||[]).map(x=>[x.participant_id,x]))}

async function renderHome(){
 const pid=profile.role==='participant'?participantProfile.id:null;
 let qlogs=sb.from('session_logs').select('*,session_templates(session_number,week_number,session_type,title)').order('performed_at',{ascending:false});
 let qw=sb.from('wellness').select('*').order('recorded_at',{ascending:false});
 let qt=sb.from('test_results').select('*,test_catalog(code,name,unit,higher_better)').order('recorded_at',{ascending:false});
 if(pid){qlogs=qlogs.eq('participant_id',pid);qw=qw.eq('participant_id',pid);qt=qt.eq('participant_id',pid)}
 const [{data:logs},{data:wells},{data:tests},{data:parts}]=await Promise.all([qlogs,qw,qt,sb.from('participants').select('*').eq('active',true)]);
 const load=(logs||[]).reduce((s,x)=>s+Number(x.session_load||0),0);
 const completed=(logs||[]).filter(x=>x.completed).length;
 const latestW=(wells||[])[0];
 if(profile.role==='participant'){
   view.innerHTML=`<div class="card hero"><h2>${esc(participantProfile.code)}</h2><div class="stats">${stat('Sedute completate',completed+'/42')}${stat('Aderenza',Math.round(completed/42*100)+'%')}${stat('Training Load',Math.round(load)+' AU')}${stat('Test registrati',(tests||[]).length)}</div></div>
   <div class="card"><h2>Stato ultimo wellness</h2>${latestW?`<div class="stats">${stat('Score',latestW.score+'/20')}${stat('Dolore',latestW.pain_present?(latestW.pain_score??'—')+'/10':'No')}${stat('Data',fmt(latestW.recorded_at))}</div>`:'<p class="muted">Nessun wellness ancora registrato.</p>'}</div>
   <div class="actionGrid"><button class="actionBtn" data-go="wellness">Compila wellness</button><button class="actionBtn" data-go="training">Seduta / sRPE</button><button class="actionBtn" data-go="tests">I miei test</button><button class="actionBtn" data-go="report">Il mio report</button></div>`;
 } else {
   view.innerHTML=`<div class="grid two"><div class="card"><h2>Dashboard Tesi</h2><div class="stats">${stat('Partecipanti',(parts||[]).length)}${stat('Sedute registrate',(logs||[]).length)}${stat('TL gruppo',Math.round(load)+' AU')}${stat('Test',(tests||[]).length)}</div></div><div class="card"><h2>Disegno</h2><p><b>14 settimane · 42 sedute</b></p><p>HIIT — FORZA — HIIT</p><p>Valutazioni: <b>T0 · T1 · T2</b></p></div></div>
   <div class="card"><h2>Monitoraggio</h2><p class="muted">Wellness pre-seduta, session-RPE post-seduta, durata, dolore, aderenza e carico interno.</p></div>`;
 }
 document.querySelectorAll('[data-go]').forEach(b=>b.onclick=async()=>{activeTab=b.dataset.go;renderTabs();await render()});
}

async function renderParticipants(){
 if(!isStaff())return renderHome();
 const {data:pp}=await sb.from('participants').select('*').order('code');
 const ids=await identityMap();
 const {data:anth}=await sb.from('anthropometry').select('*');
 const rows=(pp||[]).map(p=>{const i=ids[p.id]||{};const a=(anth||[]).filter(x=>x.participant_id===p.id);return `<tr><td><span class="codeBadge">${esc(p.code)}</span></td><td>${esc([i.first_name,i.last_name].filter(Boolean).join(' ')||'—')}</td><td>${i.age_years??'—'}</td><td>${a.find(x=>x.phase==='T0')?.weight_kg??'—'}</td><td>${a.find(x=>x.phase==='T1')?.weight_kg??'—'}</td><td>${a.find(x=>x.phase==='T2')?.weight_kg??'—'}</td><td><button class="secondary" data-edit="${p.id}">Apri</button></td></tr>`}).join('');
 view.innerHTML=`<div class="card"><div class="sectionTitle"><div><h2>Partecipanti</h2><p class="privacyNote">Nome, cognome e misure MyJump sono nella sezione riservata, visibile solo a Titolare/Ricercatore.</p></div></div>
 <form id="newParticipant" class="grid two"><label>Codice<select id="newCode">${Array.from({length:30},(_,i)=>`<option>P${String(i+1).padStart(2,'0')}</option>`).join('')}</select></label><label>Nome<input id="newFirst"></label><label>Cognome<input id="newLast"></label><label>Età<input id="newAge" type="number" min="18" max="100"></label><div><button class="primary">Crea partecipante</button></div></form></div>
 <div class="card"><div class="tableWrap"><table><thead><tr><th>Codice</th><th>Identità riservata</th><th>Età</th><th>Peso T0</th><th>Peso T1</th><th>Peso T2</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div><div id="participantEditor"></div>`;
 $('#newParticipant').onsubmit=async e=>{e.preventDefault();const code=$('#newCode').value;const {data:p,error}=await sb.from('participants').insert({code}).select().single();if(error)return toast(error.message);const {error:e2}=await sb.from('participant_identity').insert({participant_id:p.id,first_name:$('#newFirst').value.trim(),last_name:$('#newLast').value.trim(),age_years:+$('#newAge').value||null});if(e2)return toast(e2.message);toast('Partecipante creato');await renderParticipants()};
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openParticipantEditor(b.dataset.edit,ids,(anth||[])));
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

function wellnessScale(label,id,anchors){return `<label>${label}<select id="${id}">${anchors.map((x,i)=>`<option value="${i+1}">${i+1} — ${x}</option>`).join('')}</select></label>`}
async function renderWellness(){const pf=await participantOptions();view.innerHTML=`<div class="card"><h2>Wellness / readiness</h2><p class="muted">Da compilare al mattino o prima della seduta.</p><form id="wellForm">${pf}${wellnessScale('Qualità del sonno','sleep',['Pessima','Scarsa','Discreta','Buona','Ottima'])}${wellnessScale('Stanchezza generale','fatigue',['Molto alta','Alta','Media','Bassa','Nessuna'])}${wellnessScale('DOMS','doms',['Molto elevati','Elevati','Moderati','Lievi','Nessuno'])}${wellnessScale('Stress percepito','stress',['Molto alto','Alto','Medio','Basso','Molto basso'])}<label><input type="checkbox" id="painPresent"> Dolore/problema fisico oggi</label><div class="grid two"><label>Sede<input id="painSite"></label><label>Intensità 0-10<input id="painScore" type="number" min="0" max="10"></label></div><button class="primary">Salva wellness</button></form></div><div id="wellList"></div>`;$('#wellForm').onsubmit=async e=>{e.preventDefault();const payload={participant_id:$('#participantId').value,sleep:+$('#sleep').value,fatigue:+$('#fatigue').value,doms:+$('#doms').value,stress:+$('#stress').value,pain_present:$('#painPresent').checked,pain_site:$('#painSite').value.trim()||null,pain_score:$('#painPresent').checked?(+$('#painScore').value||0):null};const {error}=await sb.from('wellness').insert(payload);if(error)return toast(error.message);toast('Wellness salvato');await renderWellness()};let q=sb.from('wellness').select('*,participants(code)').order('recorded_at',{ascending:false}).limit(20);if(profile.role==='participant')q=q.eq('participant_id',participantProfile.id);const {data}=await q;$('#wellList').innerHTML=`<div class="card"><h2>Ultimi wellness</h2><div class="tableWrap"><table><thead><tr><th>Data</th><th>Codice</th><th>Score</th><th>Dolore</th></tr></thead><tbody>${(data||[]).map(x=>`<tr><td>${fmt(x.recorded_at)}</td><td>${x.participants?.code||''}</td><td>${x.score}/20</td><td>${x.pain_present?`${esc(x.pain_site||'')} ${x.pain_score??'—'}/10`:'No'}</td></tr>`).join('')}</tbody></table></div></div>`}

async function renderTraining(){const pf=await participantOptions();const {data:sessions}=await sb.from('session_templates').select('*').order('session_number');view.innerHTML=`<div class="card"><h2>Allenamento</h2><p class="muted">Le 42 sedute sono già programmate. Puoi registrare ciò che è stato realmente svolto.</p><form id="logForm">${pf}<label>Seduta<select id="sessionId">${(sessions||[]).map(s=>`<option value="${s.id}">${s.session_number}. ${s.session_type} — settimana ${s.week_number} — ${fmtDate(s.planned_date)}</option>`).join('')}</select></label><div id="plannedBox"></div><label>Lavoro realmente svolto<textarea id="actualWork"></textarea></label><div class="grid two"><label>Durata effettiva (min)<input id="duration" type="number" step="1" required></label><label>session-RPE CR10<input id="srpe" type="number" min="0" max="10" step="0.5" required></label></div><label><input id="completed" type="checkbox" checked> Seduta completata</label><label><input id="painPost" type="checkbox"> Dolore/problema durante o dopo</label><div class="grid two"><label>Sede<input id="painPostSite"></label><label>Intensità 0-10<input id="painPostScore" type="number" min="0" max="10"></label></div><label>Note<textarea id="logNotes"></textarea></label><button class="primary">Salva / aggiorna seduta</button></form></div><div id="logList"></div>`;const updatePlan=()=>{const s=sessions.find(x=>x.id===$('#sessionId').value);$('#plannedBox').innerHTML=s?`<div class="card sessionCard ${s.session_type==='FORZA'?'forza':''}"><b>Programmato</b><p>${esc(s.planned_work)}</p></div>`:''};$('#sessionId').onchange=updatePlan;updatePlan();$('#logForm').onsubmit=async e=>{e.preventDefault();const payload={participant_id:$('#participantId').value,session_template_id:$('#sessionId').value,completed:$('#completed').checked,duration_min:+$('#duration').value,srpe:+$('#srpe').value,actual_work:$('#actualWork').value.trim()||null,pain_post:$('#painPost').checked,pain_site:$('#painPostSite').value.trim()||null,pain_score:$('#painPost').checked?(+$('#painPostScore').value||0):null,notes:$('#logNotes').value.trim()||null,performed_at:new Date().toISOString()};const {error}=await sb.from('session_logs').upsert(payload,{onConflict:'participant_id,session_template_id'});if(error)return toast(error.message);toast('Seduta salvata');await renderTraining()};let q=sb.from('session_logs').select('*,participants(code),session_templates(session_number,session_type,week_number)').order('performed_at',{ascending:false}).limit(30);if(profile.role==='participant')q=q.eq('participant_id',participantProfile.id);const {data:logs}=await q;$('#logList').innerHTML=`<div class="card"><h2>Ultime sedute</h2><div class="tableWrap"><table><thead><tr><th>Codice</th><th>Seduta</th><th>Tipo</th><th>Durata</th><th>sRPE</th><th>TL</th></tr></thead><tbody>${(logs||[]).map(x=>`<tr><td>${x.participants?.code||''}</td><td>${x.session_templates?.session_number||''}</td><td>${x.session_templates?.session_type||''}</td><td>${x.duration_min??'—'}'</td><td>${x.srpe??'—'}</td><td>${x.session_load?Math.round(x.session_load)+' AU':'—'}</td></tr>`).join('')}</tbody></table></div></div>`}

async function renderTests(){const pf=await participantOptions();const {data:catalog}=await sb.from('test_catalog').select('*').eq('active',true).order('name');view.innerHTML=`<div class="card"><h2>Test T0 · T1 · T2</h2><form id="testForm">${pf}<div class="grid two"><label>Fase<select id="testPhase">${phases.map(x=>`<option>${x}</option>`).join('')}</select></label><label>Test<select id="testId">${(catalog||[]).map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label></div><div id="attemptFields"></div><div id="testExtras"></div><label>Note<textarea id="testNotes"></textarea></label>${isStaff()?'<button class="primary">Salva / aggiorna test</button>':'<p class="note">I risultati dei test vengono inseriti dal Titolare/Ricercatore.</p>'}</form></div><div id="testList"></div>`;const draw=()=>{const t=catalog.find(x=>x.id===$('#testId').value);if(!t)return;$('#attemptFields').innerHTML=`<div class="grid two">${Array.from({length:t.attempts},(_,i)=>`<label>Prova ${i+1} (${t.unit})<input class="attempt" type="number" step="0.01"></label>`).join('')}</div>`;$('#testExtras').innerHTML=t.code==='6MIN'?`<h3>Dati aggiuntivi test 6'</h3><div class="grid two"><label>FC finale bpm<input id="fcFinal" type="number"></label><label>FC a 1' bpm<input id="fc1" type="number"></label><label>RPE CR10<input id="testRpe" type="number" min="0" max="10"></label><label>Modalità<select id="testMode"><option>Corsa</option><option>Cammino</option><option>Mista</option></select></label></div>`:''};$('#testId').onchange=draw;draw();if(isStaff())$('#testForm').onsubmit=async e=>{e.preventDefault();const t=catalog.find(x=>x.id===$('#testId').value);const values=[...document.querySelectorAll('.attempt')].map(x=>+x.value).filter(Number.isFinite);if(!values.length)return toast('Inserisci almeno una prova');const mean=values.reduce((s,x)=>s+x,0)/values.length;const best=t.higher_better?Math.max(...values):Math.min(...values);const extra=t.code==='6MIN'?{fc_final:+$('#fcFinal').value||null,fc_1min:+$('#fc1').value||null,rpe:+$('#testRpe').value||null,mode:$('#testMode').value}:{};const payload={participant_id:$('#participantId').value,test_id:t.id,phase:$('#testPhase').value,values,mean_value:mean,best_value:best,extra,notes:$('#testNotes').value.trim()||null,recorded_at:new Date().toISOString()};const {error}=await sb.from('test_results').upsert(payload,{onConflict:'participant_id,test_id,phase'});if(error)return toast(error.message);toast('Test salvato');await renderTests()};let q=sb.from('test_results').select('*,participants(code),test_catalog(code,name,unit,higher_better)').order('recorded_at',{ascending:false});if(profile.role==='participant')q=q.eq('participant_id',participantProfile.id);const {data:r}=await q;$('#testList').innerHTML=`<div class="card"><h2>Risultati</h2><div class="tableWrap"><table><thead><tr><th>Codice</th><th>Fase</th><th>Test</th><th>Media</th><th>Best</th></tr></thead><tbody>${(r||[]).map(x=>`<tr><td>${x.participants?.code||participantProfile?.code||''}</td><td>${x.phase}</td><td>${esc(x.test_catalog?.name||'')}</td><td>${x.mean_value!=null?Number(x.mean_value).toFixed(2):'—'} ${x.test_catalog?.unit||''}</td><td>${x.best_value!=null?Number(x.best_value).toFixed(2):'—'} ${x.test_catalog?.unit||''}</td></tr>`).join('')}</tbody></table></div></div>`}

async function renderHistory(){const pf=await participantOptions('histPid');view.innerHTML=`<div class="card"><h2>Storico individuale</h2><div class="toolbar">${pf}<button class="primary" id="loadHistory">Carica</button></div></div><div id="historyBody"></div>`;const load=async()=>{const pid=$('#histPid').value;const [{data:w},{data:l},{data:t}]=await Promise.all([sb.from('wellness').select('*').eq('participant_id',pid).order('recorded_at',{ascending:false}),sb.from('session_logs').select('*,session_templates(session_number,week_number,session_type,title)').eq('participant_id',pid).order('performed_at',{ascending:false}),sb.from('test_results').select('*,test_catalog(name,unit)').eq('participant_id',pid).order('recorded_at',{ascending:false})]);const events=[];(w||[]).forEach(x=>events.push({d:x.recorded_at,k:'Wellness',v:`Score ${x.score}/20${x.pain_present?` · dolore ${x.pain_score??'—'}/10`:''}`}));(l||[]).forEach(x=>events.push({d:x.performed_at,k:`Seduta ${x.session_templates?.session_number} ${x.session_templates?.session_type}`,v:`${x.duration_min||'—'} min · RPE ${x.srpe??'—'} · TL ${x.session_load?Math.round(x.session_load):'—'} AU`}));(t||[]).forEach(x=>events.push({d:x.recorded_at,k:`${x.phase} · ${x.test_catalog?.name}`,v:`Best ${x.best_value??'—'} ${x.test_catalog?.unit||''}`}));events.sort((a,b)=>new Date(b.d)-new Date(a.d));$('#historyBody').innerHTML=`<div class="card"><div class="tableWrap"><table><thead><tr><th>Data</th><th>Evento</th><th>Dato</th></tr></thead><tbody>${events.map(e=>`<tr><td>${fmt(e.d)}</td><td>${esc(e.k)}</td><td>${esc(e.v)}</td></tr>`).join('')}</tbody></table></div></div>`};$('#loadHistory').onclick=load;await load()}

async function renderReport(){const pf=await participantOptions('reportPid');view.innerHTML=`<div class="card"><h2>Report atleta</h2><div class="toolbar">${pf}<button class="primary" id="genReport">Genera report</button><button class="secondary" id="printReport">Stampa / PDF</button></div></div><div id="reportBody"></div>`;$('#genReport').onclick=generateReport;$('#printReport').onclick=()=>window.print();await generateReport()}
async function generateReport(){const pid=$('#reportPid')?.value||participantProfile.id;const p=(await sb.from('participants').select('*').eq('id',pid).single()).data;let id={};if(isStaff()){id=(await sb.from('participant_identity').select('*').eq('participant_id',pid).maybeSingle()).data||{}}const [{data:a},{data:l},{data:w},{data:r}]=await Promise.all([sb.from('anthropometry').select('*').eq('participant_id',pid),sb.from('session_logs').select('*,session_templates(session_number,session_type)').eq('participant_id',pid),sb.from('wellness').select('*').eq('participant_id',pid),sb.from('test_results').select('*,test_catalog(code,name,unit)').eq('participant_id',pid)]);const done=(l||[]).filter(x=>x.completed).length,load=(l||[]).reduce((s,x)=>s+Number(x.session_load||0),0),wellAvg=(w||[]).length?(w||[]).reduce((s,x)=>s+x.score,0)/(w||[]).length:null;const anth=Object.fromEntries((a||[]).map(x=>[x.phase,x]));const tests={};(r||[]).forEach(x=>{tests[x.test_catalog.code]??={name:x.test_catalog.name,unit:x.test_catalog.unit};tests[x.test_catalog.code][x.phase]=x.best_value});const pct=(x0,x2,higher=true)=>x0!=null&&x2!=null?(((Number(x2)-Number(x0))/Number(x0))*100).toFixed(1)+'%':'—';$('#reportBody').innerHTML=`<div class="card reportHero"><h2>${esc(p.code)}${isStaff()&&id.first_name?' — '+esc(id.first_name+' '+(id.last_name||'')):''}</h2><div class="stats">${stat('Aderenza',done+'/42 ('+Math.round(done/42*100)+'%)')}${stat('TL cumulativo',Math.round(load)+' AU')}${stat('Wellness medio',wellAvg?wellAvg.toFixed(1)+'/20':'—')}${stat('Sedute mancanti',42-done)}</div></div><div class="card"><h2>Antropometria</h2><div class="tableWrap"><table><thead><tr><th>Variabile</th><th>T0</th><th>T1</th><th>T2</th><th>Δ T0-T2</th></tr></thead><tbody><tr><td>Peso kg</td><td>${anth.T0?.weight_kg??'—'}</td><td>${anth.T1?.weight_kg??'—'}</td><td>${anth.T2?.weight_kg??'—'}</td><td>${pct(anth.T0?.weight_kg,anth.T2?.weight_kg)}</td></tr><tr><td>Vita cm</td><td>${anth.T0?.waist_cm??'—'}</td><td>${anth.T1?.waist_cm??'—'}</td><td>${anth.T2?.waist_cm??'—'}</td><td>${pct(anth.T0?.waist_cm,anth.T2?.waist_cm)}</td></tr><tr><td>Fianchi cm</td><td>${anth.T0?.hips_cm??'—'}</td><td>${anth.T1?.hips_cm??'—'}</td><td>${anth.T2?.hips_cm??'—'}</td><td>${pct(anth.T0?.hips_cm,anth.T2?.hips_cm)}</td></tr></tbody></table></div></div><div class="card"><h2>Performance T0-T1-T2</h2><div class="tableWrap"><table><thead><tr><th>Test</th><th>T0</th><th>T1</th><th>T2</th><th>Δ T0-T2</th></tr></thead><tbody>${Object.values(tests).map(t=>`<tr><td>${esc(t.name)}</td><td>${t.T0??'—'} ${t.unit}</td><td>${t.T1??'—'} ${t.unit}</td><td>${t.T2??'—'} ${t.unit}</td><td>${pct(t.T0,t.T2)}</td></tr>`).join('')}</tbody></table></div></div>`}

async function renderSettings(){if(!isStaff())return renderHome();const {data:sessions}=await sb.from('session_templates').select('*').order('session_number');const {data:settings}=await sb.from('app_settings').select('*').eq('id',1).single();view.innerHTML=`<div class="card"><h2>Amministrazione progetto</h2><p class="muted">Le modifiche effettuate qui cambiano il protocollo operativo nell'app, senza modificare il codice.</p><div class="grid two"><label>Nome studio<input id="studyName" value="${esc(settings?.study_name||'')}"></label><label>Data inizio<input id="studyStart" type="date" value="${settings?.study_start||''}"></label><label>Data fine<input id="studyEnd" type="date" value="${settings?.study_end||''}"></label></div>${profile.role==='owner'?'<button class="primary" id="saveSettings">Salva impostazioni</button>':'<p class="note">Solo il Titolare può modificare le impostazioni generali.</p>'}</div><div class="card"><h2>Programmazione 42 sedute</h2><p class="muted">Puoi modificare il lavoro programmato di ogni seduta. Il registro conserva separatamente ciò che viene realmente eseguito.</p><label>Seduta<select id="editSession">${(sessions||[]).map(s=>`<option value="${s.id}">${s.session_number} — ${s.session_type} — settimana ${s.week_number}</option>`).join('')}</select></label><label>Lavoro programmato<textarea id="editPlanned" rows="10"></textarea></label><button class="primary" id="saveSession">Aggiorna seduta</button></div>`;const draw=()=>{const s=sessions.find(x=>x.id===$('#editSession').value);$('#editPlanned').value=s?.planned_work||''};$('#editSession').onchange=draw;draw();$('#saveSession').onclick=async()=>{const {error}=await sb.from('session_templates').update({planned_work:$('#editPlanned').value,updated_at:new Date().toISOString()}).eq('id',$('#editSession').value);if(error)return toast(error.message);toast('Seduta aggiornata')};if($('#saveSettings'))$('#saveSettings').onclick=async()=>{const {error}=await sb.from('app_settings').update({study_name:$('#studyName').value,study_start:$('#studyStart').value,study_end:$('#studyEnd').value,updated_at:new Date().toISOString()}).eq('id',1);if(error)return toast(error.message);toast('Impostazioni salvate')};}


// PWA: registra il service worker solo su HTTPS o localhost.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker non registrato:', err));
  });
}
