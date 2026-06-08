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
const promisesKey = 'rations:promises';
const themeKey = 'rations:theme';
const foodMemoryKey = 'rations:food-memory';
const maxFoodMemoryEntries = 80;
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
function memoryKeyForName(name){
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}
function macroSummary(food){
  const parts = [];
  if(Number.isFinite(+food.calories)) parts.push(`${Math.round(+food.calories)} cal`);
  if(Number.isFinite(+food.protein_g)) parts.push(`${Math.round(+food.protein_g)}g protein`);
  if(Number.isFinite(+food.carbs_g)) parts.push(`${Math.round(+food.carbs_g)}g carbs`);
  if(Number.isFinite(+food.fat_g)) parts.push(`${Math.round(+food.fat_g)}g fat`);
  if(Number.isFinite(+food.fiber_g) && +food.fiber_g > 0) parts.push(`${Math.round(+food.fiber_g)}g fiber`);
  return parts.join(', ');
}
function normalizeFoodMemoryEntry(entry){
  const name = String(entry?.name || '').trim().slice(0, 80);
  if(!name) return null;
  const key = entry.key || memoryKeyForName(name);
  const summary = String(entry?.summary || '').trim().slice(0, 240);
  if(!key || !summary) return null;
  return {
    key,
    name,
    summary,
    uses:Math.max(1, Math.round(+entry.uses || 1)),
    updatedAt:entry.updatedAt || new Date().toISOString()
  };
}
function foodMemoryEntries(){
  const stored = localStorage.getItem(foodMemoryKey) || '';
  const parsed = safeJson(stored, null);
  if(Array.isArray(parsed)) return parsed.map(normalizeFoodMemoryEntry).filter(Boolean);
  const legacy = stored.trim();
  return legacy ? [{ key:'legacy-food-memory', name:'Saved food memory', summary:legacy.slice(0, 240), uses:1, updatedAt:new Date(0).toISOString() }] : [];
}
function foodMemory(){
  return foodMemoryEntries()
    .sort((a,b)=>new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .map(entry => `${entry.name}: ${entry.summary}`)
    .join('\n')
    .slice(0, 3000);
}
function saveFoodMemoryEntries(entries, shouldRender=true){
  const clean = entries.map(normalizeFoodMemoryEntry).filter(Boolean)
    .sort((a,b)=>new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, maxFoodMemoryEntries);
  if(clean.length) localStorage.setItem(foodMemoryKey, JSON.stringify(clean));
  else localStorage.removeItem(foodMemoryKey);
  if(shouldRender) renderAll();
}
function foodMemoryCandidates(meal){
  const candidates = [];
  const add = (food) => {
    const name = String(food?.name || food?.meal_name || '').trim();
    const key = memoryKeyForName(name);
    const macros = macroSummary(food);
    if(!key || !macros) return;
    const portion = String(food?.portion || '').trim();
    candidates.push({
      key,
      name,
      summary:`${portion ? `${portion}: ` : ''}${macros}`,
      uses:1,
      updatedAt:new Date().toISOString()
    });
  };
  add(meal);
  (Array.isArray(meal?.items) ? meal.items : []).forEach(add);
  return candidates;
}
function rememberLoggedMeal(meal){
  const candidates = foodMemoryCandidates(meal);
  if(!candidates.length) return;
  const byKey = new Map(foodMemoryEntries().map(entry => [entry.key, entry]));
  candidates.forEach(candidate => {
    const existing = byKey.get(candidate.key);
    byKey.set(candidate.key, {
      ...candidate,
      uses:(existing?.uses || 0) + 1
    });
  });
  saveFoodMemoryEntries([...byKey.values()], false);
}
function promisedDays(){
  const stored = safeJson(localStorage.getItem(promisesKey), []);
  return Array.isArray(stored) ? stored.filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)) : [];
}
function savePromisedDays(days){
  const uniqueDays = [...new Set(days)].sort();
  localStorage.setItem(promisesKey, JSON.stringify(uniqueDays));
  renderAll();
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
  const data = { version:3, updatedAt:new Date().toISOString(), goals:goals(), promises:promisedDays(), foodMemory:foodMemory(), foodMemoryEntries:foodMemoryEntries(), meals:{} };
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
  const remoteFoodMemory = Array.isArray(remoteData?.foodMemoryEntries) ? remoteData.foodMemoryEntries : remoteData?.foodMemory;
  if(remoteFoodMemory && (options.preferRemoteGoals || !foodMemoryEntries().length)){
    if(Array.isArray(remoteFoodMemory)) saveFoodMemoryEntries(remoteFoodMemory);
    else localStorage.setItem(foodMemoryKey, String(remoteFoodMemory || '').trim().slice(0, 3000));
  }
  if(Array.isArray(remoteData?.promises)){
    savePromisedDays([...promisedDays(), ...remoteData.promises]);
    return;
  }
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
  if(!res.ok) throw new Error(await syncErrorText(res));
  const { payload } = await res.json();
  try {
    return await decryptData(phrase, payload);
  } catch {
    throw new Error('That phrase found data, but could not unlock it.');
  }
}
async function writeRemoteSync(phrase, data){
  const id = await syncIdForPhrase(phrase);
  const payload = await encryptData(phrase, data);
  const res = await fetch('/.netlify/functions/sync-data', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ id, payload })
  });
  if(!res.ok) throw new Error(await syncErrorText(res));
}
async function syncErrorText(res){
  try {
    const data = await res.json();
    return data.error || `Sync request failed (${res.status})`;
  } catch {
    return `Sync request failed (${res.status})`;
  }
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
    setSyncStatus(err.message || 'Sync failed. Check the phrase and try again.');
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
    setSyncStatus(err.message || 'Pull failed. Check the phrase and try again.');
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
    const body = JSON.stringify({ imageBase64:state.imageBase64, notes, foodMemory:foodMemory() });
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
  const loggedMeal = {...state.lastResult, id:mealId(), at:new Date().toISOString()};
  list.unshift(loggedMeal);
  rememberLoggedMeal(loggedMeal);
  saveMeals(list.slice(0, 200)); setStatus('Meal logged.'); switchTab('today');
};
$('clearBtn').onclick = () => {
  if(!confirm('Clear today’s meals?')) return;
  const today = todayISO();
  localStorage.setItem(promisesKey, JSON.stringify(promisedDays().filter(day => day !== today)));
  saveMeals([]);
};
$('clearHistoryBtn').onclick = () => {
  if(!confirm('Clear all saved Rations history on this device?')) return;
  Object.keys(localStorage).filter(k=>k.startsWith('rations:') && /^rations:\d{4}-\d{2}-\d{2}$/.test(k)).forEach(k=>localStorage.removeItem(k));
  localStorage.removeItem(promisesKey);
  renderAll();
};

function sumMeals(list){
  return list.reduce((a,m)=>({calories:a.calories+(+m.calories||0),protein:a.protein+(+m.protein_g||0),carbs:a.carbs+(+m.carbs_g||0),fat:a.fat+(+m.fat_g||0)}),{calories:0,protein:0,carbs:0,fat:0});
}
function addDaysISO(day, offset){
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function goalStatus(day=todayISO()){
  const g = goals();
  const sum = sumMeals(meals(day));
  return {
    sum,
    metProtein:sum.protein >= g.protein,
    underCalories:sum.calories <= g.calories,
    complete:sum.protein >= g.protein && sum.calories <= g.calories
  };
}
function isPromisedGoalDay(day){
  return promisedDays().includes(day) && goalStatus(day).complete;
}
function streakCount(){
  let day = isPromisedGoalDay(todayISO()) ? todayISO() : addDaysISO(todayISO(), -1);
  let count = 0;
  while(isPromisedGoalDay(day)){
    count += 1;
    day = addDaysISO(day, -1);
  }
  return count;
}
function renderStreak(){
  const today = todayISO();
  const status = goalStatus(today);
  const promised = promisedDays().includes(today);
  const missingProtein = Math.max(0, goals().protein - status.sum.protein);
  const overCalories = Math.max(0, status.sum.calories - goals().calories);
  $('streakCount').textContent = `${streakCount()} ${streakCount() === 1 ? 'day' : 'days'}`;
  $('promiseBtn').disabled = !status.complete || promised;
  $('promiseBtn').textContent = promised && status.complete ? 'Promised' : 'Promise Today';
  if(promised && status.complete){
    $('streakStatus').textContent = 'Today counts: protein goal hit and calories stayed under.';
  } else if(status.complete){
    $('streakStatus').textContent = 'You hit both goals today. Tap Promise Today to lock it in.';
  } else if(overCalories > 0){
    $('streakStatus').textContent = `${Math.round(overCalories)} calories over today, so the streak cannot count yet.`;
  } else {
    $('streakStatus').textContent = `${Math.round(missingProtein)}g protein left before today can count.`;
  }
}
function renderToday(){
  $('todayDate').textContent = `${new Date().toLocaleDateString([], {timeZone:appTimeZone, weekday:'long', month:'short', day:'numeric'})} CT`;
  const list = meals(); const g = goals(); const sum = sumMeals(list);
  $('totalCalories').textContent = `${Math.round(sum.calories)} / ${g.calories}`;
  $('totalProtein').textContent = `${Math.round(sum.protein)}g / ${g.protein}g`;
  $('totalCarbs').textContent = `${Math.round(sum.carbs)}g / ${g.carbs}g`;
  $('totalFat').textContent = `${Math.round(sum.fat)}g / ${g.fat}g`;
  renderStreak();
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
  renderFoodMemory();
}
$('saveGoals').onclick=()=>{ localStorage.setItem(goalsKey, JSON.stringify({calories:+$('goalCalories').value||2200, protein:+$('goalProtein').value||160, carbs:+$('goalCarbs').value||250, fat:+$('goalFat').value||70})); renderAll(); alert('Goals saved.'); };
function renderFoodMemory(){
  const entries = foodMemoryEntries();
  $('foodMemory').innerHTML = entries.length
    ? entries.slice(0, 12).map(entry => `<div class="memory-row"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.summary)}</small></div>`).join('')
    : '<p class="empty">No learned foods yet. Log meals normally and Rations will remember them.</p>';
  $('foodMemoryStatus').textContent = entries.length ? `${entries.length} learned ${entries.length === 1 ? 'food' : 'foods'} used in future AI estimates.` : '';
  $('clearFoodMemory').disabled = !entries.length;
}
$('clearFoodMemory').onclick=()=>{ if(confirm('Clear learned food memory? Meal history will stay.')) saveFoodMemoryEntries([]); };
$('promiseBtn').onclick=()=>{ if(goalStatus().complete) savePromisedDays([...promisedDays(), todayISO()]); };
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
