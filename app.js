const $ = (id) => document.getElementById(id);
const state = { imageBase64: null, lastResult: null };
const appTimeZone = 'America/Chicago';
const todayISO = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: appTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const dayKey = (iso=todayISO()) => `rations:${iso}`;
const goalsKey = 'rations:goals';
const themeKey = 'rations:theme';
const defaultGoals = { calories:2200, protein:160, carbs:250, fat:70 };
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const demo = {
  meal_name:'Chicken rice bowl', calories:720, protein_g:48, carbs_g:82, fat_g:22, fiber_g:6,
  confidence:'medium', coach_note:'Solid meal. Watch hidden oils and sauces if you are cutting.',
  items:[{name:'grilled chicken',portion:'about 6 oz',calories:280,protein_g:45,carbs_g:0,fat_g:8,fiber_g:0},{name:'white rice',portion:'about 1.5 cups',calories:310,protein_g:6,carbs_g:68,fat_g:1,fiber_g:1},{name:'sauce/oil/veg',portion:'visible serving',calories:130,protein_g:2,carbs_g:14,fat_g:13,fiber_g:5}]
};

function safeJson(value, fallback){
  try {
    const parsed = JSON.parse(value || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
function readImage(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ img, originalBytes:file.size || 0 });
      img.onerror = reject;
      img.src = r.result;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
async function compressImage(file){
  const { img, originalBytes } = await readImage(file);
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const imageBase64 = canvas.toDataURL('image/jpeg', 0.72);
  const compressedBytes = Math.round((imageBase64.length - 'data:image/jpeg;base64,'.length) * 0.75);
  return { imageBase64, originalBytes, compressedBytes };
}
function kb(bytes){ return Math.max(1, Math.round(bytes / 1024)); }
function currentNotes(){ return $('notes').value.trim(); }
function updateAnalyzeState(){
  $('analyzeBtn').disabled = !(state.imageBase64 || currentNotes());
}
function meals(iso=todayISO()){
  const list = safeJson(localStorage.getItem(dayKey(iso)), []);
  return Array.isArray(list) ? list : [];
}
function saveMeals(list, iso=todayISO()){ localStorage.setItem(dayKey(iso), JSON.stringify(list)); renderAll(); }
function goals(){
  const stored = safeJson(localStorage.getItem(goalsKey), defaultGoals);
  return { ...defaultGoals, ...stored };
}
function setStatus(msg){ $('status').textContent = msg || ''; }
function setSyncStatus(msg){ $('syncStatus').textContent = msg || ''; }
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
function macroText(item){
  return `P ${Math.round(item.protein_g || 0)}g · C ${Math.round(item.carbs_g || 0)}g · F ${Math.round(item.fat_g || 0)}g · Fiber ${Math.round(item.fiber_g || 0)}g`;
}
function mealId(){
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function normalizeMeal(meal, day, index=0){
  const at = meal.at || new Date().toISOString();
  const fallbackId = `legacy:${day}:${at}:${meal.meal_name || 'Meal'}:${Math.round(meal.calories || 0)}:${index}`;
  return { ...meal, id:meal.id || fallbackId, at };
}
function mergeMeals(localList, remoteList, day){
  const byId = new Map();
  [...localList, ...remoteList].forEach((meal, index) => {
    const normalized = normalizeMeal(meal, day, index);
    byId.set(normalized.id, { ...(byId.get(normalized.id) || {}), ...normalized });
  });
  return [...byId.values()]
    .sort((a,b)=>new Date(b.at || 0) - new Date(a.at || 0))
    .slice(0, 200);
}
function exportRationsData(){
  const data = { version:1, updatedAt:new Date().toISOString(), goals:goals(), meals:{} };
  historyDays().forEach(day => {
    data.meals[day] = meals(day).map((meal, index) => normalizeMeal(meal, day, index));
  });
  return data;
}
function importRationsData(remoteData, options={}){
  const remoteMeals = remoteData?.meals || {};
  const days = new Set([...historyDays(), ...Object.keys(remoteMeals)]);
  days.forEach(day => {
    const merged = mergeMeals(meals(day), Array.isArray(remoteMeals[day]) ? remoteMeals[day] : [], day);
    if(merged.length) localStorage.setItem(dayKey(day), JSON.stringify(merged));
  });
  const useRemoteGoals = options.preferRemoteGoals || !localStorage.getItem(goalsKey);
  if(remoteData?.goals && useRemoteGoals) localStorage.setItem(goalsKey, JSON.stringify({ ...defaultGoals, ...remoteData.goals }));
  renderAll();
}
function bytesToBase64(bytes){
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
function base64ToBytes(value){
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
function randomBase64(length){
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}
async function shaHex(text){
  const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(text));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function syncIdForPhrase(phrase){
  return shaHex(`rations-sync:${phrase}`);
}
async function keyForPhrase(phrase, saltBase64){
  const keyMaterial = await crypto.subtle.importKey('raw', textEncoder.encode(phrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt:base64ToBytes(saltBase64), iterations:150000, hash:'SHA-256' },
    keyMaterial,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt', 'decrypt']
  );
}
async function encryptData(phrase, data){
  const salt = randomBase64(16);
  const iv = randomBase64(12);
  const key = await keyForPhrase(phrase, salt);
  const encrypted = await crypto.subtle.encrypt({ name:'AES-GCM', iv:base64ToBytes(iv) }, key, textEncoder.encode(JSON.stringify(data)));
  return { version:1, updatedAt:new Date().toISOString(), salt, iv, data:bytesToBase64(new Uint8Array(encrypted)) };
}
async function decryptData(phrase, payload){
  const key = await keyForPhrase(phrase, payload.salt);
  const decrypted = await crypto.subtle.decrypt({ name:'AES-GCM', iv:base64ToBytes(payload.iv) }, key, base64ToBytes(payload.data));
  return JSON.parse(textDecoder.decode(decrypted));
}
async function readRemoteSync(phrase){
  const id = await syncIdForPhrase(phrase);
  const res = await fetch(`/.netlify/functions/sync-data?id=${encodeURIComponent(id)}`);
  if(res.status === 404) return null;
  if(!res.ok) throw new Error(await res.text());
  const { payload } = await res.json();
  return decryptData(phrase, payload);
}
async function writeRemoteSync(phrase, data){
  const id = await syncIdForPhrase(phrase);
  const payload = await encryptData(phrase, data);
  const res = await fetch('/.netlify/functions/sync-data', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ id, payload })
  });
  if(!res.ok) throw new Error(await res.text());
}
function syncPhrase(){
  return $('syncPhrase').value.trim();
}
function setSyncButtons(disabled){
  $('syncNowBtn').disabled = disabled;
  $('pullSyncBtn').disabled = disabled;
}
async function syncNow(){
  const phrase = syncPhrase();
  if(phrase.length < 12){ setSyncStatus('Use at least 12 characters for your sync phrase.'); return; }
  setSyncButtons(true); setSyncStatus('Syncing encrypted data...');
  try {
    const remote = await readRemoteSync(phrase);
    if(remote) importRationsData(remote);
    await writeRemoteSync(phrase, exportRationsData());
    setSyncStatus('Synced. Use this same phrase on your other device.');
  } catch (err) {
    console.warn(err);
    setSyncStatus('Sync failed. Check the phrase and try again.');
  } finally {
    setSyncButtons(false);
  }
}
async function pullSync(){
  const phrase = syncPhrase();
  if(phrase.length < 12){ setSyncStatus('Use at least 12 characters for your sync phrase.'); return; }
  setSyncButtons(true); setSyncStatus('Pulling encrypted data...');
  try {
    const remote = await readRemoteSync(phrase);
    if(!remote){ setSyncStatus('No cloud data found for that phrase yet.'); return; }
    importRationsData(remote, { preferRemoteGoals:true });
    setSyncStatus('Pulled latest data onto this device.');
  } catch (err) {
    console.warn(err);
    setSyncStatus('Pull failed. Check the phrase and try again.');
  } finally {
    setSyncButtons(false);
  }
}

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
  setStatus('Preparing photo...');
  try {
    const prepared = await compressImage(file);
    state.imageBase64 = prepared.imageBase64;
    $('preview').src = state.imageBase64;
    $('preview').hidden = false;
    updateAnalyzeState();
    const saved = prepared.originalBytes ? ` Shrunk from ${kb(prepared.originalBytes)} KB to ${kb(prepared.compressedBytes)} KB.` : '';
    setStatus(`Photo ready.${saved}`);
  } catch (err) {
    console.warn(err);
    state.imageBase64 = null;
    updateAnalyzeState();
    setStatus('Could not read that photo. Try another one or describe the meal.');
  }
};
$('notes').addEventListener('input', updateAnalyzeState);

$('analyzeBtn').onclick = async () => {
  const notes = currentNotes();
  if(!state.imageBase64 && !notes) return;
  setStatus(state.imageBase64 ? 'Uploading smaller photo...' : 'Estimating from description...');
  $('analyzeBtn').disabled = true; setLoading(true);
  try {
    const body = JSON.stringify({ imageBase64:state.imageBase64, notes });
    const res = await fetch('/.netlify/functions/analyze-meal', { method:'POST', headers:{'Content-Type':'application/json'}, body });
    if(!res.ok) throw new Error(await res.text());
    showResult(await res.json()); setStatus('Estimate complete.');
  } catch (err) {
    console.warn(err); showResult(demo); setStatus('Using demo estimate. Add API key / run Netlify function for live AI.');
  } finally { updateAnalyzeState(); setLoading(false); }
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
  $('items').innerHTML = (data.items || []).map(i => `<div class="item"><div><strong>${escapeHtml(i.name||'Item')}</strong><small>${escapeHtml(i.portion||'estimated portion')}</small><small>${macroText(i)}</small></div><div><strong>${Math.round(i.calories||0)}</strong><small>cal</small></div></div>`).join('');
  $('result').scrollIntoView({behavior:'smooth',block:'start'});
}

$('logBtn').onclick = () => {
  if(!state.lastResult) return;
  const list = meals();
  list.unshift({...state.lastResult, id:mealId(), at:new Date().toISOString()});
  saveMeals(list.slice(0, 200)); setStatus('Meal logged.'); switchTab('today');
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
  $('todayDate').textContent = `${new Date().toLocaleDateString([], {timeZone:appTimeZone, weekday:'long', month:'short', day:'numeric'})} CT`;
  const list = meals(); const g = goals(); const sum = sumMeals(list);
  $('totalCalories').textContent = `${Math.round(sum.calories)} / ${g.calories}`;
  $('totalProtein').textContent = `${Math.round(sum.protein)}g / ${g.protein}g`;
  $('totalCarbs').textContent = `${Math.round(sum.carbs)}g / ${g.carbs}g`;
  $('totalFat').textContent = `${Math.round(sum.fat)}g / ${g.fat}g`;
  $('log').innerHTML = list.length ? list.map(mealRow).join('') : '<p class="empty">No meals logged today.</p>';
}
function mealRow(m){
  return `<div class="item"><div><strong>${escapeHtml(m.meal_name||'Meal')}</strong><small>${new Date(m.at).toLocaleTimeString([], {timeZone:appTimeZone, hour:'numeric',minute:'2-digit'})} CT · P ${Math.round(m.protein_g||0)}g · C ${Math.round(m.carbs_g||0)}g · F ${Math.round(m.fat_g||0)}g</small></div><div><strong>${Math.round(m.calories||0)}</strong><small>cal</small></div></div>`;
}
function historyDays(){
  return Object.keys(localStorage).filter(k=>/^rations:\d{4}-\d{2}-\d{2}$/.test(k)).map(k=>k.replace('rations:','')).sort().reverse();
}
function renderHistory(){
  const days = historyDays();
  if(!days.length){ $('history').innerHTML = '<p class="empty">No history yet. Log a meal first.</p>'; return; }
  $('history').innerHTML = days.map(day=>{
    const list = meals(day); const sum = sumMeals(list);
    const title = new Date(day + 'T12:00:00-06:00').toLocaleDateString([], {timeZone:appTimeZone, weekday:'short', month:'short', day:'numeric'});
    return `<div class="day-group"><p class="day-title">${title} <span class="day-total">${Math.round(sum.calories)} cal</span></p>${list.map(mealRow).join('')}</div>`;
  }).join('');
}
function fillGoals(){
  const g=goals(); $('goalCalories').value=g.calories; $('goalProtein').value=g.protein; $('goalCarbs').value=g.carbs; $('goalFat').value=g.fat;
}
$('saveGoals').onclick=()=>{ localStorage.setItem(goalsKey, JSON.stringify({calories:+$('goalCalories').value||2200, protein:+$('goalProtein').value||160, carbs:+$('goalCarbs').value||250, fat:+$('goalFat').value||70})); renderAll(); alert('Goals saved.'); };
$('syncNowBtn').onclick = syncNow;
$('pullSyncBtn').onclick = pullSync;
function renderAll(){ renderToday(); renderHistory(); fillGoals(); }


if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('/sw.js').then((registration) => {
    // Check for a new service worker shortly after load, then periodically.
    registration.update();
    setInterval(() => registration.update(), 60 * 60 * 1000);
  }).catch(() => {});
}
renderAll();
