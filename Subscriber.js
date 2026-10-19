/* =====================================================================
   Subscriber.js — تبويب المشتركين (جيم الفرسان)
   استبدل بيه الملف القديم. مفيش تعديل مطلوب في الـ HTML.
   Collections المتوقعة في Firestore:
     subscribers : بيانات المشتركين (+ due = المتبقي على العميل، payments = سجل السداد)
     plans       : name | duration(أيام) | price
     attendance  : { memberId, date:'YYYY-MM-DD' }
   الدفع: عند الإضافة / التجديد بيسأل "العميل هيدفع كام؟" (ممكن جزء)،
   والباقي بيتسجل كمتبقي ويتسدد لاحقاً من تاب "الاشتراك والتجديد".
   الخزينة (treasury.js) بتسجل المدفوع فعلياً بس.
   ===================================================================== */
(function () {
  'use strict';

  const COL = { members: 'subscribers', plans: 'plans', attendance: 'attendance' };

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Number(n || 0).toLocaleString('en-US') + ' ج.م';
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
  const today = () => fmt(new Date());
  // يضيف شهور تقويمية (1/10 + شهر = 1/11) ولو اليوم مش موجود في الشهر الجديد ياخد آخر يوم فيه
  const addMonths = (s, n) => {
    const d = parse(s), day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return fmt(d);
  };
  // الخطط من 28 يوم فأكتر بتتحسب بالشهور (30→1 شهر، 90→3، 180→6، 365→12)، والأقل بتتحسب بالأيام
  const planEnd = (start, days) => days >= 28 ? addMonths(start, Math.round(days / 30)) : addDays(start, days);
  const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
  // عرض التواريخ: يوم/شهر/سنة (التخزين في Firebase بيفضل YYYY-MM-DD)
  const dmy = s => isDate(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
  const fromDmy = t => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((t || '').trim()); if (!m) return '';
    const d = +m[1], mo = +m[2], y = +m[3], dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
    return `${y}-${pad(mo)}-${pad(d)}`;
  };
  const dv = id => fromDmy(document.getElementById(id)?.value);
  const setDv = (id, iso) => { const el = document.getElementById(id); if (el) el.value = dmy(iso); };
  const toast = (msg, ok = true) => {
    const t = document.createElement('div');
    t.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] px-5 py-3 rounded-xl text-sm font-bold shadow-2xl ${ok ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'}`;
    t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  };
  const tsToDate = v => (v && v.toDate) ? fmt(v.toDate()) : (isDate(v) ? v : '');

  const IN = 'w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 transition';
  const dateField = (id, iso, onchange = '', extra = '') => `<div class="relative ${extra}">
    <input id="${id}" type="text" inputmode="numeric" maxlength="10" dir="ltr" autocomplete="off" placeholder="يوم/شهر/سنة" value="${dmy(iso)}"
      onfocus="SB.openCal(this)" onclick="SB.openCal(this)" onblur="SB.closeCal()" oninput="SB.mask(this);SB.dpSync(this);${onchange}"
      class="${IN} pl-8 text-right cursor-pointer">
    <i class="fa-regular fa-calendar absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 text-xs pointer-events-none"></i></div>`;
  const STATUS = {
    active: { t: 'نشط', c: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    soon: { t: 'قارب ينتهي', c: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    expired: { t: 'منتهي', c: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
    frozen: { t: 'موقوف مؤقتاً', c: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
    none: { t: 'غير محدد', c: 'bg-neutral-800 text-neutral-400 border-neutral-700' }
  };

  /* ---------- state ---------- */
  let members = [], plans = [], adding = false, statusFilter = 'all';
  let curId = null, curTab = 'overview', att = new Set(), calY, calM;

  const getStatus = m => {
    if (m.frozen && m.frozen.active) return 'frozen';
    if (!isDate(m.endDate)) return 'none';
    const d = diffDays(m.endDate, today());
    return d < 0 ? 'expired' : d <= 7 ? 'soon' : 'active';
  };
  const fdb = () => window.db;
  const memberRef = id => window.doc(fdb(), COL.members, id);
  const update = async (id, data) => {
    try { await window.updateDoc(memberRef(id), data); }
    catch (e) { console.error('updateDoc failed:', e); toast('فشل الحفظ: ' + (e.code || e.message), false); throw e; }
  };

  /* ---------- نافذة "العميل هيدفع كام؟" ---------- */
  // بترجع المبلغ المدفوع، أو null لو اتلغت. limit = أقصى مبلغ (سعر الخطة أو المتبقي)
  function askPay(title, limit, who, positive = false) {
    return new Promise(resolve => {
      const w = document.createElement('div');
      w.className = 'fixed inset-0 z-[250] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
      w.innerHTML = `
        <div class="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-sm shadow-2xl text-white overflow-hidden">
          <div class="p-5 border-b border-neutral-800">
            <h3 class="font-bold flex items-center gap-2"><i class="fa-solid fa-coins text-emerald-400"></i> ${esc(title)}</h3>
            <p class="text-xs text-neutral-400 mt-1">${esc(who)}</p>
          </div>
          <div class="p-5 space-y-4">
            <div class="flex items-center justify-between bg-neutral-950 border border-neutral-800 rounded-xl p-3">
              <span class="text-xs text-neutral-400">${positive ? 'المتبقي على العميل' : 'سعر الخطة'}</span>
              <span class="font-black text-amber-400">${money(limit)}</span>
            </div>
            <div>
              <label class="text-xs text-neutral-400">العميل هيدفع كام دلوقتي؟ (ج.م)</label>
              <div class="flex gap-2 mt-1">
                <input id="pay-amount" type="number" min="0" max="${limit}" step="any" value="${limit}" class="${IN} text-base font-bold">
                <button type="button" id="pay-full" class="shrink-0 bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold px-3 rounded-lg transition">دفع كامل</button>
              </div>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-neutral-400">المتبقي بعد الدفع</span><b id="pay-left" class="text-rose-400">0 ج.م</b>
            </div>
            <p id="pay-err" class="hidden text-xs text-rose-400"></p>
          </div>
          <div class="flex justify-end gap-2 p-4 border-t border-neutral-800 bg-neutral-900/90">
            <button type="button" id="pay-cancel" class="bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition">إلغاء</button>
            <button type="button" id="pay-ok" class="bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs px-5 py-2.5 rounded-xl transition">تأكيد</button>
          </div>
        </div>`;
      document.body.appendChild(w);
      const inp = w.querySelector('#pay-amount'), left = w.querySelector('#pay-left'), err = w.querySelector('#pay-err');
      const val = () => Number(inp.value === '' ? NaN : inp.value);
      const upd = () => {
        const v = val();
        left.textContent = isFinite(v) && v <= limit ? money(Math.max(0, limit - v)) : '—';
        err.classList.add('hidden');
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.stopImmediatePropagation(); done(null); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); ok(); }
      };
      const done = v => { document.removeEventListener('keydown', onKey, true); w.remove(); resolve(v); };
      const ok = () => {
        const v = val();
        if (!isFinite(v) || v < 0) { err.textContent = 'اكتب مبلغ صحيح'; return err.classList.remove('hidden'); }
        if (v > limit) { err.textContent = `المبلغ أكبر من المطلوب (${money(limit)})`; return err.classList.remove('hidden'); }
        if (positive && v <= 0) { err.textContent = 'اكتب مبلغ أكبر من صفر'; return err.classList.remove('hidden'); }
        done(v);
      };
      inp.addEventListener('input', upd);
      w.querySelector('#pay-full').onclick = () => { inp.value = limit; upd(); };
      w.querySelector('#pay-cancel').onclick = () => done(null);
      w.querySelector('#pay-ok').onclick = ok;
      document.addEventListener('keydown', onKey, true);
      upd(); inp.focus(); inp.select();
    });
  }

  /* ---------- boot ---------- */
  function waitForDb(cb) {
    if (window.db && window.onSnapshot) return cb();
    setTimeout(() => waitForDb(cb), 100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildShell();
    renderTable();
    waitForDb(() => {
      window.onSnapshot(window.collection(fdb(), COL.plans), s => {
        plans = s.docs.map(d => { const x = d.data(); return { id: d.id, name: x.name || x.planName || x.title || '—', days: Number(x.duration || x.days || x.durationDays || 30), price: Number(x.price || 0) }; });
        if (adding) refreshPlanSelect();
      });
      window.onSnapshot(window.collection(fdb(), COL.members), s => {
        // id الحقيقي للـ document لازم يكسب على أي حقل id قديم جوه الداتا
        members = s.docs.map(d => { const x = d.data(); return { ...x, id: d.id, code: x.code || x.id || d.id }; });
        members.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderStats();
        if (!adding) renderTable();
        if (curId && !$('memberModal').classList.contains('hidden') && curTab !== 'edit') renderModal();
      }, e => { console.error(e); toast('تعذر تحميل المشتركين', false); });
    });
  });

  /* ---------- shell: stats bar + modal container ---------- */
  function buildShell() {
    const root = $('content-main-2');
    if (!root) return;
    const stats = document.createElement('div');
    stats.id = 'subStats';
    stats.className = 'grid grid-cols-2 lg:grid-cols-5 gap-3';
    root.insertBefore(stats, root.children[1]);
    renderStats();

    const modal = document.createElement('div');
    modal.id = 'memberModal';
    modal.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4';
    modal.onclick = e => { if (e.target === modal) closeMember(); };
    document.body.appendChild(modal);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (!modal.classList.contains('hidden')) closeMember(); else if (adding) cancelAdd(); }
    });
  }

  function renderStats() {
    const box = $('subStats'); if (!box) return;
    const c = { all: members.length, active: 0, soon: 0, expired: 0, frozen: 0 };
    members.forEach(m => { const s = getStatus(m); if (c[s] !== undefined) c[s]++; });
    const items = [
      ['all', 'الكل', 'fa-users', 'text-white'], ['active', 'نشط', 'fa-circle-check', 'text-emerald-400'],
      ['soon', 'قارب ينتهي', 'fa-hourglass-half', 'text-amber-400'], ['expired', 'منتهي', 'fa-circle-xmark', 'text-rose-400'],
      ['frozen', 'موقوف', 'fa-pause', 'text-sky-400']
    ];
    box.innerHTML = items.map(([k, l, i, col]) => `
      <button onclick="SB.setFilter('${k}')" class="text-right bg-neutral-900/80 border ${statusFilter === k ? 'border-white' : 'border-neutral-800'} hover:border-neutral-600 rounded-2xl px-4 py-3 transition flex items-center justify-between">
        <div><p class="text-[11px] text-neutral-400">${l}</p><p class="text-xl font-black ${col}">${c[k]}</p></div>
        <i class="fa-solid ${i} ${col} opacity-70"></i>
      </button>`).join('');
  }

  /* ---------- table ---------- */
  const HEAD = ['ID', 'الاسم', 'رقم الموبايل', 'رقم البطاقة', 'الجنس', 'الطول', 'الوزن', 'السن', 'خطة الاشتراك', 'يبدأ من', 'تاريخ الانتهاء', 'المتبقي', 'ملاحظات'];

  function renderTable() {
    const table = $('subscribersTable'); if (!table) return;
    table.querySelector('thead').innerHTML = `<tr class="bg-neutral-800/80 text-neutral-300 text-xs border-b border-neutral-700/60 whitespace-nowrap">${HEAD.map(h => `<th class="py-3.5 px-4 font-semibold">${h}</th>`).join('')}</tr>`;
    const q = ($('searchInput')?.value || '').trim().toLowerCase();
    const list = members.filter(m => {
      if (statusFilter !== 'all' && getStatus(m) !== statusFilter) return false;
      return !q || [m.name, m.phone, m.cardNo, m.code].some(v => String(v ?? '').toLowerCase().includes(q));
    });
    const rows = list.map(rowHTML).join('');
    $('subscribersTableBody').innerHTML = (adding ? newRowHTML() : '') + rows;
    $('noDataMessage').classList.toggle('hidden', list.length > 0 || adding);
    if (adding) refreshPlanSelect();
  }

  function rowHTML(m) {
    const st = getStatus(m), S = STATUS[st];
    const end = isDate(m.endDate)
      ? `<span class="font-bold ${st === 'expired' ? 'text-rose-400' : ''}">${dmy(m.endDate)}</span><span class="mr-1 text-[10px] px-1.5 py-0.5 rounded-full border ${S.c}">${S.t}</span>`
      : '<span class="text-neutral-600">-</span>';
    return `<tr onclick="SB.open('${m.id}')" class="cursor-pointer hover:bg-white/5 transition whitespace-nowrap">
      <td class="py-3 px-4 font-mono text-[11px] text-neutral-400">${esc(m.code || '-')}</td>
      <td class="py-3 px-4"><div class="flex items-center gap-2">
        <span class="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-bold text-xs flex items-center justify-center">${esc((m.name || '?').trim().charAt(0))}</span>
        <span class="font-bold text-white">${esc(m.name)}</span></div></td>
      <td class="py-3 px-4 font-mono text-xs">${esc(m.phone || '-')}</td>
      <td class="py-3 px-4 font-mono text-xs">${esc(m.cardNo || '-')}</td>
      <td class="py-3 px-4 text-xs">${m.gender === 'ذكر' ? '<i class="fa-solid fa-mars text-sky-400 ml-1"></i>ذكر' : m.gender === 'أنثى' ? '<i class="fa-solid fa-venus text-pink-400 ml-1"></i>أنثى' : '-'}</td>
      <td class="py-3 px-4">${m.height ? esc(m.height) + ' سم' : '-'}</td>
      <td class="py-3 px-4">${m.weight ? esc(m.weight) + ' كجم' : '-'}</td>
      <td class="py-3 px-4">${esc(m.age || '-')}</td>
      <td class="py-3 px-4"><span class="px-2 py-1 rounded-lg text-[11px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">${esc(m.planName || '-')}</span></td>
      <td class="py-3 px-4 text-xs text-neutral-400">${isDate(m.startDate) ? dmy(m.startDate) : '-'}</td>
      <td class="py-3 px-4 text-xs">${end}</td>
      <td class="py-3 px-4 text-xs">${m.due > 0 ? `<span class="px-2 py-1 rounded-lg font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">${money(m.due)}</span>` : '<span class="text-neutral-600">-</span>'}</td>
      <td class="py-3 px-4 text-xs text-neutral-400 max-w-[160px] truncate">${esc(m.notes || '-')}</td></tr>`;
  }

  function newRowHTML() {
    return `<tr class="bg-emerald-500/5 border-y border-emerald-500/30 whitespace-nowrap" onclick="event.stopPropagation()">
      <td class="py-2 px-3"><button onclick="SB.cancelAdd()" title="إلغاء" class="text-rose-400 hover:text-rose-300 text-xs"><i class="fa-solid fa-xmark"></i> إلغاء</button></td>
      <td class="py-2 px-2 min-w-[150px]"><input id="nr-name" class="${IN}" placeholder="اسم المشترك *"></td>
      <td class="py-2 px-2 min-w-[130px]"><input id="nr-phone" type="tel" class="${IN}" placeholder="01xxxxxxxxx *"></td>
      <td class="py-2 px-2 min-w-[110px]"><input id="nr-card" class="${IN}" placeholder="رقم البطاقة"></td>
      <td class="py-2 px-2 w-24"><select id="nr-gender" class="${IN}"><option value="">الجنس</option><option value="ذكر">ذكر</option><option value="أنثى">أنثى</option></select></td>
      <td class="py-2 px-2 w-20"><input id="nr-height" type="number" class="${IN}" placeholder="سم"></td>
      <td class="py-2 px-2 w-20"><input id="nr-weight" type="number" class="${IN}" placeholder="كجم"></td>
      <td class="py-2 px-2 w-16"><input id="nr-age" type="number" class="${IN}" placeholder="سن"></td>
      <td class="py-2 px-2 min-w-[140px]"><select id="nr-plan" onchange="SB.calcEnd()" class="${IN}"></select></td>
      <td class="py-2 px-2 min-w-[130px]">${dateField('nr-start', today(), 'SB.calcEnd()')}</td>
      <td class="py-2 px-2 min-w-[130px]">${dateField('nr-end', '')}</td>
      <td class="py-2 px-2 min-w-[110px] text-[11px] text-neutral-500">يتحدد عند الحفظ</td>
      <td class="py-2 px-2 min-w-[140px]"><input id="nr-notes" class="${IN}" placeholder="ملاحظات"></td></tr>`;
  }

  function refreshPlanSelect() {
    const sel = $('nr-plan'); if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = '<option value="">اختر الخطة</option>' + plans.map(p => `<option value="${p.id}">${esc(p.name)} (${p.days} يوم)</option>`).join('');
    if (keep) sel.value = keep;
    calcEnd();
  }
  function calcEnd() {
    const p = plans.find(x => x.id === $('nr-plan')?.value), s = dv('nr-start');
    if (p && isDate(s)) setDv('nr-end', planEnd(s, p.days));
  }

  /* ---------- add flow ---------- */
  function setAddBtn(on) {
    const b = $('addSubscriberBtn'); if (!b) return;
    $('addBtnText').textContent = on ? 'حفظ البيانات' : 'إضافة مشترك';
    $('addBtnIcon').className = `fa-solid ${on ? 'fa-floppy-disk' : 'fa-user-plus'} text-xs`;
    b.classList.toggle('bg-white', !on); b.classList.toggle('text-black', !on);
    b.classList.toggle('bg-emerald-500', on); b.classList.toggle('text-black', true);
    b.classList.toggle('hover:bg-neutral-200', !on); b.classList.toggle('hover:bg-emerald-400', on);
  }
  function toggleAddSubscriber() { adding ? saveNew() : startAdd(); }
  function startAdd() {
    if (!fdb()) return toast('جاري الاتصال بقاعدة البيانات...', false);
    adding = true; statusFilter = 'all'; renderStats(); setAddBtn(true); renderTable();
    $('nr-name')?.focus();
  }
  function cancelAdd() { adding = false; setAddBtn(false); renderTable(); }

  async function saveNew() {
    const v = id => ($(id)?.value || '').trim();
    const name = v('nr-name'), phone = v('nr-phone');
    if (!name) { $('nr-name').focus(); return toast('اكتب اسم المشترك', false); }
    if (!/^\d{8,15}$/.test(phone)) { $('nr-phone').focus(); return toast('رقم الموبايل غير صحيح', false); }
    if (members.some(m => m.phone === phone)) return toast('الرقم ده مسجل لمشترك تاني', false);
    const startD = dv('nr-start'); let endD = dv('nr-end');
    if (!startD) { $('nr-start').focus(); return toast('يوم البداية غير صحيح (يوم/شهر/سنة)', false); }
    if (v('nr-end') && !endD) { $('nr-end').focus(); return toast('تاريخ الانتهاء غير صحيح (يوم/شهر/سنة)', false); }
    if (!v('nr-gender')) { $('nr-gender').focus(); return toast('اختار الجنس (ذكر / أنثى)', false); }
    const plan = plans.find(p => p.id === v('nr-plan'));

    // العميل هيدفع كام؟ (ممكن جزء والباقي يتسجل متبقي)
    let paid = 0;
    if (plan && plan.price > 0) {
      paid = await askPay(`اشتراك ${plan.name}`, plan.price, name);
      if (paid === null) return;
    }

    let code; do { code = 'GYM-' + Math.floor(1000 + Math.random() * 9000); } while (members.some(m => m.code === code));
    const btn = $('addSubscriberBtn'); btn.disabled = true; $('addBtnText').textContent = 'جاري الحفظ...';
    try {
      await window.addDoc(window.collection(fdb(), COL.members), {
        code, name, phone, cardNo: v('nr-card'), gender: v('nr-gender'), height: v('nr-height'), weight: v('nr-weight'), age: v('nr-age'),
        planId: plan?.id || '', planName: plan?.name || '', planDays: plan?.days || 0,
        startDate: startD, endDate: endD || (plan ? planEnd(startD, plan.days) : ''), notes: v('nr-notes'),
        frozen: { active: false }, invites: [], offers: [],
        renewals: plan ? [{ date: today(), planName: plan.name, from: startD, to: endD || planEnd(startD, plan.days), price: plan.price, paid }] : [],
        due: plan ? Math.max(0, plan.price - paid) : 0, payments: [],
        createdAt: window.serverTimestamp()
      });
      adding = false; setAddBtn(false); toast('تم حفظ المشترك ✔');
    } catch (e) { console.error(e); toast('فشل الحفظ، حاول تاني', false); setAddBtn(true); }
    btn.disabled = false;
  }

  function filterSubscribers() { renderTable(); }
  function setFilter(k) { statusFilter = statusFilter === k ? 'all' : k; renderStats(); renderTable(); }

  /* ---------- member modal ---------- */
  async function openMember(id) {
    curId = id; curTab = 'overview'; att = new Set();
    const d = new Date(); calY = d.getFullYear(); calM = d.getMonth();
    $('memberModal').classList.remove('hidden');
    renderModal();
    loadAttendance();
  }
  function closeMember() { $('memberModal').classList.add('hidden'); curId = null; }
  function setTab(t) { curTab = t; renderModal(); }
  const cur = () => members.find(m => m.id === curId);

  async function loadAttendance() {
    try {
      const s = await window.getDocs(window.query(window.collection(fdb(), COL.attendance), window.where('memberId', '==', curId)));
      att = new Set(s.docs.map(d => tsToDate(d.data().date)).filter(Boolean));
      if (curTab === 'overview' || curTab === 'attendance') renderModal();
    } catch (e) { console.error(e); }
  }

  const TABS = [['overview', 'نظرة عامة', 'fa-id-card'], ['renew', 'الاشتراك والتجديد', 'fa-rotate'], ['attendance', 'الحضور', 'fa-calendar-check'],
  ['invites', 'الدعوات', 'fa-user-group'], ['offers', 'عرض خاص', 'fa-tags'], ['extras', 'مشتريات / تمرين / غذاء', 'fa-dumbbell'], ['edit', 'تعديل البيانات', 'fa-pen']];

  function renderModal() {
    closeCal();
    const m = cur(); if (!m) return closeMember();
    const st = getStatus(m), S = STATUS[st];
    const body = { overview: tabOverview, renew: tabRenew, attendance: tabAttendance, invites: tabInvites, offers: tabOffers, extras: tabExtras, edit: tabEdit }[curTab](m);
    $('memberModal').innerHTML = `
    <div class="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl text-white overflow-hidden">
      <div class="flex items-center justify-between p-4 border-b border-neutral-800">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-black text-lg">${esc((m.name || '?').charAt(0))}</div>
          <div><h3 class="font-bold">${esc(m.name)} <span class="mr-2 text-[10px] px-2 py-0.5 rounded-full border ${S.c}">${S.t}</span></h3>
          <p class="text-xs text-neutral-400 font-mono">${esc(m.code)} · ${esc(m.phone)}</p></div>
        </div>
        <button onclick="SB.close()" class="text-neutral-400 hover:text-white p-2 rounded-xl hover:bg-neutral-800"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <div class="flex gap-1 overflow-x-auto p-2 border-b border-neutral-800 bg-neutral-950/50">
        ${TABS.map(([k, l, i]) => `<button onclick="SB.tab('${k}')" class="whitespace-nowrap px-3 py-2 rounded-lg text-xs font-semibold transition ${curTab === k ? 'bg-white text-black' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}"><i class="fa-solid ${i} ml-1"></i>${l}</button>`).join('')}
      </div>
      <div class="p-5 overflow-y-auto space-y-4">${body}</div>
    </div>`;
    if (curTab === 'renew') rnCalc();
  }

  const card = (label, val, col = 'text-white', sub = '') => `<div class="bg-neutral-950 border border-neutral-800 rounded-xl p-4"><p class="text-xs text-neutral-400">${label}</p><h4 class="text-lg font-bold mt-1 ${col}">${val}</h4>${sub ? `<span class="text-[10px] text-neutral-500">${sub}</span>` : ''}</div>`;
  const btn = (txt, fn, cls = 'bg-emerald-500 hover:bg-emerald-400 text-black') => `<button onclick="${fn}" class="${cls} font-bold text-xs px-4 py-2.5 rounded-xl transition">${txt}</button>`;

  /* ----- overview ----- */
  function monthStats(m) {
    const first = new Date(calY, calM, 1), last = new Date(calY, calM + 1, 0), t = today();
    const from = isDate(m.startDate) ? m.startDate : tsToDate(m.createdAt) || fmt(first);
    const to = [fmt(last), t, isDate(m.endDate) ? m.endDate : fmt(last)].sort()[0];
    let present = 0, absent = 0;
    for (let d = 1; d <= last.getDate(); d++) {
      const s = `${calY}-${pad(calM + 1)}-${pad(d)}`;
      if (att.has(s)) present++; else if (s >= from && s <= to && s < t) absent++;
    }
    return { present, absent };
  }
  function tabOverview(m) {
    const created = tsToDate(m.createdAt), months = created ? ((diffDays(today(), created)) / 30).toFixed(1) : '-';
    const ms = monthStats(m), left = isDate(m.endDate) ? diffDays(m.endDate, today()) : null;
    return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      ${card('خطة الاشتراك', esc(m.planName || '-'), 'text-indigo-300', `${dmy(m.startDate)} ← ${dmy(m.endDate)}`)}
      ${card('المتبقي', left === null ? '-' : left < 0 ? `انتهى من ${-left} يوم` : `${left} يوم`, left !== null && left < 0 ? 'text-rose-400' : 'text-emerald-400')}
      ${card('مدة النشاط معنا', months === '-' ? '-' : months + ' شهر', 'text-emerald-400', created ? 'منذ ' + created : '')}
      ${card('حضور / غياب الشهر', `${ms.present} / ${ms.absent}`, 'text-amber-400', 'يوم حضور / يوم غياب')}
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      ${card('الطول', m.height ? m.height + ' سم' : '-')}${card('الوزن', m.weight ? m.weight + ' كجم' : '-')}
      ${card('السن', esc(m.age || '-'))}${card('الجنس', esc(m.gender || '-'), m.gender === 'أنثى' ? 'text-pink-400' : 'text-sky-400')}
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">${card('رقم البطاقة', esc(m.cardNo || '-'))}${m.due > 0 ? card('مبلغ متبقي على العميل', money(m.due), 'text-rose-400', 'اسدده من تاب الاشتراك والتجديد') : ''}</div>
    ${m.notes ? `<div class="bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-sm"><p class="text-xs text-neutral-400 mb-1">ملاحظات</p>${esc(m.notes)}</div>` : ''}`;
  }

  /* ----- attendance calendar ----- */
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function calendarHTML(m) {
    const first = new Date(calY, calM, 1), days = new Date(calY, calM + 1, 0).getDate(), off = (first.getDay() + 1) % 7, t = today();
    const from = isDate(m.startDate) ? m.startDate : tsToDate(m.createdAt) || '0000-00-00';
    let cells = ''.padStart(0);
    for (let i = 0; i < off; i++) cells += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const s = `${calY}-${pad(calM + 1)}-${pad(d)}`;
      let cls = 'bg-neutral-900 text-neutral-500';
      if (att.has(s)) cls = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold';
      else if (s >= from && s < t && (!isDate(m.endDate) || s <= m.endDate)) cls = 'bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold';
      if (s === t) cls += ' ring-2 ring-white';
      cells += `<div class="h-9 rounded-lg flex items-center justify-center text-xs ${cls}">${d}</div>`;
    }
    const ms = monthStats(m);
    return `<div class="bg-neutral-950 border border-neutral-800 rounded-xl p-4">
      <div class="flex items-center justify-between mb-3">
        <button onclick="SB.cal(-1)" class="px-2 py-1 rounded-lg hover:bg-neutral-800 text-neutral-400"><i class="fa-solid fa-chevron-right"></i></button>
        <h4 class="text-sm font-bold">${MONTHS[calM]} ${calY}</h4>
        <button onclick="SB.cal(1)" class="px-2 py-1 rounded-lg hover:bg-neutral-800 text-neutral-400"><i class="fa-solid fa-chevron-left"></i></button>
      </div>
      <div class="grid grid-cols-7 gap-1.5 text-center text-[10px] text-neutral-500 mb-1.5">${['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'].map(x => `<div>${x}</div>`).join('')}</div>
      <div class="grid grid-cols-7 gap-1.5">${cells}</div>
      <div class="flex flex-wrap justify-between gap-2 text-[11px] mt-3">
        <span class="text-emerald-400">● حضور: ${ms.present} يوم</span><span class="text-rose-400">● غياب: ${ms.absent} يوم</span></div></div>`;
  }
  function tabAttendance(m) {
    return calendarHTML(m) + `<div class="flex justify-end">${btn('<i class="fa-solid fa-check ml-1"></i> تسجيل حضور اليوم', 'SB.markToday()')}</div>`;
  }
  function calMove(n) { calM += n; if (calM > 11) { calM = 0; calY++; } if (calM < 0) { calM = 11; calY--; } renderModal(); }
  async function markToday() {
    const t = today(); if (att.has(t)) return toast('الحضور متسجل النهاردة', false);
    const st = getStatus(cur()); if (st === 'expired' && !confirm('الاشتراك منتهي، تسجل الحضور برضو؟')) return;
    if (st === 'frozen') return toast('الاشتراك موقوف مؤقتاً', false);
    await window.addDoc(window.collection(fdb(), COL.attendance), { memberId: curId, date: t, createdAt: window.serverTimestamp() });
    att.add(t); renderModal(); toast('تم تسجيل الحضور ✔');
  }

  /* ----- renew / freeze ----- */
  function tabRenew(m) {
    const frozen = m.frozen && m.frozen.active;
    const base = isDate(m.endDate) && diffDays(m.endDate, today()) >= 0 ? m.endDate : today();
    const hist = (m.renewals || []).slice().reverse();
    const pays = (m.payments || []).slice().reverse();
    const dueBox = m.due > 0 ? `<div class="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex items-center justify-between gap-3">
      <div><p class="text-xs text-rose-300">متبقي على العميل</p><h4 class="text-xl font-black text-rose-400">${money(m.due)}</h4></div>
      ${btn('<i class="fa-solid fa-coins ml-1"></i> سداد', 'SB.settle()')}</div>` : '';
    return `${dueBox}<div class="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
      <h4 class="text-sm font-bold"><i class="fa-solid fa-rotate text-emerald-400 ml-1"></i> تجديد الاشتراك</h4>
      <div class="grid sm:grid-cols-3 gap-3">
        <div><label class="text-xs text-neutral-400">الخطة</label><select id="rn-plan" onchange="SB.rnCalc()" class="${IN} mt-1">${plans.map(p => `<option value="${p.id}" ${p.id === m.planId ? 'selected' : ''}>${esc(p.name)} (${p.days} يوم - ${p.price} ج.م)</option>`).join('')}</select></div>
        <div><label class="text-xs text-neutral-400">يبدأ من</label>${dateField('rn-start', base, 'SB.rnCalc()', 'mt-1')}</div>
        <div><label class="text-xs text-neutral-400">ينتهي في</label>${dateField('rn-end', '', '', 'mt-1')}</div>
      </div>
      ${btn('تأكيد التجديد', 'SB.renew()')}
    </div>
    <div class="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
      <h4 class="text-sm font-bold"><i class="fa-solid fa-pause text-sky-400 ml-1"></i> إيقاف الاشتراك مؤقتاً</h4>
      ${frozen ? `<p class="text-xs text-neutral-400">موقوف من ${dmy(m.frozen.since)} (${diffDays(today(), m.frozen.since)} يوم). عند الاستئناف هيتمدد تاريخ الانتهاء بنفس عدد الأيام.</p>${btn('استئناف الاشتراك', 'SB.unfreeze()', 'bg-sky-500 hover:bg-sky-400 text-black')}`
        : `<p class="text-xs text-neutral-400">أثناء الإيقاف مش بيتحسب غياب، ويتم تعويض الأيام عند الاستئناف.</p>${btn('إيقاف مؤقت', 'SB.freeze()', 'bg-sky-500 hover:bg-sky-400 text-black')}`}
    </div>
    <div class="bg-neutral-950 border border-neutral-800 rounded-xl p-4"><h4 class="text-sm font-bold mb-2">سجل التجديدات</h4>
      ${hist.length ? hist.map(r => {
        const paid = Number(r.paid ?? r.price ?? 0), price = Number(r.price || 0), left = Math.max(0, price - paid);
        return `<div class="flex justify-between text-xs p-2 bg-neutral-900 rounded-lg mb-1.5"><span>${esc(r.planName)} · ${dmy(r.from)} ← ${dmy(r.to)}</span><span class="font-mono"><span class="text-amber-400">دفع ${paid} / ${price} ج.م</span>${left ? `<span class="text-rose-400 mr-2">متبقي ${left}</span>` : ''}</span></div>`;
      }).join('') : '<p class="text-xs text-neutral-500">لا يوجد سجل.</p>'}</div>
    ${pays.length ? `<div class="bg-neutral-950 border border-neutral-800 rounded-xl p-4"><h4 class="text-sm font-bold mb-2">سجل السداد</h4>
      ${pays.map(p => `<div class="flex justify-between text-xs p-2 bg-neutral-900 rounded-lg mb-1.5"><span>سداد متبقي · ${dmy(p.date)}</span><span class="text-emerald-400 font-mono">${money(p.amount)}</span></div>`).join('')}</div>` : ''}`;
  }
  function rnCalc() {
    const p = plans.find(x => x.id === $('rn-plan')?.value), s = dv('rn-start');
    if (p && isDate(s)) setDv('rn-end', planEnd(s, p.days));
  }
  async function renew() {
    const m = cur(), p = plans.find(x => x.id === $('rn-plan').value), s = dv('rn-start'), e = dv('rn-end');
    if (!p || !isDate(s) || !isDate(e)) return toast('اختار الخطة والتواريخ', false);

    // العميل هيدفع كام؟ (ممكن جزء والباقي يتسجل متبقي)
    let paid = 0;
    if (p.price > 0) {
      paid = await askPay(`تجديد ${p.name}`, p.price, m.name);
      if (paid === null) return;
    }
    await update(m.id, {
      planId: p.id, planName: p.name, planDays: p.days, startDate: s, endDate: e, frozen: { active: false },
      renewals: [...(m.renewals || []), { date: today(), planName: p.name, from: s, to: e, price: p.price, paid }],
      due: Number(m.due || 0) + Math.max(0, p.price - paid)
    });
    toast('تم التجديد ✔');
  }
  // سداد جزء (أو كل) المتبقي على العميل
  async function settle() {
    const m = cur(), due = Number(m?.due || 0);
    if (!(due > 0)) return toast('مفيش متبقي على العميل', false);
    const amt = await askPay('سداد المتبقي', due, m.name, true);
    if (amt === null) return;
    await update(m.id, { due: Math.max(0, due - amt), payments: [...(m.payments || []), { date: today(), amount: amt }] });
    toast(`تم تسجيل سداد ${money(amt)} ✔`);
  }
  async function freeze() { if (confirm('إيقاف الاشتراك مؤقتاً؟')) { await update(curId, { frozen: { active: true, since: today() } }); toast('تم الإيقاف'); } }
  async function unfreeze() {
    const m = cur(), n = diffDays(today(), m.frozen.since);
    await update(m.id, { frozen: { active: false }, endDate: isDate(m.endDate) ? addDays(m.endDate, n) : m.endDate });
    toast(`تم الاستئناف وتمديد ${n} يوم ✔`);
  }

  /* ----- invites ----- */
  function tabInvites(m) {
    const list = m.invites || [];
    return `<div class="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
      <h4 class="text-sm font-bold">دعوة صديق</h4>
      <div class="grid sm:grid-cols-3 gap-3"><input id="iv-name" class="${IN}" placeholder="اسم الصديق"><input id="iv-phone" class="${IN}" placeholder="رقم الموبايل">${btn('إضافة دعوة', 'SB.addInvite()')}</div></div>
    <div class="space-y-2">${list.length ? list.map((v, i) => `<div class="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-xs">
      <div><b>${esc(v.name)}</b> <span class="text-neutral-500 font-mono mr-2">${esc(v.phone)}</span><span class="text-neutral-500">${dmy(v.date)}</span></div>
      <div class="flex items-center gap-2"><button onclick="SB.toggleInvite(${i})" class="px-2.5 py-1 rounded-lg border ${v.used ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-neutral-800 text-neutral-300 border-neutral-700'}">${v.used ? 'حضر ✔' : 'لم يحضر'}</button>
      <button onclick="SB.delInvite(${i})" class="text-rose-400"><i class="fa-solid fa-trash-can"></i></button></div></div>`).join('') : '<p class="text-xs text-neutral-500">لا توجد دعوات.</p>'}</div>`;
  }
  async function addInvite() {
    const n = $('iv-name').value.trim(); if (!n) return toast('اكتب اسم الصديق', false);
    await update(curId, { invites: [...(cur().invites || []), { name: n, phone: $('iv-phone').value.trim(), date: today(), used: false }] });
  }
  async function toggleInvite(i) { const a = [...cur().invites]; a[i] = { ...a[i], used: !a[i].used }; await update(curId, { invites: a }); }
  async function delInvite(i) { const a = [...cur().invites]; a.splice(i, 1); await update(curId, { invites: a }); }

  /* ----- special offer ----- */
  function tabOffers(m) {
    const list = m.offers || [];
    return `<div class="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
      <h4 class="text-sm font-bold">إنشاء عرض خاص بالمشترك</h4>
      <div class="grid sm:grid-cols-4 gap-3">
        <input id="of-title" class="${IN} sm:col-span-2" placeholder="عنوان العرض (مثال: خصم تجديد)">
        <select id="of-type" class="${IN}"><option value="percent">نسبة %</option><option value="fixed">مبلغ ثابت ج.م</option></select>
        <input id="of-value" type="number" class="${IN}" placeholder="القيمة">
        <div class="sm:col-span-2"><label class="text-xs text-neutral-400">ينتهي العرض في</label>${dateField('of-exp', addDays(today(), 30), '', 'mt-1')}</div>
        <div class="sm:col-span-2 flex items-end">${btn('حفظ العرض', 'SB.addOffer()')}</div></div></div>
    <div class="space-y-2">${list.length ? list.map((o, i) => {
      const dead = o.expires < today(); return `<div class="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-xs ${dead ? 'opacity-50' : ''}">
      <div><b>${esc(o.title)}</b> <span class="text-amber-400 mr-2">${o.value}${o.type === 'percent' ? '%' : ' ج.م'}</span><span class="text-neutral-500">حتى ${dmy(o.expires)}${dead ? ' (منتهي)' : ''}</span></div>
      <button onclick="SB.delOffer(${i})" class="text-rose-400"><i class="fa-solid fa-trash-can"></i></button></div>`;
    }).join('') : '<p class="text-xs text-neutral-500">لا توجد عروض.</p>'}</div>`;
  }
  async function addOffer() {
    const t = $('of-title').value.trim(), v = Number($('of-value').value);
    if (!t || !(v > 0)) return toast('اكتب العنوان والقيمة', false);
    if (!dv('of-exp')) return toast('تاريخ انتهاء العرض غير صحيح (يوم/شهر/سنة)', false);
    await update(curId, { offers: [...(cur().offers || []), { title: t, type: $('of-type').value, value: v, expires: dv('of-exp'), createdAt: today() }] });
    toast('تم حفظ العرض ✔');
  }
  async function delOffer(i) { const a = [...cur().offers]; a.splice(i, 1); await update(curId, { offers: a }); }

  /* ----- coming soon ----- */
  function tabExtras() {
    const box = (i, t, c) => `<div class="bg-neutral-950 border border-dashed border-neutral-700 rounded-xl p-5 text-center"><i class="fa-solid ${i} text-2xl ${c} mb-2"></i><h4 class="text-sm font-bold">${t}</h4><p class="text-xs text-neutral-500 mt-1">قريباً</p></div>`;
    return `<div class="grid sm:grid-cols-3 gap-3">${box('fa-bag-shopping', 'مشتريات المتجر', 'text-amber-400')}${box('fa-dumbbell', 'جدول التمرين الجاهز', 'text-indigo-400')}${box('fa-apple-whole', 'النظام الغذائي الجاهز', 'text-emerald-400')}</div>`;
  }

  /* ----- edit ----- */
  function tabEdit(m) {
    const f = (id, l, v, t = 'text') => `<div><label class="text-xs text-neutral-400">${l}</label><input id="ed-${id}" type="${t}" value="${esc(v ?? '')}" class="${IN} mt-1"></div>`;
    return `<div class="grid sm:grid-cols-3 gap-3">
      ${f('name', 'الاسم', m.name)}${f('phone', 'رقم الموبايل', m.phone, 'tel')}${f('cardNo', 'رقم البطاقة', m.cardNo)}
      ${f('height', 'الطول (سم)', m.height, 'number')}${f('weight', 'الوزن (كجم)', m.weight, 'number')}${f('age', 'السن', m.age, 'number')}
      <div><label class="text-xs text-neutral-400">الجنس</label><select id="ed-gender" class="${IN} mt-1"><option value="">غير محدد</option><option value="ذكر" ${m.gender === 'ذكر' ? 'selected' : ''}>ذكر</option><option value="أنثى" ${m.gender === 'أنثى' ? 'selected' : ''}>أنثى</option></select></div>
      <div><label class="text-xs text-neutral-400">خطة الاشتراك</label><select id="ed-plan" onchange="SB.edCalc()" class="${IN} mt-1">${planOptions(m)}</select></div>
      <div><label class="text-xs text-neutral-400">يوم البداية</label>${dateField('ed-start', m.startDate, 'SB.edCalc()', 'mt-1')}</div>
      <div><label class="text-xs text-neutral-400">تاريخ الانتهاء (تلقائي)</label><input id="ed-end-view" type="text" readonly value="${dmy(m.endDate) || '-'}" dir="ltr" class="${IN} mt-1 text-right opacity-70 cursor-not-allowed"></div>
      <div class="sm:col-span-3"><label class="text-xs text-neutral-400">ملاحظات</label><textarea id="ed-notes" rows="2" class="${IN} mt-1">${esc(m.notes || '')}</textarea></div></div>
    <div class="flex justify-between">${btn('حفظ التعديلات', 'SB.saveEdit()')}${btn('<i class="fa-solid fa-trash-can ml-1"></i> حذف المشترك', 'SB.del()', 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30')}</div>`;
  }
  // قائمة الخطط في تاب التعديل (لو الخطة الحالية مش في القائمة، بتتعرض كاختيار "حالية" عشان ما تتغيرش بالغلط)
  function planOptions(m) {
    const byId = plans.find(p => p.id === m.planId) || (!m.planId ? plans.find(p => p.name === m.planName) : null);
    const keep = !byId && m.planName ? `<option value="__keep" selected>${esc(m.planName)} (الحالية)</option>` : '';
    const none = !byId && !m.planName ? '<option value="" selected>اختر الخطة</option>' : '';
    return keep + none + plans.map(p => `<option value="${p.id}" ${byId && byId.id === p.id ? 'selected' : ''}>${esc(p.name)} (${p.days} يوم)</option>`).join('');
  }
  function edCalc() {
    const p = plans.find(x => x.id === $('ed-plan')?.value), s = dv('ed-start');
    if (p && isDate(s)) $('ed-end-view').value = dmy(planEnd(s, p.days));
  }
  async function saveEdit() {
    const v = id => ($('ed-' + id)?.value || '').trim();
    if (!curId) return toast('اختار مشترك الأول', false);
    if (!v('name')) return toast('الاسم مطلوب', false);
    if (!/^\d{8,15}$/.test(v('phone'))) return toast('رقم الموبايل غير صحيح', false);
    if (members.some(m => m.id !== curId && m.phone === v('phone'))) return toast('الرقم مسجل لمشترك تاني', false);
    const data = { name: v('name'), phone: v('phone'), cardNo: v('cardNo'), gender: v('gender'), height: v('height'), weight: v('weight'), age: v('age'), notes: v('notes') };
    // الخطة + يوم البداية → تاريخ الانتهاء بيتحسب لوحده (بس لو الخطة أو البداية اتغيروا)
    const m0 = cur(), start = dv('ed-start'), p = plans.find(x => x.id === $('ed-plan')?.value);
    if (p && (p.id !== m0.planId || start !== m0.startDate)) {
      if (!isDate(start)) { $('ed-start').focus(); return toast('اختار يوم البداية', false); }
      Object.assign(data, { planId: p.id, planName: p.name, planDays: p.days, startDate: start, endDate: planEnd(start, p.days) });
    } else if (isDate(start)) data.startDate = start;
    await update(curId, data);
    toast('تم حفظ التعديلات ✔'); setTab('overview');
  }
  async function del() {
    if (!confirm('حذف المشترك نهائياً؟')) return;
    await window.deleteDoc(memberRef(curId)); closeMember(); toast('تم الحذف');
  }

  /* ---------- exports (used by inline onclick in HTML) ---------- */
  window.toggleAddSubscriber = toggleAddSubscriber;
  window.filterSubscribers = filterSubscribers;
  function mask(el) {
    const d = el.value.replace(/\D/g, '').slice(0, 8);
    el.value = d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  }
  /* ---------- منتقي التاريخ (كالندر مخصص) ---------- */
  let dp = null, dpEl = null, dpY = 0, dpM = 0;
  function openCal(el) {
    if (dp && dpEl === el) return;
    closeCal(); dpEl = el;
    const d = parse(fromDmy(el.value) || today()); dpY = d.getFullYear(); dpM = d.getMonth();
    dp = document.createElement('div');
    dp.className = 'fixed z-[200] w-72 bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl shadow-black/70 p-3 text-white select-none';
    dp.addEventListener('mousedown', e => e.preventDefault()); // يخلي الفوكس في الحقل
    document.body.appendChild(dp); drawCal();
  }
  function closeCal() { if (dp) dp.remove(); dp = null; dpEl = null; }
  function drawCal() {
    if (!dp || !dpEl || !dpEl.isConnected) return closeCal();
    const sel = fromDmy(dpEl.value), t = today();
    const first = new Date(dpY, dpM, 1), days = new Date(dpY, dpM + 1, 0).getDate(), off = (first.getDay() + 1) % 7;
    let cells = '<div></div>'.repeat(off);
    for (let d = 1; d <= days; d++) {
      const iso = `${dpY}-${pad(dpM + 1)}-${pad(d)}`;
      const cls = iso === sel ? 'bg-emerald-500 text-black font-bold shadow-md shadow-emerald-500/30'
        : iso === t ? 'ring-1 ring-emerald-400/70 text-emerald-300 hover:bg-neutral-800' : 'text-neutral-200 hover:bg-neutral-800';
      cells += `<button type="button" onclick="SB.dpSet('${iso}')" class="h-9 rounded-lg text-xs transition ${cls}">${d}</button>`;
    }
    const nav = (fn, ic) => `<button type="button" onclick="${fn}" class="w-8 h-8 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"><i class="fa-solid ${ic} text-[10px]"></i></button>`;
    dp.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="flex">${nav('SB.dpNav(0,-1)', 'fa-angles-right')}${nav('SB.dpNav(-1,0)', 'fa-chevron-right')}</div>
        <span class="text-sm font-bold">${MONTHS[dpM]} ${dpY}</span>
        <div class="flex">${nav('SB.dpNav(1,0)', 'fa-chevron-left')}${nav('SB.dpNav(0,1)', 'fa-angles-left')}</div>
      </div>
      <div class="grid grid-cols-7 gap-1 text-center text-[11px] text-neutral-500 mb-1">${['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'].map(x => `<div class="py-1">${x}</div>`).join('')}</div>
      <div class="grid grid-cols-7 gap-1">${cells}</div>
      <div class="flex justify-between mt-3 pt-2 border-t border-neutral-800 text-xs">
        <button type="button" onclick="SB.dpSet('${t}')" class="px-3 py-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 font-semibold transition">اليوم</button>
        <button type="button" onclick="SB.dpSet('')" class="px-3 py-1.5 rounded-lg text-neutral-400 hover:bg-neutral-800 transition">مسح</button>
      </div>`;
    placeCal();
  }
  function placeCal() {
    if (!dp || !dpEl) return;
    const r = dpEl.getBoundingClientRect(), h = dp.offsetHeight, w = dp.offsetWidth;
    let top = r.bottom + 6; if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    dp.style.top = top + 'px'; dp.style.left = left + 'px';
  }
  function dpNav(dm, dy) {
    dpM += dm; dpY += dy;
    if (dpM > 11) { dpM = 0; dpY++; } if (dpM < 0) { dpM = 11; dpY--; }
    drawCal();
  }
  function dpSet(iso) {
    if (!dpEl) return;
    const el = dpEl; el.value = dmy(iso);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    closeCal();
  }
  // لما تكتب التاريخ بإيدك، الكالندر يتحرك للشهر ده
  function dpSync(el) {
    if (!dp || dpEl !== el) return;
    const iso = fromDmy(el.value); if (!iso) return;
    const d = parse(iso); dpY = d.getFullYear(); dpM = d.getMonth(); drawCal();
  }
  window.addEventListener('scroll', placeCal, true);
  window.addEventListener('resize', placeCal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && dp) { closeCal(); e.stopImmediatePropagation(); } }, true);

  window.SB = {
    mask, openCal, closeCal, dpNav, dpSet, dpSync, edCalc, open: openMember, close: closeMember, tab: setTab, cancelAdd, calcEnd, setFilter, cal: calMove, markToday,
    rnCalc, renew, settle, freeze, unfreeze, addInvite, toggleInvite, delInvite, addOffer, delOffer, saveEdit, del
  };
})();