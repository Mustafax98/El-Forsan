/* =====================================================================
   admin-app.js — إدارة تطبيق المشتركين + الصلاحيات + الإشعارات (جيم الفرسان)
   حطه آخر سكريبت في index.html (بعد treasury.js):
     <script src="/admin-app.js"></script>

   بيضيف:
   - الإعدادات ← تاب جديد "تطبيق المشتركين": الطلبات المعلقة / الحضور والغياب والنشاط /
     التمارين والتغذية (بترحيل تلقائي) / حسابات التطبيق (تفعيل + كلمة سر)
   - الإعدادات ← "اداره الصلاحيات": موظفين + مصفوفة (مخفي / عرض / عرض وتعديل) + تسجيل دخول
   - الإعدادات ← "العروض والخصومات": إرسال إشعار (تطبيق + واتساب)
   - الإعدادات ← "قنوات التواصل": إعدادات الإشعارات التلقائية + طابور رسائل الواتساب
   Collections جديدة: orders, notifications, whatsapp_outbox, staff, settings/app
   حقول جديدة جوه subscribers: appEnabled, appPinHash, workout, diet, lastLogin
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Number(n || 0).toLocaleString('en-US') + ' ج.م';
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => fmt(new Date());
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
  const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
  const dmy = s => isDate(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
  const when = sec => sec ? new Date(sec * 1000).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const toast = (msg, ok = true) => {
    const t = document.createElement('div');
    t.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[500] px-5 py-3 rounded-xl text-sm font-bold shadow-2xl ${ok ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'}`;
    t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
  };
  const IN = 'w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white text-xs placeholder-neutral-600 focus:outline-none focus:border-indigo-500 transition';
  const BTN = (txt, fn, cls = 'bg-emerald-500 hover:bg-emerald-400 text-black') => `<button type="button" onclick="${fn}" class="${cls} font-bold text-xs px-4 py-2 rounded-xl transition">${txt}</button>`;
  const CARD = 'bg-neutral-950 border border-neutral-800 rounded-xl p-4';
  const db = () => window.db;
  const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');
  const gymName = () => ($('previewTitleDisplay')?.textContent || document.title || 'الجيم').trim();

  const DEF = { autoProduct: true, autoPlan: true, autoMember: true, waMember: true, waBroadcast: false, cc: '20' };
  let cfg = { ...DEF };
  let offers = [], cats = [];
  let me = null, locked = true;
  let members = [], staff = [], products = [], plans = [], orders = [], attAll = [], notifs = [], outbox = [];
  let checkins = [], codeQ = '';
  let appSec = 'orders', ordF = 'pending', attQ = '', accQ = '', obF = 'queued', ed = null;

  const getStatus = m => {
    if (m.frozen && m.frozen.active) return 'frozen';
    if (!isDate(m.endDate)) return 'none';
    const d = diffDays(m.endDate, today());
    return d < 0 ? 'expired' : d <= 7 ? 'soon' : 'active';
  };
  const isLive = m => ['active', 'soon'].includes(getStatus(m));
  const waPhone = p => {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = cfg.cc + d.slice(1);
    else if (!d.startsWith(cfg.cc)) d = cfg.cc + d;
    return d;
  };

  /* ---------- modal helper ---------- */
  function modal(html, wide = 'max-w-2xl') {
    closeModal();
    const w = document.createElement('div');
    w.id = 'aaModal';
    w.className = 'fixed inset-0 z-[260] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3';
    w.innerHTML = `<div class="bg-neutral-900 border border-neutral-800 rounded-2xl w-full ${wide} max-h-[92vh] overflow-y-auto shadow-2xl text-white">${html}</div>`;
    w.addEventListener('mousedown', e => { if (e.target === w) closeModal(); });
    document.body.appendChild(w);
  }
  function closeModal() { $('aaModal')?.remove(); renderApp(); }

  /* =====================================================================
     إشعارات: notifyOnce (مرة واحدة حتى لو أكتر من لوحة تحكم مفتوحة) + طابور واتساب
     ===================================================================== */
  function waTargets(aud) {
    if (aud === 'all' || aud === 'active') return members.filter(m => m.phone && isLive(m));
    const m = members.find(x => x.id === aud); return m && m.phone ? [m] : [];
  }
  async function queueWa(nid, text, targets) {
    await Promise.all(targets.map(m => window.addDoc(window.collection(db(), 'whatsapp_outbox'), {
      notificationId: nid || '', memberId: m.id || '', name: m.name || '', phone: m.phone, text, status: 'queued', createdAt: window.serverTimestamp()
    })));
  }
  async function notifyOnce(key, n) {
    key = key.replace(/[^\w\u0600-\u06FF-]/g, '_');
    try {
      const ref = window.doc(db(), 'notifications', key);
      const created = await window.runTransaction(db(), async tx => {
        if ((await tx.get(ref)).exists()) return false;
        tx.set(ref, { ...n, key, createdAt: window.serverTimestamp() }); return true;
      });
      if (created) {
        const wa = n.audience === 'all' ? cfg.waBroadcast : cfg.waMember;
        if (wa) await queueWa(key, `${n.title}\n${n.body}\n— ${gymName()}`, waTargets(n.audience));
      }
      return created;
    } catch (e) { console.error(e); return false; }
  }

  /* =====================================================================
     boot
     ===================================================================== */
  const waitDb = cb => (window.db && window.onSnapshot) ? cb() : setTimeout(() => waitDb(cb), 100);

  document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = '[data-ro="1"] button:not([data-keep]),[data-ro="1"] input:not([id*="earch"]),[data-ro="1"] select,[data-ro="1"] textarea{pointer-events:none;opacity:.5}';
    document.head.appendChild(st);
    lock(true);
    injectTabs();
    renderAll();
    waitDb(listen);
  });

  function lock(on) {
    locked = on;
    let o = $('aaLock');
    if (!on) return o && o.remove();
    if (!o) {
      o = document.createElement('div'); o.id = 'aaLock';
      o.className = 'fixed inset-0 z-[400] bg-black flex items-center justify-center text-neutral-400 text-sm';
      o.textContent = 'جاري التحميل...'; document.body.appendChild(o);
    }
  }

  function injectTabs() {
    const nav = $('sub-4-tab-10')?.parentElement;
    if (nav && !$('sub-4-tab-11')) {
      const b = document.createElement('button');
      b.id = 'sub-4-tab-11';
      b.className = 'sub-tab-4-btn relative z-10 py-2 px-4 rounded-xl font-medium text-xs sm:text-sm whitespace-nowrap transition-colors duration-300 text-neutral-400 hover:text-white';
      b.innerHTML = 'تطبيق المشتركين <span id="ordBadge" class="hidden mr-1 bg-rose-500 text-white text-[10px] rounded-full px-1.5">0</span>';
      b.onclick = () => window.switchSubTab(4, 11);
      nav.appendChild(b);
    }
    const host = $('content-main-4');
    if (host && !$('sub-4-content-11')) {
      const d = document.createElement('div'); d.id = 'sub-4-content-11'; d.className = 'sub-content-4 hidden'; host.appendChild(d);
    }
    // لو تاب 5 مفيهوش محتوى نهيّئه (محتوى الأقسام بيترسم من renderOffers)
    const orig = window.switchSubTab;
    window.switchSubTab = function (t, n) {
      try { if (orig) orig.apply(this, arguments); } catch (e) { console.warn('switchSubTab:', e); }
      if (t !== 4) return;
      const mine = $('sub-4-content-11'), b = $('sub-4-tab-11'), pill = $('sub-4-slider-pill');
      if (n === 11) {
        document.querySelectorAll('#content-main-4 [id^="sub-4-content-"]').forEach(x => x.classList.add('hidden'));
        mine.classList.remove('hidden');
        document.querySelectorAll('.sub-tab-4-btn').forEach(x => { x.classList.remove('text-black', 'bg-white'); x.classList.add('text-neutral-400'); });
        b.classList.add('bg-white', 'text-black'); b.classList.remove('text-neutral-400');
        if (pill) pill.style.opacity = '0';
        renderApp();
      } else {
        mine.classList.add('hidden'); b.classList.remove('bg-white', 'text-black'); b.classList.add('text-neutral-400');
        if (pill) pill.style.opacity = '';
      }
    };
  }

  /* ---------- listeners ---------- */
  function listen() {
    const S = (ref, cb) => window.onSnapshot(ref, cb, e => {
      console.error(e);
      const o = $('aaLock'); if (o) o.textContent = 'تعذر الاتصال بقاعدة البيانات: ' + (e.code || e.message);
    });
    const C = n => window.collection(db(), n);

    S(window.doc(db(), 'settings', 'app'), s => { cfg = { ...DEF, ...(s.exists() ? s.data() : {}) }; renderNotify(); });
    S(C('staff'), s => { staff = s.docs.map(d => ({ id: d.id, ...d.data() })); renderPerm(); gate(); });

    const prev = new Map(); let firstM = true;
    S(C('subscribers'), s => {
      members = s.docs.map(d => ({ ...d.data(), id: d.id }));
      s.docChanges().forEach(ch => {
        const x = ch.doc.data(), id = ch.doc.id, inv = x.invites || [], off = x.offers || [], p = prev.get(id);
        if (!firstM && p && ch.type === 'modified' && cfg.autoMember) {
          for (let i = p.inv.length; i < inv.length; i++) {
            const v = inv[i];
            notifyOnce(`invnew_${id}_${i}_${v.name}`, { audience: id, type: 'invite', title: 'دعوة جديدة لصديقك 🎟️', body: `تم إضافة دعوة لـ ${v.name}، تقدر تجيبه يحضر معاك في الجيم.` })
              .then(ok => { if (ok && v.phone && cfg.waMember) queueWa('', `أهلاً ${v.name}! ${x.name} عزمك تحضر معاه في ${gymName()} 💪 الدعوة ليك، تعالى وقت ما يناسبك.`, [{ phone: v.phone, name: v.name }]); });
          }
          inv.forEach((v, i) => {
            if (v.used && p.inv[i] === false) notifyOnce(`invused_${id}_${i}_${v.name}`, { audience: id, type: 'invite', title: 'تم استهلاك دعوة ✔', body: `صديقك ${v.name} حضر واتستهلكت الدعوة.` });
          });
          if (off.length > p.off) {
            const o = off[off.length - 1];
            notifyOnce(`offer_${id}_${off.length}`, { audience: id, type: 'offer', title: 'عرض خاص ليك 🎁', body: `${o.title} — ${o.value}${o.type === 'percent' ? '%' : ' ج.م'} حتى ${dmy(o.expires)}` });
          }
        }
        prev.set(id, { inv: inv.map(v => !!v.used), off: off.length });
      });
      firstM = false; renderAll();
    });

    let firstP = true;
    S(C('products'), s => {
      products = s.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!firstP && cfg.autoProduct) s.docChanges().forEach(ch => {
        if (ch.type !== 'added') return; const x = ch.doc.data();
        notifyOnce('prod_' + ch.doc.id, { audience: 'all', type: 'product', title: 'منتج جديد في المتجر 🛒', body: `${x.name} متاح الآن بسعر ${Number(x.sellPrice ?? x.price ?? 0)} ج.م` });
      });
      firstP = false;
    });
    let firstL = true;
    S(C('plans'), s => {
      plans = s.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!firstL && cfg.autoPlan) s.docChanges().forEach(ch => {
        if (ch.type !== 'added') return; const x = ch.doc.data();
        notifyOnce('plan_' + ch.doc.id, { audience: 'all', type: 'plan', title: 'عرض اشتراك جديد 🔥', body: `${x.name || x.planName} — ${x.duration || x.days} يوم بسعر ${Number(x.price || 0)} ج.م` });
      });
      firstL = false;
    });

    S(C('orders'), s => {
      orders = s.docs.map(d => ({ id: d.id, ...d.data(), ts: d.data().createdAt?.seconds || Math.floor(Date.now() / 1000) }));
      renderAll();
    });
    S(window.query(C('attendance'), window.where('date', '>=', addDays(today(), -30))), s => {
      attAll = s.docs.map(d => ({ id: d.id, memberId: d.data().memberId, date: d.data().date, ts: d.data().createdAt?.seconds || 0 }));
      renderApp();
    });
    S(window.query(C('checkins'), window.where('date', '==', today())), s => {
      checkins = s.docs.map(d => ({ id: d.id, ...d.data(), ts: d.data().createdAt?.seconds || Math.floor(Date.now() / 1000) }));
      renderApp();
    });
    S(C('offers'), s => { offers = s.docs.map(d => ({ id: d.id, ...d.data() })); renderOffers(true); });
    S(C('categories'), s => { cats = s.docs.map(d => ({ id: d.id, name: d.data().name })); renderOffers(); });
    S(C('notifications'), s => { notifs = s.docs.map(d => ({ id: d.id, ...d.data(), ts: d.data().createdAt?.seconds || 0 })).sort((a, b) => b.ts - a.ts); renderOffers(); });
    S(C('whatsapp_outbox'), s => { outbox = s.docs.map(d => ({ id: d.id, ...d.data(), ts: d.data().createdAt?.seconds || 0 })).sort((a, b) => b.ts - a.ts); renderNotify(); });
  }

  function renderAll() { renderApp(); renderOffers(); renderNotify(); renderPerm(); badge(); }
  function badge() {
    const n = orders.filter(o => o.status === 'pending').length + checkins.filter(c => c.status === 'pending').length, b = $('ordBadge');
    if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
  }

  /* =====================================================================
     الصلاحيات
     ===================================================================== */
  const RES = [['home', 'الرئيسية'], ['members', 'المشتركين'], ['store', 'المتجر'], ['settings.general', 'إعدادات عامة'],
  ['settings.plans', 'الاشتراكات (الخطط)'], ['settings.products', 'المنتجات والفواتير'], ['settings.treasury', 'الخزينة'],
  ['settings.offers', 'العروض والإشعارات'], ['settings.permissions', 'إدارة الصلاحيات'], ['settings.app', 'تطبيق المشتركين'], ['settings.notify', 'قنوات التواصل']];
  const MAIN = { 1: 'home', 2: 'members', 3: 'store' };
  const SUB = { 1: 'settings.general', 2: 'settings.plans', 3: 'settings.products', 4: 'settings.treasury', 5: 'settings.offers', 6: 'settings.permissions', 10: 'settings.notify', 11: 'settings.app' };
  const lvl = k => !me || me.owner ? 2 : Number(me.perms?.[k] ?? 0);

  function gate() {
    if (!staff.length) { me = null; lock(false); applyPerms(); return; }
    const s = staff.find(x => x.id === sessionStorage.getItem('staffId'));
    if (s) { me = s; lock(false); loginUI(false); applyPerms(); } else { me = { perms: {} }; lock(false); loginUI(true); }
  }
  function loginUI(show) {
    let o = $('aaLogin');
    if (!show) return o && o.remove();
    if (o) return;
    o = document.createElement('div'); o.id = 'aaLogin';
    o.className = 'fixed inset-0 z-[390] bg-black flex items-center justify-center p-4';
    o.innerHTML = `<div class="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-sm space-y-4 text-white">
      <h3 class="font-bold text-lg text-center"><i class="fa-solid fa-lock text-emerald-400 ml-1"></i> تسجيل دخول الموظفين</h3>
      <select id="lgName" class="${IN}">${staff.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <input id="lgPin" type="password" inputmode="numeric" placeholder="الرقم السري" class="${IN}" onkeydown="if(event.key==='Enter')AA.login()">
      ${BTN('دخول', 'AA.login()')}</div>`;
    document.body.appendChild(o);
  }
  async function login() {
    const s = staff.find(x => x.id === $('lgName').value); if (!s) return;
    if (await sha('staff:' + $('lgPin').value) !== s.pinHash) return toast('الرقم السري غلط', false);
    sessionStorage.setItem('staffId', s.id); gate();
  }
  function logout() { sessionStorage.removeItem('staffId'); location.reload(); }

  function applyPerms() {
    const hdr = document.querySelector('header nav');
    if (hdr && staff.length && me && me.name && !$('staffBadge')) {
      const b = document.createElement('button'); b.id = 'staffBadge'; b.dataset.keep = '1';
      b.className = 'mr-2 text-[11px] text-neutral-400 hover:text-white px-2'; b.innerHTML = `<i class="fa-solid fa-right-from-bracket ml-1"></i>${esc(me.name)}`;
      b.onclick = logout; hdr.parentElement.appendChild(b);
    }
    const subKeys = Object.values(SUB), anySettings = subKeys.some(k => lvl(k) > 0);
    Object.entries(MAIN).forEach(([n, k]) => {
      const t = $('main-tab-' + n), c = $('content-main-' + n);
      if (t) t.style.display = lvl(k) > 0 ? '' : 'none';
      if (c) c.dataset.ro = lvl(k) < 2 ? '1' : '0';
    });
    const t4 = $('main-tab-4'); if (t4) t4.style.display = anySettings ? '' : 'none';
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach(n => {
      const k = SUB[n], t = $('sub-4-tab-' + n), c = $('sub-4-content-' + n);
      const l = k ? lvl(k) : (me && !me.owner ? 0 : 2);
      if (t) t.style.display = l > 0 ? '' : 'none';
      if (c) c.dataset.ro = l < 2 ? '1' : '0';
    });
    const first = Object.keys(MAIN).find(n => lvl(MAIN[n]) > 0) || (anySettings ? 4 : null);
    const activeHidden = [1, 2, 3, 4].some(n => $('content-main-' + n) && !$('content-main-' + n).classList.contains('hidden') && $('main-tab-' + n).style.display === 'none');
    if (activeHidden && first && window.switchMainTab) window.switchMainTab(Number(first));
  }

  function renderPerm() {
    const host = $('sub-4-content-6'); if (!host) return;
    if (!staff.length) {
      host.innerHTML = `<div class="p-6 rounded-2xl bg-neutral-900/40 border border-neutral-800/80 space-y-4 max-w-md">
        <h3 class="text-lg font-bold text-white">ابدأ بإنشاء حساب المالك</h3>
        <p class="text-xs text-neutral-400">لحد ما تنشئ حساب، لوحة التحكم مفتوحة للكل. بعد الإنشاء هيطلب تسجيل دخول، وتقدر تضيف موظفين وتحدد لكل واحد يشوف ويعدل إيه.</p>
        <input id="ow-name" class="${IN}" placeholder="اسمك"><input id="ow-pin" type="password" inputmode="numeric" class="${IN}" placeholder="رقم سري (4 أرقام على الأقل)">
        ${BTN('إنشاء حساب المالك', 'AA.createOwner()')}</div>`;
      return;
    }
    host.innerHTML = `<div class="flex items-center justify-between mb-4"><div><h3 class="text-xl font-bold text-white">الموظفين والصلاحيات</h3>
      <p class="text-xs text-neutral-400 mt-1">لكل موظف: مخفي / عرض فقط / عرض وتعديل على كل قسم.</p></div>${BTN('<i class="fa-solid fa-plus ml-1"></i> موظف جديد', 'AA.staffModal()')}</div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">${staff.map(s => `<div class="${CARD}">
        <div class="flex items-center justify-between"><b class="text-white">${esc(s.name)}</b>${s.owner ? '<span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">مالك</span>' : ''}</div>
        <p class="text-[11px] text-neutral-500 mt-2">${s.owner ? 'صلاحيات كاملة' : RES.filter(([k]) => Number(s.perms?.[k] || 0) > 0).map(([k, l]) => `${l} (${s.perms[k] == 2 ? 'تعديل' : 'عرض'})`).join('، ') || 'لا صلاحيات'}</p>
        <div class="flex gap-2 mt-3">${s.owner ? '' : BTN('تعديل', `AA.staffModal('${s.id}')`, 'bg-sky-500/10 text-sky-400 border border-sky-500/30')}${s.owner ? '' : BTN('حذف', `AA.delStaff('${s.id}')`, 'bg-rose-500/10 text-rose-400 border border-rose-500/30')}</div></div>`).join('')}</div>`;
  }
  async function createOwner() {
    const name = $('ow-name').value.trim(), pin = $('ow-pin').value.trim();
    if (!name || pin.length < 4) return toast('اكتب الاسم ورقم سري 4 أرقام على الأقل', false);
    const ref = await window.addDoc(window.collection(db(), 'staff'), { name, pinHash: await sha('staff:' + pin), owner: true, perms: {}, createdAt: window.serverTimestamp() });
    sessionStorage.setItem('staffId', ref.id); toast('تم إنشاء حساب المالك ✔');
  }
  function staffModal(id) {
    if (lvl('settings.permissions') < 2) return toast('ليس لديك صلاحية', false);
    const s = staff.find(x => x.id === id) || { perms: {} };
    modal(`<div class="p-5 border-b border-neutral-800 font-bold">${id ? 'تعديل موظف' : 'موظف جديد'}</div>
      <div class="p-5 space-y-3"><input type="hidden" id="sf-id" value="${id || ''}">
        <div class="grid sm:grid-cols-2 gap-3"><input id="sf-name" class="${IN}" placeholder="اسم الموظف" value="${esc(s.name || '')}">
        <input id="sf-pin" type="password" inputmode="numeric" class="${IN}" placeholder="${id ? 'رقم سري جديد (اتركه فاضي للإبقاء)' : 'الرقم السري'}"></div>
        <div class="flex gap-2 text-[11px]">${BTN('كاشير', 'AA.preset("cashier")', 'bg-neutral-800 text-white')}${BTN('مدير', 'AA.preset("manager")', 'bg-neutral-800 text-white')}${BTN('مدرب (حضور فقط)', 'AA.preset("coach")', 'bg-neutral-800 text-white')}</div>
        <div class="grid sm:grid-cols-2 gap-2">${RES.map(([k, l]) => `<div class="flex items-center justify-between gap-2 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs"><span>${l}</span>
          <select data-perm="${k}" class="bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-xs"><option value="0" ${!s.perms[k] ? 'selected' : ''}>مخفي</option><option value="1" ${s.perms[k] == 1 ? 'selected' : ''}>عرض فقط</option><option value="2" ${s.perms[k] == 2 ? 'selected' : ''}>عرض وتعديل</option></select></div>`).join('')}</div></div>
      <div class="flex justify-end gap-2 p-4 border-t border-neutral-800">${BTN('إلغاء', 'AA.closeModal()', 'bg-neutral-800 text-white')}${BTN('حفظ', 'AA.saveStaff()')}</div>`);
  }
  function preset(p) {
    const P = { cashier: { home: 1, members: 1, store: 2 }, manager: Object.fromEntries(RES.map(([k]) => [k, 2])), coach: { home: 1, members: 2, 'settings.app': 2 } }[p];
    document.querySelectorAll('[data-perm]').forEach(sel => { sel.value = P[sel.dataset.perm] ?? 0; });
  }
  async function saveStaff() {
    const id = $('sf-id').value, name = $('sf-name').value.trim(), pin = $('sf-pin').value.trim();
    if (!name) return toast('اكتب اسم الموظف', false);
    if (!id && pin.length < 4) return toast('الرقم السري 4 أرقام على الأقل', false);
    if (staff.some(s => s.id !== id && s.name === name)) return toast('الاسم مستخدم', false);
    const perms = {}; document.querySelectorAll('[data-perm]').forEach(sel => { perms[sel.dataset.perm] = Number(sel.value); });
    const data = { name, perms, owner: false };
    if (pin) data.pinHash = await sha('staff:' + pin);
    if (id) await window.updateDoc(window.doc(db(), 'staff', id), data);
    else await window.addDoc(window.collection(db(), 'staff'), { ...data, createdAt: window.serverTimestamp() });
    closeModal(); toast('تم الحفظ ✔');
  }
  async function delStaff(id) {
    if (lvl('settings.permissions') < 2) return toast('ليس لديك صلاحية', false);
    if (confirm('حذف الموظف؟')) await window.deleteDoc(window.doc(db(), 'staff', id));
  }

  /* =====================================================================
     تاب "تطبيق المشتركين"
     ===================================================================== */
  const SECS = [['orders', 'الطلبات', 'fa-bag-shopping'], ['att', 'الحضور والغياب', 'fa-calendar-check'], ['plans', 'التمارين والتغذية', 'fa-dumbbell'], ['acc', 'حسابات التطبيق', 'fa-mobile-screen']];
  const canApp = () => { if (lvl('settings.app') < 2) { toast('ليس لديك صلاحية التعديل', false); return false; } return true; };

  function renderApp() {
    badge();
    const host = $('sub-4-content-11'); if (!host || host.classList.contains('hidden') || $('aaModal')) return;
    const ae = document.activeElement, fid = ae && ae.id, pos = ae && ae.selectionStart;
    const pending = orders.filter(o => o.status === 'pending').length;
    host.innerHTML = `<div class="space-y-5">
      <div class="${CARD} flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h3 class="font-bold text-white">رابط تطبيق المشتركين</h3><p class="text-[11px] text-neutral-500 mt-1">ابعته للمشتركين (أو ضيفه على الشاشة الرئيسية للموبايل).</p></div>
        <div class="flex items-center gap-2"><code dir="ltr" class="text-xs bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-emerald-300">${esc(location.origin)}/member.html</code>
        ${BTN('نسخ', "navigator.clipboard.writeText(location.origin+'/member.html');AA.toast('تم النسخ')", 'bg-neutral-800 text-white')}</div></div>
      <div class="flex gap-1 overflow-x-auto border-b border-neutral-800 pb-2">${SECS.map(([k, l, i]) => `<button data-keep="1" onclick="AA.sec('${k}')" class="whitespace-nowrap px-3 py-2 rounded-lg text-xs font-semibold transition ${appSec === k ? 'bg-white text-black' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}"><i class="fa-solid ${i} ml-1"></i>${l}${k === 'orders' && pending ? `<span class="mr-1 bg-rose-500 text-white text-[10px] rounded-full px-1.5">${pending}</span>` : ''}</button>`).join('')}</div>
      <div>${{ orders: secOrders, att: secAtt, plans: secPlans, acc: secAcc }[appSec]()}</div></div>`;
    if (fid && $(fid)) { $(fid).focus(); try { $(fid).setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
  }
  const sec = k => { appSec = k; renderApp(); };

  /* ----- الطلبات ----- */
  const ordNo = o => 'ORD-' + o.id.slice(0, 6).toUpperCase();
  function secOrders() {
    const F = [['pending', 'معلقة'], ['completed', 'تم التسليم'], ['rejected', 'مرفوضة / ملغية']];
    const match = o => ordF === 'rejected' ? ['rejected', 'cancelled'].includes(o.status) : o.status === ordF;
    const list = orders.filter(match).sort((a, b) => b.ts - a.ts);
    return `<div class="flex gap-2 mb-4">${F.map(([k, l]) => `<button data-keep="1" onclick="AA.ordF('${k}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold border ${ordF === k ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-neutral-700 text-neutral-400'}">${l} (${orders.filter(o => k === 'rejected' ? ['rejected', 'cancelled'].includes(o.status) : o.status === k).length})</button>`).join('')}</div>
      <div class="grid lg:grid-cols-2 gap-3">${list.map(o => `<div class="${CARD} space-y-2">
        <div class="flex justify-between items-start"><div><b class="text-white">${esc(o.memberName || '—')}</b> <span class="text-[11px] font-mono text-neutral-500">${esc(o.phone || '')}</span>
          <p class="text-[11px] text-neutral-500">${ordNo(o)} · ${when(o.ts)}</p></div><b class="text-amber-400">${money(o.total)}</b></div>
        <div class="text-xs text-neutral-300 space-y-1">${(o.items || []).map(i => `<div class="flex justify-between bg-neutral-900 rounded-lg px-2.5 py-1.5"><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}</div>
        ${o.status === 'pending' ? `<div class="flex gap-2 pt-1">${BTN('<i class="fa-solid fa-check ml-1"></i> تأكيد التسليم والدفع', `AA.approve('${o.id}')`)}${BTN('رفض', `AA.reject('${o.id}')`, 'bg-rose-500/10 text-rose-400 border border-rose-500/30')}</div>
          <p class="text-[10px] text-neutral-600">الطلب بيفضل معلق (من غير خصم مخزون) لحد ما العميل يوصل ويدفع وتأكده.</p>`
        : `<p class="text-[11px] ${o.status === 'completed' ? 'text-emerald-400' : 'text-rose-400'}">${o.status === 'completed' ? 'اتسلّم واتسجل كفاتورة' : (o.status === 'cancelled' ? 'ألغاه العميل' : 'مرفوض: ' + esc(o.reason || ''))}</p>`}</div>`).join('') || '<p class="text-sm text-neutral-500 col-span-full text-center py-10">لا توجد طلبات.</p>'}</div>`;
  }
  async function approve(id) {
    if (!canApp()) return;
    const o = orders.find(x => x.id === id); if (!o || o.status !== 'pending') return;
    if (!confirm(`تأكيد استلام ${money(o.total)} من ${o.memberName} وتسليم الطلب؟`)) return;
    try {
      await window.runTransaction(db(), async tx => {
        const oref = window.doc(db(), 'orders', id), os = await tx.get(oref);
        if (!os.exists() || os.data().status !== 'pending') throw new Error('الطلب اتعالج قبل كده');
        const snaps = []; for (const i of o.items) snaps.push(await tx.get(window.doc(db(), 'products', i.productId)));
        const items = [];
        snaps.forEach((sn, k) => {
          const i = o.items[k];
          if (!sn.exists()) throw new Error(`المنتج "${i.name}" اتحذف`);
          const x = sn.data(), stock = Number(x.qty ?? x.quantity ?? 0);
          if (stock < i.qty) throw new Error(`المتاح من "${x.name}" ${stock} فقط`);
          items.push({ productId: i.productId, name: x.name, price: i.price, buyPrice: Number(x.buyPrice || 0), qty: i.qty });
          tx.update(sn.ref, { qty: stock - i.qty });
        });
        const total = items.reduce((a, i) => a + i.price * i.qty, 0), sref = window.doc(window.collection(db(), 'sales'));
        tx.set(sref, { items, total, memberId: o.memberId || '', buyerName: o.memberName || 'عميل', buyerPhone: o.phone || '', date: today(), orderId: id, createdAt: window.serverTimestamp() });
        tx.set(window.doc(window.collection(db(), 'treasury')), { type: 'in', source: 'store', amount: total, date: today(), party: o.memberName || '', note: 'فاتورة INV-' + sref.id.slice(0, 6).toUpperCase() + ' (طلب تطبيق)', ref: sref.id, createdAt: window.serverTimestamp() });
        tx.update(oref, { status: 'completed', saleId: sref.id, completedAt: window.serverTimestamp() });
      });
      notifyOnce('ordok_' + id, { audience: o.memberId, type: 'order', title: 'تم تسليم طلبك ✔', body: `طلبك ${ordNo(o)} بقيمة ${money(o.total)} اتسلّم. شكراً ليك!` });
      toast('تم التسليم وتسجيل الفاتورة ✔');
    } catch (e) { console.error(e); toast('فشل: ' + (e.message || e.code), false); }
  }
  async function reject(id) {
    if (!canApp()) return;
    const o = orders.find(x => x.id === id); if (!o) return;
    const reason = prompt('سبب الرفض (هيظهر للعميل):', ''); if (reason === null) return;
    await window.updateDoc(window.doc(db(), 'orders', id), { status: 'rejected', reason: reason.trim() });
    notifyOnce('ordrej_' + id, { audience: o.memberId, type: 'order', title: 'تعذّر تنفيذ طلبك', body: `طلبك ${ordNo(o)} اترفض${reason.trim() ? ': ' + reason.trim() : ''}.` });
  }

  /* ----- الحضور والغياب والنشاط ----- */
  const attOn = (mid, d) => attAll.find(a => a.memberId === mid && a.date === d);
  const lastVisit = mid => attAll.filter(a => a.memberId === mid).map(a => a.date).sort().pop() || '';
  function secAtt() {
    const t = today(), live = members.filter(isLive);
    const here = attAll.filter(a => a.date === t).sort((a, b) => b.ts - a.ts);
    const q = attQ.trim().toLowerCase();
    const hits = q.length >= 2 ? members.filter(m => [m.name, m.phone, m.code, m.cardNo].some(v => String(v ?? '').toLowerCase().includes(q))).slice(0, 6) : [];
    const absent = live.map(m => {
      const last = lastVisit(m.id), base = last || (isDate(m.startDate) && m.startDate > addDays(t, -30) ? m.startDate : addDays(t, -30));
      return { m, last, days: diffDays(t, base) };
    }).filter(x => x.days >= 3 && !attOn(x.m.id, t)).sort((a, b) => b.days - a.days);
    const rank = live.map(m => ({ m, n: new Set(attAll.filter(a => a.memberId === m.id).map(a => a.date)).size })).filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 10);
    const max = rank[0]?.n || 1;
    const nm = id => members.find(m => m.id === id)?.name || 'مشترك محذوف';
    return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <div class="${CARD}"><p class="text-xs text-neutral-400">حاضرين اليوم</p><h4 class="text-2xl font-black text-emerald-400">${here.length}</h4></div>
      <div class="${CARD}"><p class="text-xs text-neutral-400">غايبين 3 أيام فأكتر</p><h4 class="text-2xl font-black text-rose-400">${absent.length}</h4></div>
      <div class="${CARD}"><p class="text-xs text-neutral-400">اشتراكات سارية</p><h4 class="text-2xl font-black text-white">${live.length}</h4></div>
      <div class="${CARD}"><p class="text-xs text-neutral-400">نسبة حضور اليوم</p><h4 class="text-2xl font-black text-amber-400">${live.length ? Math.round(here.length / live.length * 100) : 0}%</h4></div></div>
    <div class="${CARD} mb-4 border-emerald-500/30"><h4 class="text-sm font-bold mb-2"><i class="fa-solid fa-key text-emerald-400 ml-1"></i> تسجيل حضور بالكود (من تطبيق المشترك)</h4>
      <div class="flex gap-2"><input id="codeIn" value="${esc(codeQ)}" oninput="AA.codeQ(this.value)" onkeydown="if(event.key==='Enter')AA.byCode()" inputmode="numeric" maxlength="4" dir="ltr" class="${IN} text-center text-lg font-mono tracking-widest !w-40" placeholder="0000">${BTN('تأكيد الحضور', 'AA.byCode()')}</div>
      <div class="mt-3 space-y-1.5">${checkins.filter(c => c.status === 'pending').sort((a, b) => b.ts - a.ts).map(c => `<div class="flex items-center justify-between bg-neutral-900 rounded-lg px-3 py-2 text-xs"><span><b>${esc(c.name)}</b> <span class="font-mono text-amber-400 mr-2">${esc(c.code)}</span><span class="text-neutral-500">${new Date(c.ts * 1000).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span></span>${BTN('تأكيد', `AA.confirmCi('${c.id}')`)}</div>`).join('') || '<p class="text-xs text-neutral-500">مفيش طلبات حضور معلقة.</p>'}</div></div>
    <div class="${CARD} mb-4"><h4 class="text-sm font-bold mb-2">تسجيل حضور</h4>
      <input id="attSearch" value="${esc(attQ)}" oninput="AA.attQ(this.value)" class="${IN}" placeholder="ابحث بالاسم / الموبايل / الكود / رقم البطاقة...">
      <div class="mt-2 space-y-1.5">${hits.map(m => {
      const done = attOn(m.id, t); const S = getStatus(m); return `<div class="flex items-center justify-between bg-neutral-900 rounded-lg px-3 py-2 text-xs">
        <span><b>${esc(m.name)}</b> <span class="text-neutral-500 font-mono mr-1">${esc(m.phone || '')}</span><span class="mr-1 ${S === 'expired' ? 'text-rose-400' : S === 'frozen' ? 'text-sky-400' : 'text-emerald-400'}">${{ active: 'نشط', soon: 'قارب ينتهي', expired: 'منتهي', frozen: 'موقوف', none: 'غير محدد' }[S]}</span></span>
        ${done ? '<span class="text-emerald-400">حاضر ✔</span>' : BTN('تسجيل حضور', `AA.mark('${m.id}')`)}</div>`;
    }).join('')}</div></div>
    <div class="grid lg:grid-cols-2 gap-4">
      <div class="${CARD}"><h4 class="text-sm font-bold mb-2">حضور اليوم</h4><div class="space-y-1.5 max-h-72 overflow-y-auto">${here.map(a => `<div class="flex justify-between items-center bg-neutral-900 rounded-lg px-3 py-2 text-xs"><span>${esc(nm(a.memberId))}</span><span class="text-neutral-500">${a.ts ? new Date(a.ts * 1000).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''} <button data-keep="1" onclick="AA.delAtt('${a.id}')" class="text-rose-400 mr-2"><i class="fa-solid fa-xmark"></i></button></span></div>`).join('') || '<p class="text-xs text-neutral-500">لا حضور لسه.</p>'}</div></div>
      <div class="${CARD}"><h4 class="text-sm font-bold mb-2">الغياب (اشتراك ساري ومجاش)</h4><div class="space-y-1.5 max-h-72 overflow-y-auto">${absent.map(({ m, last, days }) => `<div class="flex justify-between items-center bg-neutral-900 rounded-lg px-3 py-2 text-xs">
        <span><b>${esc(m.name)}</b> <span class="text-rose-400 mr-1">${last ? `من ${days} يوم` : 'لم يحضر'}</span></span>${BTN('تذكير', `AA.remind('${m.id}')`, 'bg-amber-500/10 text-amber-400 border border-amber-500/30')}</div>`).join('') || '<p class="text-xs text-neutral-500">مفيش غايبين 👌</p>'}</div></div></div>
    <div class="${CARD} mt-4"><h4 class="text-sm font-bold mb-3">النشاط — الأكتر حضوراً (آخر 30 يوم)</h4><div class="space-y-2">${rank.map(({ m, n }) => `<div><div class="flex justify-between text-xs mb-1"><span>${esc(m.name)}</span><span class="text-emerald-400">${n} يوم</span></div><div class="h-2 bg-neutral-900 rounded-full overflow-hidden"><div class="h-full bg-emerald-500 rounded-full" style="width:${n / max * 100}%"></div></div></div>`).join('') || '<p class="text-xs text-neutral-500">لا بيانات.</p>'}</div></div>`;
  }
  async function mark(id) {
    if (!canApp()) return;
    const m = members.find(x => x.id === id); if (!m) return;
    if (attOn(id, today())) return toast('الحضور متسجل النهاردة', false);
    const S = getStatus(m);
    if (S === 'frozen') return toast('الاشتراك موقوف مؤقتاً', false);
    if (S === 'expired' && !confirm('الاشتراك منتهي، تسجل الحضور برضو؟')) return;
    await window.setDoc(window.doc(db(), 'attendance', `${id}_${today()}`), { memberId: id, date: today(), createdAt: window.serverTimestamp() });
    toast('تم تسجيل الحضور ✔');
  }
  async function confirmCi(cid) {
    if (!canApp()) return;
    const c = checkins.find(x => x.id === cid); if (!c || c.status !== 'pending') return;
    const m = members.find(x => x.id === c.memberId);
    if (!m) return toast('المشترك غير موجود', false);
    const S = getStatus(m);
    if (S === 'frozen') return toast('الاشتراك موقوف مؤقتاً', false);
    if (S === 'expired' && !confirm(`اشتراك ${m.name} منتهي، تسجل الحضور برضو؟`)) return;
    if (!attOn(m.id, today())) await window.setDoc(window.doc(db(), 'attendance', `${m.id}_${today()}`), { memberId: m.id, date: today(), createdAt: window.serverTimestamp() });
    await window.updateDoc(window.doc(db(), 'checkins', cid), { status: 'done', doneAt: window.serverTimestamp() });
    toast(`تم تسجيل حضور ${m.name} ✔`);
  }
  function byCode() {
    const code = (codeQ || '').trim();
    if (code.length !== 4) return toast('اكتب الكود (4 أرقام)', false);
    const hits = checkins.filter(c => c.status === 'pending' && c.code === code);
    if (!hits.length) return toast('الكود غلط أو منتهي', false);
    if (hits.length > 1) return toast('فيه أكتر من مشترك بنفس الكود، أكّد من القائمة تحت', false);
    codeQ = ''; confirmCi(hits[0].id);
  }
  async function delAtt(id) { if (canApp() && confirm('حذف تسجيل الحضور؟')) await window.deleteDoc(window.doc(db(), 'attendance', id)); }
  async function remind(id) {
    if (!canApp()) return;
    const m = members.find(x => x.id === id); if (!m) return;
    const ok = await notifyOnce(`rem_${id}_${today()}`, { audience: id, type: 'reminder', title: 'وحشتنا 💪', body: `يا ${m.name} بقالك فترة مجيتش الجيم. جدولك مستنيك، تعالى كمّل!` });
    toast(ok ? 'تم إرسال التذكير ✔' : 'التذكير اتبعت النهاردة قبل كده', ok);
  }

  /* ----- التمارين والتغذية ----- */
  function secPlans() {
    const q = accQ.trim().toLowerCase();
    const list = members.filter(m => !q || [m.name, m.phone, m.code].some(v => String(v ?? '').toLowerCase().includes(q)));
    return `<input id="accSearch" value="${esc(accQ)}" oninput="AA.accQ(this.value)" class="${IN} mb-3" placeholder="ابحث عن مشترك...">
      <p class="text-[11px] text-neutral-500 mb-3">الجدول بيتحرك مع الحضور بس: اللي غاب النهاردة التمرين بتاعه بيتأجل لبكره، مش بيضيع.</p>
      <div class="${CARD} p-0 overflow-hidden"><table class="w-full text-right text-xs"><thead class="bg-neutral-800/80 text-neutral-300"><tr><th class="p-3">المشترك</th><th class="p-3">جدول التمارين</th><th class="p-3">النظام الغذائي</th><th class="p-3"></th></tr></thead>
      <tbody class="divide-y divide-neutral-800">${list.map(m => `<tr class="hover:bg-white/5"><td class="p-3 font-bold text-white">${esc(m.name)}</td>
        <td class="p-3 ${m.workout?.days?.length ? 'text-emerald-400' : 'text-neutral-600'}">${m.workout?.days?.length ? m.workout.days.length + ' أيام: ' + m.workout.days.map(d => esc(d.name)).join(' ← ') : '—'}</td>
        <td class="p-3 ${m.diet?.meals?.length ? 'text-emerald-400' : 'text-neutral-600'}">${m.diet?.meals?.length ? m.diet.meals.length + ' وجبات' : '—'}</td>
        <td class="p-3">${BTN('تعديل', `AA.edPlan('${m.id}')`, 'bg-sky-500/10 text-sky-400 border border-sky-500/30')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  const PPL = [{ name: 'صدر + ترايسبس', text: 'بنش برس | 4x10\nانكلاين دامبل | 3x12\nتفتيح | 3x12\nترايسبس بار | 3x12' }, { name: 'ظهر + بايسبس', text: 'سحب علوي | 4x10\nتجديف بار | 4x10\nسحب أرضي | 3x12\nبايسبس بار | 3x12' }, { name: 'أرجل + أكتاف', text: 'سكوات | 4x10\nليج برس | 3x12\nرفرفة جانبي | 3x15\nكتف دامبل | 3x12' }];
  const linesOf = d => (d.exercises || []).map(e => `${e.name}${e.detail ? ' | ' + e.detail : ''}`).join('\n');
  function edPlan(id) {
    if (!canApp()) return;
    const m = members.find(x => x.id === id); if (!m) return;
    ed = { id, days: (m.workout?.days || []).map(d => ({ name: d.name, text: linesOf(d) })), start: m.workout?.startedAt || today() };
    drawEd();
  }
  function captureEd() {
    if (!ed) return;
    ed.days = [...document.querySelectorAll('.wk-day')].map(d => ({ name: d.querySelector('.wk-name').value, text: d.querySelector('.wk-ex').value }));
  }
  function drawEd() {
    const m = members.find(x => x.id === ed.id), diet = m.diet || {};
    const meals = (diet.meals || []).map(x => [x.name, x.time, x.desc].filter((v, i) => i < 2 || v).join(' | ')).join('\n');
    modal(`<div class="p-5 border-b border-neutral-800 font-bold">جدول وتغذية: ${esc(m.name)}</div>
      <div class="p-5 space-y-5">
        <div><div class="flex items-center justify-between mb-2"><h4 class="text-sm font-bold text-emerald-400">جدول التمارين (بيدور بالترتيب مع كل حضور)</h4>
          <div class="flex gap-2">${BTN('قالب Push/Pull/Legs', 'AA.edPreset()', 'bg-neutral-800 text-white')}${BTN('+ يوم', 'AA.edAdd()', 'bg-neutral-800 text-white')}</div></div>
          <div class="space-y-3">${ed.days.map((d, i) => `<div class="wk-day bg-neutral-950 border border-neutral-800 rounded-xl p-3 space-y-2">
            <div class="flex gap-2"><span class="text-xs text-neutral-500 pt-2">${i + 1}</span><input class="wk-name ${IN}" placeholder="اسم اليوم (مثال: صدر)" value="${esc(d.name)}">${BTN('<i class="fa-solid fa-trash-can"></i>', `AA.edDel(${i})`, 'bg-rose-500/10 text-rose-400')}</div>
            <textarea class="wk-ex ${IN}" rows="4" placeholder="كل تمرين في سطر: اسم التمرين | 4x12">${esc(d.text)}</textarea></div>`).join('') || '<p class="text-xs text-neutral-500">مفيش أيام لسه.</p>'}</div>
          <div class="mt-2 flex items-center gap-2 text-xs text-neutral-400">بداية الدورة: <input id="wk-start" type="date" value="${ed.start}" class="${IN} !w-auto"></div></div>
        <div><h4 class="text-sm font-bold text-amber-400 mb-2">النظام الغذائي</h4>
          <input id="dt-cal" class="${IN} mb-2" placeholder="السعرات اليومية (اختياري)" value="${esc(diet.calories || '')}">
          <textarea id="dt-meals" class="${IN}" rows="5" placeholder="كل وجبة في سطر: الوجبة | الوقت | التفاصيل&#10;الفطار | 8 ص | 3 بيضات + شوفان">${esc(meals)}</textarea>
          <textarea id="dt-notes" class="${IN} mt-2" rows="2" placeholder="ملاحظات (مياه، مكملات...)">${esc(diet.notes || '')}</textarea></div></div>
      <div class="flex justify-end gap-2 p-4 border-t border-neutral-800">${BTN('إلغاء', 'AA.closeModal()', 'bg-neutral-800 text-white')}${BTN('حفظ', 'AA.savePlan()')}</div>`, 'max-w-3xl');
  }
  const edAdd = () => { captureEd(); ed.days.push({ name: '', text: '' }); drawEd(); };
  const edDel = i => { captureEd(); ed.days.splice(i, 1); drawEd(); };
  const edPreset = () => { captureEd(); ed.days = PPL.map(d => ({ ...d })); drawEd(); };
  async function savePlan() {
    captureEd();
    const days = ed.days.filter(d => d.name.trim()).map(d => ({
      name: d.name.trim(),
      exercises: d.text.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [n, ...r] = l.split('|'); return { name: n.trim(), detail: r.join('|').trim() }; })
    }));
    const meals = $('dt-meals').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [name, time, ...r] = l.split('|'); return { name: (name || '').trim(), time: (time || '').trim(), desc: r.join('|').trim() }; });
    const data = {
      workout: { days, startedAt: $('wk-start').value || today() },
      diet: { calories: $('dt-cal').value.trim(), notes: $('dt-notes').value.trim(), meals }
    };
    await window.updateDoc(window.doc(db(), 'subscribers', ed.id), data);
    const m = members.find(x => x.id === ed.id);
    notifyOnce(`plan_${ed.id}_${Date.now()}`, { audience: ed.id, type: 'plan', title: 'تم تحديث جدولك 📋', body: 'مدربك حدّث جدول التمارين / النظام الغذائي بتاعك، افتح التطبيق وشوفه.' });
    closeModal(); ed = null; toast('تم الحفظ ✔');
  }

  /* ----- حسابات التطبيق ----- */
  function secAcc() {
    const q = accQ.trim().toLowerCase();
    const list = members.filter(m => !q || [m.name, m.phone, m.code].some(v => String(v ?? '').toLowerCase().includes(q)));
    return `<input id="accSearch" value="${esc(accQ)}" oninput="AA.accQ(this.value)" class="${IN} mb-3" placeholder="ابحث عن مشترك...">
      <div class="${CARD} p-0 overflow-hidden"><table class="w-full text-right text-xs"><thead class="bg-neutral-800/80 text-neutral-300"><tr><th class="p-3">المشترك</th><th class="p-3">الموبايل</th><th class="p-3">حساب التطبيق</th><th class="p-3">آخر دخول</th><th class="p-3"></th></tr></thead>
      <tbody class="divide-y divide-neutral-800">${list.map(m => `<tr class="hover:bg-white/5"><td class="p-3 font-bold text-white">${esc(m.name)}</td><td class="p-3 font-mono">${esc(m.phone || '')}</td>
        <td class="p-3">${m.appEnabled ? '<span class="text-emerald-400">مفعّل</span>' : '<span class="text-neutral-600">غير مفعّل</span>'}</td>
        <td class="p-3 text-neutral-500">${m.lastLogin?.seconds ? when(m.lastLogin.seconds) : '—'}</td>
        <td class="p-3 whitespace-nowrap">${BTN(m.appEnabled ? 'كلمة سر جديدة' : 'تفعيل', `AA.pin('${m.id}')`)} ${m.appEnabled ? BTN('إيقاف', `AA.offApp('${m.id}')`, 'bg-rose-500/10 text-rose-400 border border-rose-500/30') : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function pin(id) {
    if (!canApp()) return;
    const m = members.find(x => x.id === id); if (!m) return;
    const p = String(Math.floor(100000 + Math.random() * 900000));
    await window.updateDoc(window.doc(db(), 'subscribers', id), { appEnabled: true, appPinHash: await sha(p + ':' + id), appPinSetAt: window.serverTimestamp() });
    const txt = `أهلاً ${m.name} 👋\nتطبيق ${gymName()} جاهز:\n${location.origin}/member.html\nرقم الموبايل: ${m.phone}\nكلمة السر: ${p}`;
    modal(`<div class="p-5 space-y-3"><h3 class="font-bold">تم تفعيل حساب ${esc(m.name)}</h3>
      <p class="text-xs text-neutral-400">كلمة السر بتظهر مرة واحدة بس (متخزنة مشفّرة):</p>
      <div class="text-center text-3xl font-black tracking-widest text-emerald-400 font-mono">${p}</div>
      <div class="flex gap-2 justify-end">${BTN('نسخ الرسالة', `navigator.clipboard.writeText(${JSON.stringify(txt)});AA.toast('تم النسخ')`, 'bg-neutral-800 text-white')}
      ${m.phone ? `<a target="_blank" href="https://wa.me/${waPhone(m.phone)}?text=${encodeURIComponent(txt)}" class="bg-emerald-500 text-black font-bold text-xs px-4 py-2 rounded-xl"><i class="fa-brands fa-whatsapp ml-1"></i>إرسال واتساب</a>` : ''}
      ${BTN('إغلاق', 'AA.closeModal()', 'bg-neutral-800 text-white')}</div></div>`, 'max-w-md');
  }
  async function offApp(id) { if (canApp() && confirm('إيقاف حساب التطبيق لهذا المشترك؟')) await window.updateDoc(window.doc(db(), 'subscribers', id), { appEnabled: false }); }

  /* =====================================================================
     العروض والإشعارات (تاب 5)
     ===================================================================== */
  const TYPES = { offer: 'عرض', plan: 'عرض اشتراك', product: 'عرض منتجات', news: 'إعلان', reminder: 'تذكير', invite: 'دعوة', order: 'طلب' };
  function renderOffers() {
    const host = $('sub-4-content-5'); if (!host) return;
    if ($('nf-title') && (document.activeElement?.id || '').startsWith('nf-')) return; // ما نقاطعش الكتابة
    const keep = { t: $('nf-title')?.value || '', b: $('nf-body')?.value || '' };
    host.innerHTML = `<div class="p-6 rounded-2xl bg-neutral-900/40 border border-neutral-800/80 space-y-4">
      <h3 class="text-lg font-bold text-white">إرسال عرض / إشعار للمشتركين</h3>
      <div class="grid sm:grid-cols-3 gap-3">
        <select id="nf-type" class="${IN}"><option value="plan">عرض اشتراك</option><option value="product">عرض منتجات</option><option value="offer">عرض / خصم</option><option value="news">إعلان</option></select>
        <select id="nf-aud" class="${IN}"><option value="all">كل المشتركين</option>${members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
        <input id="nf-title" class="${IN}" placeholder="العنوان" value="${esc(keep.t)}"></div>
      <textarea id="nf-body" rows="3" class="${IN}" placeholder="نص الإشعار (مثال: خصم 20% على التجديد السنوي لحد آخر الشهر)">${esc(keep.b)}</textarea>
      <div class="flex flex-wrap items-center gap-4 text-xs"><label class="flex items-center gap-1.5"><input id="nf-app" type="checkbox" checked> على التطبيق</label>
        <label class="flex items-center gap-1.5"><input id="nf-wa" type="checkbox" checked> رسالة واتساب (للاشتراكات السارية)</label>${BTN('<i class="fa-solid fa-paper-plane ml-1"></i> إرسال', 'AA.sendManual()')}</div>
      <div class="pt-2 border-t border-neutral-800"><h4 class="text-sm font-bold text-white mb-2">آخر الإشعارات</h4><div class="space-y-1.5 max-h-72 overflow-y-auto">
        ${notifs.slice(0, 20).map(n => `<div class="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs"><div class="flex justify-between"><b class="text-white">${esc(n.title)}</b><span class="text-neutral-500">${TYPES[n.type] || ''} · ${n.audience === 'all' ? 'الكل' : esc(members.find(m => m.id === n.audience)?.name || 'مشترك')} · ${when(n.ts)}</span></div><p class="text-neutral-400 mt-1">${esc(n.body)}</p></div>`).join('') || '<p class="text-xs text-neutral-500">لا إشعارات بعد.</p>'}</div></div></div>`;
  }
  async function sendManual() {
    if (lvl('settings.offers') < 2) return toast('ليس لديك صلاحية', false);
    const title = $('nf-title').value.trim(), body = $('nf-body').value.trim(), aud = $('nf-aud').value, type = $('nf-type').value;
    if (!title || !body) return toast('اكتب العنوان والنص', false);
    if (!$('nf-app').checked && !$('nf-wa').checked) return toast('اختار قناة إرسال', false);
    let id = '';
    if ($('nf-app').checked) id = (await window.addDoc(window.collection(db(), 'notifications'), { audience: aud, type, title, body, createdAt: window.serverTimestamp() })).id;
    let n = 0;
    if ($('nf-wa').checked) { const t = waTargets(aud); n = t.length; await queueWa(id, `${title}\n${body}\n— ${gymName()}`, t); }
    $('nf-title').value = ''; $('nf-body').value = '';
    toast(`تم الإرسال ✔${n ? ` (${n} رسالة واتساب في الطابور)` : ''}`);
    renderOffers();
  }

  /* =====================================================================
     قنوات التواصل (تاب 10): إعدادات + طابور واتساب
     ===================================================================== */
  const TOG = [['autoProduct', 'إشعار تلقائي عند إضافة منتج جديد'], ['autoPlan', 'إشعار تلقائي عند إضافة خطة اشتراك'], ['autoMember', 'إشعارات المشترك (دعوة جديدة، استهلاك دعوة، عرض خاص)'],
  ['waMember', 'واتساب: إشعارات المشترك الفردية'], ['waBroadcast', 'واتساب: الإشعارات العامة لكل المشتركين (منتج/خطة جديدة) — بيعمل رسائل كتير']];
  function renderNotify() {
    const host = $('sub-4-content-10'); if (!host) return;
    if ((document.activeElement?.id || '') === 'cc-input') return;
    const list = outbox.filter(o => o.status === obF);
    host.innerHTML = `<div class="space-y-5"><div class="p-6 rounded-2xl bg-neutral-900/40 border border-neutral-800/80 space-y-3">
      <h3 class="text-lg font-bold text-white">الإشعارات التلقائية</h3>
      ${TOG.map(([k, l]) => `<label class="flex items-center justify-between bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-xs cursor-pointer"><span>${l}</span><input type="checkbox" ${cfg[k] ? 'checked' : ''} onchange="AA.cfg('${k}',this.checked)"></label>`).join('')}
      <div class="flex items-center gap-2 text-xs text-neutral-400">كود الدولة للواتساب: <input id="cc-input" value="${esc(cfg.cc)}" onchange="AA.cfg('cc',this.value.replace(/\\D/g,''))" class="${IN} !w-20" dir="ltr"> <span class="text-neutral-600">(مصر 20)</span></div></div>
      <div class="p-6 rounded-2xl bg-neutral-900/40 border border-neutral-800/80">
        <div class="flex items-center justify-between mb-3"><h3 class="text-lg font-bold text-white"><i class="fa-brands fa-whatsapp text-emerald-400 ml-1"></i> طابور رسائل الواتساب</h3>
          <div class="flex gap-1">${[['queued', 'منتظرة'], ['sent', 'اتبعتت']].map(([k, l]) => `<button data-keep="1" onclick="AA.obF('${k}')" class="px-3 py-1.5 rounded-lg text-xs border ${obF === k ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-neutral-700 text-neutral-400'}">${l} (${outbox.filter(o => o.status === k).length})</button>`).join('')}</div></div>
        <p class="text-[11px] text-neutral-500 mb-3">الرسائل بتتبعت أوتوماتيك لو شغّلت Cloud Function (functions/index.js). من غيرها اضغط "إرسال" وهيفتح واتساب برسالة جاهزة.</p>
        <div class="space-y-2 max-h-96 overflow-y-auto">${list.slice(0, 60).map(o => `<div class="bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs flex items-center justify-between gap-3">
          <div class="min-w-0"><b class="text-white">${esc(o.name || '')}</b> <span class="font-mono text-neutral-500">${esc(o.phone || '')}</span><p class="text-neutral-400 truncate mt-1">${esc(String(o.text || '').replace(/\n/g, ' '))}</p></div>
          <div class="flex gap-2 shrink-0">${o.status === 'queued' ? `<a target="_blank" onclick="AA.sent('${o.id}')" href="https://wa.me/${waPhone(o.phone)}?text=${encodeURIComponent(o.text || '')}" class="bg-emerald-500 text-black font-bold px-3 py-1.5 rounded-lg">إرسال</a>${BTN('تم', `AA.sent('${o.id}')`, 'bg-neutral-800 text-white')}` : '<span class="text-emerald-400">✔</span>'}</div></div>`).join('') || '<p class="text-xs text-neutral-500 text-center py-6">لا رسائل.</p>'}</div></div></div>`;
  }
  async function setCfg(k, v) {
    if (lvl('settings.notify') < 2) { toast('ليس لديك صلاحية', false); return renderNotify(); }
    cfg[k] = v;
    await window.runTransaction(db(), async tx => { tx.set(window.doc(db(), 'settings', 'app'), { [k]: v }, { merge: true }); });
  }
  const markSent = id => window.updateDoc(window.doc(db(), 'whatsapp_outbox', id), { status: 'sent', sentAt: window.serverTimestamp() });

  /* ---------- export ---------- */
  window.AA = {
    toast, closeModal, login, createOwner, staffModal, preset, saveStaff, delStaff,
    sec, ordF: k => { ordF = k; renderApp(); }, approve, reject,
    attQ: v => { attQ = v; renderApp(); }, accQ: v => { accQ = v; renderApp(); }, mark, delAtt, remind, codeQ: v => { codeQ = v; }, byCode, confirmCi,
    edPlan, edAdd, edDel, edPreset, savePlan, pin, offApp, sendManual,
    cfg: setCfg, obF: k => { obF = k; renderNotify(); }, sent: markSent
  };
})();