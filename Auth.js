/* =====================================================================
   auth.js — تسجيل الدخول والصلاحيات (جيم الفرسان)   [type="module"]
   - شاشة دخول واحدة: المشترك (موبايل + كلمة سر) أو الإدارة (إيميل + كلمة سر)
   - الإدارة  → لوحة التحكم الحالية (window.db بيتفعّل بعد الدخول بس)
   - المشترك → تطبيق المشترك (member-app.js) وبيشوف بياناته بس
   - الحماية الحقيقية من ملف firestore.rules
   حساب المشترك في Firebase Auth = إيميل مشتق من الموبايل:
        <phone>.r<rev>@members.elforsan.app
   (rev بيزيد لما الإدارة تعمل "إعادة ضبط كلمة السر"، ومتخزن في loginHints/<phone>)
   ===================================================================== */
import { getApp, initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const MEMBER_DOMAIN = 'members.elforsan.app';
const app = getApp(), auth = getAuth(app), fs = getFirestore(app);

const digits = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '');
const emailFor = (phone, rev) => `${digits(phone)}.r${rev}@${MEMBER_DOMAIN}`;
const isMemberUser = u => !!u && String(u.email || '').endsWith('@' + MEMBER_DOMAIN);

/* ---------- أدوات بتستخدمها باقي الملفات ---------- */
async function createMemberAuth(phone, rev, password) {
  // بنستخدم نسخة تانية من التطبيق عشان الأدمن ما يتسجلش خروج لما نعمل حساب لمشترك
  const app2 = initializeApp(app.options, 'sec-' + Date.now());
  try {
    const a2 = getAuth(app2);
    const cred = await createUserWithEmailAndPassword(a2, emailFor(phone, rev), password);
    const uid = cred.user.uid;
    await signOut(a2);
    return uid;
  } finally { await deleteApp(app2).catch(() => { }); }
}
async function changePassword(oldPw, newPw) {
  const u = auth.currentUser;
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, oldPw));
  await updatePassword(u, newPw);
}
const logout = () => signOut(auth).then(() => location.reload());

window.FBX = { auth, MEMBER_DOMAIN, digits, emailFor, isMemberUser, createMemberAuth, changePassword, logout, getDoc, setDoc, deleteDoc };

/* ---------- واجهة الدخول ---------- */
const MSG = {
  'auth/invalid-credential': 'بيانات الدخول غير صحيحة',
  'auth/wrong-password': 'بيانات الدخول غير صحيحة',
  'auth/user-not-found': 'بيانات الدخول غير صحيحة',
  'auth/invalid-email': 'الإيميل غير صحيح',
  'auth/too-many-requests': 'محاولات كتير، استنى شوية وجرّب تاني',
  'auth/network-request-failed': 'مشكلة في الاتصال بالإنترنت',
  'auth/user-disabled': 'الحساب متوقف',
  'no-account': 'الحساب ده لسه مش مفعّل، كلّم إدارة الجيم',
  'permission-denied': 'تعذر التحقق من الحساب، راجع إعدادات الـ Rules'
};
const cache = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const adminEls = () => [document.querySelector('header'), document.querySelector('main')].filter(Boolean);
const setAdmin = v => adminEls().forEach(e => { e.style.display = v ? '' : 'none'; });

const overlay = document.createElement('div');
overlay.id = 'authOverlay';
overlay.dir = 'rtl';
overlay.className = 'fixed inset-0 z-[400] bg-black text-white flex items-center justify-center p-4 overflow-y-auto';
overlay.style.fontFamily = "'Cairo', sans-serif";
document.body.appendChild(overlay);
setAdmin(false);
showLoading();

function showLoading() {
  overlay.innerHTML = '<div class="text-neutral-400 text-sm flex items-center gap-2"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</div>';
}

function showLogin(mode = 'member') {
  const title = cache('gym_title') || 'EL-Forsan GYM', logo = cache('gym_logo');
  const isM = mode === 'member';
  overlay.innerHTML = `
    <div class="w-full max-w-sm">
      <div class="text-center mb-6">
        <div class="w-20 h-20 mx-auto rounded-2xl bg-slate-900 border border-slate-700 overflow-hidden flex items-center justify-center mb-3">
          <img src="${logo || 'https://placehold.co/100x100/1e293b/94a3b8?text=GYM'}" class="w-full h-full object-cover" alt="">
        </div>
        <h1 class="text-2xl font-black">${title.replace(/</g, '&lt;')}</h1>
        <p class="text-sm text-neutral-400 mt-1">${isM ? 'تسجيل دخول المشترك' : 'تسجيل دخول الإدارة'}</p>
      </div>
      <form id="authForm" class="bg-neutral-900/80 border border-neutral-800 rounded-2xl p-5 space-y-4">
        <div>
          <label class="text-xs text-neutral-400">${isM ? 'رقم الموبايل' : 'الإيميل'}</label>
          <input id="authUser" ${isM ? 'type="tel" inputmode="numeric" placeholder="01xxxxxxxxx"' : 'type="email" placeholder="admin@example.com"'} dir="ltr" autocomplete="username"
            class="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-3 text-sm text-white text-right focus:outline-none focus:border-emerald-500">
        </div>
        <div>
          <label class="text-xs text-neutral-400">كلمة السر</label>
          <div class="relative">
            <input id="authPass" type="password" dir="ltr" autocomplete="current-password"
              class="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-10 pr-3.5 py-3 text-sm text-white text-right focus:outline-none focus:border-emerald-500">
            <button type="button" id="authEye" class="absolute left-3 top-1/2 -translate-y-1/2 mt-0.5 text-neutral-500 hover:text-white"><i class="fa-solid fa-eye text-xs"></i></button>
          </div>
        </div>
        <p id="authErr" class="hidden text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5"></p>
        <button id="authBtn" type="submit" class="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-xl transition">دخول</button>
      </form>
      <button id="authSwitch" class="block mx-auto mt-4 text-xs text-neutral-500 hover:text-neutral-300">${isM ? 'دخول الإدارة' : 'دخول المشتركين'}</button>
    </div>`;
  const $ = id => document.getElementById(id);
  $('authEye').onclick = () => { const p = $('authPass'); p.type = p.type === 'password' ? 'text' : 'password'; };
  $('authSwitch').onclick = () => showLogin(isM ? 'admin' : 'member');
  $('authForm').onsubmit = async e => {
    e.preventDefault();
    const err = $('authErr'), btn = $('authBtn'), u = $('authUser').value.trim(), pw = $('authPass').value;
    err.classList.add('hidden');
    if (!u || !pw) { err.textContent = 'اكتب بيانات الدخول'; return err.classList.remove('hidden'); }
    btn.disabled = true; btn.textContent = 'جاري الدخول...';
    try {
      if (isM) {
        const p = digits(u);
        const hint = await getDoc(doc(fs, 'loginHints', p));
        if (!hint.exists()) throw { code: 'no-account' };
        await signInWithEmailAndPassword(auth, emailFor(p, hint.data().rev ?? 0), pw);
      } else {
        await signInWithEmailAndPassword(auth, u, pw);
      }
    } catch (ex) {
      console.error(ex);
      err.textContent = MSG[ex.code] || ('تعذر تسجيل الدخول: ' + (ex.code || ex.message));
      err.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'دخول';
    }
  };
  $('authUser').focus();
}

function addAdminLogout() {
  if (document.getElementById('adminLogoutBtn')) return;
  const nav = document.querySelector('header nav'); if (!nav) return;
  const b = document.createElement('button');
  b.id = 'adminLogoutBtn';
  b.className = 'shrink-0 text-xs font-semibold text-rose-400 hover:text-rose-300 bg-rose-500/10 border border-rose-500/20 px-3 py-2.5 rounded-xl transition';
  b.innerHTML = '<i class="fa-solid fa-right-from-bracket ml-1"></i> خروج';
  b.onclick = logout;
  nav.insertAdjacentElement('afterend', b);
}

/* ---------- توجيه حسب نوع المستخدم ---------- */
onAuthStateChanged(auth, user => {
  if (!user) { setAdmin(false); showLogin('member'); return; }
  overlay.remove();
  if (isMemberUser(user)) {
    setAdmin(false);
    window.__memberUser = user;
    window.dispatchEvent(new CustomEvent('member-ready', { detail: { user } }));
  } else {
    setAdmin(true);
    window.db = window.__db;           // لوحة الإدارة بتبدأ تشتغل من هنا
    window.__adminReady = true;
    addAdminLogout();
    window.dispatchEvent(new Event('admin-ready'));
  }
});