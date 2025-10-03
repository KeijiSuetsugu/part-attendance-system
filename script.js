/* =========================================================
   シンプル版 script.js（Always-Apply 拡張）
   - 標準シフト UI / 土日ポリシー UI / 一括操作 UI：なし
   - 希望票テキスト → AI解析 → プレビュー更新 → カレンダー即反映
   - 解析が不十分でも必ず反映（フォールバック：平日×6h）
   ========================================================= */

/* ===== 設定値 ===== */
var THRESHOLDS = { T103: 1030000, T106: 1060000, T130: 1300000 };
var STORAGE_KEY = "part_attendance_v2";

/* 祝日キャッシュ */
var HOLIDAY_CACHE_KEY = "holiday_cache_v1";
var HOLIDAY_TTL_DAYS = 30;

/* 内部既定（UIは出さない） */
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

/* ===== 祝日キャッシュ管理 ===== */
var holidayCache = loadHolidayCache();
function loadHolidayCache(){
  try { var raw = localStorage.getItem(HOLIDAY_CACHE_KEY); if (raw) return JSON.parse(raw); } catch(e){}
  return { years:{}, updated:{}, source:"" };
}
function saveHolidayCache(){ localStorage.setItem(HOLIDAY_CACHE_KEY, JSON.stringify(holidayCache)); }
function updateHolidayStatus(year, loaded, source){
  var el = $("#holiday-status"); if (!el) return;
  if (loaded) el.textContent = "祝日データ：" + year + " 取得済（" + (source==="holidays-jp"?"holidays-jp":"Nager.Date") + "）";
  else el.textContent = "祝日データ：" + year + " を取得できませんでした（オフライン？）";
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
var state = loadStateOrMigrate();
function migrateV1ToV2(old) {
  var firstId = uid();
  var employees = [{ id:firstId, name:(old.employee&&old.employee.name)||"", wage:(old.employee&&old.employee.wage)||0 }];
  var months = {}; months[firstId] = old.months || {};
  return { employees, currentEmpId:firstId, months, ui:{ ym:(old.ui&&old.ui.ym)||toYM(new Date()), projMode:"thismonth", customCaps:{a:0,b:0} } };
}
function loadStateOrMigrate() {
  try { var raw2 = localStorage.getItem(STORAGE_KEY); if (raw2) {
    var st = JSON.parse(raw2);
    if (!st.ui) st.ui = {};
    if (!st.ui.customCaps) st.ui.customCaps = {a:0,b:0};
    return st;
  }} catch(e){}
  try { var raw1 = localStorage.getItem("part_attendance_v1"); if (raw1) { var mig = migrateV1ToV2(JSON.parse(raw1)); saveState(mig); return mig; } } catch(e){}
  var id = uid();
  var fresh = { employees:[{id, name:"", wage:0}], currentEmpId:id, months:{}, ui:{ ym:toYM(new Date()), projMode:"thismonth", customCaps:{a:0,b:0} } };
  saveState(fresh); return fresh;
}
function saveState(s){ localStorage.setItem(STORAGE_KEY, JSON.stringify(s||state)); }

function daysInMonth(ym){ var [y,m]=ym.split("-").map(Number); return new Date(y, m, 0).getDate(); }
function firstDow(ym){ var [y,m]=ym.split("-").map(Number); return new Date(y, m-1, 1).getDay(); }
function currentEmployee(){ var id=state.currentEmpId; return state.employees.find(e=>e.id===id)||null; }
function ensureEmpMonth(empId, ym){ state.months[empId] = state.months[empId]||{}; state.months[empId][ym] = state.months[empId][ym]||{}; return state.months[empId][ym]; }

/* ===== 希望票：解析 / プレビュー / 適用（常に反映） ===== */

// ゆるい数値抽出
function toNumberSafe(s){ if (!s) return NaN; return Number(String(s).replace(/[^\d.]/g,'')); }

// 曜日マップ
var JP_WEEK = { "日":0, "月":1, "火":2, "水":3, "木":4, "金":5, "土":6 };

// テキスト → 制約
function parseWishText(raw){
  var text = (raw||"").replace(/\s+/g, " ").trim();
  var c = {
    preferCapYen: null,
    mentionFuyou: /扶養.*(範囲|内)/.test(text),
    holidayOff: null,            // true|false|null
    dailyHoursPrefer: null,      // 1日Xh or 時間帯から算出
    weeklyDays: null,
    weeklyHours: null,
    weekdaysAllowed: new Set(),
    weekdaysOff: new Set(),
    onDates: new Set(),
    offDates: new Set()
  };

  // 扶養ライン
  if (/130\s*万|1[,，]?\s*300[,，]?\s*000/.test(text)) c.preferCapYen = 1300000;
  else if (/106\s*万|1[,，]?\s*060[,，]?\s*000/.test(text)) c.preferCapYen = 1060000;
  else if (/103\s*万|1[,，]?\s*030[,，]?\s*000/.test(text)) c.preferCapYen = 1030000;

  // 祝日
  if (/祝日.*休/.test(text)) c.holidayOff = true;
  if (/祝日.*可|祝日.*OK/.test(text)) c.holidayOff = false;

  // 1日X時間 / Xh
  var mDay = text.match(/1日\s*([0-9]+(?:\.[0-9]+)?)\s*時間|([0-9]+(?:\.[0-9]+)?)\s*h/);
  if (mDay){ c.dailyHoursPrefer = toNumberSafe(mDay[1] || mDay[2]); }

  // 時間帯 10:00-16:30 / 9〜15 など
  var mSpan = text.match(/(\d{1,2})(?::|：)?(\d{2})?\s*[〜~\-]\s*(\d{1,2})(?::|：)?(\d{2})?/);
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

  // 「平日のみ / 週末のみ」系の緩和
  if (/平日(のみ|だけ|中心)/.test(text)){ [1,2,3,4,5].forEach(d=>c.weekdaysAllowed.add(d)); c.weekdaysOff.add(0); c.weekdaysOff.add(6); }
  if (/(土日|週末)(のみ|だけ|中心)/.test(text)){ c.weekdaysAllowed.add(0); c.weekdaysAllowed.add(6); [1,2,3,4,5].forEach(d=>c.weekdaysOff.add(d)); }

  // 曜日 OK/NG
  Object.keys(JP_WEEK).forEach(function(k){
    var reOk = new RegExp(k+"[曜日]?(は)?(出勤可|希望|入れる|OK)");
    var reNg = new RegExp(k+"[曜日]?(は)?(不可|NG|休み|入れない)");
    if (reOk.test(text)) c.weekdaysAllowed.add(JP_WEEK[k]);
    if (reNg.test(text)) c.weekdaysOff.add(JP_WEEK[k]);
  });

  // 特定日
  var reDay = /(\d{1,2})\s*日/g, m;
  while ((m = reDay.exec(text)) !== null){
    var d = toNumberSafe(m[1]);
    var around = text.slice(Math.max(0,m.index-8), m.index+8);
    if (/休|不可|NG/.test(around)) c.offDates.add(d);
    if (/入れ|希望|OK/.test(around)) c.onDates.add(d);
  }
  return c;
}

/* 月上限時間（扶養） */
function calcMonthlyTargetHours(capYen, hourly){
  if (!capYen || !hourly || hourly<=0) return 0;
  return Math.round((capYen/12/hourly)*4)/4;
}
/* 週番号（0〜） */
function weekIndexInMonth(ym, day){
  var dow = firstDow(ym);
  return Math.floor((dow + (day-1)) / 7);
}
/* 平日候補（祝日休指定時は祝日除外） */
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

/* 候補集合（曜日/祝日/特定日に基づく） */
function buildCandidateDays(ym, constraints){
  var [y,m] = ym.split("-").map(Number);
  var dim = daysInMonth(ym);
  var res = [];
  var holidayOff = constraints.holidayOff===true;

  for (var d=1; d<=dim; d++){
    var w = new Date(y, m-1, d).getDay();

    if (constraints.weekdaysOff.has(w)) continue;
    if (constraints.weekdaysAllowed.size>0 && !constraints.weekdaysAllowed.has(w) && !constraints.onDates.has(d)) continue;

    if (holidayOff){
      var hn = getHolidayNameByDate(ym, d);
      if (hn && !constraints.onDates.has(d)) continue;
    }

    if (constraints.offDates.has(d)) continue;

    res.push(d);
  }
  // 強制ON
  constraints.onDates.forEach(function(d){ if (res.indexOf(d)===-1) res.push(d); });
  res.sort(function(a,b){ return a-b; });

  // 解析から何も出なかった場合は平日フォールバック
  if (res.length===0){
    res = allWeekdayCandidates(ym, holidayOff);
  }
  // なおそれでも空（極端なNG指定など）の場合は全日フォールバック
  if (res.length===0){
    for (var dd=1; dd<=dim; dd++) res.push(dd);
  }
  return res;
}

/* 選定 & プラン作成（Always-Apply） */
function planAutoAssignment(ym, constraints, keepExisting){
  var emp = currentEmployee(); if (!emp) return {entries:[], total:0, target:0, note:"スタッフ未選択"};
  var wage = Number(emp.wage)||0;

  // 月目標（扶養 or 週指定）
  var selCap = getSelectedCap(); // 扶養UIは既存のまま
  var capYen = constraints.preferCapYen || (constraints.mentionFuyou ? (selCap.cap||1030000) : (selCap.cap||0));
  var targetFromCap = calcMonthlyTargetHours(capYen, wage);

  var weeks = 4.3;
  var baseH = (constraints.dailyHoursPrefer && constraints.dailyHoursPrefer>0) ? constraints.dailyHoursPrefer : DEFAULT_BASE_HOURS;
  var targetFromWeekly = 0;
  if (constraints.weeklyHours) targetFromWeekly = constraints.weeklyHours * weeks;
  else if (constraints.weeklyDays) targetFromWeekly = constraints.weeklyDays * baseH * weeks;

  var candidates = buildCandidateDays(ym, constraints);
  var target = Math.max(targetFromCap, targetFromWeekly);

  // ★フォールバック：目標がゼロなら「候補日×baseH」を目標にして必ず反映
  if (!target || target<=0){
    target = baseH * candidates.length;
  }
  target = Math.round(target*4)/4;

  var empId = emp.id;
  var md = ensureEmpMonth(empId, ym);
  var dim = daysInMonth(ym);

  // 既存尊重
  var existing = 0;
  if (keepExisting){
    for (var d=1; d<=dim; d++){ var r = md[String(d)]; if (r && r.work) existing += Number(r.hours)||0; }
  }
  var remain = Math.max(0, target - existing);

  var weeklyLimit = constraints.weeklyDays || Infinity;
  var perWeekCount = {};
  var entries = [];
  var filled = 0;

  // onDatesを優先
  constraints.onDates.forEach(function(d){
    if (d<1 || d>dim) return;
    var hours = baseH;
    if (constraints.dailyHoursPrefer && constraints.dailyHoursPrefer>0) hours = constraints.dailyHoursPrefer;
    var put = Math.min(hours, Math.max(0, remain - filled) || hours); // remainが0でも最低1回は反映
    put = Math.round(put*4)/4;
    entries.push({ day:d, hours: put });
    var wi = weekIndexInMonth(ym, d);
    perWeekCount[wi] = (perWeekCount[wi]||0) + 1;
    filled += put;
  });

  // 残りを候補から
  function dayHasExisting(d){
    if (!keepExisting) return false;
    var r = md[String(d)];
    return r && r.work && (Number(r.hours)||0)>0;
  }
  for (var i=0; i<candidates.length && filled < target; i++){
    var d = candidates[i];
    if (constraints.onDates.has(d)) continue;
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

  // それでも entries が空なら、最小1件（当月最初の平日）を強制投入
  if (entries.length===0 && candidates.length>0){
    entries.push({ day:candidates[0], hours: Math.round(baseH*4)/4 });
  }

  return { entries, total: Math.round(filled*4)/4, target: target, note:"" };
}

/* プレビュー */
function renderWishPreview(plan){
  var box = $("#wish-preview");
  if (!box) return;
  if (!plan || !plan.entries || plan.entries.length===0){
    box.innerHTML = '<div class="muted">プレビューなし（ただしカレンダーにはフォールバック適用済）。</div>';
    return;
  }
  var rows = plan.entries.map(function(e){ return `<tr><td>${e.day}日</td><td style="text-align:right;">${e.hours.toFixed(2)} h</td></tr>`; }).join("");
  box.innerHTML =
    `<table><thead><tr><th>日付</th><th>割付時間</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>合計</td><td style="text-align:right;">${plan.total.toFixed(2)} h</td></tr>
      <tr><td>目標</td><td style="text-align:right;">${plan.target.toFixed(2)} h</td></tr></tfoot></table>`;
}

/* カレンダー適用（曜日/特定日/祝日NGも反映） */
function applyWishPlan(plan, overwriteAll){
  var emp = currentEmployee(); if (!emp) return;
  var ym = state.ui.ym;
  var md = ensureEmpMonth(emp.id, ym);

  var c = window.__lastConstraints || { weekdaysOff:new Set(), weekdaysAllowed:new Set(), onDates:new Set(), offDates:new Set(), holidayOff:null, dailyHoursPrefer:null };

  var [y,m] = ym.split("-").map(Number);
  var dim = daysInMonth(ym);

  // まず NG 指定を休みに
  for (var d=1; d<=dim; d++){
    if (c.offDates.has(d)){
      md[String(d)] = md[String(d)] || {work:false,hours:0};
      md[String(d)].work = false; md[String(d)].hours = 0;
    }
  }
  // 曜日NG / OK
  for (var d2=1; d2<=dim; d2++){
    var w = new Date(y, m-1, d2).getDay();
    if (c.weekdaysOff.has(w) && !c.onDates.has(d2)){
      md[String(d2)] = md[String(d2)] || {work:false,hours:0};
      md[String(d2)].work = false; md[String(d2)].hours = 0;
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
    // 祝日休指定がある場合は祝日を休みに（onDates は除外）
    if (c.holidayOff===true){
      var hn = getHolidayNameByDate(ym, d2);
      if (hn && !c.onDates.has(d2)){
        md[String(d2)] = md[String(d2)] || {work:false,hours:0};
        md[String(d2)].work = false; md[String(d2)].hours = 0;
      }
    }
  }
  // onDates を強制ON
  c.onDates.forEach(function(d){
    md[String(d)] = md[String(d)] || {work:false,hours:0};
    md[String(d)].work = true;
    if (overwriteAll || !(md[String(d)].hours>0)){
      md[String(d)].hours = (c.dailyHoursPrefer && c.dailyHoursPrefer>0) ? c.dailyHoursPrefer : DEFAULT_BASE_HOURS;
    }
  });

  // 割付エントリを反映
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

/* ===== 進捗・シミュレーター ===== */
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
  if (projMode === "thismonth") {
    projAnnual = sumWage * 12;
  } else {
    var [year, month] = ym.split("-").map(Number);
    var ytdSum = 0, counted = 0;
    for (var m=1;m<=month;m++){
      var ym2 = year + "-" + pad2(m);
      var md2 = mdAll[ym2] || {};
      var mh = 0; Object.keys(md2).forEach(k=>{ var rr=md2[k]; if (rr && rr.work) mh += Number(rr.hours)||0; });
      var mw = mh * wage; if (mw>0){ ytdSum += mw; counted++; }
    }
    var avg = counted>0 ? (ytdSum/counted) : 0; var remain = 12 - month;
    projAnnual = ytdSum + avg*remain;
  }

  var elH=$("#sum-hours"), elW=$("#sum-wage"), elA=$("#proj-annual");
  if (elH) elH.textContent = sumHours.toFixed(2) + " h";
  if (elW) elW.textContent = fmtJPY(sumWage);
  if (elA) elA.textContent = fmtJPY(projAnnual);

  setBar("bar-103","pct-103", projAnnual, THRESHOLDS.T103);
  setBar("bar-106","pct-106", projAnnual, THRESHOLDS.T106);
  setBar("bar-130","pct-130", projAnnual, THRESHOLDS.T130);
  setBar("bar-custom-a","pct-custom-a", projAnnual, state.ui.customCaps ? (state.ui.customCaps.a||0) : 0);
  setBar("bar-custom-b","pct-custom-b", projAnnual, state.ui.customCaps ? (state.ui.customCaps.b||0) : 0);

  var msgs = [];
  if (projAnnual >= THRESHOLDS.T130) msgs.push("130万円ラインを超える見込みです。");
  else if (projAnnual >= THRESHOLDS.T130*0.9) msgs.push("130万円ラインの90%を超えています（要注意）。");
  if (projAnnual >= THRESHOLDS.T106 && projAnnual < THRESHOLDS.T130) msgs.push("106万円ラインを超える可能性があります。条件により社会保険加入対象となる場合があります。");
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

/* ===== 扶養シミュレーター ===== */
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
  updateCapSummary();
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

/* ===== CSV / Excel 出力 ===== */
function collectMonthRows(emp, ym){
  var [y,m] = ym.split("-").map(Number);
  var mdAll = state.months[emp ? emp.id : ""] || {};
  var md = mdAll[ym] || {};
  var wage = emp ? Number(emp.wage)||0 : 0;
  var dim = daysInMonth(ym);

  var rows = []; var sumH=0, sumW=0;
  rows.push(["Staff", (emp?emp.name:"") || "", "Year-Month", ym, "Hourly", wage]);
  rows.push(["Date","Weekday","HolidayName","Work","Hours","DayWage"]);

  for (var d=1; d<=dim; d++){
    var r = md[String(d)] || { work:false, hours:0 };
    var hours = r.work ? (Number(r.hours)||0) : 0;
    var w = hours * wage;
    var hname = getHolidayNameByDate(ym, d);
    rows.push([ ymd(ym,d), youbi(y,m,d), hname || "", r.work ? "出勤" : "休み", hours, w ]);
    sumH += hours; sumW += w;
  }

  var projMode = state.ui.projMode || "thismonth";
  var projAnnual = 0;
  if (projMode==="thismonth") projAnnual = sumW * 12;
  else {
    var ytdSum=0, cnt=0;
    for (var mm=1; mm<=m; mm++){
      var ym2 = y + "-" + pad2(mm);
      var md2 = mdAll[ym2] || {};
      var mh = 0; Object.keys(md2).forEach(k=>{ var rr = md2[k]; if (rr && rr.work) mh += Number(rr.hours)||0; });
      var mw = mh * wage;
      if (mw>0){ ytdSum += mw; cnt++; }
    }
    var avg = cnt>0 ? (ytdSum/cnt) : 0; var remain = 12 - m;
    projAnnual = ytdSum + avg*remain;
  }

  rows.push([]);
  rows.push(["SumHours", sumH, "SumWage", sumW, "ProjectedAnnual", projAnnual, "Mode", projMode]);
  return rows;
}
function download(filename, content, mime){
  if (!mime) mime = "text/plain;charset=utf-8";
  var blob = new Blob([content], { type: mime });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); document.body.removeChild(a); }, 0);
}
function exportCsvThisMonth(){
  var emp = currentEmployee(); var ym = state.ui.ym; var rows = collectMonthRows(emp, ym);
  var BOM = "\uFEFF";
  var csv = rows.map(r=>r.map(v=>{ var s=(v==null?"":String(v)); return /[",\n]/.test(s)?('"'+s.replace(/"/g,'""')+'"'):s; }).join(",")).join("\n");
  download(((emp&&emp.name)||"noname")+"_"+ym+".csv", BOM+csv, "text/csv;charset=utf-8");
}
function exportCsvAll(){
  var rows = [["Staff","Year-Month","Date","Weekday","HolidayName","Work","Hours","Hourly","DayWage"]];
  state.employees.forEach(emp=>{
    var empMonths = state.months[emp.id] || {};
    Object.keys(empMonths).sort().forEach(ym=>{
      var [y,m] = ym.split("-").map(Number); var dim = daysInMonth(ym); var wage = Number(emp.wage)||0;
      for (var d=1; d<=dim; d++){
        var r = (empMonths[ym][String(d)]) || { work:false, hours:0 };
        var hours = r.work ? (Number(r.hours)||0) : 0; var w = hours*wage;
        var hname = getHolidayNameByDate(ym, d);
        rows.push([emp.name||"（無名）", ym, ymd(ym,d), youbi(y,m,d), hname || "", r.work?"出勤":"休み", hours, wage, w]);
      }
    });
  });
  var BOM = "\uFEFF";
  var csv = rows.map(r=>r.map(v=>{ var s=(v==null?"":String(v)); return /[",\n]/.test(s)?('"'+s.replace(/"/g,'""')+'"'):s; }).join(",")).join("\n");
  download("all_staff_all_months.csv", BOM+csv, "text/csv;charset=utf-8");
}

/* ===== タブ描画 / カレンダー ===== */
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
      recalcAndRender(); syncSimulatorWage(); renderYearSummary(); renderEmpTabs(); updateCapSummary();
    });
    wrap.appendChild(b);
  });
}
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

    // 時間入力（数値のみ）
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

/* ===== 前月コピー（既存） ===== */
function getPrevYM(ym){
  var [y,m]=ym.split("-").map(Number); m -= 1; if (m===0){ y -= 1; m = 12; } return y + "-" + pad2(m);
}
function isEmptyDay(rec){ if (!rec) return true; if (rec.work) return false; var h = Number(rec.hours||0); return h===0; }
function copyPrevMonth(overwrite){
  var curYM = state.ui.ym, prevYM = getPrevYM(curYM), emp = currentEmployee(); if (!emp){ alert("スタッフが選択されていません。"); return; }
  var empId = emp.id, mdPrev = ensureEmpMonth(empId, prevYM), mdCur  = ensureEmpMonth(empId, curYM);
  var dimPrev = daysInMonth(prevYM), dimCur  = daysInMonth(curYM), limit = Math.min(dimPrev, dimCur);
  var hasData = false;
  for (var d=1; d<=dimPrev; d++){ var r = mdPrev[String(d)]; if (r && (r.work || (r.hours && Number(r.hours)>0))){ hasData = true; break; } }
  if (!hasData){ alert("前月にコピーできるデータが見つかりません。"); return; }
  for (var day=1; day<=limit; day++){
    var p = mdPrev[String(day)] || { work:false, hours:0 };
    mdCur[String(day)] = mdCur[String(day)] || { work:false, hours:0 };
    var c = mdCur[String(day)];
    if (overwrite){ c.work = !!p.work; c.hours = p.work ? (Number(p.hours)||0) : 0; }
    else { if (isEmptyDay(c)){ c.work = !!p.work; c.hours = p.work ? (Number(p.hours)||0) : 0; } }
  }
  saveState(); recalcAndRender(); renderYearSummary(); alert("前月の内容を今月へコピーしました。");
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

  // 従業員情報
  onClick("save-emp", function(){
    var e = currentEmployee(); if (!e) return;
    e.name = ($("#emp-name").value || "").trim();
    e.wage = Number($("#emp-wage").value) || 0;
    $("#emp-msg").textContent = "従業員情報を保存しました。";
    saveState(); renderTotals(); syncSimulatorWage(); renderYearSummary(); updateCapSummary();
  });

  onClick("reset-data", function(){
    if (!confirm("保存データをすべて削除します。よろしいですか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = loadStateOrMigrate();
    var cur = currentEmployee();
    $("#emp-name").value = cur ? (cur.name || "") : "";
    $("#emp-wage").value = cur ? (cur.wage || "") : "";
    $("#emp-msg").textContent = "データを初期化しました。";
    $("#month-picker").value = state.ui.ym;
    $("#proj-mode").value = state.ui.projMode;
    if (yp) yp.value = getYearFromYM(state.ui.ym);
    renderEmpTabs(); recalcAndRender(); syncSimulatorWage(); renderYearSummary(); updateCapSummary();
  });

  // 月選択
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

  // スタッフ追加/削除/並び替え
  onClick("add-emp", function(){
    var name = prompt("スタッフ名を入力してください"); if (!name) return;
    var wageStr = prompt("時給（円）を入力してください（例：1200）"); var wage = Number(wageStr);
    var id = uid(); state.employees.push({ id, name:name.trim(), wage: isFinite(wage)?wage:0 });
    state.currentEmpId = id; saveState(); renderEmpTabs();
    $("#emp-name").value = name.trim(); $("#emp-wage").value = isFinite(wage)?wage:0;
    $("#emp-msg").textContent = "新しいスタッフを追加しました。";
    recalcAndRender(); syncSimulatorWage(); renderYearSummary(); updateCapSummary();
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
    recalcAndRender(); syncSimulatorWage(); renderYearSummary(); updateCapSummary();
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

  // 出力
  onClick("export-csv-month", exportCsvThisMonth);
  onClick("export-csv-all", exportCsvAll);
  onClick("export-xlsx-month", exportXlsxThisMonth);

  // 希望票：AI解析（常に何か反映）
  onClick("wish-parse", function(){
    var txt = ($("#wish-text") && $("#wish-text").value) || "";
    var c = parseWishText(txt);
    window.__lastConstraints = c;

    var cap = c.preferCapYen ? ("¥"+c.preferCapYen.toLocaleString()) : (c.mentionFuyou ? "（扶養・UI選択準拠）" : "—");
    var sum = [
      "上限: " + cap,
      "1日基準: " + (c.dailyHoursPrefer!=null ? (c.dailyHoursPrefer + "h") : (DEFAULT_BASE_HOURS+"h[既定]")),
      "週: " + (c.weeklyDays!=null ? (c.weeklyDays + "日") : "—") + " / " + (c.weeklyHours!=null ? (c.weeklyHours + "h") : "—"),
      "祝日: " + (c.holidayOff!=null ? (c.holidayOff?"休":"可") : "可")
    ].join(" / ");
    var sumEl = $("#wish-summary"); if (sumEl) sumEl.textContent = "解析結果 → " + sum;

    var plan = planAutoAssignment(state.ui.ym, c, /*keepExisting=*/true);
    renderWishPreview(plan);
    applyWishPlan(plan, /*overwriteAll=*/false); // 常に適用
    alert("AI解析結果をカレンダーに反映しました。");
  });

  // 初期描画
  ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){
    if ($("#th-custom-a")) $("#th-custom-a").value = (state.ui.customCaps && state.ui.customCaps.a) || "";
    if ($("#th-custom-b")) $("#th-custom-b").value = (state.ui.customCaps && state.ui.customCaps.b) || "";
    recalcAndRender();
    renderYearSummary();
    updateCapSummary();
  });
});
