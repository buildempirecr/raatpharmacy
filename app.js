// RaatPharmacy — night pharmacy finder for Dhaka.
// Plain static site: data lives in data/pharmacies.json, nothing is
// invented. "Open now" is computed from the visitor's own clock.
// Corrections a visitor reports are stored only in their own browser
// (localStorage) and shown as "not yet verified" — listed hours are
// never silently changed. The toast says so honestly, and offers a
// real "tell the team" link (mailto) instead of pretending it was sent.

const CORRECTIONS_KEY = 'raatpharmacy-corrections-v1';
const LANG_KEY = 'raatpharmacy-lang';
const DATA_SAVED_KEY = 'raatpharmacy-data-saved-at';
const TEAM_EMAIL = 'gmking147@gmail.com';

// ---------- time helpers (pure, unit-testable) ----------
// "HH:MM" (24h) -> minutes since midnight. "24:00" -> 1440.
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Day-based hours. hoursByDay maps a weekday key to [open, close] or
// null (closed that day). "breaks" lists daily closed intervals, e.g.
// [["14:00","16:00"]] for a 2–4 PM break.
// Returns {hours24:true} | {open, close} | {closed:true} | null (unknown).
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function hoursForDay(p, date) {
  if (p.hours24) return { hours24: true };
  const key = DAY_KEYS[(date || new Date()).getDay()];
  if (p.hoursByDay && Object.prototype.hasOwnProperty.call(p.hoursByDay, key)) {
    const v = p.hoursByDay[key];
    if (v === null) return { closed: true };
    return { open: v[0], close: v[1] };
  }
  if (!p.open || !p.close) return null;
  return { open: p.open, close: p.close };
}
function inBreak(p, nowMin) {
  if (!p.breaks) return false;
  return p.breaks.some(([bs, be]) => nowMin >= toMinutes(bs) && nowMin < toMinutes(be));
}

// Is this pharmacy open at `nowMin` (minutes since midnight)?
// Returns true / false / null (null = hours not confirmed).
function isOpenAt(p, nowMin, date) {
  const h = hoursForDay(p, date);
  if (!h) return null;
  if (h.closed) return false;
  if (h.hours24) return true;
  if (inBreak(p, nowMin)) return false;
  const open = toMinutes(h.open);
  const close = toMinutes(h.close);
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

// Minutes until the pharmacy closes (if open) or opens (if closed).
// Returns { kind: 'closes' | 'opens', mins } or null (24h / unknown).
// Day-aware: a Friday-closed pharmacy reports the time until tomorrow's
// opening; a mid-day break reports the time until the break ends.
function minutesUntil(p, nowMin, date) {
  const today = date || new Date();
  const h = hoursForDay(p, today);
  if (!h || h.hours24) return null;
  if (h.closed) {
    const tom = new Date(today);
    tom.setDate(tom.getDate() + 1);
    const th = hoursForDay(p, tom);
    if (!th || th.closed || th.hours24) return null;
    return { kind: 'opens', mins: (1440 - nowMin) + toMinutes(th.open) };
  }
  if (inBreak(p, nowMin)) {
    const br = p.breaks.find(([bs, be]) => nowMin >= toMinutes(bs) && nowMin < toMinutes(be));
    if (br) return { kind: 'opens', mins: toMinutes(br[1]) - nowMin };
  }
  const open = toMinutes(h.open);
  const close = toMinutes(h.close);
  if (isOpenAt(p, nowMin, today) === true) {
    let mins;
    // A break before the regular close ends the open stretch early.
    const nextBreak = (p.breaks || [])
      .map(([bs]) => toMinutes(bs))
      .filter(s => s > nowMin && (close > open ? s < close : true))
      .sort((a, b) => a - b)[0];
    if (nextBreak != null) {
      mins = nextBreak - nowMin;
    } else if (close > open) mins = close - nowMin;
    else if (nowMin >= open) mins = (1440 - nowMin) + close; // overnight
    else mins = close - nowMin; // after midnight, still open
    return { kind: 'closes', mins };
  }
  // Closed: next opening.
  let mins;
  if (close > open) mins = nowMin < open ? open - nowMin : (1440 - nowMin) + open;
  else mins = open - nowMin; // overnight schedule, closed between close and open
  if (mins <= 0) mins += 1440;
  return { kind: 'opens', mins };
}

// Effective closing time for "closes latest" sorting: 24h first, then
// overnight closes count after midnight (e.g. 01:30 -> 25:30).
function effectiveClose(p, date) {
  const h = hoursForDay(p, date);
  if (!h || h.closed || h.hours24) return h && h.hours24 ? 2880 : -1;
  const open = toMinutes(h.open);
  const close = toMinutes(h.close);
  return close <= open && close > 0 ? close + 1440 : close;
}

// Haversine distance in km between two lat/lng points.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Bangla day-part label by 24h hour — never "AM -> রাত".
// 4–5:59 ভোর, 6–11:59 সকাল, 12–15:59 দুপুর, 16–17:59 বিকাল,
// 18–19:59 সন্ধ্যা, 20–23:59 রাত, 0–3:59 রাত.
function bnDayPart(h24) {
  if (h24 >= 4 && h24 < 6) return 'ভোর';
  if (h24 >= 6 && h24 < 12) return 'সকাল';
  if (h24 >= 12 && h24 < 16) return 'দুপুর';
  if (h24 >= 16 && h24 < 18) return 'বিকাল';
  if (h24 >= 18 && h24 < 20) return 'সন্ধ্যা';
  return 'রাত';
}

// "8:30 সকাল" / "11:45 রাত" style display for a "HH:MM" value.
// "24:00" -> "12:00 রাত" (bn) / "12:00 AM" (en).
function formatTime(hhmm, lang) {
  let [h, m] = hhmm.split(':').map(Number);
  if (h === 24) h = 0;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(m).padStart(2, '0');
  if (lang === 'bn') {
    return `${bnDigits(h12)}:${bnDigits(mm)} ${bnDayPart(h)}`;
  }
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:${mm} ${ampm}`;
}

function bnDigits(s) {
  return String(s).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[Number(d)]);
}
function formatNumber(n, lang) {
  return lang === 'bn' ? bnDigits(n) : String(n);
}

// "2h 5m" / "২ ঘণ্টা ৫ মিনিট" style duration.
function formatDuration(mins, lang) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (lang === 'bn') {
    if (h === 0) return `${bnDigits(m)} মিনিট`;
    if (m === 0) return `${bnDigits(h)} ঘণ্টা`;
    return `${bnDigits(h)} ঘণ্টা ${bnDigits(m)} মিনিট`;
  }
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDistance(km, lang) {
  const v = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return lang === 'bn' ? `${bnDigits(v)} কিমি` : `${v} km`;
}

// Next transition text: "Closes at 1:30 AM" or "Opens at 8:00 AM".
// 24h pharmacies already state it in the hours line, so no repeat.
// Day-aware: a Friday-closed pharmacy shows tomorrow's opening time.
function nextLine(p, nowMin, lang, text) {
  const h = hoursForDay(p, new Date());
  if (!h || h.hours24) return '';
  if (h.closed) {
    const tom = new Date();
    tom.setDate(tom.getDate() + 1);
    const th = hoursForDay(p, tom);
    if (!th || th.closed || th.hours24) return '';
    return `${text.opensAt} ${formatTime(th.open, lang)}`;
  }
  if (inBreak(p, nowMin)) {
    const br = p.breaks.find(([bs, be]) => nowMin >= toMinutes(bs) && nowMin < toMinutes(be));
    if (br) return `${text.opensAt} ${formatTime(br[1], lang)}`;
  }
  const open = isOpenAt(p, nowMin);
  if (open) return `${text.closesAt} ${formatTime(h.close, lang)}`;
  return `${text.opensAt} ${formatTime(h.open, lang)}`;
}

// ---------- i18n ----------
const I18N = {
  bn: {
    skipLink: 'মূল বিষয়বস্তুতে যান',
    pitch: 'রাতে খোলা ফার্মেসি খুঁজুন — সময়, ফোন, দিকনির্দেশনা এক ট্যাপে।',
    heroTitle: 'আজ রাতে খোলা ফার্মেসি',
    heroSub: 'ঢাকায় এখন কোন ফার্মেসি খোলা আছে — এক নজরে দেখে নিন, তারপর কল করুন।',
    filtersTitle: 'খুঁজে নিন',
    sortLabel: 'সাজান',
    sortRecommended: 'সেরা মিল প্রথমে',
    sortLatest: 'দেরিতে বন্ধ হয় যেগুলো',
    sortName: 'নাম অনুযায়ী',
    sortNearest: 'সবচেয়ে কাছে প্রথমে',
    clearFilters: 'ফিল্টার মুছে ফেলুন',
    nearestBtn: 'সবচেয়ে কাছে',
    nearestNote: 'কাছের ফার্মেসি দেখতে আপনার অবস্থান লাগবে — লোকেশন শুধু সাজানোর কাজে ব্যবহৃত হয়, কোথাও পাঠানো বা সংরক্ষণ করা হয় না।',
    nearestOn: 'সবচেয়ে কাছে সাজানো হচ্ছে',
    nearestDenied: 'অবস্থান পাওয়া যায়নি — লোকেশন অনুমতি দিলে কাছের ফার্মেসি দেখাবে।',
    nearestUnsupported: 'এই ব্রাউজারে লোকেশন কাজ করে না।',
    nearestNoCoords: 'কোনো ফার্মেসির যাচাই করা অবস্থান এখনো নেই — দূরত্ব দেখানো যাচ্ছে না।',
    statTotal: 'ফার্মেসি', statOpen: 'এখন খোলা', statLate: 'রাত ১২টার পরেও খোলা',
    stockNote: 'স্টকের তথ্য লাইভ নয় — যাওয়ার আগে ফোন করে ওষুধ আছে কিনা জেনে নিন।',
    searchPlaceholder: 'ফার্মেসি, এলাকা বা ঠিকানা লিখুন…',
    searchLabel: 'খুঁজুন',
    area: 'এলাকা', allAreas: 'সব এলাকা',
    openNow: 'এখন খোলা', closed: 'বন্ধ', hoursUnknown: 'সময় নিশ্চিত নয়',
    open24: 'সারারাত খোলা — ২৪ ঘণ্টা',
    closesAt: 'বন্ধ হবে', opensAt: 'খুলবে',
    closesIn: mins => `বন্ধ হতে বাকি ${formatDuration(mins, 'bn')}`,
    opensIn: mins => `খুলতে বাকি ${formatDuration(mins, 'bn')}`,
    closingSoon: 'শীঘ্রই বন্ধ হবে — এখনই কল করুন',
    lateBadge: 'রাত ১২টার পরেও খোলা',
    call: 'কল করুন', whatsapp: 'WhatsApp', directions: 'দিকনির্দেশনা',
    dialing: 'ডায়াল হচ্ছে…',
    share: 'শেয়ার করুন',
    phoneNotListed: 'ফোন নম্বর তালিকায় নেই',
    phoneUnverified: 'অযাচাইকৃত',
    phoneUnverifiedNote: 'এই নম্বরটি যাচাই হয়নি — কল করার আগে দেখে নিন।',
    confirmStock: 'ফোন করে স্টক নিশ্চিত করুন — ওষুধের মজুদ লাইভ দেখানো হয় না।',
    verifiedOn: 'যাচাই:',
    sourceOfficial: 'অফিসিয়াল', sourceDirectory: 'ডিরেক্টরি', sourceHospital: 'হাসপাতাল',
    hoursWrong: 'সময় ভুল মনে হচ্ছে?',
    correctionReported: 'সংশোধন জানানো হয়েছে — যাচাই হয়নি',
    results: (n, total) => `${formatNumber(total, 'bn')}টির মধ্যে ${formatNumber(n, 'bn')}টি দেখাচ্ছে`,
    empty: 'কোনো ফার্মেসি মেলেনি — খোঁজ বা ফিল্টার বদলে দেখুন।',
    emptySuggest: area => `আপনি কি “${area}” খুঁজছিলেন?`,
    emptyReset: 'সব ফিল্টার মুছুন',
    loading: 'তালিকা লোড হচ্ছে…',
    loadError: 'তালিকা আনা যায়নি — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।',
    retry: 'আবার চেষ্টা করুন',
    offlineNote: savedAt => `আপনি অফলাইনে আছেন — সর্বশেষ সেভ করা তালিকা দেখাচ্ছেন (${savedAt})।`,
    offlineNoteNoDate: 'আপনি অফলাইনে আছেন — সর্বশেষ সেভ করা তালিকা দেখাচ্ছেন।',
    aboutTitle: 'তথ্য যাচাই নিয়ে',
    aboutText: 'সব ফোন নম্বর, ঠিকানা ও সময় প্রকাশিত উৎস থেকে যাচাই করা — ২৬ নভেম্বর ২০২৬। কোনো নম্বর বা সময় বানানো হয়নি। যেখানে যাচাই করা যায়নি, সেখানে “নিশ্চিত নয়” লেখা আছে। সময় বদলাতে পারে, তাই যাওয়ার আগে ফোন করে নিন।',
    aboutSources: 'উৎস: Islamia Pharmacy (অফিসিয়াল সাইট), Lazz Pharma (অফিসিয়াল সাইট), Popular Medicine Corner, IBN SINA, Tamanna Pharmacy, হাসপাতাল ফার্মেসি, প্রকাশিত ডিরেক্টরি। পুরো তালিকা ও উৎস GitHub রিপোতে আছে।',
    footer: 'RaatPharmacy — Arohon Build for Bangladesh। জরুরি অবস্থায় ৯৯৯-এ কল করুন।',
    sheetTitle: 'সময় ভুল মনে হচ্ছে?',
    sheetLabel: 'সঠিক সময়টা লিখুন (ঐচ্ছিক)',
    sheetPlaceholder: 'যেমন: এখন রাত ১১টায় বন্ধ হয়',
    cancel: 'বাতিল', submit: 'জানান',
    sheetNote: 'আপনার জানানো তথ্য শুধু আপনার ব্রাউজারেই থাকবে, তালিকার সময় বদলাবে না — যাচাই না হওয়া পর্যন্ত “যাচাই হয়নি” হিসেবে দেখাবে। টিমকে সত্যিই জানাতে চাইলে মেইল করুন।',
    toastSaved: 'আপনার ব্রাউজারে সেভ হয়েছে — টিম এখনো জানে না।',
    tellTeam: 'টিমকে জানান',
    shareCopied: 'লিংক কপি হয়েছে।',
    langButton: 'English',
  },
  en: {
    skipLink: 'Skip to main content',
    pitch: 'Find an open pharmacy near you at night — hours, phone, directions in one tap.',
    heroTitle: 'Open pharmacies tonight',
    heroSub: 'See which Dhaka pharmacies are open right now — then call ahead.',
    filtersTitle: 'Refine',
    sortLabel: 'Sort by',
    sortRecommended: 'Best match first',
    sortLatest: 'Closes latest',
    sortName: 'Name A–Z',
    sortNearest: 'Nearest first',
    clearFilters: 'Clear filters',
    nearestBtn: 'Nearest',
    nearestNote: 'To show the closest pharmacies first, your location is needed — it is used only for sorting, never sent or stored anywhere.',
    nearestOn: 'Sorted by nearest',
    nearestDenied: 'Location not available — allow location access to see the nearest pharmacies.',
    nearestUnsupported: 'Location is not supported in this browser.',
    nearestNoCoords: 'No pharmacy has a verified location yet — distances cannot be shown.',
    statTotal: 'pharmacies', statOpen: 'open now', statLate: 'open past midnight',
    stockNote: 'Stock is not live — call ahead to confirm the medicine is in stock.',
    searchPlaceholder: 'Search pharmacy, area or address…',
    searchLabel: 'Search',
    area: 'Area', allAreas: 'All areas',
    openNow: 'Open now', closed: 'Closed', hoursUnknown: 'Hours not confirmed',
    open24: 'Open all night — 24 hours',
    closesAt: 'Closes at', opensAt: 'Opens at',
    closesIn: mins => `Closes in ${formatDuration(mins, 'en')}`,
    opensIn: mins => `Opens in ${formatDuration(mins, 'en')}`,
    closingSoon: 'Closing soon — call now',
    lateBadge: 'Open past midnight',
    call: 'Call', whatsapp: 'WhatsApp', directions: 'Directions',
    dialing: 'Dialing…',
    share: 'Share',
    phoneNotListed: 'Phone not listed',
    phoneUnverified: 'Unverified',
    phoneUnverifiedNote: 'This number is not verified — double-check before calling.',
    confirmStock: 'Call to confirm stock — medicine stock is not shown live.',
    verifiedOn: 'Verified:',
    sourceOfficial: 'Official', sourceDirectory: 'Directory', sourceHospital: 'Hospital',
    hoursWrong: 'Hours wrong?',
    correctionReported: 'Correction reported — not yet verified',
    results: (n, total) => `Showing ${n} of ${total}`,
    empty: 'No pharmacy matched — try a different search or filter.',
    emptySuggest: area => `Did you mean “${area}”?`,
    emptyReset: 'Clear all filters',
    loading: 'Loading list…',
    loadError: 'Could not load the list — check your network and try again.',
    retry: 'Try again',
    offlineNote: savedAt => `You are offline — showing the last saved list (${savedAt}).`,
    offlineNoteNoDate: 'You are offline — showing the last saved list.',
    aboutTitle: 'About the data',
    aboutText: 'Every phone number, address and opening-hours value was verified from a published source — 26 Nov 2026. Nothing was invented. Where it could not be verified, it says “not confirmed”. Hours can change, so call ahead before going.',
    aboutSources: 'Sources: Islamia Pharmacy (official site), Lazz Pharma (official site), Popular Medicine Corner, IBN SINA, Tamanna Pharmacy, hospital pharmacies, published directories. The full list and sources are in the GitHub repo.',
    footer: 'RaatPharmacy — Arohon Build for Bangladesh. In an emergency, call 999.',
    sheetTitle: 'Hours look wrong?',
    sheetLabel: 'Write the correct hours (optional)',
    sheetPlaceholder: 'e.g. now closes at 11 PM',
    cancel: 'Cancel', submit: 'Report',
    sheetNote: 'What you report stays only in your browser; the listed hours will not change — it will show as “not yet verified” until checked. To really tell the team, send an email.',
    toastSaved: 'Saved in your browser — the team has not been told yet.',
    tellTeam: 'Tell the team',
    shareCopied: 'Link copied.',
    langButton: 'বাংলা',
  },
};

const AREA_BN = {
  Gulshan: 'গুলশান', Banani: 'বনানী', Bashundhara: 'বসুন্ধরা', Narsingdi: 'নরসিংদী',
  Panthapath: 'পান্থপথ', Rampura: 'রামপুরা', Shahbagh: 'শাহবাগ', Mirpur: 'মিরপুর',
  Dhanmondi: 'ধানমন্ডি', Mohammadpur: 'মোহাম্মদপুর', Uttara: 'উত্তরা', Khilgaon: 'খিলগাঁও',
  Kakrail: 'কাকরাইল', Shyamoli: 'শ্যামলী', Kalabagan: 'কলাবাগান', Pallabi: 'পল্লবী',
  Jatrabari: 'যাত্রাবাড়ী', Lalbagh: 'লালবাগ', Moghbazar: 'মগবাজার', Bashabo: 'বাসাবো',
  Malibagh: 'মালিবাগ',
  Banasree: 'বনশ্রী',
  Cantonment: 'ক্যান্টনমেন্ট', Dakshinkhan: 'দক্ষিণখান', Demra: 'ডেমরা',
  'Elephant Road': 'এলিফ্যান্ট রোড', 'English Road': 'ইংলিশ রোড', Farmgate: 'ফার্মগেট',
  Gandaria: 'গেন্ডারিয়া', 'Green Road': 'গ্রিন রোড', Kallyanpur: 'কল্যাণপুর',
  Motijheel: 'মতিঝিল', 'Old Dhaka': 'পুরান ঢাকা', Ramna: 'রমনা',
  Shantinagar: 'শান্তিনগর', Siddheswari: 'সিদ্ধেশ্বরী', Tejgaon: 'তেজগাঁও',
};
function areaLabel(area, lang) {
  return lang === 'bn' ? (AREA_BN[area] || area) : area;
}
function sourceTierLabel(tier, lang) {
  const text = I18N[lang];
  if (tier === 'official') return text.sourceOfficial;
  if (tier === 'hospital') return text.sourceHospital;
  return text.sourceDirectory;
}

// ---------- state ----------
let pharmacies = [];
let lang = 'bn';
let corrections = {};
try { corrections = JSON.parse(localStorage.getItem(CORRECTIONS_KEY) || '{}'); } catch (e) { corrections = {}; }
try {
  const savedLang = localStorage.getItem(LANG_KEY);
  if (savedLang === 'bn' || savedLang === 'en') lang = savedLang;
} catch (e) { /* storage unavailable: keep default */ }

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
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  // Bangla mode uses the same day-part words as the hours on the cards
  // ("১১:৩০ রাত"), never AM/PM — the old version showed "১১:৩০ PM".
  if (lang === 'bn') return `${bnDigits(h12)}:${bnDigits(mm)} ${bnDayPart(h)} • ঢাকা`;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:${mm} ${ampm} • Dhaka`;
}

// ---------- filtering / sorting ----------
function matchesQuery(p, q) {
  if (!q) return true;
  const query = q.toLowerCase();
  // Phone numbers are searchable too: compare digits only, so
  // "01677 602 723", "01677602723" and "+8801677602723" all match the
  // same pharmacy, and the 5-digit hotlines (10616…) match as well.
  // Short digit strings (<5) are not treated as phone searches, so a
  // postcode fragment in an address search cannot false-match.
  const queryDigits = query.replace(/\D/g, '');
  if (queryDigits.length >= 5) {
    const norm = d => d.replace(/^880/, '0'); // +8801… and 01… are the same number
    const nq = norm(queryDigits);
    for (const field of [p.phone, p.phoneDisplay]) {
      const digits = (field || '').replace(/\D/g, '');
      if (!digits) continue;
      const nd = norm(digits);
      if (nd.includes(nq) || nq.includes(nd)) return true;
    }
  }
  // Include the Bangla area name so Bangla search terms match too.
  const hay = `${p.name} ${p.chain} ${p.area} ${areaLabel(p.area, 'bn')} ${p.address}`.toLowerCase();
  return hay.includes(query);
}
function distanceTo(p, loc) {
  if (!loc || p.lat == null || p.lng == null) return null;
  return haversineKm(loc.lat, loc.lng, p.lat, p.lng);
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
  if (state.sort === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name));
  } else if (state.sort === 'latest') {
    list.sort((a, b) => effectiveClose(b) - effectiveClose(a) || a.name.localeCompare(b.name));
  } else if (state.sort === 'nearest' && state.userLoc) {
    list.sort((a, b) => {
      const da = distanceTo(a, state.userLoc);
      const db = distanceTo(b, state.userLoc);
      if (da == null && db == null) return a.name.localeCompare(b.name);
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db || a.name.localeCompare(b.name);
    });
  } else {
    // Recommended: open now first, then late-night first, then name A–Z.
    list.sort((a, b) => {
      const oa = isOpenAt(a, now) === true ? 0 : 1;
      const ob = isOpenAt(b, now) === true ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const la = isLateNight(a) ? 0 : 1;
      const lb = isLateNight(b) ? 0 : 1;
      if (la !== lb) return la - lb;
      return a.name.localeCompare(b.name);
    });
  }
  return list;
}

// ---------- URL state (shareable) ----------
function syncUrl() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.area !== 'all') params.set('area', state.area);
  if (state.openNow) params.set('open', '1');
  if (state.late) params.set('late', '1');
  if (state.sort !== 'recommended') params.set('sort', state.sort);
  const qs = params.toString();
  const hash = location.hash || '';
  const url = location.pathname + (qs ? '?' + qs : '') + hash;
  history.replaceState(null, '', url);
}
function readUrlState() {
  const params = new URLSearchParams(location.search);
  if (params.get('q')) state.q = params.get('q');
  const area = params.get('area');
  if (area) state.area = area;
  if (params.get('open') === '1') state.openNow = true;
  if (params.get('late') === '1') state.late = true;
  const sort = params.get('sort');
  if (sort === 'name' || sort === 'latest') state.sort = sort;
  // A shared ?sort=nearest link asks for nearest-first sorting. The
  // location itself is only known after the visitor allows it, so the
  // actual permission request happens once, after the data loads
  // (see loadData) — never silently, and with a fallback if denied.
  if (sort === 'nearest') {
    state.sort = 'nearest';
    state.nearest = true;
    nearestFromUrl = true;
  }
}

// ---------- rendering ----------
const ICON_PHONE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z"/></svg>';
const ICON_CHAT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-3-.4-4.2-1.1L3 20l1.1-5.3A8.5 8.5 0 1 1 21 11.5z"/></svg>';
const ICON_COMPASS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="16.2 7.8 14.1 14.1 7.8 16.2 9.9 9.9 16.2 7.8"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 14.2A8.8 8.8 0 0 1 9.8 3.4 8.8 8.8 0 1 0 20.6 14.2Z"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>';

function elementFromHtml(html) {
  const templateElement = document.createElement('template');
  templateElement.innerHTML = html.trim();
  return templateElement.content.firstElementChild;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function statusBadge(p, text, now) {
  const open = isOpenAt(p, now);
  if (open === true) return `<span class="badge badge-open"><span class="dot" aria-hidden="true"></span>${escapeHtml(text.openNow)}</span>`;
  if (open === false) return `<span class="badge badge-closed"><span class="dot" aria-hidden="true"></span>${escapeHtml(text.closed)}</span>`;
  return `<span class="badge badge-unknown">${escapeHtml(text.hoursUnknown)}</span>`;
}

// Phone block: the number as plain text (not a second link), with an
// "unverified" badge and note when the number could not be confirmed.
// The Call button lives in the actions row, not here — one primary
// Call button only (audit B12).
function buildPhoneBlock(pharmacy, text, englishAttribute) {
  const phoneVerified = pharmacy.phoneVerified !== false;
  if (!pharmacy.phone) return `<p class="phone-line">${escapeHtml(text.phoneNotListed)}</p>`;
  const unverifiedBadge = phoneVerified ? '' : ` <span class="badge badge-unverified">${escapeHtml(text.phoneUnverified)}</span>`;
  // The data can explain WHY a number is unverified (e.g. Care Banani's
  // number contains a sequential run) — show that reason instead of
  // leaving the visitor to guess. It is English data, hence lang="en".
  const unverifiedNote = phoneVerified ? '' : `<p class="unverified-note">${escapeHtml(text.phoneUnverifiedNote)}${pharmacy.phoneNote ? ` <span${englishAttribute}>${escapeHtml(pharmacy.phoneNote)}</span>` : ''}</p>`;
  return `<p class="phone-line"><span class="phone-text"${englishAttribute}>${escapeHtml(pharmacy.phoneDisplay)}</span>${unverifiedBadge}</p>${unverifiedNote}`;
}

// Action buttons: Call (only with a phone), WhatsApp (only when the
// number is verified as a mobile), directions, and share. Directions
// use exact coordinates when the pharmacy has them, otherwise a
// name+address search — never a guessed location.
function buildCardActions(pharmacy, text) {
  const tel = pharmacy.phone ? pharmacy.phone.replace(/[\s-]/g, '') : '';
  const callButton = pharmacy.phone
    ? `<a class="btn btn-call" href="tel:${escapeHtml(tel)}">${ICON_PHONE}${escapeHtml(text.call)}</a>` : '';
  const whatsappButton = (pharmacy.whatsapp && pharmacy.whatsappVerified !== false && pharmacy.phone)
    ? `<a class="btn btn-icon btn-wa" href="https://wa.me/${escapeHtml(pharmacy.phone.replace(/^\+/, '').replace(/[\s-]/g, ''))}" target="_blank" rel="noopener" aria-label="${escapeHtml(text.whatsapp)}" title="${escapeHtml(text.whatsapp)}">${ICON_CHAT}</a>` : '';
  const directionsHref = (pharmacy.lat != null && pharmacy.lng != null)
    ? `https://www.google.com/maps/dir/?api=1&destination=${pharmacy.lat},${pharmacy.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pharmacy.name + ', ' + pharmacy.address)}`;
  const directionsButton = `<a class="btn btn-icon btn-ghost" href="${directionsHref}" target="_blank" rel="noopener" aria-label="${escapeHtml(text.directions)}" title="${escapeHtml(text.directions)}">${ICON_COMPASS}</a>`;
  const shareButton = `<button class="btn btn-icon btn-ghost" type="button" data-share="${escapeHtml(pharmacy.id)}" aria-label="${escapeHtml(text.share)}" title="${escapeHtml(text.share)}">${ICON_SHARE}</button>`;
  return `<div class="actions">${callButton}${whatsappButton}${directionsButton}${shareButton}</div>`;
}

function cardHtml(p, text) {
  const now = nowMinutes();
  const open = isOpenAt(p, now);
  // All data strings (names, addresses, hours, notes, sources) are
  // English; when the page is Bangla, mark them lang="en" so screen
  // readers pronounce them correctly.
  const en = lang === 'bn' ? ' lang="en"' : '';
  const badge = statusBadge(p, text, now);
  const late = isLateNight(p) ? `<span class="badge badge-late">${ICON_MOON}${escapeHtml(text.lateBadge)}</span>` : '';
  const hoursLine = p.hours24
    ? `<p class="hours-line"><strong>${escapeHtml(text.open24)}</strong></p>`
    : p.hoursText
      ? `<p class="hours-line"><strong${en}>${escapeHtml(p.hoursText)}</strong></p>`
      : `<p class="hours-line">${escapeHtml(text.hoursUnknown)}</p>`;
  const next = nextLine(p, now, lang, text);
  const until = minutesUntil(p, now);
  let countdown = '';
  if (until && until.kind === 'closes') {
    const soon = until.mins <= 90;
    countdown = `<p class="countdown${soon ? ' countdown-soon' : ''}">${escapeHtml(soon ? text.closingSoon : text.closesIn(until.mins))}</p>`;
  } else if (until && until.kind === 'opens') {
    countdown = `<p class="countdown">${escapeHtml(text.opensIn(until.mins))}</p>`;
  }
  const dist = distanceTo(p, state.userLoc);
  const distLine = (state.nearest && dist != null)
    ? `<p class="distance">${escapeHtml(formatDistance(dist, lang))}</p>` : '';
  const phoneBlock = buildPhoneBlock(p, text, en);
  const actions = buildCardActions(p, text);
  const corr = corrections[p.id];
  const corrBadge = corr
    ? `<p class="correction-badge">${escapeHtml(text.correctionReported)}${corr.text ? ` — “${escapeHtml(corr.text)}”` : ''}</p>` : '';
  const notes = p.notes ? `<p class="notes"${en}>${escapeHtml(p.notes)}</p>` : '';
  const tier = p.sourceTier ? `<span class="tier-badge">${escapeHtml(sourceTierLabel(p.sourceTier, lang))}</span>` : '';
  return `
    <li class="card${open === true ? ' card-open' : ''}" data-id="${escapeHtml(p.id)}">
      <div class="card-head">
        <div>
          <h3${en}>${escapeHtml(p.name)}</h3>
          <p class="area">${escapeHtml(areaLabel(p.area, lang))} • <span${en}>${escapeHtml(p.chain)}</span></p>
        </div>
        <div class="card-badges">${badge}${late}</div>
      </div>
      ${hoursLine}
      ${next ? `<p class="next-line">${escapeHtml(next)}</p>` : ''}
      ${countdown}
      ${distLine}
      <p class="address"${en}>${escapeHtml(p.address)}</p>
      ${actions}
      ${phoneBlock}
      <p class="meta-line">${escapeHtml(text.confirmStock)}</p>
      <p class="meta-line">${escapeHtml(text.verifiedOn)} ${escapeHtml(p.lastVerified)} • <span${en}>${escapeHtml(p.source)}</span> ${tier}</p>
      ${notes}
      ${corrBadge}
      <button class="link-btn" type="button" data-correct="${escapeHtml(p.id)}">${escapeHtml(text.hoursWrong)}</button>
    </li>`;
}

// Focus bookkeeping: remember where focus was before a re-render so it
// can be put back on the equivalent element afterwards.
function captureFocus() {
  const focusedElement = document.activeElement;
  if (!focusedElement || focusedElement === document.body) return null;
  if (focusedElement.id) return { byId: focusedElement.id, selStart: focusedElement.selectionStart, selEnd: focusedElement.selectionEnd };
  const correct = focusedElement.getAttribute && focusedElement.getAttribute('data-correct');
  if (correct) return { byAttr: 'data-correct', val: correct };
  const share = focusedElement.getAttribute && focusedElement.getAttribute('data-share');
  if (share) return { byAttr: 'data-share', val: share };
  return null;
}
function restoreFocus(desc) {
  if (!desc) return;
  let target = null;
  if (desc.byId) target = document.getElementById(desc.byId);
  else if (desc.byAttr) target = document.querySelector(`[${desc.byAttr}="${desc.val}"]`);
  if (target && typeof target.focus === 'function') {
    target.focus({ preventScroll: true });
    if (desc.selStart != null && target.setSelectionRange) {
      try { target.setSelectionRange(desc.selStart, desc.selEnd); } catch (e) { /* not a text field */ }
    }
  }
}

let areaOptionsSig = '';
// Write every visible label in the current language. This is the only
// place that touches static page text, so a new language string has one
// home and a typo shows up in one search.
function renderPageText(text) {
  document.documentElement.lang = lang;
  document.getElementById('skipLink').textContent = text.skipLink;
  document.getElementById('pitch').textContent = text.pitch;
  document.getElementById('heroTitle').textContent = text.heroTitle;
  document.getElementById('heroSub').textContent = text.heroSub;
  document.getElementById('filtersTitle').textContent = text.filtersTitle;
  document.getElementById('sortLabel').textContent = text.sortLabel;
  document.getElementById('sortRecommended').textContent = text.sortRecommended;
  document.getElementById('sortLatest').textContent = text.sortLatest;
  document.getElementById('sortName').textContent = text.sortName;
  const sortNearestOption = document.getElementById('sortNearest');
  if (sortNearestOption) sortNearestOption.textContent = text.sortNearest;
  document.getElementById('clearFilters').textContent = text.clearFilters;
  document.getElementById('emptyText').textContent = text.empty;
  document.getElementById('emptyReset').textContent = text.emptyReset;
  document.getElementById('nearestBtn').textContent = text.nearestBtn;
  document.getElementById('nearestNote').textContent = text.nearestNote;
  document.getElementById('stockNote').textContent = text.stockNote;
  document.getElementById('searchInput').placeholder = text.searchPlaceholder;
  document.getElementById('searchLabel').textContent = text.searchLabel;
  document.getElementById('areaLabel').textContent = text.area;
  document.getElementById('aboutTitle').textContent = text.aboutTitle;
  document.getElementById('aboutText').textContent = text.aboutText;
  document.getElementById('aboutSources').textContent = text.aboutSources;
  document.getElementById('footerText').textContent = text.footer;
  document.getElementById('sheetTitle').textContent = text.sheetTitle;
  document.getElementById('correctLabel').textContent = text.sheetLabel;
  document.getElementById('correctInput').placeholder = text.sheetPlaceholder;
  document.getElementById('cancelCorrect').textContent = text.cancel;
  document.getElementById('submitCorrect').textContent = text.submit;
  document.getElementById('sheetNote').textContent = text.sheetNote;
  document.getElementById('langToggle').textContent = text.langButton;
  document.getElementById('clock').textContent = clockText();
}

// Refresh the three stat chips and their pressed states so the chips
// always agree with the active filter.
function renderStats(text) {
  const now = nowMinutes();
  const openCount = pharmacies.filter(p => isOpenAt(p, now) === true).length;
  const lateCount = pharmacies.filter(isLateNight).length;
  document.getElementById('statTotal').textContent = formatNumber(pharmacies.length, lang);
  document.getElementById('statTotalLabel').textContent = text.statTotal;
  document.getElementById('statOpen').textContent = formatNumber(openCount, lang);
  document.getElementById('statOpenLabel').textContent = text.statOpen;
  document.getElementById('statLate').textContent = formatNumber(lateCount, lang);
  document.getElementById('statLateLabel').textContent = text.statLate;
  document.getElementById('statChipAll').setAttribute('aria-pressed', String(!state.openNow && !state.late));
  document.getElementById('statChipOpen').setAttribute('aria-pressed', String(state.openNow));
  document.getElementById('statChipLate').setAttribute('aria-pressed', String(state.late));
  document.getElementById('nearestBtn').setAttribute('aria-pressed', String(state.nearest));
}

// Rebuild the area <select> options only when the area list or the
// language changes. Rebuilding on every render would destroy focus
// inside the select, so the signature string guards it. Returns the
// sorted area list for the caller.
function renderAreaOptions(text) {
  const areas = [...new Set(pharmacies.map(p => p.area))].sort();
  const signature = lang + '|' + areas.join(',');
  if (signature !== areaOptionsSig) {
    areaOptionsSig = signature;
    const areaSelect = document.getElementById('areaFilter');
    areaSelect.innerHTML = `<option value="all">${escapeHtml(text.allAreas)}</option>` +
      areas.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(areaLabel(a, lang))}</option>`).join('');
  }
  const areaSelect = document.getElementById('areaFilter');
  // Normalise the area from the URL case-insensitively (?area=banani
  // must match the "Banani" option) once the area list is known.
  if (state.area !== 'all') {
    const match = areas.find(a => a.toLowerCase() === String(state.area).toLowerCase());
    if (match) state.area = match;
  }
  if (areas.includes(state.area)) areaSelect.value = state.area;
  else { areaSelect.value = 'all'; state.area = 'all'; }
  return areas;
}

// Keep the sort select and the clear-filters button in sync with state:
// the "Nearest" sort option exists only once a location is known, and
// clear-filters is usable only when something is actually filtered.
function renderFilterControls(text) {
  const sortSelect = document.getElementById('sortSelect');
  if (state.userLoc && !document.getElementById('sortNearest')) {
    const option = document.createElement('option');
    option.id = 'sortNearest'; option.value = 'nearest'; option.textContent = text.sortNearest;
    sortSelect.appendChild(option);
  }
  sortSelect.value = state.sort;
  const hasFilter = state.q !== '' || state.area !== 'all' || state.openNow ||
    state.late || state.sort !== 'recommended' || state.nearest;
  const clearButton = document.getElementById('clearFilters');
  clearButton.disabled = !hasFilter;
  clearButton.classList.toggle('hidden', !hasFilter);
}

// Levenshtein distance (small strings only: area names). Used to
// suggest the closest area when a search finds nothing.
function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Closest area to a failed search query, or null. Matches on the English
// name and the Bangla label, so "gulsan", "গুলসান" and "bananai" all
// suggest the right area instead of a dead end. A substring match wins
// outright; otherwise the closest spelling within a small distance.
function suggestAreaFor(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return null;
  const areas = [...new Set(pharmacies.map(p => p.area))];
  let best = null;
  let bestDist = Infinity;
  for (const area of areas) {
    if (area === state.area) continue; // never suggest the filter already on
    const labels = [area.toLowerCase(), areaLabel(area, 'bn').toLowerCase()];
    for (const label of labels) {
      if (label.includes(q) || q.includes(label)) return area;
      const dist = levenshtein(q, label);
      const limit = label.length <= 6 ? 2 : 3;
      if (dist <= limit && dist < bestDist) { best = area; bestDist = dist; }
    }
  }
  return best;
}

// Re-render the whole page from state. Each step is its own function
// above; this one only calls them in order, then restores focus and
// writes the shareable URL. The result count is an aria-live region, so
// it is updated ONLY for user actions (search/filter/sort/language),
// never on the 60-second refresh.
function render(opts) {
  const announce = !!(opts && opts.announce);
  const focusDescription = captureFocus();
  const text = I18N[lang];
  renderPageText(text);
  renderStats(text);
  renderAreaOptions(text);
  renderFilterControls(text);
  const list = filteredList(state);
  renderList(list, text, announce);
  if (announce) {
    document.getElementById('resultCount').textContent = text.results(list.length, pharmacies.length);
  }
  document.getElementById('emptyState').classList.toggle('hidden', list.length > 0);
  // Empty search: suggest the closest matching area instead of a dead
  // end. The button applies that area and clears the search text.
  const suggestBox = document.getElementById('emptySuggest');
  const suggestion = list.length === 0 && state.q ? suggestAreaFor(state.q) : null;
  if (suggestion) {
    document.getElementById('emptySuggestBtn').textContent = text.emptySuggest(areaLabel(suggestion, lang));
    document.getElementById('emptySuggestBtn').dataset.area = suggestion;
    suggestBox.classList.remove('hidden');
  } else {
    suggestBox.classList.add('hidden');
  }
  document.getElementById('loadingState').classList.add('hidden');
  restoreFocus(focusDescription);
  syncUrl();
}

// Keyed list reconciliation: reuse a card node when its generated HTML
// is unchanged, so focus inside a card survives re-renders.
// When `animate` is true (a user filter/search action), the list plays a
// subtle 120ms fade+rise; the CSS disables it under reduced motion.
function renderList(list, text, animate) {
  const ul = document.getElementById('pharmacyList');
  if (animate) {
    ul.classList.remove('list-anim');
    // Force a reflow so the animation restarts on every filter change.
    void ul.offsetWidth;
    ul.classList.add('list-anim');
    setTimeout(() => ul.classList.remove('list-anim'), 200);
  }
  // Skeleton cards (no data-id) are one-shot placeholders: drop them.
  Array.from(ul.children).forEach(li => {
    if (!li.dataset || !li.dataset.id) li.remove();
  });
  const existing = new Map();
  Array.from(ul.children).forEach(li => {
    if (!li.dataset || !li.dataset.id) return;
    // A stale duplicate (same id twice) must not shadow the live node:
    // drop extras on sight, so a bad render can never leave the list
    // doubled again.
    if (existing.has(li.dataset.id)) { li.remove(); return; }
    existing.set(li.dataset.id, li);
  });
  const seen = new Set();
  const fragment = document.createDocumentFragment();
  list.forEach(p => {
    seen.add(p.id);
    const html = cardHtml(p, text);
    let li = existing.get(p.id);
    if (li && li._html === html) {
      // Reuse: move into place, keep focus and DOM state.
    } else {
      // WHY remove the old node first: creating a fresh node without
      // removing the old one left both in the list — every language
      // toggle doubled all 94 cards, and the keyed map could only see
      // one of each pair, so later renders could never clean up.
      // (Found by the Nov 2026 audit: 188 cards after one toggle, and
      // "0 of 94" shown next to 94 stale cards after an empty search.)
      if (li) li.remove();
      li = elementFromHtml(html);
      li._html = html;
    }
    fragment.appendChild(li);
  });
  existing.forEach((li, id) => { if (!seen.has(id)) li.remove(); });
  ul.appendChild(fragment);
}

// Update one visible card's live status in place: open/closed badge,
// next opening/closing line, and countdown. Replacing the whole card
// would steal focus, so only these three spots are touched.
function refreshCardStatus(cardElement, pharmacy, text, now) {
  const open = isOpenAt(pharmacy, now);
  cardElement.classList.toggle('card-open', open === true);
  const badgeSlot = cardElement.querySelector('.card-badges .badge');
  if (badgeSlot) badgeSlot.outerHTML = statusBadge(pharmacy, text, now);
  const nextElement = cardElement.querySelector('.next-line');
  const nextText = nextLine(pharmacy, now, lang, text);
  if (nextElement) {
    if (nextText) nextElement.textContent = nextText;
    else nextElement.remove();
  } else if (nextText) {
    const hoursElement = cardElement.querySelector('.hours-line');
    if (hoursElement) hoursElement.insertAdjacentHTML('afterend', `<p class="next-line">${escapeHtml(nextText)}</p>`);
  }
  const until = minutesUntil(pharmacy, now);
  let countdownElement = cardElement.querySelector('.countdown');
  let countdownText = '';
  let soon = false;
  if (until && until.kind === 'closes') {
    soon = until.mins <= 90;
    countdownText = soon ? text.closingSoon : text.closesIn(until.mins);
  } else if (until && until.kind === 'opens') {
    countdownText = text.opensIn(until.mins);
  }
  if (countdownText) {
    if (countdownElement) { countdownElement.textContent = countdownText; countdownElement.classList.toggle('countdown-soon', soon); }
    else {
      const anchor = cardElement.querySelector('.next-line') || cardElement.querySelector('.hours-line');
      if (anchor) anchor.insertAdjacentHTML('afterend', `<p class="countdown${soon ? ' countdown-soon' : ''}">${escapeHtml(countdownText)}</p>`);
    }
  } else if (countdownElement) countdownElement.remove();
}

// The 60-second refresh updates ONLY the clock, the stat numbers, and each
// visible card's status badge / next line / countdown — never the whole
// list, never the aria-live result count, so focus is never lost.
function refreshOpenStatuses() {
  const text = I18N[lang];
  document.getElementById('clock').textContent = clockText();
  if (!pharmacies.length) return;
  const now = nowMinutes();
  const openCount = pharmacies.filter(p => isOpenAt(p, now) === true).length;
  const lateCount = pharmacies.filter(isLateNight).length;
  document.getElementById('statOpen').textContent = formatNumber(openCount, lang);
  document.getElementById('statLate').textContent = formatNumber(lateCount, lang);
  document.querySelectorAll('#pharmacyList .card').forEach(cardElement => {
    const pharmacy = pharmacies.find(x => x.id === cardElement.dataset.id);
    if (!pharmacy) return;
    refreshCardStatus(cardElement, pharmacy, text, now);
  });
}

// Shared filter state (chips, area, sort, search, nearest).
const state = { q: '', area: 'all', openNow: false, late: false, sort: 'recommended', nearest: false, userLoc: null };
// True only when the page was opened with ?sort=nearest in the URL.
let nearestFromUrl = false;
function syncStateFromInputs() {
  state.q = document.getElementById('searchInput').value.trim();
  state.area = document.getElementById('areaFilter').value;
  state.sort = document.getElementById('sortSelect').value;
  // The sort dropdown also offers "Nearest first" once a location is
  // known: picking it must behave exactly like the Nearest button
  // (distances shown, button pressed), not just re-order silently.
  state.nearest = state.sort === 'nearest';
}
function clearFilters() {
  state.q = ''; state.area = 'all'; state.openNow = false; state.late = false;
  state.sort = 'recommended'; state.nearest = false;
  document.getElementById('searchInput').value = '';
  document.getElementById('areaFilter').value = 'all';
  document.getElementById('sortSelect').value = 'recommended';
  render({ announce: true });
}
// Ask for the visitor's location once and sort nearest-first.
// Shared by the Nearest button and by a shared ?sort=nearest link.
// On denial (or no location support) the sort falls back to
// Recommended instead of leaving a "nearest" sort with no distances.
function requestNearest() {
  if (!('geolocation' in navigator)) {
    state.nearest = false;
    if (state.sort === 'nearest') state.sort = 'recommended';
    showToast(I18N[lang].nearestUnsupported);
    render({ announce: true });
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      // 21 pharmacies have verified coordinates; if none did, say so
      // instead of sorting silently by nothing.
      const anyGeo = pharmacies.some(p => p.lat != null && p.lng != null);
      if (!anyGeo) {
        state.nearest = false;
        if (state.sort === 'nearest') state.sort = 'recommended';
        showToast(I18N[lang].nearestNoCoords);
        render({ announce: true });
        return;
      }
      state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.nearest = true;
      state.sort = 'nearest';
      render({ announce: true });
    },
    () => {
      state.nearest = false;
      if (state.sort === 'nearest') state.sort = 'recommended';
      showToast(I18N[lang].nearestDenied);
      render({ announce: true });
    },
    { timeout: 10000, maximumAge: 300000 }
  );
}
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- sharing ----------
function pharmacyUrl(p) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.area !== 'all') params.set('area', state.area);
  if (state.openNow) params.set('open', '1');
  if (state.late) params.set('late', '1');
  if (state.sort !== 'recommended') params.set('sort', state.sort);
  const qs = params.toString();
  return location.origin + location.pathname + (qs ? '?' + qs : '') + '#' + p.id;
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed'; textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try { document.execCommand('copy'); resolve(); }
    catch (e) { reject(e); }
    document.body.removeChild(textArea);
  });
}
function sharePharmacy(p) {
  const url = pharmacyUrl(p);
  const text = `${p.name} — ${I18N[lang].heroTitle}`;
  if (navigator.share) {
    navigator.share({ title: 'RaatPharmacy', text, url }).catch(() => { /* user cancelled */ });
  } else {
    copyText(url).then(() => showToast(I18N[lang].shareCopied)).catch(() => showToast(url));
  }
}
function scrollToHashCard() {
  const id = (location.hash || '').slice(1);
  if (!id) return;
  let li = document.querySelector(`#pharmacyList .card[data-id="${CSS.escape(id)}"]`);
  if (!li) {
    // A shared link to a card the current filters hide (e.g. ?open=1
    // at a time that pharmacy is closed): drop the filters so the
    // card can actually be reached, instead of silently showing nothing.
    if (!pharmacies.some(p => p.id === id)) return;
    clearFilters();
    li = document.querySelector(`#pharmacyList .card[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
  }
  try { li.scrollIntoView({ block: 'start' }); } catch (e) { /* jsdom / old browsers */ }
  li.classList.add('card-highlight');
  setTimeout(() => li.classList.remove('card-highlight'), 4000);
}

// ---------- correction sheet (focus managed) ----------
let correctingId = null;
let sheetTrigger = null;
let sheetKeyHandler = null;
function focusableInSheet() {
  // The sheet is visible whenever this runs; its input + buttons are the
  // only focusables. (offsetParent is unreliable here: jsdom reports null
  // for everything, and fixed-position ancestors behave inconsistently.)
  return Array.from(document.getElementById('correctSheet')
    .querySelectorAll('input, button'))
    .filter(elm => !elm.disabled);
}
function openSheet(id, trigger) {
  correctingId = id;
  sheetTrigger = trigger || null;
  const p = pharmacies.find(x => x.id === id);
  const sheetPharmacy = document.getElementById('sheetPharmacy');
  sheetPharmacy.textContent = p ? p.name : '';
  // Pharmacy names are English data.
  if (lang === 'bn') sheetPharmacy.setAttribute('lang', 'en');
  else sheetPharmacy.removeAttribute('lang');
  document.getElementById('correctInput').value = '';
  document.getElementById('correctSheet').classList.remove('hidden');
  document.getElementById('sheetBackdrop').classList.remove('hidden');
  // Background inert while the dialog is open.
  ['topbar', 'main', 'footer'].forEach(sel => {
    const node = document.querySelector(sel === 'topbar' ? 'header.topbar' : sel);
    if (node) node.setAttribute('inert', '');
  });
  document.querySelector('header.topbar').setAttribute('aria-hidden', 'true');
  document.getElementById('main').setAttribute('aria-hidden', 'true');
  document.querySelector('footer').setAttribute('aria-hidden', 'true');
  sheetKeyHandler = e => {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const f = focusableInSheet();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.getElementById('correctSheet').addEventListener('keydown', sheetKeyHandler);
  document.getElementById('correctInput').focus();
}
function closeSheet() {
  correctingId = null;
  document.getElementById('correctSheet').classList.add('hidden');
  document.getElementById('sheetBackdrop').classList.add('hidden');
  if (sheetKeyHandler) {
    document.getElementById('correctSheet').removeEventListener('keydown', sheetKeyHandler);
    sheetKeyHandler = null;
  }
  document.querySelectorAll('[inert]').forEach(node => node.removeAttribute('inert'));
  document.querySelector('header.topbar').removeAttribute('aria-hidden');
  document.getElementById('main').removeAttribute('aria-hidden');
  document.querySelector('footer').removeAttribute('aria-hidden');
  if (sheetTrigger && typeof sheetTrigger.focus === 'function') {
    sheetTrigger.focus({ preventScroll: true });
  }
  sheetTrigger = null;
}
let toastTimer = null;
function showToast(html, ms) {
  const toast = document.getElementById('toast');
  toast.innerHTML = html;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), ms || 6000);
}
function tellTeamLink(p, text) {
  const subject = `RaatPharmacy সংশোধন: ${p ? p.name : ''}`;
  const body = `ফার্মেসি: ${p ? `${p.name} (${p.address})` : ''}\nসংশোধন: ${text || '(কিছু লেখা হয়নি)'}\n\n— RaatPharmacy থেকে পাঠানো`;
  return `mailto:${TEAM_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ---------- data loading ----------
function showSkeleton() {
  const ul = document.getElementById('pharmacyList');
  ul.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    ul.appendChild(elementFromHtml('<li class="card skeleton" aria-hidden="true"><div class="sk-line sk-title"></div><div class="sk-line sk-sub"></div><div class="sk-line sk-btn"></div></li>'));
  }
  document.getElementById('loadingState').classList.remove('hidden');
  document.getElementById('errorState').classList.add('hidden');
}
function loadData() {
  showSkeleton();
  return fetch('data/pharmacies.json')
    .then(r => { if (!r.ok) throw new Error('Failed to load data'); return r.json(); })
    .then(d => {
      pharmacies = d.pharmacies || [];
      try { localStorage.setItem(DATA_SAVED_KEY, new Date().toISOString()); } catch (e) { /* ignore */ }
      document.getElementById('errorState').classList.add('hidden');
      render({ announce: true });
      showOfflineNoteIfNeeded();
      scrollToHashCard();
      // A shared ?sort=nearest link: ask for location once, now that
      // the data (and its coordinates) is loaded.
      if (nearestFromUrl) { nearestFromUrl = false; requestNearest(); }
    })
    .catch(() => {
      document.getElementById('pharmacyList').innerHTML = '';
      document.getElementById('loadingState').classList.add('hidden');
      const err = document.getElementById('errorState');
      err.querySelector('.error-text').textContent = I18N[lang].loadError;
      err.querySelector('#retryLoad').textContent = I18N[lang].retry;
      err.classList.remove('hidden');
      showOfflineNoteIfNeeded();
    });
}
function showOfflineNoteIfNeeded() {
  const note = document.getElementById('offlineNote');
  if (!navigator.onLine) {
    let savedAt = '';
    try { savedAt = localStorage.getItem(DATA_SAVED_KEY) || ''; } catch (e) { /* ignore */ }
    if (savedAt) {
      const d = new Date(savedAt);
      const stamp = lang === 'bn'
        ? `${bnDigits(d.getDate())}/${bnDigits(d.getMonth() + 1)}/${bnDigits(d.getFullYear())}, ${bnDigits(String(d.getHours()).padStart(2, '0'))}:${bnDigits(String(d.getMinutes()).padStart(2, '0'))}`
        : d.toLocaleString();
      note.textContent = I18N[lang].offlineNote(stamp);
    } else {
      // No saved date yet: say so in words. Interpolating the empty
      // date into the normal string printed a bare "()" on screen.
      note.textContent = I18N[lang].offlineNoteNoDate;
    }
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }
}

// ---------- init ----------
function init() {
  readUrlState();
  // Restore inputs from URL state before first render.
  document.getElementById('searchInput').value = state.q || '';
  document.getElementById('areaFilter').value = state.area || 'all';
  document.getElementById('sortSelect').value = state.sort || 'recommended';

  const debouncedSearch = debounce(() => { syncStateFromInputs(); render({ announce: true }); }, 150);
  document.getElementById('searchInput').addEventListener('input', debouncedSearch);
  document.getElementById('areaFilter').addEventListener('change', () => { syncStateFromInputs(); render({ announce: true }); });
  document.getElementById('sortSelect').addEventListener('change', () => { syncStateFromInputs(); render({ announce: true }); });
  document.getElementById('clearFilters').addEventListener('click', clearFilters);
  document.getElementById('emptyReset').addEventListener('click', clearFilters);
  document.getElementById('retryLoad').addEventListener('click', () => loadData());
  document.getElementById('statChipAll').addEventListener('click', () => { state.openNow = false; state.late = false; render({ announce: true }); });
  document.getElementById('statChipOpen').addEventListener('click', () => { state.openNow = !state.openNow; render({ announce: true }); });
  document.getElementById('statChipLate').addEventListener('click', () => { state.late = !state.late; render({ announce: true }); });
  document.getElementById('nearestBtn').addEventListener('click', () => {
    if (state.nearest) { state.nearest = false; state.sort = 'recommended'; render({ announce: true }); return; }
    requestNearest();
  });
  document.getElementById('emptySuggestBtn').addEventListener('click', e => {
    // Apply the suggested area and clear the failed search text, so the
    // visitor lands on real results instead of an empty page.
    const area = e.currentTarget.dataset.area;
    if (!area) return;
    state.q = '';
    state.area = area;
    document.getElementById('searchInput').value = '';
    document.getElementById('areaFilter').value = area;
    render({ announce: true });
  });
  document.getElementById('langToggle').addEventListener('click', () => {
    lang = lang === 'bn' ? 'en' : 'bn';
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
    render({ announce: true });
  });
  document.getElementById('pharmacyList').addEventListener('click', e => {
    // Tapping Call shows brief "Dialing…" feedback + a light haptic.
    // WHY an overlay class, not a label swap: replacing the button's
    // text changes its width, the actions row can wrap, the card grows
    // taller, and the next tap can land on the wrong button. The
    // overlay (see .btn-call.is-dialing in styles.css) covers the
    // button without moving anything on the page.
    const callBtn = e.target.closest('.btn-call');
    if (callBtn && !callBtn.classList.contains('is-dialing')) {
      callBtn.classList.add('is-dialing');
      callBtn.setAttribute('data-dialing-text', I18N[lang].dialing);
      callBtn.setAttribute('aria-busy', 'true');
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) { /* unsupported */ } }
      setTimeout(() => {
        callBtn.classList.remove('is-dialing');
        callBtn.removeAttribute('aria-busy');
      }, 900);
    }
    const correctBtn = e.target.closest('[data-correct]');
    if (correctBtn) { openSheet(correctBtn.getAttribute('data-correct'), correctBtn); return; }
    const shareBtn = e.target.closest('[data-share]');
    if (shareBtn) {
      const p = pharmacies.find(x => x.id === shareBtn.getAttribute('data-share'));
      if (p) sharePharmacy(p);
    }
  });
  document.getElementById('cancelCorrect').addEventListener('click', closeSheet);
  document.getElementById('sheetBackdrop').addEventListener('click', closeSheet);
  document.getElementById('submitCorrect').addEventListener('click', () => {
    if (!correctingId) return;
    const correctionText = document.getElementById('correctInput').value.trim();
    const p = pharmacies.find(x => x.id === correctingId);
    saveCorrection(correctingId, correctionText);
    closeSheet();
    render({ announce: true });
    // Honest toast: saved only in this browser + a real way to tell the team.
    const text = I18N[lang];
    showToast(`${escapeHtml(text.toastSaved)} <a href="${tellTeamLink(p, correctionText)}">${escapeHtml(text.tellTeam)} →</a>`, 8000);
  });
  // Clock + open-now status refresh every minute — badges/countdowns only.
  setInterval(refreshOpenStatuses, 60000);

  // Offline support: register the service worker only if it loads.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* works fine without it */ });
    });
  }
  window.addEventListener('online', showOfflineNoteIfNeeded);
  window.addEventListener('offline', showOfflineNoteIfNeeded);
  // Same-document navigation to a #pharmacy-id (a shared card link
  // opened while already on the finder, or back/forward): a plain
  // goto with only a hash change does not reload the page, so without
  // this the link would do nothing at all.
  window.addEventListener('hashchange', scrollToHashCard);

  loadData();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
// Export pure helpers for Node testing.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { toMinutes, isOpenAt, isLateNight, formatTime, minutesUntil, effectiveClose, formatDuration, haversineKm, bnDayPart, hoursForDay, inBreak };
}
