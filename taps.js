// ===================== J-tabs.js =====================

const ACTIVE_CLASSES = ['text-black'];
const INACTIVE_CLASSES = ['text-neutral-400', 'hover:text-white'];

// تحريك الـ pill تحت الزر النشط
function movePill(pill, btn) {
    if (!pill || !btn || btn.offsetWidth === 0) return; // لو التاب مخفي القياس بيكون 0
    pill.style.width = btn.offsetWidth + 'px';
    pill.style.left = btn.offsetLeft + 'px';
}

// دالة عامة لتفعيل تاب واحد وإخفاء الباقي
function activateTab({ btnPrefix, contentPrefix, count, index, pillId }) {
    for (let i = 1; i <= count; i++) {
        const btn = document.getElementById(`${btnPrefix}${i}`);
        // querySelectorAll عشان لو فيه IDs مكررة في الـ HTML
        const contents = document.querySelectorAll(`[id="${contentPrefix}${i}"]`);

        if (btn) {
            btn.classList.remove(...ACTIVE_CLASSES, ...INACTIVE_CLASSES);
            btn.classList.add(...(i === index ? ACTIVE_CLASSES : INACTIVE_CLASSES));
        }
        contents.forEach(el => el.classList.toggle('hidden', i !== index));
    }
    movePill(document.getElementById(pillId), document.getElementById(`${btnPrefix}${index}`));
}

// ---------- التابس الأساسية ----------
const MAIN_COUNT = 4;

function switchMainTab(index) {
    activateTab({
        btnPrefix: 'main-tab-',
        contentPrefix: 'content-main-',
        count: MAIN_COUNT,
        index,
        pillId: 'main-slider-pill'
    });

    // تاب الإعدادات كان مخفي فمقاسات الـ pills كانت صفر، نعيد حسابها
    if (index === 4) {
        requestAnimationFrame(() => {
            switchSubTab(4, currentSubTab[4]);
        });
    }
    localStorage.setItem('gym_main_tab', index);
}

// ---------- التابس الفرعية (داخل الإعدادات) ----------
const SUB_COUNTS = { 4: 10 };
const currentSubTab = { 4: 1 };

function switchSubTab(group, index) {
    currentSubTab[group] = index;
    activateTab({
        btnPrefix: `sub-${group}-tab-`,
        contentPrefix: `sub-${group}-content-`,
        count: SUB_COUNTS[group],
        index,
        pillId: `sub-${group}-slider-pill`
    });

    // تاب "المنتجات" (رقم 3) جواه تابس داخلية
    if (group === 4 && index === 3) {
        requestAnimationFrame(() => switchInnerSubTab(currentInnerTab));
    }

    // اسكرول للزر النشط في الموبايل
    document.getElementById(`sub-${group}-tab-${index}`)
        ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

    localStorage.setItem(`gym_sub_tab_${group}`, index);
}

// ---------- التابس الداخلية (إدارة المنتجات / الفواتير / الفئات) ----------
let currentInnerTab = 1;

function switchInnerSubTab(index) {
    currentInnerTab = index;
    activateTab({
        btnPrefix: 'inner-sub-tab-',
        contentPrefix: 'inner-sub-content-',
        count: 3,
        index,
        pillId: 'inner-sub-slider-pill'
    });
}

// ---------- ربط الدوال بالـ HTML (onclick) ----------
window.switchMainTab = switchMainTab;
window.switchSubTab = switchSubTab;
window.switchInnerSubTab = switchInnerSubTab;

// ---------- التهيئة ----------
document.addEventListener('DOMContentLoaded', () => {
    currentSubTab[4] = Number(localStorage.getItem('gym_sub_tab_4')) || 1;
    switchSubTab(4, currentSubTab[4]);
    switchInnerSubTab(1);
    switchMainTab(Number(localStorage.getItem('gym_main_tab')) || 1);
});

// إعادة ضبط الـ pills عند تغيير حجم الشاشة
window.addEventListener('resize', () => {
    const main = document.querySelector('.main-tab-btn.text-black');
    movePill(document.getElementById('main-slider-pill'), main);
    movePill(document.getElementById('sub-4-slider-pill'),
        document.getElementById(`sub-4-tab-${currentSubTab[4]}`));
    movePill(document.getElementById('inner-sub-slider-pill'),
        document.getElementById(`inner-sub-tab-${currentInnerTab}`));
});