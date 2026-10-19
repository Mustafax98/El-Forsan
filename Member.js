/* =====================================================================
   member.js — تطبيق المشترك (member.html)
   تسجيل دخول بالموبايل + كلمة سر (بتتفعل من لوحة التحكم)، وبعدها:
   اشتراكي / المتجر (طلب معلق) / طلباتي / التمارين / التغذية / الإشعارات
   ===================================================================== */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Number(n || 0).toLocaleString('en-US') + ' ج.م';
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => fmt(new Date());
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
  const dmy = s => isDate(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '-';
  const when = sec => sec ? new Date(sec * 1000).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');
  const toast = (msg, ok = true) => {
    const t = document.createElement('div');
    t.className = `fixed top-5 left-1/2 -translate-x-1/2 z-[300] px-5 py-3 rounded-xl text-sm font-bold shadow-2xl ${ok ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'}`;
    t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
  };
  const IN = 'w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500';
  const CARD = 'bg-neutral-950 border border-neutral-900 rounded-2xl p-4';

  let checkins = [];
  let me = null, att = new Set(), products = [], cats = [], orders = [], notifs = [], gym = { title: 'EL-Forsan GYM', logo: '' };
  let view = 'home', cart = {}, catF = 'all', calY, calM, unsub = [], seenAt = Number(localStorage.getItem('mem_seen') || 0);
  const D = new Date(); calY = D.getFullYear(); calM = D.getMonth();

  const getStatus = m => {
    if (m.frozen && m.frozen.active) return 'frozen';
    if (!isDate(m.endDate)) return 'none';
    const d = diffDays(m.endDate, today());
    return d < 0 ? 'expired' : d <= 7 ? 'soon' : 'active';
  };
  const ST = { active: ['نشط', 'text-emerald-400'], soon: ['قارب ينتهي', 'text-amber-400'], expired: ['منتهي', 'text-rose-400'], frozen: ['موقوف مؤقتاً', 'text-sky-400'], none: ['غير محدد', 'text-neutral-400'] };

  /* ---------- boot ---------- */
  const ready = cb => window.db ? cb() : window.addEventListener('fb-ready', cb, { once: true });
  ready(() => {
    try { gym = { ...gym, title: localStorage.getItem('gym_title') || gym.title, logo: localStorage.getItem('gym_logo') || '' }; } catch (e) { /* */ }
    window.onSnapshot(window.doc(window.db, 'settings', 'general'), s => { if (s.exists()) { gym = { title: s.data().title || gym.title, logo: s.data().logo || '' }; render(); } });
    const id = localStorage.getItem('mem_id');
    if (id) start(id); else render();
  });

  async function login() {
    const phone = $('lg-phone').value.trim(), pin = $('lg-pin').value.trim();
    if (!phone || !pin) return toast('اكتب رقم الموبايل وكلمة السر', false);
    try {
      const s = await window.getDocs(window.query(window.collection(window.db, 'subscribers'), window.where('phone', '==', phone)));
      const d = s.docs[0];
      if (!d) return toast('الرقم غير مسجل', false);
      const x = d.data();
      if (!x.appEnabled || !x.appPinHash) return toast('الحساب غير مفعّل، كلّم إدارة الجيم', false);
      if (await sha(pin + ':' + d.id) !== x.appPinHash) return toast('كلمة السر غلط', false);
      localStorage.setItem('mem_id', d.id);
      window.updateDoc(d.ref, { lastLogin: window.serverTimestamp() }).catch(() => { });
      start(d.id);
    } catch (e) { console.error(e); toast('تعذر تسجيل الدخول', false); }
  }
  function logout() { localStorage.removeItem('mem_id'); unsub.forEach(u => u()); unsub = []; me = null; cart = {}; view = 'home'; render(); }

  function start(id) {
    const C = n => window.collection(window.db, n), S = (r, cb) => unsub.push(window.onSnapshot(r, cb, e => console.error(e)));
    S(window.doc(window.db, 'subscribers', id), s => {
      if (!s.exists() || !s.data().appEnabled) { toast('الحساب غير متاح', false); return logout(); }
      me = { ...s.data(), id: s.id }; render();
    });
    S(window.query(C('attendance'), window.where('memberId', '==', id)), s => { att = new Set(s.docs.map(d => d.data().date)); render(); });
    S(window.query(C('checkins'), window.where('memberId', '==', id)), s => { checkins = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); });
    S(C('products'), s => { products = s.docs.map(d => ({ id: d.id, ...d.data(), price: Number(d.data().sellPrice ?? d.data().price ?? 0), qty: Number(d.data().qty ?? d.data().quantity ?? 0) })).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar')); render(); });
    S(C('categories'), s => { cats = s.docs.map(d => ({ id: d.id, name: d.data().name })); render(); });
    S(window.query(C('orders'), window.where('memberId', '==', id)), s => { orders = s.docs.map(d => ({ id: d.id, ...d.data(), ts: d.data().createdAt?.seconds || Math.floor(Date.now() / 1000) })).sort((a, b) => b.ts - a.ts); render(); });
    S(window.query(C('notifications'), window.where('audience', 'in', ['all', id])), s => { notifs = s.docs.map(d => ({ id: d.id, ...d.data(), ts: d.data().createdAt?.seconds || Math.floor(Date.now() / 1000) })).sort((a, b) => b.ts - a.ts); render(); });
  }

  /* ---------- جدول التمارين: بيتحرك مع الحضور بس ---------- */
  function workoutState(w) {
    const days = w?.days || []; if (!days.length) return null;
    const from = w.startedAt || '0000-00-00';
    const dates = [...att].filter(d => d >= from).sort(), n = days.length, done = dates.length;
    const doneToday = att.has(today());
    const nextIdx = done % n;
    const todayIdx = doneToday ? (done - 1 + n) % n : nextIdx;
    const last = dates[dates.length - 1];
    const missed = !doneToday && last ? Math.max(0, diffDays(today(), last) - 1) : 0;
    return { days, n, nextIdx, todayIdx, doneToday, missed, done };
  }

  /* ---------- render ---------- */
  function render() {
    const app = $('app'); if (!app) return;
    const fid = document.activeElement?.id, fv = fid ? document.activeElement.value : '';
    app.innerHTML = me ? shell() : loginView();
    if (fid && $(fid)) { $(fid).value = fv; $(fid).focus(); }
  }

  function loginView() {
    return `<div class="min-h-screen flex flex-col items-center justify-center p-6 space-y-6">
      ${gym.logo ? `<img src="${gym.logo}" class="w-24 h-24 rounded-3xl object-cover border border-neutral-800">` : `<div class="w-24 h-24 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-4xl"><i class="fa-solid fa-dumbbell"></i></div>`}
      <h1 class="text-2xl font-black">${esc(gym.title)}</h1>
      <div class="w-full space-y-3"><input id="lg-phone" type="tel" inputmode="numeric" dir="ltr" class="${IN} text-right" placeholder="رقم الموبايل">
        <input id="lg-pin" type="password" inputmode="numeric" dir="ltr" class="${IN} text-right" placeholder="كلمة السر" onkeydown="if(event.key==='Enter')MB.login()">
        <button onclick="MB.login()" class="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-black py-3 rounded-xl">دخول</button>
        <p class="text-[11px] text-neutral-500 text-center">كلمة السر بتوصلك من إدارة الجيم.</p></div></div>`;
  }

  function shell() {
    const unread = notifs.filter(n => n.ts > seenAt).length, pend = orders.filter(o => o.status === 'pending').length;
    const cartN = Object.values(cart).reduce((a, b) => a + b, 0);
    const tabs = [['home', 'اشتراكي', 'fa-id-card'], ['store', 'المتجر', 'fa-store', cartN], ['orders', 'طلباتي', 'fa-bag-shopping', pend], ['workout', 'التمارين', 'fa-dumbbell'], ['diet', 'التغذية', 'fa-apple-whole'], ['notif', 'إشعارات', 'fa-bell', unread]];
    const body = { home: viewHome, store: viewStore, orders: viewOrders, workout: viewWorkout, diet: viewDiet, notif: viewNotif }[view]();
    return `<header class="sticky top-0 z-40 bg-black/80 backdrop-blur border-b border-neutral-900 px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">${gym.logo ? `<img src="${gym.logo}" class="w-10 h-10 rounded-xl object-cover">` : ''}<div><p class="font-black leading-tight">${esc(gym.title)}</p><p class="text-[11px] text-neutral-500">أهلاً ${esc(me.name)}</p></div></div>
        <button onclick="MB.logout()" class="text-neutral-500 hover:text-white p-2"><i class="fa-solid fa-right-from-bracket"></i></button></header>
      <main class="p-4 pb-28 space-y-4">${body}</main>
      <nav class="fixed bottom-0 inset-x-0 z-40 bg-black/90 backdrop-blur border-t border-neutral-900 safe-b"><div class="max-w-xl mx-auto grid grid-cols-6">
        ${tabs.map(([k, l, i, b]) => `<button onclick="MB.go('${k}')" class="relative py-2.5 flex flex-col items-center gap-0.5 text-[10px] ${view === k ? 'text-emerald-400' : 'text-neutral-500'}"><i class="fa-solid ${i} text-base"></i>${l}${b ? `<span class="absolute top-1 right-1/4 bg-rose-500 text-white text-[9px] rounded-full min-w-4 h-4 px-1 flex items-center justify-center">${b}</span>` : ''}</button>`).join('')}</div></nav>`;
  }
  function go(v) { view = v; if (v === 'notif') { seenAt = Math.floor(Date.now() / 1000); localStorage.setItem('mem_seen', seenAt); } render(); scrollTo(0, 0); }

  /* ----- الرئيسية ----- */
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function viewHome() {
    const s = getStatus(me), left = isDate(me.endDate) ? diffDays(me.endDate, today()) : null, t = today();
    const first = new Date(calY, calM, 1), days = new Date(calY, calM + 1, 0).getDate(), off = (first.getDay() + 1) % 7;
    const from = isDate(me.startDate) ? me.startDate : '0000-00-00';
    let cells = '<div></div>'.repeat(off), p = 0, a = 0;
    for (let d = 1; d <= days; d++) {
      const iso = `${calY}-${pad(calM + 1)}-${pad(d)}`; let cls = 'bg-neutral-900 text-neutral-600';
      if (att.has(iso)) { cls = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'; p++; }
      else if (iso >= from && iso < t && (!isDate(me.endDate) || iso <= me.endDate)) { cls = 'bg-rose-500/20 text-rose-300 border border-rose-500/40'; a++; }
      if (iso === t) cls += ' ring-2 ring-white';
      cells += `<div class="h-9 rounded-lg flex items-center justify-center text-xs ${cls}">${d}</div>`;
    }
    const invites = me.invites || [], offers = (me.offers || []).filter(o => o.expires >= t);
    const pendingCi = checkins.find(c => c.date === t && c.status === 'pending');
    const checkinCard = att.has(t)
      ? `<div class="${CARD} border-emerald-500/30 text-center"><i class="fa-solid fa-circle-check text-3xl text-emerald-400"></i><p class="font-black mt-2">تم تسجيل حضورك النهاردة ✔</p></div>`
      : pendingCi
        ? `<div class="${CARD} border-amber-500/30 text-center space-y-2"><p class="text-xs text-neutral-400">قول الكود ده للريسيبشن</p>
            <div class="text-5xl font-black tracking-[0.3em] text-amber-400 font-mono" dir="ltr">${esc(pendingCi.code)}</div>
            <p class="text-[11px] text-neutral-500">صالح النهاردة بس — بينتظر تأكيد الريسيبشن</p></div>`
        : (s === 'expired' || s === 'frozen')
          ? `<div class="${CARD} text-center text-xs text-rose-400">${s === 'expired' ? 'اشتراكك منتهي، جدّد الأول عشان تسجل حضور' : 'اشتراكك موقوف مؤقتاً'}</div>`
          : `<button onclick="MB.checkin()" class="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-black text-lg py-4 rounded-2xl"><i class="fa-solid fa-hand ml-2"></i>حضور اليوم</button>`;
    return `${checkinCard}<div class="${CARD} space-y-3"><div class="flex justify-between items-start"><div><p class="text-xs text-neutral-500">خطة الاشتراك</p><h2 class="text-xl font-black">${esc(me.planName || '-')}</h2></div>
        <span class="text-xs font-bold ${ST[s][1]}">${ST[s][0]}</span></div>
      <div class="grid grid-cols-3 gap-2 text-center"><div class="bg-neutral-900 rounded-xl p-2.5"><p class="text-[10px] text-neutral-500">يبدأ</p><p class="text-xs font-bold mt-1">${dmy(me.startDate)}</p></div>
        <div class="bg-neutral-900 rounded-xl p-2.5"><p class="text-[10px] text-neutral-500">ينتهي</p><p class="text-xs font-bold mt-1">${dmy(me.endDate)}</p></div>
        <div class="bg-neutral-900 rounded-xl p-2.5"><p class="text-[10px] text-neutral-500">المتبقي</p><p class="text-xs font-bold mt-1 ${left !== null && left < 0 ? 'text-rose-400' : 'text-emerald-400'}">${left === null ? '-' : left < 0 ? 'منتهي' : left + ' يوم'}</p></div></div>
      ${me.due > 0 ? `<div class="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs flex justify-between"><span class="text-rose-300">مبلغ متبقي عليك</span><b class="text-rose-400">${money(me.due)}</b></div>` : ''}</div>
    <div class="${CARD}"><div class="flex items-center justify-between mb-3"><button onclick="MB.cal(-1)" class="p-2 text-neutral-400"><i class="fa-solid fa-chevron-right"></i></button><b class="text-sm">${MONTHS[calM]} ${calY}</b><button onclick="MB.cal(1)" class="p-2 text-neutral-400"><i class="fa-solid fa-chevron-left"></i></button></div>
      <div class="grid grid-cols-7 gap-1.5 text-center text-[10px] text-neutral-500 mb-1.5">${['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'].map(x => `<div>${x}</div>`).join('')}</div>
      <div class="grid grid-cols-7 gap-1.5">${cells}</div>
      <div class="flex justify-between text-[11px] mt-3"><span class="text-emerald-400">● حضور: ${p} يوم</span><span class="text-rose-400">● غياب: ${a} يوم</span></div></div>
    ${offers.length ? `<div class="${CARD} space-y-2"><h3 class="text-sm font-bold">عروضك الخاصة 🎁</h3>${offers.map(o => `<div class="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs flex justify-between"><b>${esc(o.title)}</b><span class="text-amber-400">${o.value}${o.type === 'percent' ? '%' : ' ج.م'} · حتى ${dmy(o.expires)}</span></div>`).join('')}</div>` : ''}
    <div class="${CARD} space-y-2"><h3 class="text-sm font-bold">دعواتك لأصدقائك 🎟️</h3>${invites.map(v => `<div class="flex justify-between items-center bg-neutral-900 rounded-xl px-3 py-2.5 text-xs"><span><b>${esc(v.name)}</b></span><span class="${v.used ? 'text-emerald-400' : 'text-amber-400'}">${v.used ? 'تم استهلاكها ✔' : 'متاحة'}</span></div>`).join('') || '<p class="text-xs text-neutral-500">مفيش دعوات حالياً.</p>'}</div>`;
  }
  function cal(n) { calM += n; if (calM > 11) { calM = 0; calY++; } if (calM < 0) { calM = 11; calY--; } render(); }

  /* ----- المتجر ----- */
  function viewStore() {
    const list = products.filter(p => p.qty > 0 && (catF === 'all' || p.categoryId === catF));
    const lines = Object.entries(cart).map(([id, q]) => ({ p: products.find(x => x.id === id), q })).filter(l => l.p);
    const total = lines.reduce((a, l) => a + l.p.price * l.q, 0);
    return `<div class="flex gap-2 overflow-x-auto pb-1">${[['all', 'الكل'], ...cats.map(c => [c.id, c.name])].map(([k, l]) => `<button onclick="MB.cat('${k}')" class="px-4 py-2 rounded-xl text-xs whitespace-nowrap ${catF === k ? 'bg-emerald-500 text-black font-bold' : 'bg-neutral-900 text-neutral-300'}">${esc(l)}</button>`).join('')}</div>
      <div class="grid grid-cols-2 gap-3">${list.map(p => `<div class="${CARD} flex flex-col gap-2"><div class="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center"><i class="fa-solid fa-box-open"></i></div>
        <p class="text-sm font-bold leading-snug">${esc(p.name)}</p><div class="flex items-center justify-between mt-auto"><b class="text-emerald-400">${money(p.price)}</b>
        <button onclick="MB.add('${p.id}')" class="bg-emerald-500 text-black w-8 h-8 rounded-lg font-black">+</button></div></div>`).join('') || '<p class="text-sm text-neutral-500 col-span-2 text-center py-10">لا توجد منتجات.</p>'}</div>
      ${lines.length ? `<div class="${CARD} space-y-3 sticky bottom-20"><h3 class="font-bold text-sm">سلتك</h3>${lines.map(l => `<div class="flex items-center justify-between text-xs"><span>${esc(l.p.name)}</span>
        <span class="flex items-center gap-2"><button onclick="MB.step('${l.p.id}',-1)" class="w-7 h-7 bg-neutral-800 rounded-lg">−</button><b>${l.q}</b><button onclick="MB.step('${l.p.id}',1)" class="w-7 h-7 bg-neutral-800 rounded-lg">+</button><span class="w-20 text-left text-emerald-400">${money(l.p.price * l.q)}</span></span></div>`).join('')}
        <div class="flex justify-between font-black"><span>الإجمالي</span><span class="text-emerald-400">${money(total)}</span></div>
        <button onclick="MB.order()" class="w-full bg-emerald-500 text-black font-black py-3 rounded-xl">إرسال الطلب</button>
        <p class="text-[10px] text-neutral-500 text-center">الطلب بيفضل معلق لحد ما تيجي الجيم، تدفع وتستلم، والإدارة تأكده.</p></div>` : ''}`;
  }
  const cat = k => { catF = k; render(); };
  function add(id) { const p = products.find(x => x.id === id); if (!p) return; if ((cart[id] || 0) >= p.qty) return toast(`المتاح ${p.qty} فقط`, false); cart[id] = (cart[id] || 0) + 1; render(); }
  function step(id, d) { const p = products.find(x => x.id === id); cart[id] = (cart[id] || 0) + d; if (cart[id] <= 0) delete cart[id]; else if (p && cart[id] > p.qty) { cart[id] = p.qty; toast(`المتاح ${p.qty} فقط`, false); } render(); }
  async function order() {
    const lines = Object.entries(cart).map(([id, q]) => ({ p: products.find(x => x.id === id), q })).filter(l => l.p && l.q > 0);
    if (!lines.length) return toast('السلة فاضية', false);
    if (orders.filter(o => o.status === 'pending').length >= 5) return toast('عندك 5 طلبات معلقة، استنى الإدارة تعالجها', false);
    if (lines.some(l => l.q > l.p.qty)) return toast('كمية غير متاحة', false);
    try {
      await window.addDoc(window.collection(window.db, 'orders'), {
        memberId: me.id, memberName: me.name, phone: me.phone || '', status: 'pending',
        items: lines.map(l => ({ productId: l.p.id, name: l.p.name, price: l.p.price, qty: l.q })),
        total: lines.reduce((a, l) => a + l.p.price * l.q, 0), createdAt: window.serverTimestamp()
      });
      cart = {}; toast('تم إرسال الطلب — بانتظار تأكيد الجيم ✔'); go('orders');
    } catch (e) { console.error(e); toast('تعذر إرسال الطلب', false); }
  }

  /* ----- طلباتي ----- */
  const OS = { pending: ['معلق — بانتظار التأكيد', 'text-amber-400'], completed: ['تم التسليم', 'text-emerald-400'], rejected: ['مرفوض', 'text-rose-400'], cancelled: ['ملغي', 'text-neutral-500'] };
  function viewOrders() {
    return orders.map(o => `<div class="${CARD} space-y-2"><div class="flex justify-between text-xs"><b>ORD-${o.id.slice(0, 6).toUpperCase()}</b><span class="${OS[o.status]?.[1]}">${OS[o.status]?.[0] || o.status}</span></div>
      <p class="text-[11px] text-neutral-500">${when(o.ts)}</p>
      ${(o.items || []).map(i => `<div class="flex justify-between text-xs bg-neutral-900 rounded-lg px-3 py-2"><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}
      <div class="flex justify-between font-bold text-sm"><span>الإجمالي</span><span class="text-emerald-400">${money(o.total)}</span></div>
      ${o.status === 'rejected' && o.reason ? `<p class="text-xs text-rose-400">السبب: ${esc(o.reason)}</p>` : ''}
      ${o.status === 'pending' ? `<button onclick="MB.cancel('${o.id}')" class="text-xs text-rose-400 border border-rose-500/30 rounded-lg px-3 py-1.5">إلغاء الطلب</button>` : ''}</div>`).join('') || '<p class="text-sm text-neutral-500 text-center py-16">لا توجد طلبات.</p>';
  }
  async function cancel(id) {
    const o = orders.find(x => x.id === id); if (!o || o.status !== 'pending' || !confirm('إلغاء الطلب؟')) return;
    try { await window.updateDoc(window.doc(window.db, 'orders', id), { status: 'cancelled' }); } catch (e) { toast('تعذر الإلغاء', false); }
  }

  /* ----- التمارين ----- */
  function viewWorkout() {
    const w = workoutState(me.workout);
    if (!w) return '<p class="text-sm text-neutral-500 text-center py-16">لسه مفيش جدول تمارين. كلّم المدرب.</p>';
    const d = w.days[w.todayIdx], next = w.days[w.nextIdx];
    return `<div class="${CARD} space-y-3 border-emerald-500/30"><div class="flex justify-between items-center"><div><p class="text-xs text-neutral-500">${w.doneToday ? 'تمرين النهاردة (خلصته ✔)' : 'تمرين النهاردة'}</p><h2 class="text-2xl font-black text-emerald-400">${esc(d.name)}</h2></div><i class="fa-solid fa-dumbbell text-3xl text-emerald-500/40"></i></div>
      ${w.missed > 0 && !w.doneToday ? `<p class="text-[11px] bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded-lg px-3 py-2">غبت ${w.missed} يوم — الجدول اتأجل ومكملش، النهاردة تكمّل من ${esc(d.name)} ✅</p>` : ''}
      <div class="space-y-1.5">${(d.exercises || []).map((e, i) => `<div class="flex justify-between bg-neutral-900 rounded-xl px-3 py-2.5 text-sm"><span>${i + 1}. ${esc(e.name)}</span><b class="text-emerald-400 text-xs">${esc(e.detail || '')}</b></div>`).join('')}</div>
      ${w.doneToday ? `<p class="text-xs text-neutral-400">التمرين الجاي: <b class="text-white">${esc(next.name)}</b></p>` : ''}</div>
    <div class="${CARD} space-y-2"><h3 class="text-sm font-bold">دورة الجدول</h3><div class="flex flex-wrap gap-2">${w.days.map((x, i) => `<span class="px-3 py-1.5 rounded-lg text-xs border ${i === w.todayIdx ? 'bg-emerald-500 text-black border-emerald-500 font-bold' : 'border-neutral-800 text-neutral-400'}">${i + 1}. ${esc(x.name)}</span>`).join('')}</div>
      <p class="text-[11px] text-neutral-500">الجدول بيتحرك مع حضورك بس: لو غبت، التمرين بيتأجل لحد ما تحضر. حضرت ${w.done} مرة من بداية الدورة.</p></div>`;
  }

  /* ----- التغذية ----- */
  function viewDiet() {
    const d = me.diet; if (!d || !(d.meals || []).length) return '<p class="text-sm text-neutral-500 text-center py-16">لسه مفيش نظام غذائي. كلّم المدرب.</p>';
    return `${d.calories ? `<div class="${CARD} flex justify-between items-center"><span class="text-sm text-neutral-400">السعرات اليومية</span><b class="text-2xl font-black text-amber-400">${esc(d.calories)}</b></div>` : ''}
      ${d.meals.map(m => `<div class="${CARD}"><div class="flex justify-between"><b>${esc(m.name)}</b><span class="text-xs text-amber-400">${esc(m.time)}</span></div>${m.desc ? `<p class="text-sm text-neutral-300 mt-2">${esc(m.desc)}</p>` : ''}</div>`).join('')}
      ${d.notes ? `<div class="${CARD} text-sm text-neutral-300"><p class="text-xs text-neutral-500 mb-1">ملاحظات</p>${esc(d.notes)}</div>` : ''}`;
  }

  /* ----- الإشعارات ----- */
  const ICON = { offer: 'fa-gift text-amber-400', plan: 'fa-tags text-emerald-400', product: 'fa-cart-shopping text-sky-400', news: 'fa-bullhorn text-indigo-400', reminder: 'fa-heart text-rose-400', invite: 'fa-ticket text-amber-400', order: 'fa-bag-shopping text-emerald-400' };
  function viewNotif() {
    return notifs.map(n => `<div class="${CARD} flex gap-3"><i class="fa-solid ${ICON[n.type] || 'fa-bell text-neutral-400'} text-lg pt-1"></i><div><b class="text-sm">${esc(n.title)}</b><p class="text-xs text-neutral-300 mt-1">${esc(n.body)}</p><p class="text-[10px] text-neutral-600 mt-1">${when(n.ts)}</p></div></div>`).join('') || '<p class="text-sm text-neutral-500 text-center py-16">لا إشعارات.</p>';
  }

  async function checkin() {
    const t = today();
    if (att.has(t)) return toast('حضورك متسجل النهاردة', false);
    if (checkins.some(c => c.date === t && c.status === 'pending')) return;
    const code = String(Math.floor(1000 + Math.random() * 9000));
    try {
      await window.addDoc(window.collection(window.db, 'checkins'), {
        memberId: me.id, name: me.name, phone: me.phone || '', code, date: t, status: 'pending', createdAt: window.serverTimestamp()
      });
    } catch (e) { console.error(e); toast('تعذر إنشاء الكود', false); }
  }

  window.MB = { checkin, login, logout, go, cal, cat, add, step, order, cancel };
})();