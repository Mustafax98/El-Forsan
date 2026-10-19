/* =====================================================================
   products.js — الإعدادات ← تاب المنتجات (جيم الفرسان)
   - إدارة المنتجات: إضافة / تعديل / حذف / بحث
   - إدارة الفئات: إضافة / تعديل الاسم / حذف + عدد المنتجات في كل فئة
   Collections في Firestore:
     categories : { name }
     products   : { code, name, categoryId, categoryName, buyPrice, sellPrice, qty, notes }

   حطه في الآخر بعد باقي الملفات (بعد plans.js) عشان يحل مكان
   دوال filterProducts / addCategory القديمة:
     <script src="/products.js"></script>
   ===================================================================== */
(function () {
  'use strict';

  const COL_P = 'products', COL_C = 'categories';

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Number(n || 0).toLocaleString('en-US') + ' ج.م';
  const toast = (msg, ok = true) => {
    const t = document.createElement('div');
    t.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] px-5 py-3 rounded-xl text-sm font-bold shadow-2xl ${ok ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'}`;
    t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  };
  const fail = (e, what) => { console.error(e); toast(`${what}: ${e.code || e.message}`, false); };

  const IN = 'w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-white text-sm placeholder-neutral-600 focus:outline-none focus:border-indigo-500 transition';

  let products = [], cats = [], saving = false;

  const inCat = (p, c) => p.categoryId === c.id || (!p.categoryId && p.categoryName && p.categoryName === c.name);
  const countFor = c => products.filter(p => inCat(p, c)).length;
  const uncategorized = () => products.filter(p => !cats.some(c => inCat(p, c))).length;

  /* ---------- boot ---------- */
  function waitForDb(cb) {
    if (window.db && window.onSnapshot) return cb();
    setTimeout(() => waitForDb(cb), 100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildModal();
    // نشيل أي مستمع قديم على زر الإضافة عشان ما يتفتحش مودالين
    const old = $('addProductBtn');
    if (old) { const nb = old.cloneNode(true); old.replaceWith(nb); nb.addEventListener('click', () => openProductModal()); }
    renderAll();

    waitForDb(() => {
      window.onSnapshot(window.collection(window.db, COL_C), s => {
        cats = s.docs.map(d => ({ id: d.id, name: d.data().name || '—' })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        renderAll();
      }, e => fail(e, 'تعذر تحميل الفئات'));

      window.onSnapshot(window.collection(window.db, COL_P), s => {
        products = s.docs.map(d => {
          const x = d.data();
          return { id: d.id, code: x.code || d.id, name: x.name || '—', categoryId: x.categoryId || '', categoryName: x.categoryName || '',
            buyPrice: Number(x.buyPrice || 0), sellPrice: Number(x.sellPrice ?? x.price ?? 0), qty: Number(x.qty ?? x.quantity ?? 0), notes: x.notes || '', createdAt: x.createdAt?.seconds || 0 };
        }).sort((a, b) => b.createdAt - a.createdAt);
        renderAll();
      }, e => fail(e, 'تعذر تحميل المنتجات'));
    });
  });

  function renderAll() { renderProducts(); renderCategories(); }

  /* ---------- المنتجات ---------- */
  function renderProducts() {
    const body = $('productsTableBody'); if (!body) return;
    const q = ($('searchProductInput')?.value || '').trim().toLowerCase();
    const list = products.filter(p => !q || [p.name, p.code, p.categoryName].some(v => String(v).toLowerCase().includes(q)));
    body.innerHTML = list.map(p => {
      const qtyCls = p.qty <= 0 ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : p.qty <= 5 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      const cat = cats.find(c => inCat(p, c));
      return `<tr class="hover:bg-white/5 transition whitespace-nowrap">
        <td class="py-3 px-4 font-mono text-xs text-neutral-400">${esc(p.code)}</td>
        <td class="py-3 px-4 font-bold text-white">${esc(p.name)}</td>
        <td class="py-3 px-4">${cat ? `<span class="px-2 py-1 rounded-lg text-[11px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">${esc(cat.name)}</span>` : '<span class="text-neutral-600 text-xs">بدون فئة</span>'}</td>
        <td class="py-3 px-4 text-neutral-300">${money(p.buyPrice)}</td>
        <td class="py-3 px-4 text-amber-400 font-bold">${money(p.sellPrice)}</td>
        <td class="py-3 px-4"><span class="px-2.5 py-1 rounded-full text-xs font-bold border ${qtyCls}">${p.qty}${p.qty <= 0 ? ' · نفد' : p.qty <= 5 ? ' · قارب ينفد' : ''}</span></td>
        <td class="py-3 px-4 text-xs text-neutral-400 max-w-[180px] truncate">${esc(p.notes || '-')}</td>
        <td class="py-3 px-4 text-center">
          <button onclick="openProductModal('${p.id}')" title="تعديل" class="text-sky-400 hover:text-sky-300 px-2"><i class="fa-solid fa-pen"></i></button>
          <button onclick="deleteProduct('${p.id}')" title="حذف" class="text-rose-400 hover:text-rose-300 px-2"><i class="fa-solid fa-trash-can"></i></button>
        </td></tr>`;
    }).join('');
    const empty = $('noProductsMessage');
    if (empty) {
      empty.classList.toggle('hidden', list.length > 0);
      empty.textContent = products.length ? 'لا توجد نتائج مطابقة للبحث.' : 'لا توجد منتجات مسجلة في المتجر حالياً.';
    }
  }

  function filterProducts() { renderProducts(); }

  /* ---------- مودال المنتج ---------- */
  function buildModal() {
    if ($('productModal')) return;
    const m = document.createElement('div');
    m.id = 'productModal';
    m.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
    m.addEventListener('click', e => { if (e.target === m) closeProductModal(); });
    m.innerHTML = `
      <div class="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg shadow-2xl text-white overflow-hidden max-h-[92vh] flex flex-col">
        <div class="flex justify-between items-center p-5 border-b border-neutral-800">
          <h3 class="text-lg font-bold flex items-center gap-2" id="pmTitle"></h3>
          <button onclick="closeProductModal()" class="text-neutral-400 hover:text-white p-2 rounded-xl hover:bg-neutral-800"><i class="fa-solid fa-xmark text-lg"></i></button>
        </div>
        <div class="p-6 space-y-4 overflow-y-auto">
          <input type="hidden" id="pmId">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="sm:col-span-2"><label class="block text-xs text-neutral-400 mb-1">اسم المنتج <span class="text-red-500">*</span></label><input id="pmName" class="${IN}" placeholder="مثال: Whey Protein 2kg"></div>
            <div><label class="block text-xs text-neutral-400 mb-1">كود المنتج</label><input id="pmCode" dir="ltr" class="${IN} font-mono text-right" placeholder="تلقائي"></div>
          </div>
          <div><label class="block text-xs text-neutral-400 mb-1">الفئة</label><select id="pmCat" class="${IN}"></select>
            <p id="pmCatHint" class="hidden text-[11px] text-amber-400 mt-1">لا توجد فئات بعد، أضف فئة من تاب "إدارة الفئات".</p></div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label class="block text-xs text-neutral-400 mb-1">سعر الشراء (ج.م)</label><input id="pmBuy" type="number" min="0" step="any" class="${IN}" placeholder="0"></div>
            <div><label class="block text-xs text-neutral-400 mb-1">سعر البيع (ج.م) <span class="text-red-500">*</span></label><input id="pmSell" type="number" min="0" step="any" class="${IN}" placeholder="0"></div>
            <div><label class="block text-xs text-neutral-400 mb-1">الكمية المتاحة</label><input id="pmQty" type="number" min="0" step="1" class="${IN}" placeholder="0"></div>
          </div>
          <div><label class="block text-xs text-neutral-400 mb-1">ملاحظات</label><textarea id="pmNotes" rows="2" class="${IN}"></textarea></div>
        </div>
        <div class="flex justify-end gap-2 p-4 border-t border-neutral-800 bg-neutral-900/90">
          <button onclick="closeProductModal()" class="bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition">إلغاء</button>
          <button onclick="saveProduct()" class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2"><i class="fa-solid fa-floppy-disk"></i> <span id="pmSaveText">حفظ المنتج</span></button>
        </div>
      </div>`;
    document.body.appendChild(m);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !m.classList.contains('hidden')) closeProductModal();
    });
  }

  function nextCode() {
    let code; do { code = 'P-' + Math.floor(1000 + Math.random() * 9000); } while (products.some(p => p.code === code));
    return code;
  }

  function openProductModal(id) {
    const p = typeof id === 'string' ? products.find(x => x.id === id) : null;
    const selCat = p ? (cats.find(c => inCat(p, c))?.id || '') : '';
    $('pmId').value = p ? p.id : '';
    $('pmTitle').innerHTML = `<i class="fa-solid fa-box text-indigo-400"></i> ${p ? 'تعديل المنتج' : 'إضافة منتج جديد'}`;
    $('pmSaveText').textContent = p ? 'حفظ التعديل' : 'حفظ المنتج';
    $('pmName').value = p ? p.name : '';
    $('pmCode').value = p ? p.code : nextCode();
    $('pmBuy').value = p ? p.buyPrice : '';
    $('pmSell').value = p ? p.sellPrice : '';
    $('pmQty').value = p ? p.qty : '';
    $('pmNotes').value = p ? p.notes : '';
    $('pmCat').innerHTML = '<option value="">بدون فئة</option>' + cats.map(c => `<option value="${c.id}" ${c.id === selCat ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    $('pmCatHint').classList.toggle('hidden', cats.length > 0);
    $('productModal').classList.remove('hidden');
    setTimeout(() => $('pmName').focus(), 50);
  }
  function closeProductModal() { $('productModal').classList.add('hidden'); }

  async function saveProduct() {
    if (saving) return;
    if (!window.db) return toast('جاري الاتصال بقاعدة البيانات...', false);
    const id = $('pmId').value, name = $('pmName').value.trim(), code = $('pmCode').value.trim() || nextCode();
    const buy = Number($('pmBuy').value || 0), sell = Number($('pmSell').value), qty = Number($('pmQty').value || 0);
    if (!name) { $('pmName').focus(); return toast('اكتب اسم المنتج', false); }
    if ($('pmSell').value === '' || !(sell >= 0)) { $('pmSell').focus(); return toast('اكتب سعر البيع', false); }
    if (!(buy >= 0)) { $('pmBuy').focus(); return toast('سعر الشراء غير صحيح', false); }
    if (!(qty >= 0) || !Number.isInteger(qty)) { $('pmQty').focus(); return toast('الكمية لازم تكون رقم صحيح', false); }
    if (products.some(p => p.id !== id && p.code === code)) return toast('كود المنتج مستخدم قبل كده', false);
    if (products.some(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) return toast('فيه منتج بنفس الاسم', false);

    const cat = cats.find(c => c.id === $('pmCat').value);
    const data = { code, name, categoryId: cat?.id || '', categoryName: cat?.name || '', buyPrice: buy, sellPrice: sell, qty, notes: $('pmNotes').value.trim() };

    saving = true;
    const label = $('pmSaveText'), prev = label.textContent; label.textContent = 'جاري الحفظ...';
    try {
      if (id) await window.updateDoc(window.doc(window.db, COL_P, id), data);
      else await window.addDoc(window.collection(window.db, COL_P), { ...data, createdAt: window.serverTimestamp() });
      toast(id ? 'تم تعديل المنتج ✔' : 'تم إضافة المنتج ✔');
      closeProductModal();
    } catch (e) { fail(e, 'فشل الحفظ'); }
    label.textContent = prev; saving = false;
  }

  async function deleteProduct(id) {
    const p = products.find(x => x.id === id); if (!p) return;
    if (!confirm(`حذف المنتج "${p.name}"؟`)) return;
    try { await window.deleteDoc(window.doc(window.db, COL_P, id)); toast('تم حذف المنتج'); }
    catch (e) { fail(e, 'فشل الحذف'); }
  }

  /* ---------- الفئات ---------- */
  function renderCategories() {
    const box = $('categoriesList'); if (!box) return;
    if (!cats.length) {
      box.innerHTML = '<p class="text-sm text-neutral-500">لا توجد فئات بعد. اكتب اسم الفئة فوق واضغط "حفظ الفئة".</p>';
      return;
    }
    const un = uncategorized();
    const summary = `<div class="w-full flex flex-wrap gap-2 text-[11px] mb-1">
      <span class="px-2.5 py-1 rounded-full bg-neutral-800 text-neutral-300 border border-neutral-700">${cats.length} فئة</span>
      <span class="px-2.5 py-1 rounded-full bg-neutral-800 text-neutral-300 border border-neutral-700">${products.length} منتج</span>
      ${un ? `<span class="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">${un} منتج بدون فئة</span>` : ''}</div>`;
    box.innerHTML = summary + cats.map(c => {
      const n = countFor(c);
      return `<div class="flex items-center gap-3 bg-neutral-950 border border-neutral-800 hover:border-neutral-700 rounded-xl px-4 py-3 transition min-w-[210px]">
        <span class="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 flex items-center justify-center"><i class="fa-solid fa-layer-group text-xs"></i></span>
        <div class="flex-1"><p class="text-sm font-bold text-white">${esc(c.name)}</p>
          <p class="text-[11px] ${n ? 'text-emerald-400' : 'text-neutral-500'}">${n} منتج</p></div>
        <button onclick="renameCategory('${c.id}')" title="تعديل الاسم" class="text-sky-400 hover:text-sky-300 px-1.5"><i class="fa-solid fa-pen text-xs"></i></button>
        <button onclick="deleteCategory('${c.id}')" title="حذف" class="text-rose-400 hover:text-rose-300 px-1.5"><i class="fa-solid fa-trash-can text-xs"></i></button>
      </div>`;
    }).join('');
  }

  async function addCategory() {
    const input = $('categoryNameInput'); if (!input) return;
    const name = input.value.trim();
    if (!window.db) return toast('جاري الاتصال بقاعدة البيانات...', false);
    if (!name) { input.focus(); return toast('اكتب اسم الفئة', false); }
    if (cats.some(c => c.name.toLowerCase() === name.toLowerCase())) return toast('الفئة دي موجودة قبل كده', false);
    try {
      await window.addDoc(window.collection(window.db, COL_C), { name, createdAt: window.serverTimestamp() });
      input.value = ''; toast('تم إضافة الفئة ✔');
    } catch (e) { fail(e, 'فشل الحفظ'); }
  }

  async function renameCategory(id) {
    const c = cats.find(x => x.id === id); if (!c) return;
    const name = (prompt('اسم الفئة الجديد:', c.name) || '').trim();
    if (!name || name === c.name) return;
    if (cats.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return toast('فيه فئة بنفس الاسم', false);
    try {
      await window.updateDoc(window.doc(window.db, COL_C, id), { name });
      // نحدّث اسم الفئة في المنتجات اللي عليها
      await Promise.all(products.filter(p => inCat(p, c)).map(p => window.updateDoc(window.doc(window.db, COL_P, p.id), { categoryId: id, categoryName: name })));
      toast('تم تعديل الفئة ✔');
    } catch (e) { fail(e, 'فشل التعديل'); }
  }

  async function deleteCategory(id) {
    const c = cats.find(x => x.id === id); if (!c) return;
    const n = countFor(c);
    if (n) return toast(`الفئة "${c.name}" فيها ${n} منتج، انقل المنتجات لفئة تانية الأول`, false);
    if (!confirm(`حذف الفئة "${c.name}"؟`)) return;
    try { await window.deleteDoc(window.doc(window.db, COL_C, id)); toast('تم حذف الفئة'); }
    catch (e) { fail(e, 'فشل الحذف'); }
  }

  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'categoryNameInput') addCategory(); });

  window.filterProducts = filterProducts;
  window.openProductModal = openProductModal;
  window.closeProductModal = closeProductModal;
  window.saveProduct = saveProduct;
  window.deleteProduct = deleteProduct;
  window.addCategory = addCategory;
  window.renameCategory = renameCategory;
  window.deleteCategory = deleteCategory;
})();