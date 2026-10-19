/* =====================================================================
   invoices.js — الإعدادات ← المنتجات ← تاب "الفواتير" (جيم الفرسان)
   - بيعرض كل فاتورة اتعملت من المتجر (collection: sales) بتفاصيلها
   - بحث + فلتر بالتاريخ + فلتر بالحالة + ملخص (مبيعات / مرتجعات / صافي)
   - مرتجع كامل أو جزئي من داخل الفاتورة:
       * بيرجّع الكمية للمخزون (products.qty)
       * بيحدّث الفاتورة (returnedQty لكل صنف + returnedTotal + status + returns[])
       * كله في Transaction واحدة عشان ما يحصلش تكرار أو تضارب
   حطه بعد باقي الملفات:
     <script src="/invoices.js"></script>
   ===================================================================== */
(function () {
  'use strict';

  const COL_P = 'products', COL_S = 'sales';

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

  let sales = [], busy = false, openId = null, returnMode = false;

  const STATUS = {
    paid: { label: 'مكتملة', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    partial: { label: 'مرتجع جزئي', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    returned: { label: 'مرتجع كامل', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/20' }
  };

  const invNo = s => 'INV-' + s.id.slice(0, 6).toUpperCase();
  const timeOf = s => s.createdAt ? new Date(s.createdAt * 1000).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '';
  const statusOf = s => {
    if (!s.items.length) return 'paid';
    if (s.items.every(i => i.returnedQty >= i.qty)) return 'returned';
    return s.returnedTotal > 0 || s.items.some(i => i.returnedQty > 0) ? 'partial' : 'paid';
  };

  /* ---------- boot ---------- */
  function waitForDb(cb) {
    if (window.db && window.onSnapshot) return cb();
    setTimeout(() => waitForDb(cb), 100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildLayout();
    buildModal();
    renderAll();
    waitForDb(() => {
      window.onSnapshot(window.collection(window.db, COL_S), snap => {
        sales = snap.docs.map(d => {
          const x = d.data();
          return {
            id: d.id,
            items: (x.items || []).map(i => ({
              productId: i.productId || '', name: i.name || '—', price: Number(i.price || 0),
              buyPrice: Number(i.buyPrice || 0), qty: Number(i.qty || 0), returnedQty: Number(i.returnedQty || 0)
            })),
            total: Number(x.total || 0), returnedTotal: Number(x.returnedTotal || 0),
            buyerName: x.buyerName || 'عميل نقدي', buyerPhone: x.buyerPhone || '', memberId: x.memberId || '',
            date: x.date || '', createdAt: x.createdAt?.seconds || 0, returns: x.returns || []
          };
        }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || b.date.localeCompare(a.date));
        renderAll();
        if (openId) renderModal();
      }, e => { console.error(e); toast('تعذر تحميل الفواتير: ' + (e.code || e.message), false); });
    });
  });

  /* ---------- الهيكل ---------- */
  function buildLayout() {
    const host = $('inner-sub-content-2'); if (!host) return;
    host.innerHTML = `
      <div id="invStats" class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5"></div>
      <div class="p-4 rounded-2xl bg-neutral-900/40 border border-neutral-800/80 mb-5 flex flex-col lg:flex-row gap-3 lg:items-center">
        <div class="relative flex-1">
          <span class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400"><i class="fa-solid fa-search text-xs"></i></span>
          <input id="invSearch" oninput="renderInvoices()" placeholder="ابحث برقم الفاتورة أو اسم العميل أو الهاتف..." class="${IN} w-full pr-9 py-2.5">
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <input type="date" id="invFrom" onchange="renderInvoices()" class="${IN}" title="من تاريخ">
          <input type="date" id="invTo" onchange="renderInvoices()" class="${IN}" title="إلى تاريخ">
          <select id="invStatus" onchange="renderInvoices()" class="${IN}">
            <option value="">كل الحالات</option>
            <option value="paid">مكتملة</option>
            <option value="partial">مرتجع جزئي</option>
            <option value="returned">مرتجع كامل</option>
          </select>
          <button onclick="resetInvoiceFilters()" class="bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold px-3 py-2 rounded-xl transition">مسح</button>
        </div>
      </div>
      <div class="bg-gray-900/90 border border-gray-800 rounded-xl shadow-xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-right border-collapse">
            <thead><tr class="bg-gray-800/80 text-gray-300 text-xs uppercase tracking-wider border-b border-gray-700/60 whitespace-nowrap">
              <th class="py-3.5 px-4 font-semibold">رقم الفاتورة</th>
              <th class="py-3.5 px-4 font-semibold">التاريخ</th>
              <th class="py-3.5 px-4 font-semibold">العميل</th>
              <th class="py-3.5 px-4 font-semibold">الأصناف</th>
              <th class="py-3.5 px-4 font-semibold">الإجمالي</th>
              <th class="py-3.5 px-4 font-semibold">المرتجع</th>
              <th class="py-3.5 px-4 font-semibold">الحالة</th>
              <th class="py-3.5 px-4 font-semibold text-center">الإجراءات</th>
            </tr></thead>
            <tbody id="invTableBody" class="divide-y divide-gray-800 text-gray-200 text-sm"></tbody>
          </table>
        </div>
        <div id="invEmpty" class="hidden py-10 text-center text-gray-400"></div>
      </div>`;
  }

  function filtered() {
    const q = ($('invSearch')?.value || '').trim().toLowerCase();
    const from = $('invFrom')?.value || '', to = $('invTo')?.value || '', st = $('invStatus')?.value || '';
    return sales.filter(s => {
      if (from && s.date < from) return false;
      if (to && s.date > to) return false;
      if (st && statusOf(s) !== st) return false;
      return !q || [invNo(s), s.buyerName, s.buyerPhone].some(v => String(v).toLowerCase().includes(q));
    });
  }

  function renderAll() { renderStats(); renderInvoices(); }

  function renderStats() {
    const box = $('invStats'); if (!box) return;
    const list = filtered();
    const total = list.reduce((a, s) => a + s.total, 0), ret = list.reduce((a, s) => a + s.returnedTotal, 0);
    const card = (label, val, cls) => `<div class="bg-neutral-950 border border-neutral-800 rounded-xl p-4"><p class="text-xs text-neutral-400">${label}</p><h4 class="text-lg font-black mt-1 ${cls}">${val}</h4></div>`;
    box.innerHTML = card('عدد الفواتير', list.length, 'text-white')
      + card('إجمالي المبيعات', money(total), 'text-indigo-400')
      + card('إجمالي المرتجعات', money(ret), 'text-rose-400')
      + card('الصافي', money(total - ret), 'text-emerald-400');
  }

  function renderInvoices() {
    renderStats();
    const body = $('invTableBody'); if (!body) return;
    const list = filtered();
    body.innerHTML = list.map(s => {
      const st = STATUS[statusOf(s)];
      const count = s.items.reduce((a, i) => a + i.qty, 0);
      return `<tr class="hover:bg-white/5 transition whitespace-nowrap cursor-pointer" onclick="openInvoice('${s.id}')">
        <td class="py-3 px-4 font-mono text-xs text-indigo-300">${esc(invNo(s))}</td>
        <td class="py-3 px-4 text-xs text-neutral-300">${esc(s.date)} <span class="text-neutral-500">${esc(timeOf(s))}</span></td>
        <td class="py-3 px-4"><p class="font-bold text-white">${esc(s.buyerName)}</p>${s.buyerPhone ? `<p class="text-[11px] font-mono text-neutral-500">${esc(s.buyerPhone)}</p>` : ''}</td>
        <td class="py-3 px-4 text-xs text-neutral-300">${s.items.length} صنف · ${count} قطعة</td>
        <td class="py-3 px-4 text-amber-400 font-bold">${money(s.total)}</td>
        <td class="py-3 px-4 ${s.returnedTotal ? 'text-rose-400 font-bold' : 'text-neutral-600'}">${s.returnedTotal ? money(s.returnedTotal) : '—'}</td>
        <td class="py-3 px-4"><span class="px-2.5 py-1 rounded-full text-xs font-bold border ${st.cls}">${st.label}</span></td>
        <td class="py-3 px-4 text-center">
          <button onclick="event.stopPropagation();openInvoice('${s.id}')" class="text-sky-400 hover:text-sky-300 px-2 text-xs font-semibold"><i class="fa-solid fa-eye ml-1"></i>عرض</button>
          ${s.items.some(i => i.qty - i.returnedQty > 0) ? `<button onclick="event.stopPropagation();openInvoice('${s.id}', true)" class="text-rose-400 hover:text-rose-300 px-2 text-xs font-semibold"><i class="fa-solid fa-rotate-left ml-1"></i>مرتجع</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    const empty = $('invEmpty');
    if (empty) {
      empty.classList.toggle('hidden', list.length > 0);
      empty.textContent = sales.length ? 'لا توجد فواتير مطابقة للبحث.' : 'لا توجد فواتير بعد. أي عملية بيع من المتجر هتظهر هنا.';
    }
  }

  function resetInvoiceFilters() {
    ['invSearch', 'invFrom', 'invTo', 'invStatus'].forEach(id => { const e = $(id); if (e) e.value = ''; });
    renderInvoices();
  }

  /* ---------- مودال الفاتورة ---------- */
  function buildModal() {
    if ($('invoiceModal')) return;
    const m = document.createElement('div');
    m.id = 'invoiceModal';
    m.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
    m.addEventListener('click', e => { if (e.target === m) closeInvoice(); });
    document.body.appendChild(m);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !m.classList.contains('hidden')) closeInvoice(); });
  }

  function openInvoice(id, withReturn) { openId = id; returnMode = !!withReturn; renderModal(); $('invoiceModal').classList.remove('hidden'); }
  function closeInvoice() { openId = null; returnMode = false; $('invoiceModal').classList.add('hidden'); }
  function startReturn() { returnMode = true; renderModal(); }
  function cancelReturn() { returnMode = false; renderModal(); }

  function renderModal() {
    const s = sales.find(x => x.id === openId), m = $('invoiceModal');
    if (!s) return closeInvoice();
    const st = STATUS[statusOf(s)];
    const canReturn = s.items.some(i => i.qty - i.returnedQty > 0);
    if (!canReturn) returnMode = false;

    const rows = s.items.map((i, idx) => {
      const rem = i.qty - i.returnedQty;
      return `<tr class="whitespace-nowrap">
        <td class="py-2.5 px-3 font-bold text-white">${esc(i.name)}</td>
        <td class="py-2.5 px-3 text-neutral-300">${money(i.price)}</td>
        <td class="py-2.5 px-3 text-center">${i.qty}</td>
        <td class="py-2.5 px-3 text-center ${i.returnedQty ? 'text-rose-400 font-bold' : 'text-neutral-600'}">${i.returnedQty || '—'}</td>
        <td class="py-2.5 px-3 text-amber-400 font-bold">${money(i.price * i.qty)}</td>
        ${returnMode ? `<td class="py-2.5 px-3 text-center">${rem > 0
          ? `<input type="number" id="rq_${idx}" min="0" max="${rem}" step="1" value="0" data-max="${rem}" oninput="updateReturnSum()" class="${IN} w-16 text-center"> <span class="text-[10px] text-neutral-500">/ ${rem}</span>`
          : '<span class="text-[11px] text-neutral-600">تم إرجاعه</span>'}</td>` : ''}
      </tr>`;
    }).join('');

    const history = s.returns.length ? s.returns.slice().reverse().map(r => `
      <div class="bg-neutral-900 rounded-lg p-3 text-xs space-y-1">
        <div class="flex justify-between"><span class="text-neutral-300">${esc(r.date || '')}</span><span class="text-rose-400 font-bold">${money(r.amount)}</span></div>
        <p class="text-neutral-500">${(r.items || []).map(i => `${esc(i.name)} × ${i.qty}`).join('، ')}</p>
      </div>`).join('') : '<p class="text-xs text-neutral-500">لا توجد مرتجعات على هذه الفاتورة.</p>';

    m.innerHTML = `
      <div class="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-3xl shadow-2xl text-white overflow-hidden max-h-[92vh] flex flex-col">
        <div class="flex justify-between items-center p-5 border-b border-neutral-800">
          <div>
            <h3 class="text-lg font-bold flex items-center gap-2"><i class="fa-solid fa-receipt text-indigo-400"></i> فاتورة <span class="font-mono text-indigo-300">${esc(invNo(s))}</span>
              <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${st.cls}">${st.label}</span></h3>
            <p class="text-xs text-neutral-400 mt-1">${esc(s.date)} ${esc(timeOf(s))} · ${esc(s.buyerName)}${s.buyerPhone ? ' · ' + esc(s.buyerPhone) : ''}${s.memberId ? ' · <span class="text-emerald-400">مشترك</span>' : ''}</p>
          </div>
          <button onclick="closeInvoice()" class="text-neutral-400 hover:text-white p-2 rounded-xl hover:bg-neutral-800"><i class="fa-solid fa-xmark text-lg"></i></button>
        </div>
        <div class="p-5 space-y-5 overflow-y-auto">
          <div class="overflow-x-auto border border-neutral-800 rounded-xl">
            <table class="w-full text-right text-sm">
              <thead><tr class="bg-neutral-800/80 text-neutral-300 text-xs whitespace-nowrap">
                <th class="py-2.5 px-3">الصنف</th><th class="py-2.5 px-3">السعر</th><th class="py-2.5 px-3 text-center">المباع</th>
                <th class="py-2.5 px-3 text-center">المرتجع</th><th class="py-2.5 px-3">الإجمالي</th>${returnMode ? '<th class="py-2.5 px-3 text-center">كمية المرتجع</th>' : ''}
              </tr></thead>
              <tbody class="divide-y divide-neutral-800">${rows}</tbody>
            </table>
          </div>
          <div class="grid grid-cols-3 gap-3 text-center">
            <div class="bg-neutral-950 border border-neutral-800 rounded-xl p-3"><p class="text-[11px] text-neutral-400">إجمالي الفاتورة</p><p class="font-black text-amber-400 mt-1">${money(s.total)}</p></div>
            <div class="bg-neutral-950 border border-neutral-800 rounded-xl p-3"><p class="text-[11px] text-neutral-400">المرتجع</p><p class="font-black text-rose-400 mt-1">${money(s.returnedTotal)}</p></div>
            <div class="bg-neutral-950 border border-neutral-800 rounded-xl p-3"><p class="text-[11px] text-neutral-400">الصافي</p><p class="font-black text-emerald-400 mt-1">${money(s.total - s.returnedTotal)}</p></div>
          </div>
          <div><h4 class="text-xs font-bold text-neutral-300 mb-2">سجل المرتجعات</h4><div class="space-y-2">${history}</div></div>
        </div>
        <div class="flex items-center justify-between gap-2 p-4 border-t border-neutral-800 bg-neutral-900/90">
          <div class="text-xs text-neutral-400">${returnMode ? 'قيمة المرتجع: <b id="retSum" class="text-rose-400">0 ج.م</b>' : ''}</div>
          <div class="flex gap-2">
            ${returnMode ? `
            <button onclick="cancelReturn()" class="bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition">إلغاء المرتجع</button>
            <button onclick="fillReturnAll()" class="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 text-xs font-semibold px-4 py-2.5 rounded-xl transition">مرتجع الكل</button>
            <button onclick="submitReturn()" id="retBtn" class="bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2"><i class="fa-solid fa-check"></i> تأكيد المرتجع</button>` : `
            <button onclick="closeInvoice()" class="bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition">إغلاق</button>
            ${canReturn ? `<button onclick="startReturn()" class="bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2"><i class="fa-solid fa-rotate-left"></i> مرتجع</button>` : ''}`}
          </div>
        </div>
      </div>`;
  }

  function readPicks() {
    const s = sales.find(x => x.id === openId); if (!s) return [];
    const picks = [];
    s.items.forEach((i, idx) => {
      const el = $('rq_' + idx); if (!el) return;
      let q = Math.floor(Number(el.value || 0));
      const max = Number(el.dataset.max);
      if (!(q > 0)) return;
      if (q > max) q = max;
      picks.push({ idx, qty: q });
    });
    return picks;
  }

  function updateReturnSum() {
    const s = sales.find(x => x.id === openId); if (!s) return;
    const sum = readPicks().reduce((a, p) => a + s.items[p.idx].price * p.qty, 0);
    const el = $('retSum'); if (el) el.textContent = money(sum);
  }

  function fillReturnAll() {
    document.querySelectorAll('[id^="rq_"]').forEach(el => { el.value = el.dataset.max; });
    updateReturnSum();
  }

  async function submitReturn() {
    if (busy) return;
    const s = sales.find(x => x.id === openId); if (!s) return;
    const picks = readPicks();
    if (!picks.length) return toast('حدد كمية المرتجع لصنف واحد على الأقل', false);
    if (!window.db) return toast('جاري الاتصال بقاعدة البيانات...', false);
    const sum = picks.reduce((a, p) => a + s.items[p.idx].price * p.qty, 0);
    if (!confirm(`تأكيد مرتجع بقيمة ${money(sum)}؟\nهترجع الكميات للمخزون.`)) return;

    busy = true;
    const btn = $('retBtn'), prev = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التنفيذ...'; }

    try {
      const amount = await window.runTransaction(window.db, async tx => {
        const sref = window.doc(window.db, COL_S, s.id);
        const ssnap = await tx.get(sref);
        if (!ssnap.exists()) throw new Error('الفاتورة غير موجودة');
        const sd = ssnap.data();
        const items = (sd.items || []).map(i => ({ ...i, returnedQty: Number(i.returnedQty || 0) }));

        // كل القراءات قبل الكتابات
        const ids = [...new Set(picks.map(p => items[p.idx]?.productId).filter(Boolean))];
        const psnaps = {};
        for (const id of ids) psnaps[id] = await tx.get(window.doc(window.db, COL_P, id));

        let amt = 0; const ret = [], add = {};
        picks.forEach(p => {
          const it = items[p.idx];
          if (!it) throw new Error('صنف غير موجود في الفاتورة');
          const rem = Number(it.qty) - it.returnedQty;
          if (p.qty <= 0 || p.qty > rem) throw new Error(`المتبقي للإرجاع من "${it.name}" هو ${rem} فقط`);
          it.returnedQty += p.qty;
          amt += Number(it.price) * p.qty;
          ret.push({ productId: it.productId || '', name: it.name, price: Number(it.price), qty: p.qty });
          if (it.productId) add[it.productId] = (add[it.productId] || 0) + p.qty;
        });

        // رجّع المخزون (لو المنتج لسه موجود)
        Object.keys(add).forEach(pid => {
          const snap = psnaps[pid];
          if (snap && snap.exists()) {
            const x = snap.data();
            tx.update(snap.ref, { qty: Number(x.qty ?? x.quantity ?? 0) + add[pid] });
          }
        });

        const returnedTotal = Number(sd.returnedTotal || 0) + amt;
        const all = items.every(i => i.returnedQty >= Number(i.qty));
        tx.update(sref, {
          items, returnedTotal, status: all ? 'returned' : 'partial',
          returns: [...(sd.returns || []), { date: todayISO(), amount: amt, items: ret, at: Date.now() }]
        });
        // خصم قيمة المرتجع من الخزينة (في نفس الـ Transaction)
        tx.set(window.doc(window.collection(window.db, 'treasury')), {
          type: 'out', source: 'return', amount: amt, date: todayISO(),
          party: sd.buyerName || '', note: 'مرتجع فاتورة ' + invNo(s), ref: s.id, createdAt: window.serverTimestamp()
        });
        return amt;
      });
      returnMode = false;
      if (openId) renderModal();
      toast(`تم المرتجع ✔ ${money(amount)}`);
    } catch (e) {
      console.error(e); toast('فشل المرتجع: ' + (e.message || e.code), false);
    }
    busy = false;
    if (btn && $('retBtn')) { btn.disabled = false; btn.innerHTML = prev; }
  }

  window.renderInvoices = renderInvoices;
  window.resetInvoiceFilters = resetInvoiceFilters;
  window.openInvoice = openInvoice;
  window.closeInvoice = closeInvoice;
  window.startReturn = startReturn;
  window.cancelReturn = cancelReturn;
  window.updateReturnSum = updateReturnSum;
  window.fillReturnAll = fillReturnAll;
  window.submitReturn = submitReturn;
})();