// Sync between devices through Firestore, and the link to «Ритм» (same Firebase project and account).
// Local data stays the source of truth on each device; this module only ships changed documents up
// and applies newer ones coming down (the newest `u` wins). Book files are never sent.
import { firebaseConfig } from '../firebase-config.js';
import { $, html, today, debounce } from './util.js';
import { store, COLLECTIONS } from './store.js';
import { db as idb } from './db.js';
import * as M from './model.js';
import { account } from './screens/settings.js';
import { toast } from './ui.js';

let fb = null, auth = null, fs = null, user = null;
let unsubs = [];
let state = 'out'; // out | sync | ok | offline | error
let habits = null; // habits of «Ритм», loaded when settings are opened
let authError = '';

const ERR = {
  'auth/invalid-credential': 'Неверный адрес или пароль.',
  'auth/wrong-password': 'Неверный адрес или пароль.',
  'auth/user-not-found': 'Такого аккаунта нет.',
  'auth/invalid-email': 'Адрес почты написан с ошибкой.',
  'auth/too-many-requests': 'Слишком много попыток. Попробуй через несколько минут.',
  'auth/network-request-failed': 'Нет связи с сервером. Проверь интернет.',
  'auth/missing-password': 'Введи пароль.',
};

/** Redraw the account block if the settings sheet is open. */
const refresh = () => account.changed();
function setState(s) {
  if (state === s) return;
  state = s;
  refresh();
}

// ---------- pushing and pulling ----------

const push = debounce(async () => {
  if (!user || !store.dirty.size) return;
  if (!navigator.onLine) { setState('offline'); return; }
  setState('sync');
  const keys = [...store.dirty].slice(0, 400);
  const batch = fb.writeBatch(fs), sent = [];
  for (const key of keys) {
    const i = key.indexOf('/'), coll = key.slice(0, i), id = key.slice(i + 1);
    const doc = store.raw(coll, id);
    if (!doc) { store.dirty.delete(key); continue; }
    const { _d, ...clean } = doc;
    batch.set(fb.doc(fs, 'users', user.uid, 'g_' + coll, id), clean);
    sent.push([coll, id, doc.u]);
  }
  try {
    await batch.commit();
    for (const [coll, id, u] of sent) store.markSynced(coll, id, u);
    setState(store.dirty.size ? 'sync' : 'ok');
    if (store.dirty.size) push();
  } catch (err) {
    setState(navigator.onLine ? 'error' : 'offline');
  }
}, 1500);

async function begin() {
  end();
  setState('sync');
  for (const coll of COLLECTIONS) {
    const key = `sync:${user.uid}:${coll}`;
    let cursor = (await idb.kvGet(key)) || 0;
    const q = fb.query(fb.collection(fs, 'users', user.uid, 'g_' + coll), fb.where('u', '>', cursor));
    unsubs.push(fb.onSnapshot(q, snap => {
      let max = cursor;
      snap.docChanges().forEach(change => {
        if (change.type === 'removed') return;
        const doc = change.doc.data();
        store.applyRemote(coll, change.doc.id, doc);
        if (doc.u > max) max = doc.u;
      });
      if (max > cursor) { cursor = max; idb.kvSet(key, max); }
      if (!store.dirty.size) setState('ok');
    }, () => setState(navigator.onLine ? 'error' : 'offline')));
  }
  push();
}

function end() {
  for (const off of unsubs) off();
  unsubs = [];
}

// ---------- link to «Ритм» ----------

async function loadHabits() {
  if (!user) return;
  try {
    const snap = await fb.getDocs(fb.collection(fs, 'users', user.uid, 'items'));
    habits = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.kind === 'habit' && !(x.end && x.end < today()));
    const s = store.settings.ritm;
    if (!s.item && habits.length) {
      const guess = habits.find(h => /чит|книг|страниц/i.test(h.name || ''));
      if (guess) store.setSettings({ ritm: { item: guess.id } });
    }
  } catch (e) { habits = []; }
  refresh();
}

/** When today's reading ring closes, tick the chosen habit in «Ритм» (once a day). */
async function markRitm() {
  const s = store.settings.ritm, t = today();
  if (!user || !s.on || !s.item || !M.dayClosed(t)) return;
  if ((store.meta.get('ritm') || {}).last === t) return;
  store.put('meta', 'ritm', { last: t });
  const goal = (habits && habits.find(h => h.id === s.item) || {}).goal || 1;
  try {
    await fb.setDoc(fb.doc(fs, 'users', user.uid, 'log', t.slice(0, 7)), { d: { [t.slice(8)]: { [s.item]: goal } } }, { merge: true });
    toast('Чтение отмечено в «Ритме»');
  } catch (e) {
    store.put('meta', 'ritm', { last: '' });
  }
}

// ---------- the account block in settings ----------

const STATE_TEXT = { sync: 'отправляю изменения…', ok: 'всё синхронизировано', offline: 'нет связи, отправлю позже', error: 'сервер не отвечает, попробую позже' };

function render() {
  if (!user) {
    return html`<div class="stack" id="accountBox">
<p class="small muted">Войди тем же адресом и паролем, что в «Ритме»: списки, отметки и статистика появятся на всех твоих устройствах.</p>
<label class="field"><span>Почта</span><input class="input" id="aMail" type="email" autocomplete="username" inputmode="email"></label>
<label class="field"><span>Пароль</span><input class="input" id="aPass" type="password" autocomplete="current-password"></label>
${authError ? html`<p class="small" style="color:var(--bad)">${authError}</p>` : ''}
<div class="row"><button class="btn primary" data-act="sign-in">Войти</button><button class="btn quiet" data-act="reset-pass">Забыла пароль</button></div>
</div>`;
  }
  const s = store.settings.ritm;
  return html`<div class="stack" id="accountBox">
<p class="small">${user.email}<br><span class="muted">${STATE_TEXT[state] || ''}${store.dirty.size ? ` (в очереди ${store.dirty.size})` : ''}</span></p>
<div class="row between"><span>Отмечать чтение в «Ритме»</span>
  <div class="seg" style="flex:0 0 auto">${[[true, 'Да'], [false, 'Нет']].map(([k, v]) => html`<button class="${!!s.on === k ? 'on' : ''}" data-act="ritm-on" data-v="${k ? '1' : ''}" style="min-width:56px">${v}</button>`)}</div></div>
${s.on ? (habits === null ? html`<p class="small muted">Загружаю привычки из «Ритма»…</p>`
    : habits.length ? html`<label class="field"><span>Какую привычку отмечать, когда кольцо дня закрыто</span><select class="input" id="ritmItem">${habits.map(h => html`<option value="${h.id}" ${h.id === s.item ? 'selected' : ''}>${h.name}</option>`)}</select></label>`
      : html`<p class="small muted">В «Ритме» пока нет привычек. Добавь там привычку про чтение, и она появится здесь.</p>`) : ''}
<div class="row"><button class="btn quiet" data-act="sign-out">Выйти из аккаунта</button></div>
</div>`;
}

const acts = {
  'sign-in': async () => {
    const mail = $('#aMail').value.trim(), pass = $('#aPass').value;
    authError = '';
    try { await fb.signInWithEmailAndPassword(auth, mail, pass); } catch (err) { authError = ERR[err.code] || 'Не получилось войти.'; refresh(); }
  },
  'reset-pass': async () => {
    const mail = $('#aMail').value.trim();
    if (!mail) { authError = 'Впиши почту, на неё придёт письмо для смены пароля.'; refresh(); return; }
    try { await fb.sendPasswordResetEmail(auth, mail); authError = ''; toast('Письмо для смены пароля отправлено'); } catch (err) { authError = ERR[err.code] || 'Письмо отправить не получилось.'; refresh(); }
  },
  'sign-out': () => fb.signOut(auth),
  'ritm-on': el => { store.setSettings({ ritm: { on: !!el.dataset.v } }); if (el.dataset.v && habits === null) loadHabits(); },
};

export async function start() {
  if (!firebaseConfig) return;
  fb = await import('../vendor/firebase.js');
  const app = fb.initializeApp(firebaseConfig);
  // initializeAuth (not getAuth) keeps the popup sign-in machinery, and its Google script, out of the app.
  auth = fb.initializeAuth(app, { persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence] });
  auth.languageCode = 'ru';
  fs = fb.initializeFirestore(app, { localCache: fb.memoryLocalCache(), ignoreUndefinedProperties: true });
  account.render = render;
  Object.assign(account.acts, acts);
  document.addEventListener('change', e => { if (e.target.id === 'ritmItem') store.setSettings({ ritm: { item: e.target.value } }); });
  fb.onAuthStateChanged(auth, u => {
    user = u;
    authError = '';
    if (u) { begin(); if (store.settings.ritm.on) loadHabits(); } else { end(); setState('out'); habits = null; }
    refresh();
  });
  store.on(origin => { if (origin !== 'remote') { push(); markRitm(); } });
  window.addEventListener('online', () => push());
}
