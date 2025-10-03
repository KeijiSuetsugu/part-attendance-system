/* ===== 設定値 ===== */
var THRESHOLDS = { T103: 1030000, T106: 1060000, T130: 1300000 };
var STORAGE_KEY = "part_attendance_v3_min";

/* 祝日キャッシュ */
var HOLIDAY_CACHE_KEY = "holiday_cache_v1";
var HOLIDAY_TTL_DAYS = 30;

/* 内部既定：フォールバックで使う1日基準 */
var DEFAULT_BASE_HOURS = 6;

/* ===== ユーティリティ ===== */
function $(sel){ return document.querySelector(sel); }
function fmtJPY(n){ return "¥" + Math.round(n).toLocaleString("ja-JP", { maximumFractionDigits: 0 }); }
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function uid(){ return "emp-" + Math.random().toString(36).slice(2, 9); }
function pad2(n){ return String(n).length===1 ? "0"+String(n) : String(n); }
function ymd(ym, d){ return ym + "-" + pad2(d); }
function youbi(y,m,d){ return ["日","月","火","水","木","金","土"][new Date(y, m-1, d).getDay()]; }
function isWeekend(y,m,d){ var w = new Date(y, m-1, d).getDay(); return (w===0 || w===6); }
function getYearFromYM(ym){ return Number(ym.split("-")[0]); }
function toYM(d){ return d.getFullYear() + "-" + pad2(d.getMonth()+1); }
function onClick(id, handler){ var el = document.getElementById(id); if (el) el.addEventListener("click", handler); }

/* 全角→半角の正規化（数字・コロン・中黒・句読点・空白） */
function normalizeText(s){
  if (!s) return "";
  return s
    .replace(/[０-９]/g, function(ch){ return String.fromCharCode(ch.charCodeAt(0)-0xFEE0); }) // ０-９ → 0-9
    .replace(/[：]/g, ":")
    .replace(/[〜～]/g, "~")
    .replace(/[・､，]/g, ",")
    .replace(/[　\s]+/g, " ")        // 連続空白を1つに
    .trim();
}
/* 緩い数値化（小数点のみ残す） */
function toNumberSafe(s){ if (!s) return NaN; return Number(String(s).replace(/[^\d.]/g,'')); }

/* ===== 祝日キャッシュ ===== */
var holidayCache = loadHolidayCache();
function loadHolidayCache(){
  try { var raw = localStorage.getItem(HOLIDAY_CACHE_KEY); if (raw) return JSON.parse(raw); } catch(e){}
  return { years:{}, updated:{}, source:"" };
}
function saveHolidayCache(){ localStorage.setItem(HOLIDAY_CACHE_KEY, JSON.stringify(holidayCache)); }
function updateHolidayStatus(year, loaded, source){
  var el = $("#holiday-status"); if (!el) return;
  if (loaded) el.textContent = "祝日データ：" + year + " 取得済（" + (source==="holidays-jp"?"holidays-jp":"Nager.Date") + "）";
  else el.textContent = "祝日データ：" + year + " を取得できませんでした";
}
function ensureHolidaysForYear(year, cb){
  if (!holidayCache || !holidayCache.years) holidayCache = { years:{}, updated:{}, source:"" };
  var now = Date.now(); var ystr = String(year);
  var have = holidayCache.years[ystr]; var ts = holidayCache.updated ? holidayCache.updated[ystr] : null;
  if (have && ts && ((now - ts)/86400000 < HOLIDAY_TTL_DAYS)){ updateHolidayStatus(year, true, holidayCache.source||"holidays-jp"); cb&&cb(); return; }
  fetchHolidaysJP(year, function(map, src){
    holidayCache.years[ystr] = map; holidayCache.updated[ystr]=Date.now(); holidayCache.source=src; saveHolidayCache(); updateHolidayStatus(year,true,src); cb&&cb();
  }, function(){
    fetchNagerJP(year, function(map, src){
      holidayCache.years[ystr] = map; holidayCache.updated[ystr]=Date.now(); holidayCache.source=src; saveHolidayCache(); updateHolidayStatus(year,true,src); cb&&cb();
    }, function(){ updateHolidayStatus(year,false,""); cb&&cb(); });
  });
}
function fetchHolidaysJP(year, ok, ng){
  fetch("https://holidays-jp.github.io/api/v1/"+year+"/date.json",{cache:"no-store"})
    .then(r=>{ if(!r.ok) throw new Error(); return r.json(); })
    .then(json=>ok(json,"holidays-jp")).catch(ng);
}
function fetchNagerJP(year, ok, ng){
  fetch("https://date.nager.at/api/v3/PublicHolidays/"+year+"/JP",{cache:"no-store"})
    .then(r=>{ if(!r.ok) throw new Error(); return r.json(); })
    .then(list=>{ var map={}; list.forEach(it=>{ map[it.date]=it.localName||it.name||"祝日"; }); ok(map,"nager"); })
    .catch(ng);
}
function getHolidayNameByDate(ym, d){
  var y = String(getYearFromYM(ym)); var map = holidayCache && holidayCache.years ? holidayCache.years[y] : null;
  return map ? (map[ymd(ym,d)] || "") : "";
}

/* ===== 状態 ===== */
var state = loadStateOrInit();
function loadStateOrInit() {
  try { var raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch(e){}
  var id = uid();
  var fresh = { employees:[{id, name:"", wage:0}], currentEmpId:id, months:{}, ui:{ ym:toYM(new Date()), projMode:"thismonth", customCaps:{a:0,b:0} } };
  saveState(fresh); return fresh;
}
function saveState(s){ localStorage.setItem(STORAGE_KEY, JSON.stringify(s||state)); }

function daysInMonth(ym){ var [y,m]=ym.split("-").map(Number); return new Date(y, m, 0).getDate(); }
function firstDow(ym){ var [y,m]=ym.split("-").map(Number); return new Date(y, m-1, 1).getDay(); }
function currentEmployee(){ var id=state.currentEmpId; return state.employees.find(e=>e.id===id)||null; }
function ensureEmpMonth(empId, ym){ state.months[empId] = state.months[empId]||{}; state.months[empId][ym] = state.months[empId][ym]||{}; return state.months[empId][ym]; }

/* ===== 希望票 AI解析 強化 ===== */
var JP_WEEK = { "日":0, "月":1, "火":2, "水":3, "木":4, "金":5, "土":6 };

function parseWeekCharsToSet(str){
  var set = new Set();
  (str||"").split("").forEach(function(ch){
    if (JP_WEEK.hasOwnProperty(ch)) set.add(JP_WEEK[ch]);
  });
  return set;
}

function parseWishText(raw){
  // 正規化（全角→半角・中黒/句読点→カンマ・空白整理）
  var text = normalizeText(raw||"");

  var c = {
    preferCapYen: null,
    mentionFuyou: /扶養.*(範囲|内)/.test(text),
    holidayOff: null,            // true|false|null
    dailyHoursPrefer: null,
    weeklyDays: null,
    weeklyHours: null,
    weekdaysAllowed: new Set(),
    weekdaysOff: new Set(),
    onDates: new Set(),
    offDates: new Set()
  };

  // 上限（103/106/130 万円）
  if (/(130)\s*万|1\s*300\s*000/.test(text)) c.preferCapYen = 1300000;
  else if (/(106)\s*万|1\s*060\s*000/.test(text)) c.preferCapYen = 1060000;
  else if (/(103)\s*万|1\s*030\s*000/.test(text)) c.preferCapYen = 1030000;

  // 祝日
  if (/祝日.*休/.test(text)) c.holidayOff = true;
  if (/祝日.*可|祝日.*OK/i.test(text)) c.holidayOff = false;

  // 勤務時間（全角対応後なので \d でOK）
  // 例：「勤務時間は4時間」「実働: 6 時間」「1日 5.5 時間」「5h」
  var mFixed = text.match(/(勤務時間|実働|希望時間)\s*[:は]?\s*([0-9]+(?:\.[0-9]+)?)\s*時間/);
  if (mFixed){ c.dailyHoursPrefer = toNumberSafe(mFixed[2]); }
  var mDay = text.match(/1日\s*([0-9]+(?:\.[0-9]+)?)\s*時間|([0-9]+(?:\.[0-9]+)?)\s*h/i);
  if (!c.dailyHoursPrefer && mDay){ c.dailyHoursPrefer = toNumberSafe(mDay[1] || mDay[2]); }

  // 時間帯 → 所要時間（10:00~16:30 / 9-15）
  var mSpan = text.match(/(\d{1,2})(?::(\d{2}))?\s*[~\-]\s*(\d{1,2})(?::(\d{2}))?/);
  if (mSpan){
    var sH = toNumberSafe(mSpan[1]), sM = toNumberSafe(mSpan[2]||0);
    var eH = toNumberSafe(mSpan[3]), eM = toNumberSafe(mSpan[4]||0);
    var dur = Math.max(0, (eH*60+eM)-(sH*60+sM)) / 60;
    if (dur>0) c.dailyHoursPrefer = Math.round(dur*4)/4;
  }

  // 週X日 / 週X時間
  var mWDays = text.match(/週\s*([0-9]+)\s*日/);
  if (mWDays) c.weeklyDays = toNumberSafe(mWDays[1]);
  var mWHours = text.match(/週\s*([0-9]+(?:\.[0-9]+)?)\s*時間/);
  if (mWHours) c.weeklyHours = toNumberSafe(mWHours[1]);

  // ★ 曜日リスト＋可否（例：「月・火・木は出勤」「水金は休み」「土日可」「平日中心」）
  // 正規化済みなので「・」はカンマに置き換わっている前提。カンマやスペースを許容しつつ拾う。
  // パターン1： [月火水木金土日, ]+ は (出勤|勤務|可|OK|休み|不可|NG)
  var reWeekList = /([月火水木金土日,\s]+?)\s*は?\s*(出勤|勤務|可|OK|休み|不可|NG)/g;
  var m;
  while ((m = reWeekList.exec(text)) !== null){
    var daysStr = m[1].replace(/[, ]+/g,""); // カンマ/空白除去 → 例「月火木」
    var verb = m[2];
    var set = parseWeekCharsToSet(daysStr);
    if (/出勤|勤務|可|OK/i.test(verb)){
      set.forEach(d=>c.weekdaysAllowed.add(d));
      // 許可が明示された場合、他曜日を除外する設計は buildCandidateDays 側で処理
    } else {
      set.forEach(d=>c.weekdaysOff.add(d));
    }
  }

  // パターン2：個別曜日 OK/NG（単発表現にも対応）
  Object.keys(JP_WEEK).forEach(function(k){
    var reOk = new RegExp(k+"[曜日]?(は)?(出勤|勤務|出勤可|希望|入れる|OK)","i");
    var reNg = new RegExp(k+"[曜日]?(は)?(不可|NG|休み|入れない)","i");
    if (reOk.test(text)) c.weekdaysAllowed.add(JP_WEEK[k]);
    if (reNg.test(text)) c.weekdaysOff.add(JP_WEEK[k]);
  });

  // 「平日のみ/中心」「土日中心」
  if (/平日(のみ|だけ|中心)/.test(text)){ [1,2,3,4,5].forEach(d=>c.weekdaysAllowed.add(d)); c.weekdaysOff.add(0); c.weekdaysOff.add(6); }
  if (/(土日|週末)(のみ|だけ|中心)/.test(text)){ c.weekdaysAllowed.add(0); c.weekdaysAllowed.add(6); [1,2,3,4,5].forEach(d=>c.weekdaysOff.add(d)); }

  // 特定日（15日は休み / 22日は入れる）
  var reDay = /(\d{1,2})\s*日/g, m2;
  while ((m2 = reDay.exec(text)) !== null){
    var d = toNumberSafe(m2[1]);
    var around = text.slice(Math.max(0,m2.index-10), m2.index+10);
    if (/休|不可|NG/.test(around)) c.offDates.add(d);
    if (/入れ|希望|OK|出勤|勤務/.test(around)) c.onDates.add(d);
  }

  return c;
}

function calcMonthlyTargetHours(capYen, hourly){
  if (!capYen || !hourly || hourly<=0) return 0;
  return Math.round((capYen/12/hourly)*4)/4;
}
function weekIndexInMonth(ym, day){
  var dow = firstDow(ym);
  return Math.floor((dow + (day-1)) / 7);
}
function allWeekdayCandidates(ym, holidayOff){
  var [y,m] = ym.split("-").map(Number);
  var dim = daysInMonth(ym);
  var arr = [];
  for (var d=1; d<=dim; d++){
    var w = new Date(y, m-1, d).getDay();
    if (w===0 || w===6) continue;
    if (holidayOff && getHolidayNameByDate(ym, d)) continue;
    arr.push(d);
  }
  return arr;
}
function buildCandidateDays(ym, c){
  var [y,m] = ym.split("-").map(Number);
  var dim = daysInMonth(ym);
  var res = [];
  var holidayOff = c.holidayOff===true;

  for (var d=1; d<=dim; d++){
    var w = new Date(y, m-1, d).getDay();

    if (c.weekdaysOff.has(w)) continue;

    // 「許可された曜日だけ」に絞る（Allowed が一つでも指定されていればそれを優先）
    if (c.weekdaysAllowed.size>0 && !c.weekdaysAllowed.has(w) && !c.onDates.has(d)) continue;

    if (holidayOff && getHolidayNameByDate(ym, d) && !c.onDates.has(d)) continue;
    if (c.offDates.has(d)) continue;

    res.push(d);
  }
  // 強制 ON
  c.onDates.forEach(function(d){ if (res.indexOf(d)===-1) res.push(d); });
  res.sort((a,b)=>a-b);

  // 候補が空なら 平日候補 → 全日 とフォールバック
  if (res.length===0) res = allWeekdayCandidates(ym, holidayOff);
  if (res.length===0){ for (var dd=1; dd<=dim; dd++) res.push(dd); }
  return res;
}

function getSelectedCap(){
  var selEl = $("#cap-select");
  var sel = selEl ? selEl.value : "";
  var label = "", cap = 0;
  if (sel === "custom"){
    var v = Number(($("#cap-custom") && $("#cap-custom").value) || 0);
    cap = isFinite(v) && v>0 ? v : 0;
    label = cap>0 ? "カスタム" : "カスタム（未入力）";
  } else if (sel){
    cap = Number(sel)||0;
    label = (cap===1030000) ? "103万円" : (cap===1060000) ? "106万円" : (cap===1300000) ? "130万円" : "上限";
  }
  return { cap, label };
}

function planAutoAssignment(ym, c, keepExisting){
  var emp = currentEmployee(); if (!emp) return {entries:[], total:0, target:0, note:"スタッフ未選択"};
  var wage = Number(emp.wage)||0;

  var capInfo = getSelectedCap();
  var capYen = c.preferCapYen || (c.mentionFuyou ? (capInfo.cap||1030000) : (capInfo.cap||0));
  var targetFromCap = calcMonthlyTargetHours(capYen, wage);

  var weeks = 4.3;
  var baseH = (c.dailyHoursPrefer && c.dailyHoursPrefer>0) ? c.dailyHoursPrefer : DEFAULT_BASE_HOURS;
  var targetFromWeekly = 0;
  if (c.weeklyHours) targetFromWeekly = c.weeklyHours * weeks;
  else if (c.weeklyDays) targetFromWeekly = c.weeklyDays * baseH * weeks;

  var candidates = buildCandidateDays(ym, c);
  var target = Math.max(targetFromCap, targetFromWeekly);
  if (!target || target<=0) target = baseH * candidates.length;
  target = Math.round(target*4)/4;

  var md = ensureEmpMonth(currentEmployee().id, ym);
  var dim = daysInMonth(ym);

  var existing = 0;
  if (keepExisting){
    for (var d=1; d<=dim; d++){ var r = md[String(d)]; if (r && r.work) existing += Number(r.hours)||0; }
  }
  var remain = Math.max(0, target - existing);

  var weeklyLimit = c.weeklyDays || Infinity;
  var perWeekCount = {};
  var entries=[]; var filled=0;

  // onDates 優先
  c.onDates.forEach(function(d){
    if (d<1 || d>dim) return;
    var hours = baseH;
    if (c.dailyHoursPrefer && c.dailyHoursPrefer>0) hours = c.dailyHoursPrefer;
    var put = Math.min(hours, Math.max(0, remain - filled) || hours);
    put = Math.round(put*4)/4;
    entries.push({ day:d, hours: put });
    var wi = weekIndexInMonth(ym, d);
    perWeekCount[wi] = (perWeekCount[wi]||0) + 1;
    filled += put;
  });

  // 残り
  function dayHasExisting(d){
    if (!keepExisting) return false;
    var r = md[String(d)];
    return r && r.work && (Number(r.hours)||0)>0;
  }
  for (var i=0; i<candidates.length && filled < target; i++){
    var d = candidates[i];
    if (c.onDates.has(d)) continue;
    if (dayHasExisting(d)) continue;
    var wi = weekIndexInMonth(ym, d);
    perWeekCount[wi] = perWeekCount[wi] || 0;
    if (perWeekCount[wi] >= weeklyLimit) continue;

    var put = Math.min(baseH, target - filled);
    if (put <= 0) break;

    entries.push({ day:d, hours: Math.round(put*4)/4 });
    perWeekCount[wi] += 1;
    filled += put;
  }

  if (entries.length===0 && candidates.length>0){
    entries.push({ day:candidates[0], hours: Math.round(baseH*4)/4 });
  }

  return { entries, total: Math.round(filled*4)/4, target: target, note:"" };
}

function renderWishPreview(plan){
  var box = $("#wish-preview");
  if (!box) return;
  if (!plan || !plan.entries || plan.entries.length===0){
    box.innerHTML = '<div class="muted">プレビューなし（フォールバック適用済）。</div>';
    return;
  }
  var rows = plan.entries.map(e=>`<tr><td>${e.day}日</td><td style="text-align:right;">${e.hours.toFixed(2)} h</td></tr>`).join("");
  box.innerHTML =
    `<table><thead><tr><th>日付</th><th>割付時間</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>合計</td><td style="text-align:right;">${plan.total.toFixed(2)} h</td></tr>
      <tr><td>目標</td><td style="text-align:right;">${plan.target.toFixed(2)} h</td></tr></tfoot></table>`;
}

function applyWishPlan(plan, overwriteAll){
  var emp = currentEmployee(); if (!emp) return;
  var ym = state.ui.ym;
  var md = ensureEmpMonth(emp.id, ym);

  var c = window.__lastConstraints || { weekdaysOff:new Set(), weekdaysAllowed:new Set(), onDates:new Set(), offDates:new Set(), holidayOff:null, dailyHoursPrefer:null };
  var [y,m] = ym.split("-").map(Number);
  var dim = daysInMonth(ym);

  // NG 指定は休みに
  for (var d=1; d<=dim; d++){
    if (c.offDates.has(d)){
      md[String(d)] = md[String(d)] || {work:false,hours:0};
      md[String(d)].work = false; md[String(d)].hours = 0;
    }
  }
  // 曜日NG/OK、祝日休
  for (var d2=1; d2<=dim; d2++){
    var w = new Date(y, m-1, d2).getDay();
    if (c.weekdaysOff.has(w) && !c.onDates.has(d2)){
      md[String(d2)] = md[String(d2)] || {work:false,hours:0};
      md[String(d2)].work = false; md[String(d2)].hours = 0;
      continue;
    }
    if (c.weekdaysAllowed.size>0 && c.weekdaysAllowed.has(w)){
      md[String(d2)] = md[String(d2)] || {work:false,hours:0};
      if (!md[String(d2)].work || overwriteAll){
        md[String(d2)].work = true;
        if (overwriteAll || !(md[String(d2)].hours>0)){
          md[String(d2)].hours = (c.dailyHoursPrefer && c.dailyHoursPrefer>0) ? c.dailyHoursPrefer : DEFAULT_BASE_HOURS;
        }
      }
    }
    if (c.holidayOff===true){
      var hn = getHolidayNameByDate(ym, d2);
      if (hn && !c.onDates.has(d2)){
        md[String(d2)] = md[String(d2)] || {work:false,hours:0};
        md[String(d2)].work = false; md[String(d2)].hours = 0;
      }
    }
  }
  // onDates 強制ON
  c.onDates.forEach(function(d){
    md[String(d)] = md[String(d)] || {work:false,hours:0};
    md[String(d)].work = true;
    if (overwriteAll || !(md[String(d)].hours>0)){
      md[String(d)].hours = (c.dailyHoursPrefer && c.dailyHoursPrefer>0) ? c.dailyHoursPrefer : DEFAULT_BASE_HOURS;
    }
  });

  // 割付反映
  plan.entries.forEach(function(e){
    md[String(e.day)] = md[String(e.day)] || {work:false,hours:0};
    var r = md[String(e.day)];
    if (!overwriteAll && r.work && (Number(r.hours)||0)>0) return;
    r.work = true;
    r.hours = e.hours;
  });

  saveState();
  recalcAndRender();
  renderYearSummary();
}

/* ===== カレンダー描画 & 進捗 ===== */
function recalcAndRender() {
  renderCalendar();
  renderTotals();
}
function renderCalendar() {
  var ym = state.ui.ym, empId = state.currentEmpId;
  var root = $("#calendar"); if (!root) return;
  root.innerHTML = "";

  ["日","月","火","水","木","金","土"].forEach(function(h){
    var el = document.createElement("div");
    el.className = "day-head"; el.textContent = h;
    root.appendChild(el);
  });

  var dow = firstDow(ym), dim = daysInMonth(ym);
  var monthData = ensureEmpMonth(empId, ym);
  var y = getYearFromYM(ym), m = Number(ym.split("-")[1]);

  for (var i=0;i<dow;i++){ var empty=document.createElement("div"); empty.className="day-cell"; empty.style.visibility="hidden"; root.appendChild(empty); }

  for (var day=1; day<=dim; day++){
    var key = String(day);
    if (!monthData[key]) monthData[key] = { work:false, hours:0 };
    var rec = monthData[key];

    var cell = document.createElement("div"); cell.className = "day-cell";

    var title = document.createElement("div"); title.className = "day-title";
    var monthBadge = document.createElement("span"); monthBadge.className = "badge"; monthBadge.textContent = state.ui.ym;
    var daySpan = document.createElement("span"); daySpan.textContent = day + "日";
    title.appendChild(daySpan);
    title.appendChild(monthBadge);

    var hname = getHolidayNameByDate(ym, day);
    if (hname){
      var hbadge = document.createElement("span");
      hbadge.className = "badge holiday";
      hbadge.title = hname;
      hbadge.textContent = hname;
      title.appendChild(hbadge);
      if (!rec.work && (!rec.hours || Number(rec.hours)===0)){
        rec.work = false; rec.hours = 0;
      }
    }
    cell.appendChild(title);

    var tog = document.createElement("div");
    tog.className = "toggle " + (rec.work ? "on" : "off");
    tog.textContent = rec.work ? "出勤" : "休み";
    tog.addEventListener("click", function(recRef){
      return function(){
        recRef.work = !recRef.work; if (!recRef.work) recRef.hours = 0;
        saveState(); recalcAndRender();
      };
    }(rec));
    cell.appendChild(tog);

    var timeRow = document.createElement("div");
    timeRow.className = "time-row";

    var input = document.createElement("input");
    input.type = "number";
    input.step = "0.25";
    input.min = "0";
    input.max = "24";
    input.placeholder = "勤務時間（h）";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.value = rec.work ? String(rec.hours || "") : "";
    input.disabled = !rec.work;

    var pill = document.createElement("span");
    pill.className = "val-pill";
    pill.textContent = (rec.work && rec.hours > 0) ? (Number(rec.hours).toFixed(2) + " h") : "";

    input.addEventListener("input", function(){
      var raw = (input.value || "").replace(",", ".");
      var v = Number(raw);
      if (!isFinite(v)) v = 0;
      v = clamp(Math.round(v*4)/4, 0, 24);
      rec.hours = v;
      input.value = v ? String(v) : "";
      pill.textContent = (rec.work && v>0) ? (v.toFixed(2) + " h") : "";
      saveState(); renderTotals(); renderYearSummary();
    });

    var help = document.createElement("span");
    help.className = "help";
    help.textContent = "0.25=15分 / 0.5=30分";

    timeRow.appendChild(input);
    timeRow.appendChild(pill);
    timeRow.appendChild(help);
    cell.appendChild(timeRow);

    root.appendChild(cell);
  }
}

function renderTotals() {
  var ym = state.ui.ym, emp = currentEmployee();
  var wage = emp ? Number(emp.wage) || 0 : 0;
  var empId = emp ? emp.id : "";
  var mdAll = state.months[empId] || {};
  var monthData = mdAll[ym] || {};

  var sumHours = 0;
  Object.keys(monthData).forEach(k=>{ var r=monthData[k]; if (r && r.work) sumHours += Number(r.hours)||0; });
  var sumWage = sumHours * wage;

  var projMode = state.ui.projMode || "thismonth";
  var projAnnual = 0;
  if (projMode === "thismonth") projAnnual = sumWage * 12;
  else {
    var [year, month] = ym.split("-").map(Number);
    var ytdSum = 0, counted = 0;
    for (var m=1;m<=month;m++){
      var ym2 = year + "-" + pad2(m);
      var md2 = mdAll[ym2] || {};
      var mh = 0; Object.keys(md2).forEach(k=>{ var rr=md2[k]; if (rr && r.work) mh += Number(rr.hours)||0; });
      var mw = mh * wage; if (mw>0){ ytdSum += mw; counted++; }
    }
    var avg = counted>0 ? (ytdSum/counted) : 0; var remain = 12 - month;
    projAnnual = ytdSum + avg*remain;
  }

  $("#sum-hours").textContent = sumHours.toFixed(2) + " h";
  $("#sum-wage").textContent = fmtJPY(sumWage);
  $("#proj-annual").textContent = fmtJPY(projAnnual);

  setBar("bar-103","pct-103", projAnnual, THRESHOLDS.T103);
  setBar("bar-106","pct-106", projAnnual, THRESHOLDS.T106);
  setBar("bar-130","pct-130", projAnnual, THRESHOLDS.T130);
  setBar("bar-custom-a","pct-custom-a", projAnnual, (state.ui.customCaps&&state.ui.customCaps.a)||0);
  setBar("bar-custom-b","pct-custom-b", projAnnual, (state.ui.customCaps&&state.ui.customCaps.b)||0);

  var msgs = [];
  if (projAnnual >= THRESHOLDS.T130) msgs.push("130万円ラインを超える見込みです。");
  else if (projAnnual >= THRESHOLDS.T130*0.9) msgs.push("130万円ラインの90%を超えています（要注意）。");
  if (projAnnual >= THRESHOLDS.T106 && projAnnual < THRESHOLDS.T130) msgs.push("106万円ラインを超える可能性があります。");
  else if (projAnnual >= THRESHOLDS.T106*0.9 && projAnnual < THRESHOLDS.T106) msgs.push("106万円ラインの90%を超えています（要注意）。");
  if (projAnnual >= THRESHOLDS.T103 && projAnnual < THRESHOLDS.T106) msgs.push("103万円ライン超の見込みです。");
  else if (projAnnual >= THRESHOLDS.T103*0.9 && projAnnual < THRESHOLDS.T103) msgs.push("103万円ラインの90%を超えています（要注意）。");
  var warn=$("#warn"); if (warn) warn.textContent = msgs.join(" ");

  updateCapSummary();
  syncSimulatorWage();
  recalcSimulator();
}
function setBar(barId, pctId, value, cap){
  var bar=$( "#"+barId ), pct=$("#"+pctId);
  var p = (cap>0) ? Math.min(100, (value/cap)*100) : 0;
  if (bar) bar.value = p;
  if (pct) pct.textContent = Math.round(p) + "%";
}

/* ===== シミュレーター（上限→月上限時間） ===== */
function onCapChange(){
  var sel = $("#cap-select"), custom=$("#cap-custom");
  if (!sel || !custom) return;
  custom.disabled = (sel.value !== "custom");
  recalcSimulator();
}
function syncSimulatorWage(){
  var wage = 0; var emp = currentEmployee(); if (emp) wage = Number(emp.wage)||0;
  var w = $("#cap-wage"); if (w) w.value = wage || "";
}
function updateCapSummary(){
  var box = $("#sim-cap-summary"); if (!box) return;
  var wage = Number(($("#cap-wage") && $("#cap-wage").value) || 0);
  var info = getSelectedCap();
  if (!info.cap){ box.textContent = "シミュレーター設定：—"; return; }
  var hoursText = "時給未設定";
  if (wage > 0){
    var perMonth = info.cap / 12 / wage;
    var rounded = Math.round(perMonth*4)/4;
    hoursText = rounded.toFixed(2) + " h / 月";
  }
  box.innerHTML = 'シミュレーター設定：<strong>'+ fmtJPY(info.cap) +'</strong> / 年（'+ info.label +'） → 月上限 <strong>'+ hoursText +'</strong>';
}
function recalcSimulator(){
  var selEl = $("#cap-select"), custEl=$("#cap-custom"), wageEl=$("#cap-wage"), out=$("#cap-hours");
  if (!selEl || !wageEl || !out) return;
  var sel = selEl.value, customYen = custEl ? Number(custEl.value) : 0, wage = Number(wageEl.value);
  var cap = (sel==="custom") ? ((isFinite(customYen) && customYen>0) ? customYen : 0) : Number(sel)||0;
  var hours = "";
  if (cap>0 && wage>0){ var perMonth = cap/12/wage; var rounded = Math.round(perMonth*4)/4; hours = rounded.toFixed(2) + " h / 月"; }
  out.value = hours;
}

/* ===== 年間サマリー ===== */
function calcMonthWage(emp, year, month){
  var ym = year + "-" + pad2(month);
  var mdAll = state.months[emp ? emp.id : ""] || {};
  var md = mdAll[ym] || {};
  var hours = 0; Object.keys(md).forEach(k=>{ var r=md[k]; if (r && r.work) hours += Number(r.hours)||0; });
  var wage = emp ? Number(emp.wage)||0 : 0;
  return { hours, amount: hours*wage };
}
function renderYearSummary(){
  var tableWrap = $("#year-summary"); if (!tableWrap) return;
  var emp = currentEmployee();
  var yrEl = $("#year-picker"); var year = yrEl ? (Number(yrEl.value)||getYearFromYM(state.ui.ym)) : getYearFromYM(state.ui.ym);
  var months = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  var html = '<table class="year-table"><thead><tr><th class="month">月</th>';
  months.forEach(m=>html += "<th>"+m+"</th>");
  html += "<th>合計</th></tr></thead><tbody>";

  html += '<tr><th class="month">金額</th>';
  var yearSum = 0;
  for (var m=1;m<=12;m++){ var a = calcMonthWage(emp, year, m).amount; yearSum += a; html += "<td>"+(a>0?fmtJPY(a):"—")+"</td>"; }
  html += "<td>"+fmtJPY(yearSum)+"</td></tr>";

  html += '<tr><th class="month">時間(h)</th>';
  var yearHours = 0;
  for (var mm=1;mm<=12;mm++){ var h = calcMonthWage(emp, year, mm).hours; yearHours += h; html += "<td>"+(h>0?h.toFixed(2):"—")+"</td>"; }
  html += "<td>"+yearHours.toFixed(2)+"</td></tr>";

  html += "</tbody></table>";
  tableWrap.innerHTML = html;
}

/* ===== 初期化 ===== */
document.addEventListener("DOMContentLoaded", function(){
  renderEmpTabs();

  var emp = currentEmployee();
  $("#emp-name").value = emp ? (emp.name || "") : "";
  $("#emp-wage").value = emp ? (emp.wage || "") : "";
  $("#month-picker").value = state.ui.ym;
  $("#proj-mode").value = state.ui.projMode || "thismonth";
  var yp = $("#year-picker"); if (yp) yp.value = getYearFromYM(state.ui.ym);

  // 保存/管理
  onClick("save-emp", function(){
    var e = currentEmployee(); if (!e) return;
    e.name = ($("#emp-name").value || "").trim();
    e.wage = Number($("#emp-wage").value) || 0;
    $("#emp-msg").textContent = "従業員情報を保存しました。";
    saveState(); renderTotals(); renderYearSummary(); syncSimulatorWage(); updateCapSummary();
  });
  onClick("reset-data", function(){
    if (!confirm("保存データをすべて削除します。よろしいですか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = loadStateOrInit();
    var cur = currentEmployee();
    $("#emp-name").value = cur ? (cur.name || "") : "";
    $("#emp-wage").value = cur ? (cur.wage || "") : "";
    $("#emp-msg").textContent = "データを初期化しました。";
    $("#month-picker").value = state.ui.ym;
    $("#proj-mode").value = state.ui.projMode;
    if (yp) yp.value = getYearFromYM(state.ui.ym);
    renderEmpTabs(); recalcAndRender(); renderYearSummary(); syncSimulatorWage(); updateCapSummary();
  });

  // 月移動
  onClick("prev-month", function(){
    var [y,m] = state.ui.ym.split("-").map(Number); var d=new Date(y,m-1,1); d.setMonth(d.getMonth()-1);
    state.ui.ym = toYM(d); $("#month-picker").value = state.ui.ym; if (yp) yp.value = getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateCapSummary(); });
  });
  onClick("next-month", function(){
    var [y,m] = state.ui.ym.split("-").map(Number); var d=new Date(y,m-1,1); d.setMonth(d.getMonth()+1);
    state.ui.ym = toYM(d); $("#month-picker").value = state.ui.ym; if (yp) yp.value = getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateCapSummary(); });
  });
  var mp = $("#month-picker");
  mp && mp.addEventListener("change", function(e){
    state.ui.ym = e.target.value; if (yp) yp.value = getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateCapSummary(); });
  });

  // スタッフ
  onClick("add-emp", function(){
    var name = prompt("スタッフ名を入力してください"); if (!name) return;
    var wageStr = prompt("時給（円）を入力してください（例：1200）"); var wage = Number(wageStr);
    var id = uid(); state.employees.push({ id, name:name.trim(), wage: isFinite(wage)?wage:0 });
    state.currentEmpId = id; saveState(); renderEmpTabs();
    $("#emp-name").value = name.trim(); $("#emp-wage").value = isFinite(wage)?wage:0;
    $("#emp-msg").textContent = "新しいスタッフを追加しました。";
    recalcAndRender(); renderYearSummary(); syncSimulatorWage(); updateCapSummary();
  });
  onClick("del-emp", function(){
    var e = currentEmployee(); if (!e) return;
    if (!confirm("「" + (e.name || "（無名）") + "」を削除します。よろしいですか？")) return;
    var idx = state.employees.findIndex(x=>x.id===e.id);
    if (idx>=0) state.employees.splice(idx,1);
    if (state.months[e.id]) delete state.months[e.id];
    if (state.employees.length===0){
      var id = uid(); state.employees.push({id, name:"", wage:0}); state.currentEmpId = id;
    } else {
      var next = state.employees[Math.max(0, idx-1)]; state.currentEmpId = next.id;
    }
    saveState(); renderEmpTabs();
    var cur = currentEmployee(); $("#emp-name").value = cur ? (cur.name||"") : ""; $("#emp-wage").value = cur ? (cur.wage||0) : 0;
    $("#emp-msg").textContent = "スタッフを削除しました。";
    recalcAndRender(); renderYearSummary(); syncSimulatorWage(); updateCapSummary();
  });
  onClick("move-left", function(){
    var id = state.currentEmpId, idx = state.employees.findIndex(e=>e.id===id);
    if (idx>0){ var t = state.employees[idx-1]; state.employees[idx-1]=state.employees[idx]; state.employees[idx]=t; saveState(); renderEmpTabs(); }
  });
  onClick("move-right", function(){
    var id = state.currentEmpId, idx = state.employees.findIndex(e=>e.id===id);
    if (idx>=0 && idx<state.employees.length-1){ var t = state.employees[idx+1]; state.employees[idx+1]=state.employees[idx]; state.employees[idx]=t; saveState(); renderEmpTabs(); }
  });

  var pm = $("#proj-mode");
  pm && pm.addEventListener("change", function(e){ state.ui.projMode = e.target.value; saveState(); renderTotals(); });

  // カスタムライン（A/B）
  var a=$("#th-custom-a"), b=$("#th-custom-b");
  if (a) a.addEventListener("input", function(){ state.ui.customCaps = state.ui.customCaps||{a:0,b:0}; state.ui.customCaps.a = Number(a.value)||0; saveState(); renderTotals(); });
  if (b) b.addEventListener("input", function(){ state.ui.customCaps = state.ui.customCaps||{a:0,b:0}; state.ui.customCaps.b = Number(b.value)||0; saveState(); renderTotals(); });

  // 希望票：AI解析→即反映（既存入力は尊重）
  onClick("wish-parse", function(){
    var txt = ($("#wish-text") && $("#wish-text").value) || "";
    var c = parseWishText(txt);
    window.__lastConstraints = c;

    var cap = c.preferCapYen ? ("¥"+c.preferCapYen.toLocaleString()) : (c.mentionFuyou ? "（扶養・UI選択準拠）" : "—");
    var sum = [
      "上限: " + cap,
      "1日基準: " + (c.dailyHoursPrefer!=null ? (c.dailyHoursPrefer + "h") : (DEFAULT_BASE_HOURS+"h[既定]")),
      "週: " + (c.weeklyDays!=null ? (c.weeklyDays + "日") : "—") + " / " + (c.weeklyHours!=null ? (c.weeklyHours + "h") : "—"),
      "祝日: " + (c.holidayOff!=null ? (c.holidayOff?"休":"可") : "可"),
      "曜日OK: " + (c.weekdaysAllowed.size>0 ? Array.from(c.weekdaysAllowed).join(",") : "—"),
      "曜日NG: " + (c.weekdaysOff.size>0 ? Array.from(c.weekdaysOff).join(",") : "—")
    ].join(" / ");
    var sumEl = $("#wish-summary"); if (sumEl) sumEl.textContent = "解析結果 → " + sum;

    var plan = planAutoAssignment(state.ui.ym, c, /*keepExisting=*/true);
    renderWishPreview(plan);
    applyWishPlan(plan, /*overwriteAll=*/false);
    alert("AI解析結果をカレンダーに反映しました。");
  });

  // 初期描画
  ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){
    if ($("#th-custom-a")) $("#th-custom-a").value = (state.ui.customCaps && state.ui.customCaps.a) || "";
    if ($("#th-custom-b")) $("#th-custom-b").value = (state.ui.customCaps && state.ui.customCaps.b) || "";
    renderEmpTabs();
    recalcAndRender();
    renderYearSummary();
    syncSimulatorWage(); updateCapSummary();
  });
});

function renderEmpTabs() {
  var wrap = $("#emp-tabs"); if (!wrap) return;
  wrap.innerHTML = "";
  state.employees.forEach(function(e){
    var b = document.createElement("button");
    b.className = "tab" + (e.id===state.currentEmpId ? " active" : "");
    b.textContent = e.name || "（無名）";
    b.title = (e.name || "（無名）") + " / 時給: " + ((e.wage!=null?e.wage:0) + "円");
    b.addEventListener("click", function(){
      state.currentEmpId = e.id; saveState();
      $("#emp-name").value = e.name || ""; $("#emp-wage").value = e.wage || 0; $("#emp-msg").textContent = "";
      recalcAndRender(); renderYearSummary(); renderEmpTabs(); syncSimulatorWage(); updateCapSummary();
    });
    wrap.appendChild(b);
  });
}
