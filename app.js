const $ = (id) => document.getElementById(id);
const state = { imageBase64: null, lastResult: null };
const todayISO = () => new Date().toISOString().slice(0,10);
const dayKey = (iso=todayISO()) => `rations:${iso}`;
const goalsKey = 'rations:goals';
const themeKey = 'rations:theme';

const demo = {
  meal_name:'Chicken rice bowl', calories:720, protein_g:48, carbs_g:82, fat_g:22, fiber_g:6,
  confidence:'medium', coach_note:'Solid meal. Watch hidden oils and sauces if you are cutting.',
  items:[{name:'grilled chicken',portion:'about 6 oz',calories:280,protein_g:45,carbs_g:0,fat_g:8,fiber_g:0},{name:'white rice',portion:'about 1.5 cups',calories:310,protein_g:6,carbs_g:68,fat_g:1,fiber_g:1},{name:'sauce/oil/veg',portion:'visible serving',calories:130,protein_g:2,carbs_g:14,fat_g:13,fiber_g:5}]
};

function readFile(file){
  return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); });
}
function meals(iso=todayISO()){ return JSON.parse(localStorage.getItem(dayKey(iso)) || '[]'); }
function saveMeals(list, iso=todayISO()){ localStorage.setItem(dayKey(iso), JSON.stringify(list)); renderAll(); }
function goals(){ return JSON.parse(localStorage.getItem(goalsKey) || '{"calories":2200,"protein":160,"carbs":250,"fat":70}'); }
function setStatus(msg){ $('status').textContent = msg || ''; }
const loadingLines = [
  'Checking portions, hidden oils, and macros.',
  'Estimating protein, carbs, fats, and fiber.',
  'Looking for sauces, rice, oils, and sneaky extras.',
  'Building your meal scorecard.'
];
let loadingTimer = null;
function setLoading(on){
  const overlay = $('loadingOverlay');
  if(!overlay) return;
  if(on){
    let i = 0;
    $('loadingLine').textContent = loadingLines[0];
    overlay.hidden = false;
    loadingTimer = setInterval(()=>{
      i = (i + 1) % loadingLines.length;
      $('loadingLine').textContent = loadingLines[i];
    }, 1550);
  } else {
    overlay.hidden = true;
    if(loadingTimer) clearInterval(loadingTimer);
    loadingTimer = null;
  }
}
function escapeHtml(s){ return String(s).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c])); }

function setTheme(theme){
  document.body.classList.toggle('dark', theme === 'dark');
  $('themeBtn').textContent = theme === 'dark' ? 'Cream' : 'Dark';
  localStorage.setItem(themeKey, theme);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#12100d' : '#f4ead8');
}
setTheme(localStorage.getItem(themeKey) || 'cream');
$('themeBtn').onclick = () => setTheme(document.body.classList.contains('dark') ? 'cream' : 'dark');

function switchTab(name){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active-screen'));
  $(`${name}Tab`).classList.add('active-screen');
  if(name === 'history') renderHistory();
  if(name === 'goals') fillGoals();
}
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>switchTab(btn.dataset.tab));

$('pickBtn').onclick = () => $('photoInput').click();
$('photoInput').onchange = async (e) => {
  const file = e.target.files?.[0]; if(!file) return;
  state.imageBase64 = await readFile(file);
  $('preview').src = state.imageBase64; $('preview').hidden = false; $('analyzeBtn').disabled = false; setStatus('Photo ready. Add notes if useful, then estimate.');
};

$('analyzeBtn').onclick = async () => {
  if(!state.imageBase64) return;
  setStatus('Estimating...'); $('analyzeBtn').disabled = true; setLoading(true);
  try {
    const res = await fetch('/.netlify/functions/analyze-meal', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({imageBase64:state.imageBase64, notes:$('notes').value.trim()}) });
    if(!res.ok) throw new Error(await res.text());
    showResult(await res.json()); setStatus('Estimate complete.');
  } catch (err) {
    console.warn(err); showResult(demo); setStatus('Using demo estimate. Add API key / run Netlify function for live AI.');
  } finally { $('analyzeBtn').disabled = false; setLoading(false); }
};

function showResult(data){
  state.lastResult = data;
  $('result').hidden = false;
  $('mealName').textContent = data.meal_name || 'Estimated meal';
  $('calories').textContent = Math.round(data.calories || 0);
  $('protein').textContent = `${Math.round(data.protein_g || 0)}g`;
  $('carbs').textContent = `${Math.round(data.carbs_g || 0)}g`;
  $('fat').textContent = `${Math.round(data.fat_g || 0)}g`;
  $('fiber').textContent = `${Math.round(data.fiber_g || 0)}g`;
  $('confidence').textContent = `Confidence: ${data.confidence || 'unknown'}`;
  $('coachNote').textContent = data.coach_note || data.notes || '';
  $('items').innerHTML = (data.items || []).map(i => `<div class="item"><div><strong>${escapeHtml(i.name||'Item')}</strong><small>${escapeHtml(i.portion||'estimated portion')}</small></div><div><strong>${Math.round(i.calories||0)}</strong><small>cal</small></div></div>`).join('');
  $('result').scrollIntoView({behavior:'smooth',block:'start'});
}

$('logBtn').onclick = () => {
  if(!state.lastResult) return;
  const list = meals();
  list.unshift({...state.lastResult, at:new Date().toISOString()});
  saveMeals(list); setStatus('Meal logged.'); switchTab('today');
};
$('clearBtn').onclick = () => { if(confirm('Clear today’s meals?')) saveMeals([]); };
$('clearHistoryBtn').onclick = () => {
  if(!confirm('Clear all saved Rations history on this device?')) return;
  Object.keys(localStorage).filter(k=>k.startsWith('rations:') && /^rations:\d{4}-\d{2}-\d{2}$/.test(k)).forEach(k=>localStorage.removeItem(k));
  renderAll();
};

function sumMeals(list){
  return list.reduce((a,m)=>({calories:a.calories+(+m.calories||0),protein:a.protein+(+m.protein_g||0),carbs:a.carbs+(+m.carbs_g||0),fat:a.fat+(+m.fat_g||0)}),{calories:0,protein:0,carbs:0,fat:0});
}
function renderToday(){
  $('todayDate').textContent = new Date().toLocaleDateString([], {weekday:'long', month:'short', day:'numeric'});
  const list = meals(); const g = goals(); const sum = sumMeals(list);
  $('totalCalories').textContent = `${Math.round(sum.calories)} / ${g.calories}`;
  $('totalProtein').textContent = `${Math.round(sum.protein)}g / ${g.protein}g`;
  $('totalCarbs').textContent = `${Math.round(sum.carbs)}g / ${g.carbs}g`;
  $('totalFat').textContent = `${Math.round(sum.fat)}g / ${g.fat}g`;
  $('log').innerHTML = list.length ? list.map(mealRow).join('') : '<p class="empty">No meals logged today.</p>';
}
function mealRow(m){
  return `<div class="item"><div><strong>${escapeHtml(m.meal_name||'Meal')}</strong><small>${new Date(m.at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} · P ${Math.round(m.protein_g||0)}g · C ${Math.round(m.carbs_g||0)}g · F ${Math.round(m.fat_g||0)}g</small></div><div><strong>${Math.round(m.calories||0)}</strong><small>cal</small></div></div>`;
}
function historyDays(){
  return Object.keys(localStorage).filter(k=>/^rations:\d{4}-\d{2}-\d{2}$/.test(k)).map(k=>k.replace('rations:','')).sort().reverse();
}
function renderHistory(){
  const days = historyDays();
  if(!days.length){ $('history').innerHTML = '<p class="empty">No history yet. Log a meal first.</p>'; return; }
  $('history').innerHTML = days.map(day=>{
    const list = meals(day); const sum = sumMeals(list);
    const title = new Date(day + 'T12:00:00').toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'});
    return `<div class="day-group"><p class="day-title">${title} <span class="day-total">${Math.round(sum.calories)} cal</span></p>${list.map(mealRow).join('')}</div>`;
  }).join('');
}
function fillGoals(){
  const g=goals(); $('goalCalories').value=g.calories; $('goalProtein').value=g.protein; $('goalCarbs').value=g.carbs; $('goalFat').value=g.fat;
}
$('saveGoals').onclick=()=>{ localStorage.setItem(goalsKey, JSON.stringify({calories:+$('goalCalories').value||2200, protein:+$('goalProtein').value||160, carbs:+$('goalCarbs').value||250, fat:+$('goalFat').value||70})); renderAll(); alert('Goals saved.'); };
function renderAll(){ renderToday(); renderHistory(); fillGoals(); }

if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
renderAll();
