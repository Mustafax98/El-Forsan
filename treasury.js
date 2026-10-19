/* =====================================================================
   treasury.js — الإعدادات ← الخزينه (جيم الفرسان)
   سجل حركات (Ledger) في collection اسمها "treasury":
     { type:'in'|'out', source:'subscription'|'store'|'return'|'manual',
       amount, date:'YYYY-MM-DD', party, note, ref, createdAt }
   - الوارد: اشتراكات + متجر (+ إيداع يدوي)
   - المنصرف: مرتجعات (+ مصروف يدوي)
   - رصيد الخزينة = إجمالي الوارد - إجمالي المنصرف
   الملفات التانية بتسجل الحركات عن طريق:
     window.addTreasury({ type, source, amount, party, note, ref })
   حطه بعد باقي الملفات:
     <script src="/treasury.js"></script>
   ===================================================================== */
(function () {
  'use strict';

  const COL = 'treasury';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Number(n || 0).toLocaleString('en-US') + ' ج.م';
  const pad = n => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const toast = (msg, ok = true) => {
    const t = document.createElement('div');
    t.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] px-5 py-3 rounded-xl text-sm font-bold shadow-2xl ${ok ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'}`;
    t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
  };

  const IN = 'bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-white text-xs placeholder-neutral-600 focus:outline-none focus:border-indigo-500 transition';

  const SRC = {
    subscription: { t: 'اشتراك', c: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    store: { t: 'متجر', c: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20' },
    return: { t: 'مرتجع', c: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
    manual: { t: 'يدوي', c: 'bg-amber-500/10 text-amber-400 border-amber-500/20' }
  };

  let entries = [], balances = {}, formOpen = false, busy = false;

  /* ---------- API للملفات التانية ---------- */
  window.addTreasury = async function (e) {
    try {
      if (!window.db) return;
      const amount = Number(e.amount || 0);
      if (!(amount > 0)) return;
      await window.addDoc(window.collection(window.db, COL), {
        type: e.type === 'out' ? 'out' : 'in', source: e.source || 'manual', amount,
        date: todayISO(), party: e.party || '', note: e.note || '', ref: e.ref || '', key: e.key || '',
        createdAt: window.serverTimestamp()
      });
    } catch (err) {
      console.error(err);
      toast('تعذر تسجيل العملية في الخزينة: ' + (err.code || err.message), false);
    }
  };

  /* ---------- boot ---------- */
  function waitForDb(cb) {
    if (window.db && window.onSnapshot) return cb();
    setTimeout(() => waitForDb(cb), 100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildLayout();
    renderAll();
    waitForDb(() => {
      window.onSnapshot(window.collection(window.db, COL), snap => {
        entries = snap.docs.map(d => {
          const x = d.data();
          const ts = x.createdAt?.seconds ?? Math.floor(Date.now() / 1000);
          return {
            id: d.id, type: x.type === 'out' ? 'out' : 'in', source: x.source || 'manual',
            amount: Number(x.amount || 0), date: x.date || '', party: x.party || '', note: x.note || '', ref: x.ref || '', key: x.key || '', ts
          };
        }).sort((a, b) => a.ts - b.ts);
        // الرصيد بعد كل حركة
        balances = {}; let bal = 0;
        entries.forEach(e => { bal += e.type === 'in' ? e.amount : -e.amount; balances[e.id] = bal; });
        renderAll();
      }, e => { console.error(e); toast('تعذر تحميل الخزينة: ' + (e.code || e.message), false); });

      /* تسجيل الاشتراكات تلقائياً: أي مشترك جديد أو تجديد بعد تحميل الصفحة بيتسجل في الخزينة */
      let seen = null; // memberId -> عدد التجديدات المعروفة
      const isDup = (key, ref, amount) => {
        const now = Date.now() / 1000;
        return entries.some(e => (key && e.key === key) ||
          (e.source === 'subscription' && e.ref === ref && e.amount === amount && Math.abs(now - e.ts) < 120));
      };
      window.onSnapshot(window.collection(window.db, 'subscribers'), snap => {
        const first = seen === null;
        if (first) seen = new Map();
        snap.docChanges().forEach(ch => {
          const id = ch.doc.id, x = ch.doc.data(), rn = Array.isArray(x.renewals) ? x.renewals : [];
          if (ch.type === 'removed') { seen.delete(id); return; }
          const pay = Array.isArray(x.payments) ? x.payments : [];
          const prev = seen.get(id);
          seen.set(id, { rn: rn.length, pay: pay.length });
          if (first) return;
          let fresh = [];
          if (ch.type === 'added') fresh = rn.map(r => ({ r })).concat(pay.map(p => ({ p })));
          else if (prev !== undefined) fresh = rn.slice(prev.rn).map(r => ({ r })).concat(pay.slice(prev.pay).map(p => ({ p })));
          fresh.forEach(({ r, p }) => {
            // سداد متبقي على اشتراك سابق
            if (p) {
              const a = Number(p.amount || 0); if (!(a > 0)) return;
              const k = `${id}|pay|${p.date || ''}|${a}|${pay.indexOf(p)}`;
              if (isDup(k, id, a)) return;
              window.addTreasury({ type: 'in', source: 'subscription', amount: a, party: x.name || '', note: 'سداد متبقي اشتراك', ref: id, key: k });
              return;
            }
            // اشتراك جديد / تجديد: المدفوع فعلياً بس (القديم من غير paid بيتحسب بالسعر كامل)
            const amount = Number(r.paid ?? r.price ?? 0);
            if (!(amount > 0)) return;
            const key = `${id}|${r.date || ''}|${r.from || ''}|${r.to || ''}`;
            if (isDup(key, id, amount)) return;
            window.addTreasury({
              type: 'in', source: 'subscription', amount, party: x.name || '',
              note: (ch.type === 'added' ? 'اشتراك جديد ' : 'تجديد ') + (r.planName || ''), ref: id, key
            });
          });
        });
      }, e => console.error(e));
    });
  });

  /* ---------- الهيكل ---------- */
  function buildLayout() {
    const host = $('sub-4-content-4'); if (!host) return;
    host.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div><h2 class="text-2xl font-bold text-white flex items-center gap-2"><i class="fa-solid fa-vault text-emerald-400"></i> الخزينة</h2>
          <p class="text-sm text-neutral-400 mt-1">كل جنيه داخل من الاشتراكات والمتجر، وأي مرتجع بيتخصم تلقائياً.</p></div>
        <button onclick="toggleTreasuryForm()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm px-5 py-2.5 rounded-xl transition flex items-center gap-2 shrink-0">
          <i class="fa-solid fa-plus"></i> حركة يدوية</button>
      </div>

      <div id="trForm" class="hidden p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800 mb-5">
        <div class="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <select id="trType" class="${IN}"><option value="in">إيداع (وارد)</option><option value="out">سحب / مصروف (منصرف)</option></select>
          <input id="trAmount" type="number" min="0" step="any" placeholder="المبلغ (ج.م)" class="${IN}">
          <input id="trNote" placeholder="البيان (مثال: إيجار، كهرباء، شراء معدات...)" class="${IN} sm:col-span-2">
          <button onclick="saveTreasuryManual()" id="trSaveBtn" class="bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs px-4 py-2 rounded-xl transition">حفظ الحركة</button>
        </div>
      </div>

      <div id="trStats" class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5"></div>

      <div class="p-4 rounded-2xl bg-neutral-900/40 border border-neutral-800/80 mb-5 flex flex-col lg:flex-row gap-3 lg:items-center">
        <div class="relative flex-1">
          <span class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400"><i class="fa-solid fa-search text-xs"></i></span>
          <input id="trSearch" oninput="renderTreasury()" placeholder="ابحث بالبيان أو الاسم..." class="${IN} w-full pr-9 py-2.5">
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <input type="date" id="trFrom" onchange="renderTreasury()" class="${IN}" title="من تاريخ">
          <input type="date" id="trTo" onchange="renderTreasury()" class="${IN}" title="إلى تاريخ">
          <select id="trSource" onchange="renderTreasury()" class="${IN}">
            <option value="">كل المصادر</option>
            <option value="subscription">اشتراكات</option>
            <option value="store">متجر</option>
            <option value="return">مرتجعات</option>
            <option value="manual">يدوي</option>
          </select>
          <button onclick="resetTreasuryFilters()" class="bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold px-3 py-2 rounded-xl transition">مسح</button>
        </div>
      </div>

      <div class="bg-gray-900/90 border border-gray-800 rounded-xl shadow-xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-right border-collapse">
            <thead><tr class="bg-gray-800/80 text-gray-300 text-xs uppercase tracking-wider border-b border-gray-700/60 whitespace-nowrap">
              <th class="py-3.5 px-4 font-semibold">التاريخ</th>
              <th class="py-3.5 px-4 font-semibold">المصدر</th>
              <th class="py-3.5 px-4 font-semibold">البيان</th>
              <th class="py-3.5 px-4 font-semibold">العميل</th>
              <th class="py-3.5 px-4 font-semibold">وارد</th>
              <th class="py-3.5 px-4 font-semibold">منصرف</th>
              <th class="py-3.5 px-4 font-semibold">الرصيد بعد الحركة</th>
            </tr></thead>
            <tbody id="trBody" class="divide-y divide-gray-800 text-gray-200 text-sm"></tbody>
          </table>
        </div>
        <div id="trEmpty" class="hidden py-10 text-center text-gray-400"></div>
      </div>`;
  }

  function filtered() {
    const q = ($('trSearch')?.value || '').trim().toLowerCase();
    const from = $('trFrom')?.value || '', to = $('trTo')?.value || '', src = $('trSource')?.value || '';
    return entries.filter(e => {
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      if (src && e.source !== src) return false;
      return !q || [e.note, e.party].some(v => String(v).toLowerCase().includes(q));
    }).reverse(); // الأحدث الأول
  }

  function renderAll() { renderTreasury(); }

  function renderTreasury() {
    const body = $('trBody'); if (!body) return;
    const list = filtered();

    // الكروت
    const sum = (src, type) => list.filter(e => (!src || e.source === src) && (!type || e.type === type)).reduce((a, e) => a + e.amount, 0);
    const balance = entries.reduce((a, e) => a + (e.type === 'in' ? e.amount : -e.amount), 0);
    const inAll = sum(null, 'in'), outAll = sum(null, 'out');
    const card = (label, val, cls, sub = '') => `<div class="bg-neutral-950 border border-neutral-800 rounded-xl p-4"><p class="text-xs text-neutral-400">${label}</p><h4 class="text-lg font-black mt-1 ${cls}">${val}</h4>${sub ? `<span class="text-[10px] text-neutral-500">${sub}</span>` : ''}</div>`;
    $('trStats').innerHTML =
      card('رصيد الخزينة الحالي', money(balance), balance >= 0 ? 'text-emerald-400' : 'text-rose-400', 'إجمالي كل الفترات')
      + card('وارد الاشتراكات', money(sum('subscription', 'in')), 'text-emerald-400', 'في الفترة المحددة')
      + card('وارد المتجر', money(sum('store', 'in')), 'text-indigo-300', 'في الفترة المحددة')
      + card('المرتجعات', money(sum('return', 'out')), 'text-rose-400', 'اتخصمت من الخزينة')
      + card('صافي الفترة', money(inAll - outAll), inAll - outAll >= 0 ? 'text-amber-400' : 'text-rose-400', `وارد ${money(inAll)} · منصرف ${money(outAll)}`);

    body.innerHTML = list.map(e => {
      const s = SRC[e.source] || SRC.manual, isIn = e.type === 'in', bal = balances[e.id] ?? 0;
      // الاسم بيفتح ملف المشترك (للاشتراكات) أو الفاتورة (للمتجر والمرتجعات)
      const open = !e.ref ? '' : e.source === 'subscription' ? `SB.open('${e.ref}')` : (e.source === 'store' || e.source === 'return') ? `window.openInvoice&&openInvoice('${e.ref}')` : '';
      const who = !e.party ? '<span class="text-neutral-600">—</span>'
        : open ? `<button onclick="${open}" class="font-bold text-sky-300 hover:text-sky-200 hover:underline">${esc(e.party)}</button>`
          : `<span class="font-bold text-white">${esc(e.party)}</span>`;
      const time = new Date(e.ts * 1000).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      return `<tr class="hover:bg-white/5 transition whitespace-nowrap">
        <td class="py-3 px-4 text-xs text-neutral-300">${esc(e.date)} <span class="text-neutral-500">${esc(time)}</span></td>
        <td class="py-3 px-4"><span class="px-2.5 py-1 rounded-full text-xs font-bold border ${s.c}">${s.t}</span></td>
        <td class="py-3 px-4 max-w-[260px] truncate text-white">${esc(e.note || '—')}</td>
        <td class="py-3 px-4">${who}</td>
        <td class="py-3 px-4 ${isIn ? 'text-emerald-400 font-bold' : 'text-neutral-700'}">${isIn ? '+ ' + money(e.amount) : '—'}</td>
        <td class="py-3 px-4 ${!isIn ? 'text-rose-400 font-bold' : 'text-neutral-700'}">${!isIn ? '− ' + money(e.amount) : '—'}</td>
        <td class="py-3 px-4 font-bold ${bal >= 0 ? 'text-white' : 'text-rose-400'}">${money(bal)}</td>
      </tr>`;
    }).join('');

    const empty = $('trEmpty');
    empty.classList.toggle('hidden', list.length > 0);
    empty.textContent = entries.length ? 'لا توجد حركات مطابقة للبحث.' : 'لا توجد حركات بعد. أي اشتراك أو بيع من المتجر هيتسجل هنا تلقائياً.';
  }

  function resetTreasuryFilters() {
    ['trSearch', 'trFrom', 'trTo', 'trSource'].forEach(id => { const e = $(id); if (e) e.value = ''; });
    renderTreasury();
  }

  function toggleTreasuryForm() {
    formOpen = !formOpen;
    $('trForm').classList.toggle('hidden', !formOpen);
    if (formOpen) $('trAmount').focus();
  }

  async function saveTreasuryManual() {
    if (busy) return;
    const amount = Number($('trAmount').value), note = $('trNote').value.trim(), type = $('trType').value;
    if (!(amount > 0)) { $('trAmount').focus(); return toast('اكتب مبلغ صحيح', false); }
    if (!note) { $('trNote').focus(); return toast('اكتب البيان', false); }
    if (!window.db) return toast('جاري الاتصال بقاعدة البيانات...', false);
    if (type === 'out') {
      const bal = entries.reduce((a, e) => a + (e.type === 'in' ? e.amount : -e.amount), 0);
      if (amount > bal && !confirm(`المبلغ أكبر من رصيد الخزينة (${money(bal)}). تكمل؟`)) return;
    }
    busy = true; $('trSaveBtn').disabled = true;
    await window.addTreasury({ type, source: 'manual', amount, note });
    $('trAmount').value = ''; $('trNote').value = '';
    busy = false; $('trSaveBtn').disabled = false;
    toast('تم تسجيل الحركة ✔');
  }

  window.renderTreasury = renderTreasury;
  window.resetTreasuryFilters = resetTreasuryFilters;
  window.toggleTreasuryForm = toggleTreasuryForm;
  window.saveTreasuryManual = saveTreasuryManual;
})();