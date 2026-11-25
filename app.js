// RaatPharmacy — night pharmacy finder for Dhaka.
// Plain static site: data lives in data/pharmacies.json, nothing is
// invented. "Open now" is computed from the visitor's own clock.
// Corrections a visitor reports are stored only in their own browser
// (localStorage) and shown as "not yet verified" — listed hours are
// never silently changed.

const CORRECTIONS_KEY = 'raatpharmacy-corrections-v1';

// ---------- time helpers (pure, unit-testable) ----------
// "HH:MM" (24h) -> minutes since midnight. "24:00" -> 1440.
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Is this pharmacy open at `nowMin` (minutes since midnight)?
// Returns true / false / null (null = hours not confirmed).
function isOpenAt(p, nowMin) {
  if (p.hours24) return true;
  if (!p.open || !p.close) return null;
  const open = toMinutes(p.open);
  const close = toMinutes(p.close);
  if (close > open) return nowMin >= open && nowMin < close;
  if (close === 0) return nowMin >= open; // closes at midnight
  return nowMin >= open || nowMin < close; // overnight, e.g. 08:00-01:30
}

// "Open past midnight" for the late-night filter: 24h, or closes after
// midnight (00:30 / 01:00 / 01:30 / 03:00), or opens at midnight.
function isLateNight(p) {
  if (p.hours24) return true;
  if (!p.open || !p.close) return false;
  const open = toMinutes(p.open);
  const close = toMinutes(p.close);
  if (open === 0) return true;
  return close <= open && close > 0 && close <= 210;
}

// "1:30 AM" style display for a "HH:MM" value. "24:00" -> "12:00 AM".
function formatTime(hhmm, lang) {
  let [h, m] = hhmm.split(':').map(Number);
  if (h === 24) h = 0;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(m).padStart(2, '0');
  if (lang === 'bn') {
    const bnDigits = s => s.replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)]);
    return `${bnDigits(String(h12))}:${bnDigits(mm)} ${ampm === 'AM' ? 'রাত' : 'দুপুর/রাত'}`;
  }
  return `${h12}:${mm} ${ampm}`;
}

function bnDigits(s) {
  return String(s).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)]);
}
function num(n, lang) {
  return lang === 'bn' ? bnDigits(n) : String(n);
}

// Next transition text: "Closes at 1:30 AM" or "Opens at 8:00 AM".
function nextLine(p, nowMin, lang, t) {
  if (p.hours24) return t.open24;
  if (!p.open || !p.close) return '';
  const open = isOpenAt(p, nowMin);
  if (open) return `${t.closesAt} ${formatTime(p.close, lang)}`;
  return `${t.opensAt} ${formatTime(p.open, lang)}`;
}

// ---------- i18n ----------
const I18N = {
  bn: {
    pitch: 'রাতে খোলা ফার্মেসি খুঁজুন — সময়, ফোন, দিকনির্দেশনা এক ট্যাপে।',
    statTotal: 'ফার্মেসি', statOpen: 'এখন খোলা', statLate: 'রাত ১২টার পরেও খোলা',
    stockNote: '⚠️ স্টকের তথ্য লাইভ নয় — যাওয়ার আগে ফোন করে ওষুধ আছে কিনা জেনে নিন।',
    searchPlaceholder: 'ফার্মেসি, এলাকা বা ঠিকানা লিখুন…',
    area: 'এলাকা', allAreas: 'সব এলাকা',
    openNowOnly: 'শুধু এখন খোলা', lateOnly: 'রাত ১২টার পরেও খোলা',
    openNow: 'এখন খোলা', closed: 'বন্ধ', hoursUnknown: 'সময় নিশ্চিত নয়',
    open24: 'সারারাত খোলা — ২৪ ঘণ্টা',
    closesAt: 'বন্ধ হবে', opensAt: 'খুলবে',
    lateBadge: 'রাত ১২টার পরেও খোলা',
    call: '📞 কল করুন', whatsapp: '💬 WhatsApp', directions: '🧭 দিকনির্দেশনা',
    phoneNotListed: 'ফোন নম্বর তালিকায় নেই',
    confirmStock: '📞 ফোন করে স্টক নিশ্চিত করুন — ওষুধের মজুদ লাইভ দেখানো হয় না।',
    verifiedOn: 'যাচাই:',
    hoursWrong: 'সময় ভুল মনে হচ্ছে?',
    correctionReported: '⚠️ সংশোধন জানানো হয়েছে — যাচাই হয়নি',
    results: (n, total) => `${num(total, 'bn')}টির মধ্যে ${num(n, 'bn')}টি দেখাচ্ছে`,
    empty: 'কোনো ফার্মেসি মেলেনি — খোঁজ বা ফিল্টার বদলে দেখুন।',
    loading: 'তালিকা লোড হচ্ছে…',
    aboutTitle: 'তথ্য যাচাই নিয়ে',
    aboutText: 'সব ফোন নম্বর, ঠিকানা ও সময় প্রকাশিত উৎস থেকে যাচাই করা — ২৫ নভেম্বর ২০২৬। কোনো নম্বর বা সময় বানানো হয়নি। যেখানে যাচাই করা যায়নি, সেখানে “নিশ্চিত নয়” লেখা আছে। সময় বদলাতে পারে, তাই যাওয়ার আগে ফোন করে নিন।',
    aboutSources: 'উৎস: Islamia Pharmacy (অফিসিয়াল সাইট), Lazz Pharma, Tamanna Pharmacy, হাসপাতাল ফার্মেসি, প্রকাশিত ডিরেক্টরি। পুরো তালিকা ও উৎস GitHub রিপোতে আছে।',
    footer: 'RaatPharmacy — Arohon Build for Bangladesh। জরুরি অবস্থায় ৯৯৯-এ কল করুন।',
    sheetTitle: 'সময় ভুল মনে হচ্ছে?',
    sheetLabel: 'সঠিক সময়টা লিখুন (ঐচ্ছিক)',
    sheetPlaceholder: 'যেমন: এখন রাত ১১টায় বন্ধ হয়',
    cancel: 'বাতিল', submit: 'জানান',
    sheetNote: 'আপনার জানানো তথ্য শুধু আপনার ব্রাউজারেই থাকবে, তালিকার সময় বদলাবে না — যাচাই না হওয়া পর্যন্ত “যাচাই হয়নি” হিসেবে দেখাবে।',
    toastSaved: 'ধন্যবাদ! সংশোধনটি জানানো হয়েছে।',
    langButton: 'English',
    clockSuffix: '',
  },
  en: {
    pitch: 'Find an open pharmacy near you at night — hours, phone, directions in one tap.',
    statTotal: 'pharmacies', statOpen: 'open now', statLate: 'open past midnight',
    stockNote: '⚠️ Stock is not live — call ahead to confirm the medicine is in stock.',
    searchPlaceholder: 'Search pharmacy, area or address…',
    area: 'Area', allAreas: 'All areas',
    openNowOnly: 'Open now only', lateOnly: 'Open past midnight',
    openNow: 'Open now', closed: 'Closed', hoursUnknown: 'Hours not confirmed',
    open24: 'Open all night — 24 hours',
    closesAt: 'Closes at', opensAt: 'Opens at',
    lateBadge: 'Open past midnight',
    call: '📞 Call', whatsapp: '💬 WhatsApp', directions: '🧭 Directions',
    phoneNotListed: 'Phone not listed',
    confirmStock: '📞 Call to confirm stock — medicine stock is not shown live.',
    verifiedOn: 'Verified:',
    hoursWrong: 'Hours wrong?',
    correctionReported: '⚠️ Correction reported — not yet verified',
    results: (n, total) => `Showing ${n} of ${total}`,
    empty: 'No pharmacy matched — try a different search or filter.',
    loading: 'Loading list…',
    aboutTitle: 'About the data',
    aboutText: 'Every phone number, address and opening-hours value was verified from a published source — 25 Nov 2026. Nothing was invented. Where it could not be verified, it says “not confirmed”. Hours can change, so call ahead before going.',
    aboutSources: 'Sources: Islamia Pharmacy (official site), Lazz Pharma, Tamanna Pharmacy, hospital pharmacies, published directories. The full list and sources are in the GitHub repo.',
    footer: 'RaatPharmacy — Arohon Build for Bangladesh. In an emergency, call 999.',
    sheetTitle: 'Hours look wrong?',
    sheetLabel: 'Write the correct hours (optional)',
    sheetPlaceholder: 'e.g. now closes at 11 PM',
    cancel: 'Cancel', submit: 'Report',
    sheetNote: 'What you report stays only in your browser; the listed hours will not change — it will show as “not yet verified” until checked.',
    toastSaved: 'Thank you! Your correction was recorded.',
    langButton: 'বাংলা',
    clockSuffix: '',
  },
};

const AREA_BN = {
  Gulshan: 'গুলশান', Banani: 'বনানী', Bashundhara: 'বসুন্ধরা', Narsingdi: 'নরসিংদী',
  Panthapath: 'পান্থপথ', Rampura: 'রামপুরা', Shahbagh: 'শাহবাগ', Mirpur: 'মিরপুর',
  Dhanmondi: 'ধানমন্ডি', Mohammadpur: 'মোহাম্মদপুর', Uttara: 'উত্তরা', Khilgaon: 'খিলগাঁও',
  Kakrail: 'কাকরাইল', Shyamoli: 'শ্যামলী', Kalabagan: 'কলাবাগান', Pallabi: 'পল্লবী',
  Jatrabari: 'যাত্রাবাড়ী', Lalbagh: 'লালবাগ', Moghbazar: 'মগবাজার', Bashabo: 'বাসাবো',
  Malibagh: 'মালিবাগ',
};
function areaLabel(area, lang) {
  return lang === 'bn' ? (AREA_BN[area] || area) : area;
}

// ---------- state ----------
let pharmacies = [];
let lang = 'bn';
let corrections = {};
try { corrections = JSON.parse(localStorage.getItem(CORRECTIONS_KEY) || '{}'); } catch (e) { corrections = {}; }

function loadCorrections() {
  try { return JSON.parse(localStorage.getItem(CORRECTIONS_KEY) || '{}'); } catch (e) { return {}; }
}
function saveCorrection(id, text) {
  const c = loadCorrections();
  c[id] = { text: text || '', at: new Date().toISOString() };
  localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(c));
  corrections = c;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function clockText() {
  const d = new Date();
  let h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = `${h12}:${mm} ${ampm}`;
  return lang === 'bn' ? `${bnDigits(time)} • ঢাকা` : `${time} • Dhaka`;
}

// ---------- filtering / sorting ----------
function matchesQuery(p, q) {
  if (!q) return true;
  const hay = `${p.name} ${p.chain} ${p.area} ${p.address}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}
function filteredList(state) {
  const now = nowMinutes();
  let list = pharmacies.filter(p => {
    if (state.area !== 'all' && p.area !== state.area) return false;
    if (!matchesQuery(p, state.q)) return false;
    if (state.openNow && isOpenAt(p, now) !== true) return false;
    if (state.late && !isLateNight(p)) return false;
    return true;
  });
  // Open now first, then late-night first, then name A–Z.
  list.sort((a, b) => {
    const oa = isOpenAt(a, now) === true ? 0 : 1;
    const ob = isOpenAt(b, now) === true ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const la = isLateNight(a) ? 0 : 1;
    const lb = isLateNight(b) ? 0 : 1;
    if (la !== lb) return la - lb;
    return a.name.localeCompare(b.name);
  });
  return list;
}

// ---------- rendering ----------
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cardHtml(p, t) {
  const now = nowMinutes();
  const open = isOpenAt(p, now);
  const badge = open === true
    ? `<span class="badge badge-open">● ${esc(t.openNow)}</span>`
    : open === false
      ? `<span class="badge badge-closed">● ${esc(t.closed)}</span>`
      : `<span class="badge badge-unknown">${esc(t.hoursUnknown)}</span>`;
  const late = isLateNight(p) ? `<span class="badge badge-late">🌙 ${esc(t.lateBadge)}</span>` : '';
  const hoursLine = p.hours24
    ? `<p class="hours-line"><strong>${esc(t.open24)}</strong></p>`
    : p.hoursText
      ? `<p class="hours-line"><strong>${esc(p.hoursText)}</strong></p>`
      : `<p class="hours-line">${esc(t.hoursUnknown)}</p>`;
  const next = nextLine(p, now, lang, t);
  const phoneBlock = p.phone
    ? `<p class="phone-line">${esc(p.phoneDisplay)}</p>`
    : `<p class="phone-line">${esc(t.phoneNotListed)}</p>`;
  const callBtn = p.phone
    ? `<a class="btn btn-call" href="tel:${esc(p.phone.replace(/[\s-]/g, ''))}">${esc(t.call)}</a>` : '';
  const waBtn = (p.whatsapp && p.phone)
    ? `<a class="btn btn-wa" href="https://wa.me/${esc(p.phone.replace(/^\+/, '').replace(/[\s-]/g, ''))}" target="_blank" rel="noopener">${esc(t.whatsapp)}</a>` : '';
  const dirBtn = `<a class="btn btn-ghost" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ', ' + p.address)}" target="_blank" rel="noopener">${esc(t.directions)}</a>`;
  const corr = corrections[p.id];
  const corrBadge = corr
    ? `<p class="correction-badge">${esc(t.correctionReported)}${corr.text ? ` — “${esc(corr.text)}”` : ''}</p>` : '';
  const notes = p.notes ? `<p class="notes">${esc(p.notes)}</p>` : '';
  return `
    <li class="card" data-id="${esc(p.id)}">
      <div class="card-head">
        <div>
          <h3>${esc(p.name)}</h3>
          <p class="area">${esc(areaLabel(p.area, lang))} • ${esc(p.chain)}</p>
        </div>
        <div>${badge}${late}</div>
      </div>
      ${hoursLine}
      ${next ? `<p class="next-line">${esc(next)}</p>` : ''}
      <p class="address">${esc(p.address)}</p>
      <div class="actions">${callBtn}${waBtn}${dirBtn}</div>
      ${phoneBlock}
      <p class="meta-line">${esc(t.confirmStock)}</p>
      <p class="meta-line">${esc(t.verifiedOn)} ${esc(p.lastVerified)} • ${esc(p.source)}</p>
      ${notes}
      ${corrBadge}
      <button class="link-btn" type="button" data-correct="${esc(p.id)}">${esc(t.hoursWrong)}</button>
    </li>`;
}

function render() {
  const t = I18N[lang];
  document.documentElement.lang = lang;
  document.getElementById('pitch').textContent = t.pitch;
  document.getElementById('stockNote').textContent = t.stockNote;
  document.getElementById('searchInput').placeholder = t.searchPlaceholder;
  document.getElementById('areaLabel').textContent = t.area;
  document.getElementById('openNowLabel').textContent = t.openNowOnly;
  document.getElementById('lateLabel').textContent = t.lateOnly;
  document.getElementById('aboutTitle').textContent = t.aboutTitle;
  document.getElementById('aboutText').textContent = t.aboutText;
  document.getElementById('aboutSources').textContent = t.aboutSources;
  document.getElementById('footerText').textContent = t.footer;
  document.getElementById('sheetTitle').textContent = t.sheetTitle;
  document.getElementById('correctLabel').textContent = t.sheetLabel;
  document.getElementById('correctInput').placeholder = t.sheetPlaceholder;
  document.getElementById('cancelCorrect').textContent = t.cancel;
  document.getElementById('submitCorrect').textContent = t.submit;
  document.getElementById('sheetNote').textContent = t.sheetNote;
  document.getElementById('langToggle').textContent = t.langButton;
  document.getElementById('clock').textContent = clockText();

  const now = nowMinutes();
  const openCount = pharmacies.filter(p => isOpenAt(p, now) === true).length;
  const lateCount = pharmacies.filter(isLateNight).length;
  document.getElementById('statTotal').textContent = num(pharmacies.length, lang);
  document.getElementById('statTotalLabel').textContent = t.statTotal;
  document.getElementById('statOpen').textContent = num(openCount, lang);
  document.getElementById('statOpenLabel').textContent = t.statOpen;
  document.getElementById('statLate').textContent = num(lateCount, lang);
  document.getElementById('statLateLabel').textContent = t.statLate;

  // Area options (preserve selection).
  const areaSel = document.getElementById('areaFilter');
  const prevArea = areaSel.value || 'all';
  const areas = [...new Set(pharmacies.map(p => p.area))].sort();
  areaSel.innerHTML = `<option value="all">${esc(t.allAreas)}</option>` +
    areas.map(a => `<option value="${esc(a)}">${esc(areaLabel(a, lang))}</option>`).join('');
  areaSel.value = areas.includes(prevArea) ? prevArea : 'all';

  const state = {
    q: document.getElementById('searchInput').value.trim(),
    area: areaSel.value,
    openNow: document.getElementById('openNowToggle').checked,
    late: document.getElementById('lateToggle').checked,
  };
  const list = filteredList(state);
  const ul = document.getElementById('pharmacyList');
  ul.innerHTML = '';
  list.forEach(p => ul.appendChild(el(cardHtml(p, t))));
  document.getElementById('resultCount').textContent = t.results(list.length, pharmacies.length);
  document.getElementById('emptyState').textContent = t.empty;
  document.getElementById('emptyState').classList.toggle('hidden', list.length > 0);
  document.getElementById('loadingState').classList.add('hidden');
}

// ---------- correction sheet ----------
let correctingId = null;
function openSheet(id) {
  correctingId = id;
  const p = pharmacies.find(x => x.id === id);
  document.getElementById('sheetPharmacy').textContent = p ? p.name : '';
  document.getElementById('correctInput').value = '';
  document.getElementById('correctSheet').classList.remove('hidden');
  document.getElementById('sheetBackdrop').classList.remove('hidden');
}
function closeSheet() {
  correctingId = null;
  document.getElementById('correctSheet').classList.add('hidden');
  document.getElementById('sheetBackdrop').classList.add('hidden');
}
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2600);
}

// ---------- init ----------
function init() {
  document.getElementById('searchInput').addEventListener('input', render);
  document.getElementById('areaFilter').addEventListener('change', render);
  document.getElementById('openNowToggle').addEventListener('change', render);
  document.getElementById('lateToggle').addEventListener('change', render);
  document.getElementById('langToggle').addEventListener('click', () => {
    lang = lang === 'bn' ? 'en' : 'bn';
    render();
  });
  document.getElementById('pharmacyList').addEventListener('click', e => {
    const btn = e.target.closest('[data-correct]');
    if (btn) openSheet(btn.getAttribute('data-correct'));
  });
  document.getElementById('cancelCorrect').addEventListener('click', closeSheet);
  document.getElementById('sheetBackdrop').addEventListener('click', closeSheet);
  document.getElementById('submitCorrect').addEventListener('click', () => {
    if (!correctingId) return;
    saveCorrection(correctingId, document.getElementById('correctInput').value.trim());
    closeSheet();
    render();
    showToast(I18N[lang].toastSaved);
  });
  // Clock + open-now status refresh every minute.
  setInterval(() => {
    document.getElementById('clock').textContent = clockText();
    render();
  }, 60000);

  fetch('data/pharmacies.json')
    .then(r => { if (!r.ok) throw new Error('Failed to load data'); return r.json(); })
    .then(d => { pharmacies = d.pharmacies || []; render(); })
    .catch(() => {
      document.getElementById('loadingState').textContent =
        'Could not load the pharmacy list. Please reload the page.';
    });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
// Export pure helpers for Node testing.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { toMinutes, isOpenAt, isLateNight, formatTime };
}
