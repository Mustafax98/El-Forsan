








/* =====================================================================
                                  
                                Plans

/* =====================================================================
   plans.js — الإعدادات ← تاب الاشتراكات (جيم الفرسان)
   بيدير خطط الاشتراك في collection اسمها "plans"،
   والخطط دي بتظهر لوحدها في فورم المشتركين (Subscriber.js) وفي التجديد.

   مهم: حطه في الآخر بعد باقي الملفات عشان دوال
   openPlanModal / closePlanModal / savePlan تاخد مكان القديمة:
     <script src="/plans.js"></script>   ← بعد setting.js
   ===================================================================== */
(function () {
  'use strict';

  const COL_PLANS = 'plans';
  const COL_MEMBERS = 'subscribers';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (msg, ok = true) => {
    const t = document.createElement('div');
    t.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl text-sm font-bold shadow-2xl ${ok ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'}`;
    t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  };

  let plans = [], members = [], saving = false;

  /* وصف المدة بالعربي: 30 → شهر، 90 → 3 شهور، 365 → سنة */
  function durationLabel(days) {
    if (days < 28) return days === 1 ? 'يوم واحد' : `${days} أيام`;
    const m = Math.round(days / 30);
    if (m === 1) return 'شهر';
    if (m === 2) return 'شهرين';
    if (m === 12) return 'سنة';
    if (m >= 3 && m <= 10) return `${m} شهور`;
    return `${m} شهر`;
  }

  const countFor = p => members.filter(m => m.planId === p.id || (!m.planId && m.planName && m.planName === p.name)).length;

  /* ---------- boot ---------- */
  function waitForDb(cb) {
    if (window.db && window.onSnapshot) return cb();
    setTimeout(() => waitForDb(cb), 100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    enhanceModal();
    renderPlans();
    waitForDb(() => {
      window.onSnapshot(window.collection(window.db, COL_PLANS), s => {
        plans = s.docs.map(d => {
          const x = d.data();
          return { id: d.id, name: x.name || x.planName || x.title || '—', days: Number(x.duration || x.days || x.durationDays || 0), price: Number(x.price || 0), createdAt: x.createdAt?.seconds || 0 };
        }).sort((a, b) => a.days - b.days);
        renderPlans();
      }, e => { console.error(e); toast('تعذر تحميل الخطط: ' + (e.code || e.message), false); });

      window.onSnapshot(window.collection(window.db, COL_MEMBERS), s => {
        members = s.docs.map(d => { const x = d.data(); return { id: d.id, planId: x.planId || '', planName: x.planName || '' }; });
        renderPlans();
      });
    });
  });

  /* ---------- table ---------- */
  function renderPlans() {
    const body = $('plansTableBody'); if (!body) return;
    if (!plans.length) {
      body.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-neutral-500 text-sm"><i class="fa-solid fa-tags text-2xl block mb-2 text-neutral-700"></i>لا توجد خطط بعد. اضغط "إضافة خطة جديدة" لإنشاء أول خطة.</td></tr>`;
      return;
    }
    body.innerHTML = plans.map(p => {
      const n = countFor(p);
      return `<tr class="hover:bg-white/5 transition">
        <td class="py-3 px-4 font-bold text-white">${esc(p.name)}</td>
        <td class="py-3 px-4">${p.days} <span class="text-[11px] text-neutral-500">(${durationLabel(p.days)})</span></td>
        <td class="py-3 px-4 text-amber-400 font-mono">${p.price.toLocaleString('en-US')} ج.م</td>
        <td class="py-3 px-4"><span class="px-2.5 py-1 rounded-full text-xs font-bold ${n ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20' : 'bg-neutral-800 text-neutral-500 border border-neutral-700'}">${n} مشترك</span></td>
        <td class="py-3 px-4 text-center whitespace-nowrap">
          <button onclick="openPlanModal('${p.id}')" title="تعديل" class="text-sky-400 hover:text-sky-300 px-2"><i class="fa-solid fa-pen"></i></button>
          <button onclick="deletePlan('${p.id}')" title="حذف" class="text-rose-400 hover:text-rose-300 px-2"><i class="fa-solid fa-trash-can"></i></button>
        </td></tr>`;
    }).join('');
  }

  /* ---------- modal ---------- */
  // يضيف أزرار اختيار سريع للمدة تحت حقل المدة
  function enhanceModal() {
    const input = $('planDurationInput');
    if (!input || $('planDurationChips')) return;
    const chips = document.createElement('div');
    chips.id = 'planDurationChips';
    chips.className = 'flex flex-wrap gap-1.5 mt-2';
    chips.innerHTML = [[1, 'يوم'], [30, 'شهر'], [90, '3 شهور'], [180, '6 شهور'], [365, 'سنة']]
      .map(([d, l]) => `<button type="button" onclick="document.getElementById('planDurationInput').value=${d}" class="px-2.5 py-1 rounded-lg text-[11px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 transition">${l}</button>`).join('');
    input.parentElement.appendChild(chips);
    const hint = document.createElement('p');
    hint.className = 'text-[10px] text-neutral-500 mt-1.5';
    hint.textContent = 'الخطط من 28 يوم فأكتر بتنتهي في نفس اليوم من الشهر (1/10 + شهر = 1/11).';
    input.parentElement.appendChild(hint);
  }

  function openPlanModal(id) {
    const p = typeof id === 'string' ? plans.find(x => x.id === id) : null;
    $('editingPlanId').value = p ? p.id : '';
    $('planNameInput').value = p ? p.name : '';
    $('planDurationInput').value = p ? p.days : '';
    $('planPriceInput').value = p ? p.price : '';
    $('planModalTitle').innerHTML = `<i class="fa-solid fa-tags text-indigo-400"></i> ${p ? 'تعديل الخطة' : 'إضافة خطة اشتراك جديدة'}`;
    $('planSaveBtnText').textContent = p ? 'حفظ التعديل' : 'حفظ الخطة';
    $('planModal').classList.remove('hidden');
    setTimeout(() => $('planNameInput').focus(), 50);
  }
  function closePlanModal() { $('planModal').classList.add('hidden'); }

  document.addEventListener('DOMContentLoaded', () => {
    const modal = $('planModal');
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) closePlanModal(); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('planModal') && !$('planModal').classList.contains('hidden')) closePlanModal();
    if (e.key === 'Enter' && e.target && ['planNameInput', 'planDurationInput', 'planPriceInput'].includes(e.target.id)) savePlan();
  });

  /* ---------- save / delete ---------- */
  async function savePlan() {
    if (saving) return;
    if (!window.db) return toast('جاري الاتصال بقاعدة البيانات...', false);
    const editId = $('editingPlanId').value;
    const name = $('planNameInput').value.trim();
    const days = parseInt($('planDurationInput').value, 10);
    const price = Number($('planPriceInput').value);

    if (!name) { $('planNameInput').focus(); return toast('اكتب اسم الخطة', false); }
    if (!(days > 0)) { $('planDurationInput').focus(); return toast('اكتب مدة الخطة بالأيام', false); }
    if (!(price >= 0) || $('planPriceInput').value === '') { $('planPriceInput').focus(); return toast('اكتب سعر الخطة', false); }
    if (plans.some(p => p.id !== editId && p.name.toLowerCase() === name.toLowerCase())) return toast('فيه خطة بنفس الاسم', false);

    saving = true;
    const label = $('planSaveBtnText'), old = label.textContent; label.textContent = 'جاري الحفظ...';
    try {
      if (editId) {
        await window.updateDoc(window.doc(window.db, COL_PLANS, editId), { name, duration: days, price });
        // المشتركين الحاليين يفضلوا على اسم الخطة القديم لحد ما يجددوا؛ بنحدّث اسم الخطة في بياناتهم عشان الجدول يفضل متسق
        const renamed = plans.find(p => p.id === editId);
        if (renamed && renamed.name !== name) {
          const affected = members.filter(m => m.planId === editId);
          await Promise.all(affected.map(m => window.updateDoc(window.doc(window.db, COL_MEMBERS, m.id), { planName: name })));
        }
        toast('تم تعديل الخطة ✔');
      } else {
        await window.addDoc(window.collection(window.db, COL_PLANS), { name, duration: days, price, createdAt: window.serverTimestamp() });
        toast('تم إضافة الخطة ✔');
      }
      closePlanModal();
    } catch (e) {
      console.error(e); toast('فشل الحفظ: ' + (e.code || e.message), false);
    }
    label.textContent = old; saving = false;
  }

  async function deletePlan(id) {
    const p = plans.find(x => x.id === id); if (!p) return;
    const n = countFor(p);
    const msg = n
      ? `الخطة "${p.name}" عليها ${n} مشترك. لو حذفتها هتختفي من قائمة الاختيار، والمشتركين هيفضلوا بنفس بياناتهم. تحذف؟`
      : `حذف الخطة "${p.name}"؟`;
    if (!confirm(msg)) return;
    try { await window.deleteDoc(window.doc(window.db, COL_PLANS, id)); toast('تم حذف الخطة'); }
    catch (e) { console.error(e); toast('فشل الحذف: ' + (e.code || e.message), false); }
  }

  window.openPlanModal = openPlanModal;
  window.closePlanModal = closePlanModal;
  window.savePlan = savePlan;
  window.deletePlan = deletePlan;
})();













