/* =====================================================================
   Home.js — الرئيسية: لوحة مؤشرات الأداء والتقارير (جيم الفرسان)
   ---------------------------------------------------------------------
   مبني على بنية البيانات الفعلية في Subscriber.js و treasury.js:
     subscribers : startDate/endDate (YYYY-MM-DD), planId, planName, planDays,
                   frozen{active,since}, renewals[{from,to,price,paid}], due,
                   payments[{date,amount}], createdAt
     plans       : name, duration|days, price
     attendance  : { memberId, date:'YYYY-MM-DD', createdAt }
     treasury    : { type:'in'|'out', source, amount, date, party, note, createdAt }
   الإيراد = وارد الخزينة من (اشتراكات + متجر) — الإيداع اليدوي مش بيتحسب إيراد.
   المصروفات = كل المنصرف (مرتجعات + مصروفات يدوية).
   حطه قبل Admin app.js:   <script src="/Home.js"></script>
   ===================================================================== */
(function () {
  'use strict';

  const CFG = {
    expiringDays: 7,          // "قارب ينتهي"
    absentDays: 7,            // عضو نشط غايب أكتر من كده = تنبيه
    retentionLookbackMin: 30, // أقل فترة لحساب الاحتفاظ
    retentionTarget: 85,
    vipMinDays: 300,          // سنوي
    midMinDays: 150,          // 6 شهور
    get monthlyTarget() { return Number(localStorage.getItem('gymMonthlyTarget')) || 50000; }
  };
  const COL = { members: 'subscribers', plans: 'plans', attendance: 'attendance', treasury: 'treasury' };

  /* ---------------- helpers ---------------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
  const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
  const today = () => fmt(new Date());
  const dmy = s => isDate(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
  const num = v => (isFinite(Number(v)) ? Number(v) : 0);
  const nf = n => Math.round(n).toLocaleString('en-US');
  const money = n => nf(n) + ' ج.م';
  const pct1 = n => (isFinite(n) ? n : 0).toFixed(1);
  const tsDate = v => (v && v.toDate) ? v.toDate() : null;
  const tsISO = v => { const d = tsDate(v); return d ? fmt(d) : ''; };
  const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  /* ---------------- state ---------------- */
  const S = {
    period: 'weekly', cFrom: '', cTo: '',
    members: [], plans: [], attendance: [], treasury: [],
    report: null
  };

  /* ---------------- normalizers ---------------- */
  function terms(m) {
    let t = (m.renewals || []).filter(r => isDate(r.from) && isDate(r.to)).map(r => ({ from: r.from, to: r.to })).sort((a, b) => a.from.localeCompare(b.from));
    if (!t.length && isDate(m.startDate) && isDate(m.endDate)) t = [{ from: m.startDate, to: m.endDate }];
    if (t.length && isDate(m.endDate) && m.endDate > t[t.length - 1].to) t[t.length - 1] = { ...t[t.length - 1], to: m.endDate };
    return t;
  }
  function status(m) {
    if (m.frozen && m.frozen.active) return 'frozen';
    if (!isDate(m.endDate)) return 'none';
    const d = diffDays(m.endDate, today());
    return d < 0 ? 'expired' : d <= CFG.expiringDays ? 'soon' : 'active';
  }
  const joinISO = m => tsISO(m.createdAt) || (terms(m)[0] && terms(m)[0].from) || '';
  const planDaysOf = m => {
    if (num(m.planDays)) return num(m.planDays);
    const p = S.plans.find(x => x.id === m.planId || x.name === m.planName);
    if (p) return p.days;
    const t = terms(m).slice(-1)[0];
    return t ? diffDays(t.to, t.from) : 0;
  };

  /* ---------------- period ---------------- */
  function getRange() {
    const t = today(), now = new Date();
    let from, to;
    if (S.period === 'daily') { from = to = t; }
    else if (S.period === 'weekly') { from = addDays(t, -6); to = t; }
    else if (S.period === 'monthly') { from = fmt(new Date(now.getFullYear(), now.getMonth(), 1)); to = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)); }
    else { from = S.cFrom; to = S.cTo; }
    const days = diffDays(to, from) + 1;
    return { from, to, days, pFrom: addDays(from, -days), pTo: addDays(from, -1) };
  }
  const within = (iso, a, b) => isDate(iso) && iso >= a && iso <= b;

  /* ---------------- calculations ---------------- */
  function finance(r) {
    const calc = (a, b) => {
      let sub = 0, store = 0, out = 0;
      S.treasury.forEach(e => {
        if (!within(e.date, a, b)) return;
        if (e.type === 'out') out += e.amount;
        else if (e.source === 'subscription') sub += e.amount;
        else if (e.source === 'store') store += e.amount;
      });
      const income = sub + store;
      return { sub, store, income, out, net: income - out };
    };
    return { cur: calc(r.from, r.to), prev: calc(r.pFrom, r.pTo) };
  }

  function memberStats(r) {
    const t = today();
    const ms = S.members.map(m => ({ m, st: status(m), terms: terms(m) }));
    const active = ms.filter(x => x.st === 'active' || x.st === 'soon');
    const expiring = ms.filter(x => x.st === 'soon').sort((a, b) => a.m.endDate.localeCompare(b.m.endDate));
    const frozen = ms.filter(x => x.st === 'frozen');
    const expiredRecently = ms.filter(x => x.st === 'expired' && diffDays(t, x.m.endDate) <= 30);

    // الاحتفاظ: الاشتراكات اللي انتهت في آخر فترة، كام منها اتجدد (في اشتراك بعده)
    const ws = addDays(t, -Math.max(r.days, CFG.retentionLookbackMin));
    let ended = 0, renewed = 0;
    ms.forEach(x => x.terms.forEach((tm, i) => {
      if (tm.to >= ws && tm.to < t) { ended++; if (i < x.terms.length - 1) renewed++; }
    }));
    const retention = ended ? (renewed / ended) * 100 : (S.members.length ? 100 : 0);

    const newCur = S.members.filter(m => within(joinISO(m), r.from, r.to)).length;
    const newPrev = S.members.filter(m => within(joinISO(m), r.pFrom, r.pTo)).length;

    const dist = { vip: 0, mid: 0, low: 0 };
    active.forEach(({ m }) => {
      const d = planDaysOf(m);
      if (/vip|سنوي/i.test(m.planName || '') || d >= CFG.vipMinDays) dist.vip++;
      else if (d >= CFG.midMinDays) dist.mid++; else dist.low++;
    });

    const dues = S.members.filter(m => num(m.due) > 0);
    return { ms, active, expiring, frozen, expiredRecently, retention, ended, renewed, newCur, newPrev, dist, dues, dueTotal: dues.reduce((a, m) => a + num(m.due), 0) };
  }

  function attendanceStats(r, ms) {
    const inR = S.attendance.filter(a => within(a.date, r.from, r.to));
    const inP = S.attendance.filter(a => within(a.date, r.pFrom, r.pTo));
    const hours = new Array(24).fill(0), byDay = new Array(7).fill(0), byMember = {};
    inR.forEach(a => {
      if (a.time) hours[a.time.getHours()]++;
      byDay[parse(a.date).getDay()]++;
      byMember[a.memberId] = (byMember[a.memberId] || 0) + 1;
    });
    const sum = (x, y) => hours.slice(x, y).reduce((p, q) => p + q, 0);
    const buckets = [
      { label: '08 ص - 02 م', count: sum(8, 14) }, { label: '02 م - 06 م', count: sum(14, 18) },
      { label: '06 م - 09 م', count: sum(18, 21) }, { label: '09 م - 08 ص', count: sum(21, 24) + sum(0, 8) }
    ];
    const hourTotal = hours.reduce((p, q) => p + q, 0);
    const top = Object.entries(byMember).map(([id, n]) => ({ m: S.members.find(x => x.id === id), n })).filter(x => x.m).sort((a, b) => b.n - a.n).slice(0, 3);
    const busyDay = byDay.indexOf(Math.max(...byDay));

    // نشطين غايبين
    const last = {};
    S.attendance.forEach(a => { if (!last[a.memberId] || a.date > last[a.memberId]) last[a.memberId] = a.date; });
    const t = today();
    const absent = ms.active.filter(({ m }) => {
      const l = last[m.id];
      const since = l || joinISO(m);
      return isDate(since) && diffDays(t, since) > CFG.absentDays;
    }).map(x => x.m);
    return { total: inR.length, prevTotal: inP.length, perDay: inR.length / r.days, buckets, hourTotal, peakHour: hours.indexOf(Math.max(...hours)), top, busyDay: inR.length ? DAY_NAMES[busyDay] : '', absent };
  }

  /* ---------------- chart ---------------- */
  function series(r) {
    let labels, n, idx, key;
    if (r.days <= 1) { labels = ['12ص-6ص', '6ص-12م', '12م-6م', '6م-12ص']; n = 4; key = 'time'; idx = d => Math.floor(d.getHours() / 6); }
    else if (r.days <= 14) { n = r.days; labels = Array.from({ length: n }, (_, i) => DAY_NAMES[parse(addDays(r.from, i)).getDay()]); key = 'date'; idx = s => diffDays(s, r.from); }
    else { n = 4; labels = [0, 1, 2, 3].map(i => dmy(addDays(r.from, Math.floor(r.days * i / 4))).slice(0, 5)); key = 'date'; idx = s => Math.min(3, Math.floor(diffDays(s, r.from) * 4 / r.days)); }
    const values = new Array(n).fill(0);
    S.treasury.forEach(e => {
      if (e.type !== 'in' || e.source === 'manual' || !within(e.date, r.from, r.to)) return;
      const v = key === 'time' ? (e.time ? idx(e.time) : -1) : idx(e.date);
      if (v >= 0 && v < n) values[v] += e.amount;
    });
    return { labels, values };
  }

  function drawChart(r, fin) {
    const { labels, values } = series(r);
    const svg = document.querySelector('#content-main-1 svg[viewBox="0 0 500 150"]');
    if (svg) {
      const max = Math.max(...values, 1), n = values.length;
      const pts = values.map((v, i) => [n === 1 ? 250 : (i / (n - 1)) * 500, 130 - (v / max) * 110]);
      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < n; i++) { const cx = (pts[i - 1][0] + pts[i][0]) / 2; d += ` C ${cx} ${pts[i - 1][1]}, ${cx} ${pts[i][1]}, ${pts[i][0]} ${pts[i][1]}`; }
      svg.innerHTML = `<defs><linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#34d399" stop-opacity="0.35"/><stop offset="100%" stop-color="#34d399" stop-opacity="0"/></linearGradient></defs>
        <path d="${d} L ${pts[n - 1][0]} 150 L ${pts[0][0]} 150 Z" fill="url(#revGrad)" stroke="none"></path>
        <path d="${d}" stroke="#34d399" stroke-linecap="round"></path>
        ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#000" stroke="#34d399" stroke-width="2"><title>${labels[i]}: ${money(values[i])}</title></circle>`).join('')}`;
    }
    const ax = $('chart-axis-labels'); if (ax) ax.innerHTML = labels.map(l => `<span>${esc(l)}</span>`).join('');
    const badge = document.querySelector('#content-main-1 .lg\\:col-span-2 span.rounded-full');
    if (badge) {
      const up = fin.cur.income >= fin.prev.income;
      badge.textContent = up ? 'تصاعدي مستمر' : 'أقل من الفترة السابقة';
      badge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold border ' + (up ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20');
    }
  }

  /* ---------------- render ---------------- */
  function badge(el, text, up) {
    if (!el) return;
    el.className = 'inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border ' + (up ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20');
    el.innerHTML = `<i class="fa-solid fa-arrow-trend-${up ? 'up' : 'down'}"></i> ${text}`;
  }
  const growthText = (cur, prev) => prev ? { t: `${cur >= prev ? '+' : ''}${pct1(((cur - prev) / prev) * 100)}%`, up: cur >= prev } : { t: cur ? '+جديد' : '0%', up: true };

  function renderKPIs(r, fin, ms, at) {
    $('kpi-revenue-val').textContent = money(fin.cur.income);
    const g = growthText(fin.cur.income, fin.prev.income); badge($('kpi-revenue-growth'), g.t, g.up);
    const rc = $('kpi-revenue-val').closest('.group'), rs = rc.querySelectorAll('.border-t span');
    const target = CFG.monthlyTarget * (r.days / 30), tp = target ? (fin.cur.income / target) * 100 : 0;
    if (rs[0]) rs[0].textContent = `اشتراكات ${nf(fin.cur.sub)} · متجر ${nf(fin.cur.store)}`;
    if (rs[1]) {
      rs[1].textContent = `${Math.round(tp)}% من التارجت`;
      rs[1].className = (tp >= 90 ? 'text-emerald-400' : tp >= 60 ? 'text-amber-400' : 'text-rose-400') + ' font-semibold cursor-pointer';
      rs[1].title = 'اضغط لتغيير التارجت الشهري'; rs[1].dataset.target = '1';
    }

    $('kpi-active-val').textContent = `${nf(ms.active.length)} مشترك`;
    const ac = $('kpi-active-val').closest('.group');
    const ng = growthText(ms.newCur, ms.newPrev);
    badge(ac.querySelector('span.rounded-full'), ms.newPrev ? `${ng.t} جدد` : `+${ms.newCur} جديد`, ng.up);
    const as = ac.querySelectorAll('.border-t span');
    if (as[0]) as[0].textContent = `${ms.frozen.length} موقوف مؤقتاً`;
    if (as[1]) as[1].textContent = `${ms.newCur} مشترك جديد بالفترة`;

    $('kpi-expiring-val').textContent = `${nf(ms.expiring.length)} اشتراك`;
    const es = $('kpi-expiring-val').closest('.group').querySelector('.border-t span');
    if (es) es.textContent = `خلال ${CFG.expiringDays} أيام`;

    $('kpi-checkins-val').textContent = `${nf(at.total)} حضور`;
    const cs = $('kpi-checkins-val').closest('.group').querySelectorAll('.border-t span');
    if (cs[0]) cs[0].textContent = `المعدل اليومي: ${pct1(at.perDay)}`;
    if (cs[1]) { const ok = at.total >= at.prevTotal; cs[1].textContent = ok ? 'أعلى من الفترة السابقة' : 'أقل من الفترة السابقة'; cs[1].className = (ok ? 'text-violet-400' : 'text-rose-400') + ' font-semibold'; }
  }

  function renderRetention(ms) {
    const ret = Math.min(100, Math.max(0, ms.retention)), ch = 100 - ret;
    $('retention-val').textContent = pct1(ret) + '%'; $('retention-bar').style.width = ret + '%';
    $('churn-val').textContent = pct1(ch) + '%'; $('churn-bar').style.width = ch + '%';
    const card = $('retention-val').closest('.bg-zinc-950'), foot = card.lastElementChild.querySelectorAll('span');
    if (foot[0]) foot[0].textContent = `الهدف: الاحتفاظ > ${CFG.retentionTarget}% · (${ms.renewed}/${ms.ended} اتجددوا)`;
    if (foot[1]) { foot[1].dataset.goRecs = '1'; }
  }

  function renderHeatmap(at) {
    const grid = document.querySelector('#content-main-1 .grid.grid-cols-4'); if (!grid) return;
    const card = grid.closest('.bg-zinc-950'), tot = at.hourTotal, sorted = [...at.buckets].sort((a, b) => b.count - a.count);
    const style = b => {
      if (!tot || !b.count) return ['bg-zinc-900 border border-zinc-800', 'text-zinc-500', 'text-zinc-400', 'هادئ'];
      if (b === sorted[0]) return ['bg-rose-500/10 border border-rose-500/30', 'text-rose-300', 'text-rose-400', 'ذروة كبرى'];
      if (b === sorted[1] && b.count / tot >= 0.2) return ['bg-emerald-500/10 border border-emerald-500/30', 'text-emerald-300', 'text-emerald-400', 'مرتفع'];
      if (b.count / tot >= 0.1) return ['bg-zinc-900 border border-zinc-800', 'text-zinc-500', 'text-amber-400', 'متوسط'];
      return ['bg-zinc-900 border border-zinc-800', 'text-zinc-500', 'text-zinc-400', 'هادئ'];
    };
    grid.innerHTML = at.buckets.map(b => { const [bx, l, v, t] = style(b); return `<div class="${bx} p-2.5 rounded-xl" title="${b.count} حضور"><span class="block text-[10px] ${l}">${b.label}</span><span class="font-bold ${v} mt-1 block">${t}</span></div>`; }).join('');
    const foot = card.lastElementChild.querySelectorAll('span'), h = at.peakHour, share = tot ? sorted[0].count / tot : 0;
    if (foot[0]) foot[0].textContent = tot ? `الوقت الأكثر ازدحاماً: ${h % 12 || 12}:00 ${h >= 12 ? 'مساءً' : 'صباحاً'}` : 'لا توجد بيانات حضور';
    if (foot[1]) { foot[1].textContent = share >= 0.4 ? 'موصى بزيادة المدربين' : 'توزيع الحضور متوازن'; foot[1].className = (share >= 0.4 ? 'text-amber-400' : 'text-emerald-400') + ' font-bold'; }
  }

  // بطاقة "أداء المدربين" → مفيش بيانات مدربين، فبقت "الأعضاء الأكثر انتظاماً"
  function renderTopMembers(at) {
    const icon = document.querySelector('#content-main-1 .fa-ranking-star'); if (!icon) return;
    const card = icon.closest('.bg-zinc-950');
    card.querySelector('h4').textContent = 'الأعضاء الأكثر انتظاماً (Top Attendees)';
    card.querySelector('p').textContent = 'أكتر الأعضاء حضوراً خلال الفترة المحددة.';
    const list = card.querySelector('.space-y-3'), cols = ['violet', 'cyan', 'emerald'];
    list.innerHTML = at.top.length ? at.top.map(({ m, n }, i) => {
      const c = cols[i % 3];
      return `<div class="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900 border border-zinc-800">
        <div class="flex items-center gap-2"><div class="w-7 h-7 rounded-full bg-${c}-500/20 text-${c}-400 font-bold flex items-center justify-center text-[11px]">${esc((m.name || '?').trim().charAt(0))}</div>
        <button type="button" onclick="SB.open('${m.id}')" class="font-semibold text-zinc-200 hover:text-white hover:underline">${esc(m.name)}</button></div>
        <span class="text-emerald-400 font-bold">${n} يوم حضور</span></div>`;
    }).join('') : '<div class="text-center text-zinc-500 p-3">لا يوجد حضور مسجل بالفترة</div>';
    const foot = card.lastElementChild.querySelectorAll('span');
    if (foot[0]) foot[0].textContent = at.busyDay ? `أكثر يوم ازدحاماً: ${at.busyDay}` : 'أكثر يوم ازدحاماً: —';
    if (foot[1]) { foot[1].textContent = `${at.absent.length} نشط غايب +${CFG.absentDays} أيام`; foot[1].className = (at.absent.length ? 'text-amber-400' : 'text-emerald-400') + ' font-semibold'; }
  }

  function renderDist(ms) {
    const tot = ms.dist.vip + ms.dist.mid + ms.dist.low, p = v => tot ? (v / tot) * 100 : 0;
    [['vip', 'dist-vip', 'bar-vip'], ['mid', 'dist-mid', 'bar-mid'], ['low', 'dist-low', 'bar-low']].forEach(([k, t, b]) => { $(t).textContent = Math.round(p(ms.dist[k])) + '%'; $(b).style.width = p(ms.dist[k]) + '%'; });
    const top = Object.entries(ms.dist).sort((a, b) => b[1] - a[1])[0], names = { vip: 'السنوية (VIP)', mid: 'ستة أشهر', low: 'الشهرية / الحصص' };
    const f = $('dist-vip').closest('.bg-zinc-950').lastElementChild.querySelector('span:last-child'); if (f) f.textContent = tot ? names[top[0]] : '—';
  }

  function renderProfit(fin) {
    $('report-expenses').textContent = money(fin.cur.out);
    $('report-net-profit').textContent = money(fin.cur.net);
    const mg = fin.cur.income ? (fin.cur.net / fin.cur.income) * 100 : 0;
    $('report-margin').textContent = `${pct1(mg)}% ${mg >= 0 ? 'ربحية صافية' : 'خسارة'}`;
    $('report-margin').className = mg >= 0 ? 'text-emerald-400' : 'text-rose-400';
    $('margin-bar').style.width = Math.min(100, Math.max(0, mg)) + '%';
    return mg;
  }

  /* ---------------- التوصيات ---------------- */
  function recommendations(r, fin, ms, at, margin) {
    const R = [], add = (level, icon, title, text, action) => R.push({ level, icon, title, text, action });
    const g = fin.prev.income ? ((fin.cur.income - fin.prev.income) / fin.prev.income) * 100 : null;
    const target = CFG.monthlyTarget * (r.days / 30);

    if (ms.expiring.length) add('warn', 'fa-clock', `${ms.expiring.length} اشتراك هينتهي خلال ${CFG.expiringDays} أيام`, 'ابعتلهم تذكير تجديد دلوقتي — التجديد المبكر أسهل وأرخص من استرجاع عضو انتهى اشتراكه.', { label: 'إرسال تذكير واتساب', fn: 'sendWhatsAppReminders()' });
    if (ms.expiredRecently.length) add('danger', 'fa-user-xmark', `${ms.expiredRecently.length} عضو انتهى اشتراكه آخر 30 يوم ولم يجدد`, 'كلمهم بعرض عودة أو خصم تجديد؛ نسبة كبيرة بترجع لما حد يتواصل معاها.', { label: 'فتح المشتركين', fn: 'switchMainTab(2)' });
    if (ms.dues.length) add('warn', 'fa-coins', `${ms.dues.length} عميل عليهم متبقي ${money(ms.dueTotal)}`, 'فلوس لسه ماتحصلتش من اشتراكات اتسجلت بدفع جزئي. حصّلها من تاب "الاشتراك والتجديد" في ملف كل عضو.', { label: 'فتح المشتركين', fn: 'switchMainTab(2)' });
    if (at.absent.length) add('warn', 'fa-user-clock', `${at.absent.length} مشترك نشط غايب أكتر من ${CFG.absentDays} أيام`, 'الأعضاء اللي بيبطلوا ييجوا هما أكتر ناس مش هيجددوا. اتصل بيهم أو ابعت رسالة تشجيع قبل ما ينتهي اشتراكهم.');

    if (ms.ended && ms.retention < CFG.retentionTarget) add('danger', 'fa-shield-halved', `معدل الاحتفاظ ${pct1(ms.retention)}% أقل من الهدف (${CFG.retentionTarget}%)`, 'فكر في خصم للتجديد المبكر أو برنامج ولاء، وتابع أسباب عدم التجديد مع الأعضاء اللي مجددوش.');
    else if (ms.ended) add('good', 'fa-shield-halved', `معدل الاحتفاظ ممتاز (${pct1(ms.retention)}%)`, 'حافظ على الجودة، وشجع الأعضاء يدعوا أصدقاءهم بعرض إحالة.');

    if (g !== null && g < 0) add('danger', 'fa-arrow-trend-down', `الإيرادات تراجعت ${pct1(Math.abs(g))}% عن الفترة السابقة`, 'جرب عرض محدود المدة أو بيع منتجات المتجر والباقات الأطول لتعويض الفرق.');
    else if (g !== null && g > 0) add('good', 'fa-arrow-trend-up', `الإيرادات زادت ${pct1(g)}% عن الفترة السابقة`, 'استمر في نفس الاستراتيجية وركز على الباقات الأكتر مبيعاً.');
    if (target && fin.cur.income < target * 0.6) add('warn', 'fa-bullseye', 'الإيرادات أقل من 60% من التارجت المتوقع للفترة', 'راجع خطة التسويق وفكر في حملة اشتراكات جديدة. (التارجت بيتغير بالضغط على نسبة التارجت في كارت الإيرادات)');
    if (fin.cur.income && margin < 40) add('warn', 'fa-scale-balanced', `هامش الربح منخفض (${pct1(margin)}%)`, 'راجع المصروفات والمرتجعات، وتأكد من تسعير المنتجات والباقات.');
    if (fin.cur.store === 0 && fin.cur.sub > 0) add('info', 'fa-store', 'مفيش مبيعات من المتجر في الفترة', 'اعرض المنتجات (مكملات / مياه) للأعضاء عند الحضور — دخل إضافي بسهولة.');

    const t = at.buckets.reduce((a, b) => a + b.count, 0), top = [...at.buckets].sort((a, b) => b.count - a.count)[0];
    if (t && top.count / t >= 0.4) add('info', 'fa-fire', `ازدحام شديد في فترة ${top.label}`, 'زوّد المدربين في الفترة دي ووجّه الأعضاء لأوقات أهدأ بعروض خاصة.');
    if (at.prevTotal && at.total < at.prevTotal * 0.8) add('warn', 'fa-person-running', 'الحضور انخفض أكتر من 20% عن الفترة السابقة', 'نشّط الأعضاء بتحدي حضور أو حصص جديدة.');

    const td = ms.dist.vip + ms.dist.mid + ms.dist.low;
    if (td && ms.dist.low / td > 0.5) add('info', 'fa-chart-pie', 'أغلب المشتركين على باقات قصيرة', 'قدّم خصم على الباقات الأطول (6 شهور / سنوي) لتثبيت الدخل.');
    if (ms.frozen.length) add('info', 'fa-pause', `${ms.frozen.length} اشتراك موقوف مؤقتاً`, 'تابعهم وشجعهم على الاستئناف، والأيام بتتعوض تلقائياً عند الاستئناف.');
    if (!S.members.length) add('info', 'fa-circle-info', 'لا يوجد مشتركين بعد', 'أضف مشتركين من تاب "المشتركين" وهتظهر هنا توصيات مخصصة تلقائياً.');
    return R;
  }

  function ensureRecs() {
    if ($('recommendations-section')) return;
    const s = document.createElement('div'); s.id = 'recommendations-section'; s.className = 'pt-2 pb-8';
    s.innerHTML = `<div class="flex items-center justify-between mb-4"><h3 class="text-lg font-bold text-white flex items-center gap-2"><i class="fa-solid fa-lightbulb text-amber-400"></i><span>التوصيات الذكية (Smart Recommendations)</span></h3><span id="rec-count" class="text-xs text-zinc-500"></span></div><div id="rec-list" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>`;
    $('content-main-1').appendChild(s);
  }
  function renderRecs(list) {
    ensureRecs();
    const map = { danger: ['rose', 'عاجل'], warn: ['amber', 'تنبيه'], info: ['cyan', 'اقتراح'], good: ['emerald', 'ممتاز'] };
    $('rec-count').textContent = `${list.length} توصية`;
    $('rec-list').innerHTML = list.map(x => {
      const [c, tag] = map[x.level];
      return `<div class="bg-zinc-950 border border-zinc-900 hover:border-zinc-800 p-4 rounded-2xl shadow-2xl flex gap-3 transition-all">
        <div class="w-11 h-11 shrink-0 rounded-xl bg-${c}-500/10 border border-${c}-500/20 flex items-center justify-center text-${c}-400"><i class="fa-solid ${x.icon}"></i></div>
        <div class="flex-1 space-y-1.5"><div class="flex items-center justify-between gap-2"><h4 class="font-bold text-sm text-zinc-200">${esc(x.title)}</h4>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-${c}-500/10 text-${c}-400 border border-${c}-500/20 whitespace-nowrap">${tag}</span></div>
        <p class="text-xs text-zinc-400 leading-relaxed">${esc(x.text)}</p>
        ${x.action ? `<button type="button" onclick="${x.action.fn}" class="mt-1 text-[11px] font-bold px-3 py-1 rounded-lg bg-${c}-500/20 hover:bg-${c}-500/30 text-${c}-400 border border-${c}-500/30 transition-all">${esc(x.action.label)}</button>` : ''}</div></div>`;
    }).join('');
  }

  /* ---------------- render all ---------------- */
  function renderAll() {
    if (!$('kpi-revenue-val')) return;
    if (S.period === 'custom' && !(isDate(S.cFrom) && isDate(S.cTo))) return;
    const r = getRange(), fin = finance(r), ms = memberStats(r), at = attendanceStats(r, ms);

    $('date-range-display').textContent = `${dmy(r.from)} - ${dmy(r.to)}`;
    $('input-from-date').value = r.from; $('input-to-date').value = r.to;
    $('active-filter-badge').textContent = { daily: 'عرض يومي نشط', weekly: 'عرض أسبوعي نشط', monthly: 'عرض شهري نشط', custom: 'نطاق مخصص نشط' }[S.period];
    ['daily', 'weekly', 'monthly'].forEach(p => {
      $('btn-' + p).className = 'px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ' + (S.period === p ? 'bg-emerald-600 text-black font-bold shadow-md shadow-emerald-600/30' : 'text-zinc-400 hover:text-white');
    });

    renderKPIs(r, fin, ms, at); renderRetention(ms); renderHeatmap(at); renderTopMembers(at);
    drawChart(r, fin); renderDist(ms);
    const mg = renderProfit(fin);
    renderRecs(recommendations(r, fin, ms, at, mg));
    S.report = { r, fin, ms, at, mg };
  }

  /* ---------------- actions (inline onclick) ---------------- */
  window.switchPeriod = p => { S.period = p; renderAll(); };
  window.toggleCalendarDropdown = () => $('calendar-dropdown').classList.toggle('hidden');
  window.applyCustomDateRange = () => {
    const f = $('input-from-date').value, t = $('input-to-date').value;
    if (!isDate(f) || !isDate(t)) return alert('اختار تاريخ البداية والنهاية');
    if (f > t) return alert('تاريخ البداية لازم يكون قبل النهاية');
    S.period = 'custom'; S.cFrom = f; S.cTo = t;
    $('calendar-dropdown').classList.add('hidden'); renderAll();
  };

  window.exportReport = () => {
    const x = S.report; if (!x) return alert('لا توجد بيانات للتصدير');
    const rows = [
      ['تقرير الأداء', `${dmy(x.r.from)} - ${dmy(x.r.to)}`], [],
      ['المؤشر', 'القيمة'],
      ['إيراد الاشتراكات', Math.round(x.fin.cur.sub)], ['إيراد المتجر', Math.round(x.fin.cur.store)],
      ['إجمالي الإيرادات', Math.round(x.fin.cur.income)], ['المصروفات والمرتجعات', Math.round(x.fin.cur.out)],
      ['صافي الربح', Math.round(x.fin.cur.net)], ['هامش الربح %', pct1(x.mg)],
      ['الاشتراكات النشطة', x.ms.active.length], ['موقوف مؤقتاً', x.ms.frozen.length],
      ['قاربت على الانتهاء', x.ms.expiring.length], ['مشتركين جدد بالفترة', x.ms.newCur],
      ['إجمالي المتبقي على العملاء', Math.round(x.ms.dueTotal)],
      ['الحضور بالفترة', x.at.total], ['معدل الاحتفاظ %', pct1(x.ms.retention)],
      [], ['اشتراكات قاربت على الانتهاء'], ['الاسم', 'الموبايل', 'الانتهاء', 'الخطة'],
      ...x.ms.expiring.map(({ m }) => [m.name, m.phone, dmy(m.endDate), m.planName]),
      [], ['عليهم متبقي'], ['الاسم', 'الموبايل', 'المتبقي'],
      ...x.ms.dues.map(m => [m.name, m.phone, Math.round(num(m.due))])
    ];
    const csv = '\uFEFF' + rows.map(rw => rw.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `report_${x.r.from}_${x.r.to}.csv`; document.body.appendChild(a); a.click(); a.remove();
  };

  const waNum = p => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('0')) d = '20' + d.slice(1); return d; };
  window.sendWhatsAppReminders = () => {
    const list = memberStats(getRange()).expiring;
    if (!list.length) return alert('مفيش اشتراكات قربت تخلص 👌');
    const gym = ($('previewTitleDisplay') && $('previewTitleDisplay').textContent.trim()) || 'الجيم';
    const old = $('wa-overlay'); if (old) old.remove();
    const ov = document.createElement('div'); ov.id = 'wa-overlay';
    ov.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
    ov.innerHTML = `<div class="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl text-white">
      <div class="flex justify-between items-center p-5 border-b border-neutral-800 sticky top-0 bg-neutral-900"><h3 class="font-bold flex items-center gap-2"><i class="fa-brands fa-whatsapp text-emerald-400"></i> تذكير ${list.length} مشترك</h3>
      <button type="button" id="wa-close" class="text-neutral-400 hover:text-white p-2"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="p-4 space-y-2 text-sm">${list.map(({ m }) => {
        const left = diffDays(m.endDate, today());
        const msg = `أهلاً ${m.name} 👋\nاشتراكك في ${gym} (${m.planName || 'الاشتراك'}) ${left === 0 ? 'بينتهي النهاردة' : `هينتهي بعد ${left} يوم`} (${dmy(m.endDate)}).${num(m.due) > 0 ? `\nمتبقي عليك ${nf(m.due)} ج.م.` : ''}\nجدّد دلوقتي وكمّل رحلتك معانا 💪`;
        const n = waNum(m.phone);
        return `<div class="flex items-center justify-between gap-3 p-3 rounded-xl bg-neutral-950 border border-neutral-800"><div><div class="font-semibold">${esc(m.name)}</div><div class="text-[11px] text-neutral-400">${esc(m.phone || 'بدون رقم')} · ينتهي ${dmy(m.endDate)}</div></div>
        ${n ? `<a href="https://wa.me/${n}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" class="shrink-0 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-lg text-xs font-bold">إرسال</a>` : '<span class="text-xs text-rose-400">لا يوجد رقم</span>'}</div>`;
      }).join('')}</div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#wa-close').onclick = () => ov.remove();
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  };

  /* ---------------- data ---------------- */
  let timer; const later = () => { clearTimeout(timer); timer = setTimeout(renderAll, 150); };
  function listen(name, map, key) {
    window.onSnapshot(window.collection(window.db, COL[name]), s => { S[key] = s.docs.map(d => map(d.id, d.data())); later(); },
      e => console.warn('[Home]', name, e.code || e.message));
  }
  function init() {
    listen('members', (id, x) => ({ ...x, id }), 'members');
    listen('plans', (id, x) => ({ id, name: x.name || x.planName || x.title || '', days: num(x.duration || x.days || x.durationDays) || 30, price: num(x.price) }), 'plans');
    listen('attendance', (id, x) => ({ id, memberId: x.memberId, date: isDate(x.date) ? x.date : tsISO(x.date) || tsISO(x.createdAt), time: tsDate(x.createdAt) }), 'attendance');
    listen('treasury', (id, x) => ({ id, type: x.type === 'out' ? 'out' : 'in', source: x.source || 'manual', amount: num(x.amount), date: isDate(x.date) ? x.date : tsISO(x.createdAt), time: tsDate(x.createdAt) }), 'treasury');
  }

  function boot() {
    ensureRecs();
    document.addEventListener('click', e => {
      const dd = $('calendar-dropdown');
      if (dd && !dd.classList.contains('hidden') && !dd.parentElement.contains(e.target)) dd.classList.add('hidden');
      const tgt = e.target.closest('[data-target]');
      if (tgt) {
        const v = prompt('التارجت الشهري للإيرادات (ج.م):', CFG.monthlyTarget);
        if (v !== null && Number(v) > 0) { localStorage.setItem('gymMonthlyTarget', String(Number(v))); renderAll(); }
      }
      if (e.target.closest('[data-go-recs]')) $('recommendations-section')?.scrollIntoView({ behavior: 'smooth' });
    });
    renderAll();
    (function wait() { if (window.db && window.onSnapshot) return init(); setTimeout(wait, 100); })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();