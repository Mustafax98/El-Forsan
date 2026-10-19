/* =====================================================================
   general-settings.js — الإعدادات ← إعدادات عامة (جيم الفرسان)
   - تعديل اسم الجيم  → بيظهر في الهيدر وعنوان التاب
   - رفع / إزالة اللوجو → بيتصغّر تلقائياً (256px) ويتخزن جوه Firestore
   التخزين: document واحد  settings/general  { title, logo, updatedAt }
   بيحل مكان دوال stageLogoUpload / stageRemoveLogo / saveChangesManually
   (حطه بعد taps.js وباقي الملفات عشان يكسب):
     <script src="/general-settings.js"></script>
   ===================================================================== */
(function () {
  'use strict';

  const DEFAULT_TITLE = 'EL-Forsan GYM';
  const PLACEHOLDER = 'https://placehold.co/100x100/1e293b/94a3b8?text=NO+LOGO';
  const MAX_FILE = 5 * 1024 * 1024; // 5MB (زي ما مكتوب في الصفحة)
  const MAX_SIDE = 256;             // أقصى عرض/ارتفاع بعد التصغير

  const $ = id => document.getElementById(id);
  const toast = (msg, ok = true) => {
    const t = document.createElement('div');
    t.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] px-5 py-3 rounded-xl text-sm font-bold shadow-2xl ${ok ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'}`;
    t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
  };

  let saved = { title: '', logo: '' };
  let stagedLogo; // undefined = من غير تغيير | '' = إزالة | 'data:...' = لوجو جديد
  let titleDirty = false, busy = false;

  /* ---------- كاش محلي عشان الاسم واللوجو يظهروا فوراً من غير وميض ---------- */
  const cacheRead = () => {
    try { return { title: localStorage.getItem('gym_title') || '', logo: localStorage.getItem('gym_logo') || '' }; }
    catch (e) { return { title: '', logo: '' }; }
  };
  const cacheWrite = () => {
    try { localStorage.setItem('gym_title', saved.title); localStorage.setItem('gym_logo', saved.logo); } catch (e) { /* مساحة ممتلئة: عادي */ }
  };

  /* ---------- تطبيق الاسم واللوجو على الصفحة ---------- */
  function apply() {
    const title = saved.title || DEFAULT_TITLE;
    const h = $('previewTitleDisplay'); if (h) h.textContent = title;
    const img = $('previewLogo'); if (img) img.src = saved.logo || PLACEHOLDER;
    document.title = title;
  }

  /* ---------- boot ---------- */
  function waitForDb(cb) {
    if (window.db && window.onSnapshot) return cb();
    setTimeout(() => waitForDb(cb), 100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    saved = cacheRead();
    apply();
    const input = $('inputTitle');
    if (input) {
      if (saved.title) input.value = saved.title;
      input.addEventListener('input', () => { titleDirty = true; });
    }
    waitForDb(() => {
      window.onSnapshot(window.doc(window.db, 'settings', 'general'), snap => {
        if (!snap.exists()) { if (input && !input.value) input.value = DEFAULT_TITLE; return; }
        const d = snap.data();
        saved = { title: d.title || '', logo: d.logo || '' };
        cacheWrite(); apply();
        if (input && !titleDirty) input.value = saved.title || DEFAULT_TITLE;
      }, e => { console.error(e); toast('تعذر تحميل الإعدادات: ' + (e.code || e.message), false); });
    });
  });

  /* ---------- معالجة الصورة: تصغير + تحويل لـ Data URL ---------- */
  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = () => rej(new Error('تعذر قراءة الملف'));
      r.readAsDataURL(file);
    });
  }

  async function processImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('الملف لازم يكون صورة');
    if (file.size > MAX_FILE) throw new Error('حجم الصورة أكبر من 5MB');
    if (file.type === 'image/svg+xml') {
      const url = await readAsDataURL(file);
      if (url.length > 400000) throw new Error('ملف SVG كبير، استخدم PNG أو JPG');
      return url;
    }
    const src = await readAsDataURL(file);
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('الصورة تالفة'));
      i.src = src;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const jpeg = file.type === 'image/jpeg';
    if (jpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    return jpeg ? c.toDataURL('image/jpeg', 0.88) : c.toDataURL('image/png');
  }

  /* ---------- معاينة اللوجو الجديد جوه مربع الرفع (قبل الحفظ) ---------- */
  function renderStage() {
    const label = $('logoInput')?.closest('label'); if (!label) return;
    let box = $('logoStage');
    if (stagedLogo === undefined) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'logoStage';
      box.className = 'flex items-center gap-3 mb-2';
      label.insertBefore(box, label.firstChild);
    }
    box.innerHTML = stagedLogo
      ? `<img src="${stagedLogo}" alt="" class="w-14 h-14 rounded-xl object-cover border border-slate-700 bg-slate-900">
         <span class="text-[11px] font-bold text-amber-400">لوجو جديد — لم يُحفظ بعد</span>`
      : `<img src="${PLACEHOLDER}" alt="" class="w-14 h-14 rounded-xl object-cover border border-slate-700 bg-slate-900 opacity-60">
         <span class="text-[11px] font-bold text-rose-400">سيتم إزالة اللوجو عند الحفظ</span>`;
  }

  async function stageLogoUpload(ev) {
    const file = ev?.target?.files?.[0]; if (!file) return;
    try {
      stagedLogo = await processImage(file);
      renderStage();
      toast('تم اختيار اللوجو — اضغط "حفظ في البيانات"');
    } catch (e) {
      console.error(e); toast(e.message || 'تعذر معالجة الصورة', false);
      ev.target.value = '';
    }
  }

  function stageRemoveLogo() {
    stagedLogo = '';
    const f = $('logoInput'); if (f) f.value = '';
    renderStage();
  }

  /* ---------- الحفظ ---------- */
  async function saveChangesManually() {
    if (busy) return;
    const title = ($('inputTitle')?.value || '').trim();
    if (!title) { $('inputTitle')?.focus(); return toast('اكتب اسم الجيم', false); }
    if (!window.db) return toast('جاري الاتصال بقاعدة البيانات...', false);

    const data = { title };
    if (stagedLogo !== undefined) data.logo = stagedLogo;

    busy = true;
    const btn = $('saveBtn'), prev = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin ml-2"></i> جاري الحفظ...'; }
    try {
      await window.runTransaction(window.db, async tx => {
        tx.set(window.doc(window.db, 'settings', 'general'), { ...data, updatedAt: window.serverTimestamp() }, { merge: true });
      });
      saved = { title, logo: stagedLogo !== undefined ? stagedLogo : saved.logo };
      stagedLogo = undefined; titleDirty = false;
      const f = $('logoInput'); if (f) f.value = '';
      cacheWrite(); apply(); renderStage();
      toast('تم حفظ الإعدادات ✔');
    } catch (e) {
      console.error(e); toast('فشل الحفظ: ' + (e.code || e.message), false);
    }
    if (btn) { btn.disabled = false; btn.innerHTML = prev; }
    busy = false;
  }

  window.stageLogoUpload = stageLogoUpload;
  window.stageRemoveLogo = stageRemoveLogo;
  window.saveChangesManually = saveChangesManually;
})();


// ===== تبديل الثيم (داكن / فاتح) =====
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('gym-theme', theme); } catch (e) {}
    updateThemeButtons(theme);
}

function updateThemeButtons(theme) {
    const icon = document.getElementById('themeToggleIcon');
    const text = document.getElementById('themeToggleText');
    if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    if (text) text.textContent = theme === 'dark' ? 'الوضع الداكن (اضغط للفاتح)' : 'الوضع الفاتح (اضغط للداكن)';
}

function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(cur === 'dark' ? 'light' : 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
    updateThemeButtons(document.documentElement.getAttribute('data-theme') || 'dark');
});

window.setTheme = setTheme;
window.toggleTheme = toggleTheme;
