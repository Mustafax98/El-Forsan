/* =====================================================================
   store-pos.js — تاب المتجر (نقطة البيع POS) — جيم الفرسان
   بيعرض المنتجات والفئات اللي في الإعدادات (collections: products + categories)،
   مع بحث، وفلتر الفئات، وسلة، وبحث عن مشترك بالموبايل، وإتمام البيع.
   إتمام البيع بيخصم الكمية من المخزون ويسجل الفاتورة في collection اسمها "sales".

   ده بيحل مكان store-pos.js القديم بالكامل.
   ===================================================================== */
(function () {
  'use strict';

  const COL_P = 'products', COL_C = 'categories', COL_M = 'subscribers', COL_S = 'sales';

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

  let products = [], cats = [], members = [];
  let activeCat = 'all', cart = [], busy = false;

  const catOf = p => cats.find(c => c.id === p.categoryId || (!p.categoryId && p.categoryName && p.categoryName === c.name));

  /* ---------- boot ---------- */
  function waitForDb(cb) {
    if (window.db && window.onSnapshot) return cb();
    setTimeout(() => waitForDb(cb), 100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderAll();
    document.addEventListener('click', e => {
      const box = $('membersSuggestions');
      if (box && !box.contains(e.target) && e.target.id !== 'buyerPhone') box.classList.add('hidden');
    });
    waitForDb(() => {
      window.onSnapshot(window.collection(window.db, COL_C), s => {
        cats = s.docs.map(d => ({ id: d.id, name: d.data().name || '—' })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        if (activeCat !== 'all' && activeCat !== 'none' && !cats.some(c => c.id === activeCat)) activeCat = 'all';
        renderAll();
      }, e => console.error(e));

      window.onSnapshot(window.collection(window.db, COL_P), s => {
        products = s.docs.map(d => {
          const x = d.data();
          return {
            id: d.id, code: x.code || '', name: x.name || '—', categoryId: x.categoryId || '', categoryName: x.categoryName || '',
            buyPrice: Number(x.buyPrice || 0), sellPrice: Number(x.sellPrice ?? x.price ?? 0), qty: Number(x.qty ?? x.quantity ?? 0), createdAt: x.createdAt?.seconds || 0
          };
        }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        renderAll();
      }, e => { console.error(e); toast('تعذر تحميل المنتجات: ' + (e.code || e.message), false); });

      window.onSnapshot(window.collection(window.db, COL_M), s => {
        members = s.docs.map(d => { const x = d.data(); return { id: d.id, name: x.name || '', phone: String(x.phone || ''), code: x.code || x.id || '' }; });
      });
    });
  });

  function renderAll() { renderCategories(); renderProducts(); renderCart(); }

  /* ---------- الفئات ---------- */
  function renderCategories() {
    const bar = $('categoriesFilterBar'); if (!bar) return;
    const btn = (key, label, n) => {
      const on = activeCat === key;
      return `<button onclick="filterStoreByCategory('${key}')" id="catBtn_${key}" class="cat-filter-btn px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${on ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}">${esc(label)} <span class="text-[11px] opacity-70">(${n})</span></button>`;
    };
    const none = products.filter(p => !catOf(p)).length;
    bar.innerHTML = btn('all', 'عرض الكل', products.length)
      + cats.map(c => btn(c.id, c.name, products.filter(p => catOf(p) === c).length)).join('')
      + (none && cats.length ? btn('none', 'بدون فئة', none) : '');
  }

  function filterStoreByCategory(key) { activeCat = key; renderCategories(); renderProducts(); }
  function searchPosProducts() { renderProducts(); }

  /* ---------- المنتجات ---------- */
  function renderProducts() {
    const grid = $('productsGrid'); if (!grid) return;
    const q = ($('posSearchInput')?.value || '').trim().toLowerCase();
    const list = products.filter(p => {
      if (activeCat === 'none' ? !!catOf(p) : activeCat !== 'all' && catOf(p)?.id !== activeCat) return false;
      return !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
    });
    grid.className = 'grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4';
    grid.innerHTML = list.map(p => {
      const inCart = cart.find(i => i.id === p.id)?.qty || 0;
      const out = p.qty <= 0, low = !out && p.qty <= 5, full = inCart >= p.qty;
      const c = catOf(p);
      return `<button onclick="addToCart('${p.id}')" ${out ? 'disabled' : ''} class="text-right bg-gray-900 border ${inCart ? 'border-indigo-500' : 'border-gray-800'} ${out ? 'opacity-50 cursor-not-allowed' : 'hover:border-indigo-500/60 hover:-translate-y-0.5 active:translate-y-0'} rounded-2xl p-4 transition-all shadow-lg flex flex-col gap-3 relative">
        ${inCart ? `<span class="absolute top-2 left-2 min-w-6 h-6 px-1.5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center">${inCart}</span>` : ''}
        <div class="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 flex items-center justify-center"><i class="fa-solid fa-box-open"></i></div>
        <div class="space-y-1">
          <p class="text-sm font-bold text-white leading-snug">${esc(p.name)}</p>
          ${c ? `<span class="inline-block px-2 py-0.5 rounded-md text-[10px] bg-gray-800 text-gray-400">${esc(c.name)}</span>` : ''}
        </div>
        <div class="flex items-center justify-between mt-auto">
          <span class="text-base font-black text-emerald-400">${money(p.sellPrice)}</span>
          <span class="text-[10px] px-2 py-0.5 rounded-full border ${out ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : low ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-gray-800 text-gray-400 border-gray-700'}">${out ? 'نفد' : (full ? 'الحد الأقصى' : 'متاح ' + p.qty)}</span>
        </div></button>`;
    }).join('');
    const empty = $('noStoreProductsMsg');
    if (empty) {
      empty.classList.toggle('hidden', list.length > 0);
      empty.textContent = products.length ? 'لا توجد منتجات مطابقة في هذه الفئة حالياً.' : 'لا توجد منتجات بعد. أضفها من الإعدادات ← المنتجات.';
    }
  }

  /* ---------- السلة ---------- */
  function addToCart(id) {
    const p = products.find(x => x.id === id); if (!p) return;
    const it = cart.find(i => i.id === id);
    if (it) { if (it.qty >= p.qty) return toast(`المتاح من "${p.name}" ${p.qty} فقط`, false); it.qty++; }
    else { if (p.qty <= 0) return toast('المنتج نفد', false); cart.push({ id, qty: 1 }); }
    renderCart(); renderProducts();
  }
  function cartStep(id, d) {
    const it = cart.find(i => i.id === id), p = products.find(x => x.id === id); if (!it || !p) return;
    if (d > 0 && it.qty >= p.qty) return toast(`المتاح من "${p.name}" ${p.qty} فقط`, false);
    it.qty += d; if (it.qty <= 0) cart = cart.filter(i => i.id !== id);
    renderCart(); renderProducts();
  }
  function cartRemove(id) { cart = cart.filter(i => i.id !== id); renderCart(); renderProducts(); }
  function clearCart() { cart = []; renderCart(); renderProducts(); }

  function cartTotal() { return cart.reduce((s, i) => s + i.qty * (products.find(p => p.id === i.id)?.sellPrice || 0), 0); }

  function renderCart() {
    const box = $('cartItemsList'); if (!box) return;
    // نظبط السلة على المخزون الحالي (منتج اتحذف أو الكمية قلّت)
    cart = cart.filter(i => products.some(p => p.id === i.id));
    cart.forEach(i => { const p = products.find(x => x.id === i.id); if (i.qty > p.qty) i.qty = p.qty; });
    cart = cart.filter(i => i.qty > 0);

    box.innerHTML = cart.length ? cart.map(i => {
      const p = products.find(x => x.id === i.id);
      return `<div class="flex items-center gap-2 bg-gray-800/60 border border-gray-700/50 rounded-xl p-2.5">
        <div class="flex-1 min-w-0"><p class="text-xs font-bold text-white truncate">${esc(p.name)}</p><p class="text-[11px] text-gray-400">${money(p.sellPrice)} × ${i.qty} = <span class="text-emerald-400 font-bold">${money(p.sellPrice * i.qty)}</span></p></div>
        <div class="flex items-center gap-1">
          <button onclick="cartStep('${i.id}',-1)" class="w-7 h-7 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm leading-none">−</button>
          <span class="w-6 text-center text-xs font-bold">${i.qty}</span>
          <button onclick="cartStep('${i.id}',1)" class="w-7 h-7 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm leading-none">+</button>
        </div>
        <button onclick="cartRemove('${i.id}')" class="text-rose-400 hover:text-rose-300 px-1"><i class="fa-solid fa-xmark text-xs"></i></button></div>`;
    }).join('') : '<p class="text-xs text-gray-500 text-center py-6"><i class="fa-solid fa-cart-shopping block text-xl mb-2 text-gray-700"></i>السلة فاضية، اضغط على منتج لإضافته.</p>';
    const total = $('cartTotalPrice'); if (total) total.textContent = money(cartTotal());
  }

  /* ---------- المشتري ---------- */
  function searchMemberByPhone() {
    const q = ($('buyerPhone')?.value || '').trim().toLowerCase(), box = $('membersSuggestions');
    $('selectedMemberId').value = ''; // أي تعديل يدوي يلغي الربط بالمشترك
    if (!box) return;
    if (q.length < 3) return box.classList.add('hidden');
    const hits = members.filter(m => m.phone.includes(q) || m.name.toLowerCase().includes(q)).slice(0, 6);
    box.innerHTML = hits.length ? hits.map(m => `<button type="button" onclick="pickMember('${m.id}')" class="w-full text-right px-3 py-2.5 hover:bg-gray-700 border-b border-gray-700/60 last:border-0 flex items-center justify-between">
        <span class="font-bold text-white">${esc(m.name)}</span><span class="font-mono text-[11px] text-gray-400">${esc(m.phone)}</span></button>`).join('')
      : '<p class="px-3 py-3 text-gray-400 text-center">لا يوجد مشترك بهذا الرقم (هيتسجل كعميل عادي)</p>';
    box.classList.remove('hidden');
  }
  function pickMember(id) {
    const m = members.find(x => x.id === id); if (!m) return;
    $('buyerPhone').value = m.phone; $('buyerName').value = m.name; $('selectedMemberId').value = m.id;
    $('membersSuggestions').classList.add('hidden');
  }

  /* ---------- إتمام البيع ---------- */
  async function checkoutSale() {
    if (busy) return;
    if (!cart.length) return toast('السلة فاضية', false);
    if (!window.db) return toast('جاري الاتصال بقاعدة البيانات...', false);
    busy = true;
    const btn = document.querySelector('button[onclick="checkoutSale()"]'), prev = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...'; }

    const lines = cart.map(i => ({ ...i, p: products.find(x => x.id === i.id) }));
    const buyerName = ($('buyerName').value || '').trim() || 'عميل نقدي';
    const buyerPhone = ($('buyerPhone').value || '').trim();
    const memberId = $('selectedMemberId').value || '';

    try {
      const total = await window.runTransaction(window.db, async tx => {
        // قراءة كل المنتجات الأول (شرط Firestore: كل القراءات قبل الكتابات)
        const snaps = [];
        for (const l of lines) snaps.push(await tx.get(window.doc(window.db, COL_P, l.id)));
        let sum = 0; const items = [];
        snaps.forEach((snap, idx) => {
          const l = lines[idx];
          if (!snap.exists()) throw new Error(`المنتج "${l.p.name}" اتحذف`);
          const x = snap.data(), stock = Number(x.qty ?? x.quantity ?? 0), price = Number(x.sellPrice ?? x.price ?? 0);
          if (stock < l.qty) throw new Error(`المتاح من "${x.name}" ${stock} فقط`);
          sum += price * l.qty;
          items.push({ productId: l.id, name: x.name, price, buyPrice: Number(x.buyPrice || 0), qty: l.qty });
          tx.update(snap.ref, { qty: stock - l.qty });
        });
        const saleRef = window.doc(window.collection(window.db, COL_S));
        tx.set(saleRef, {
          items, total: sum, memberId, buyerName, buyerPhone, date: todayISO(), createdAt: window.serverTimestamp()
        });
        tx.set(window.doc(window.collection(window.db, 'treasury')), {
          type: 'in', source: 'store', amount: sum, date: todayISO(), party: buyerName,
          note: 'فاتورة INV-' + saleRef.id.slice(0, 6).toUpperCase(), ref: saleRef.id, createdAt: window.serverTimestamp()
        });
        return sum;
      });
      cart = []; $('buyerName').value = ''; $('buyerPhone').value = ''; $('selectedMemberId').value = '';
      renderAll();
      toast(`تم البيع ✔ الإجمالي ${money(total)}`);
    } catch (e) {
      console.error(e); toast('فشل إتمام البيع: ' + (e.message || e.code), false);
    }
    if (btn) { btn.disabled = false; btn.innerHTML = prev; }
    busy = false;
  }

  window.filterStoreByCategory = filterStoreByCategory;
  window.searchPosProducts = searchPosProducts;
  window.addToCart = addToCart;
  window.cartStep = cartStep;
  window.cartRemove = cartRemove;
  window.clearCart = clearCart;
  window.searchMemberByPhone = searchMemberByPhone;
  window.pickMember = pickMember;
  window.checkoutSale = checkoutSale;
})();