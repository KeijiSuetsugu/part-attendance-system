/* ===== 設定値 ===== */
var THRESHOLDS = { T103: 1030000, T106: 1060000, T130: 1300000 };
var STORAGE_KEY = "part_attendance_v3_force";

/* 祝日キャッシュ */
var HOLIDAY_CACHE_KEY = "holiday_cache_v1";
var HOLIDAY_TTL_DAYS = 30;

/* 既定の1日時間（指示がない時のフォールバック） */
var DEFAULT_BASE_HOURS = 6;

/* ===== ユーティリティ ===== */
function $(sel){ return document.querySelector(sel); }
function fmtJPY(n){ return "¥" + Math.round(n).toLocaleString("ja-JP", { maximumFractionDigits: 0 }); }
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function uid(){ return "emp-" + Math.random().toString(36).slice(2, 9); }
function pad2(n){ return String(n).length===1 ? "0"+String(n) : String(n); }
function ymd(ym, d){ return ym + "-" + pad2(d); }
function youbi(y,m,d){ return ["日","月","火","水","木","金","土"][new Date(y, m-1, d).getDay()]; }
function getYearFromYM(ym){ return Number(ym.split("-")[0]); }
function toYM(d){ return d.getFullYear() + "-" + pad2(d.getMonth()+1); }
function onClick(id, handler){ var el = document.getElementById(id); if (el) el.addEventListener("click", handler); }

/* 全角→半角＆記号の正規化 */
function normalizeText(s){
  if (!s) return "";
  return s
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0)-0xFEE0)) // 数字
    .replace(/[：]/g, ":")
    .replace(/[〜～]/g, "~")
    .replace(/[・､，]/g, ",")
    .replace(/[　\s]+/g, " ")
    .trim();
}
/* 小数点のみ残す緩い数値化 */
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

/* ===== 希望票 AI解析（“のみ/だけ/中心”を強制モードに反映） ===== */
var JP_WEEK = { "日":0, "月":1, "火":2, "水":3, "木":4, "金":5, "土":6 };
function parseWeekCharsToSet(str){
  var set = new Set();
  (str||"").split("").forEach(function(ch){ if (JP_WEEK.hasOwnProperty(ch)) set.add(JP_WEEK[ch]); });
  return set;
}
function parseWishText(raw){
  var text = normalizeText(raw||"");

  var c = {
    preferCapYen: null,          // 103/106/130
    mentionFuyou: /扶養.*(範囲|内|希望)/.test(text),
    holidayOff: null,            // true なら祝日を休みに
    dailyHoursPrefer: null,      // 1日X時間
    weeklyDays: null,            // 週X日（任意）
    weeklyHours: null,           // 週X時間（任意）
    weekdaysAllowed: new Set(),  // 許可曜日
    weekdaysOff: new Set(),      // 禁止曜日
    onDates: new Set(),          // この日は入れる
    offDates: new Set(),         // この日は休み
    allowedIsOnly: false         // 「のみ/だけ/中心」指定
  };

  // 上限（万・円）
  if (/(130)\s*万|1\s*300\s*000/.test(text)) c.preferCapYen = 1300000;
  else if (/(106)\s*万|1\s*060\s*000/.test(text)) c.preferCapYen = 1060000;
  else if (/(103)\s*万|1\s*030\s*000/.test(text)) c.preferCapYen = 1030000;

  // 勤務時間
  var mFixed = text.match(/(勤務時間|実働|希望時間)\s*[:は]?\s*([0-9]+(?:\.[0-9]+)?)\s*時間/);
  if (mFixed){ c.dailyHoursPrefer = toNumberSafe(mFixed[2]); }
  var mDay = text.match(/1日\s*([0-9]+(?:\.[0-9]+)?)\s*時間|([0-9]+(?:\.[0-9]+)?)\s*h/i);
  if (!c.dailyHoursPrefer && mDay){ c.dailyHoursPrefer = toNumberSafe(mDay[1] || mDay[2]); }

  // 時間帯 → 所要時間
  var mSpan = text.match(/(\d{1,2})(?::(\d{2}))?\s*[~\-]\s*(\d{1,2})(?::(\d{2}))?/);
  if (mSpan){
    var sH = toNumberSafe(mSpan[1]), sM = toNumberSafe(mSpan[2]||0);
    var eH = toNumberSafe(mSpan[3]), eM = toNumberSafe(mSpan[4]||0);
    var dur = Math.max(0, (eH*60+eM)-(sH*60+sM)) / 60;
    if (dur>0) c.dailyHoursPrefer = Math.round(dur*4)/4;
  }

  // 「月・火・木のみ出勤」など（・や読点/スペースに対応）
  var reWeekList = /([月火水木金土日,\s]+)(?:のみ|だけ|中心)?\s*(?:は)?\s*(出勤|勤務|可|OK|休み|不可|NG)/gi;
  var m;
  while ((m = reWeekList.exec(text)) !== null){
    var rawDays = (m[1]||"").replace(/[, ]+/g,""); // 例: "月火木"
    var verb = m[2];
    var isOnly = /のみ|だけ|中心/.test(m[0]);
    var set = parseWeekCharsToSet(rawDays);
    if (/出勤|勤務|可|OK/i.test(verb)){
      set.forEach(d=>c.weekdaysAllowed.add(d));
      if (isOnly) c.allowedIsOnly = true;
    } else {
      set.forEach(d=>c.weekdaysOff.add(d));
    }
  }

  // 単発表現（「月は出勤」「木は不可」など）
  Object.keys(JP_WEEK).forEach(function(k){
    var reOk = new RegExp(k+"[曜日]?(は)?(出勤|勤務|出勤可|希望|入れる|OK)","i");
    var reNg = new RegExp(k+"[曜日]?(は)?(不可|NG|休み|入れない)","i");
    if (reOk.test(text)) c.weekdaysAllowed.add(JP_WEEK[k]);
    if (reNg.test(text)) c.weekdaysOff.add(JP_WEEK[k]);
  });

  // 平日のみ/土日中心
  if (/平日(のみ|だけ|中心)/.test(text)){ [1,2,3,4,5].forEach(d=>c.weekdaysAllowed.add(d)); c.weekdaysOff.add(0); c.weekdaysOff.add(6); c.allowedIsOnly = true; }
  if (/(土日|週末)(のみ|だけ|中心)/.test(text)){ c.weekdaysAllowed.add(0); c.weekdaysAllowed.add(6); [1,2,3,4,5].forEach(d=>c.weekdaysOff.add(d)); c.allowedIsOnly = true; }

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

/* ===== カレンダー強制反映（希望票→そのまま上書き） ===== */
function applyWishHard(ym, c){
  var emp = currentEmployee(); if (!emp) return;
  var md = ensureEmpMonth(emp.id, ym);
  var baseH = (c.dailyHoursPrefer && c.dailyHoursPrefer>0) ? c.dailyHoursPrefer : DEFAULT_BASE_HOURS;

  // 1) まず全日を休みにリセット
  var [y,m] = ym.split("-").map(Number);
  var dim = daysInMonth(ym);
  for (var d=1; d<=dim; d++){ md[String(d)] = { work:false, hours:0 }; }

  // 2) 指定に従ってON/OFF
  for (var day=1; day<=dim; day++){
    var w = new Date(y, m-1, day).getDay();
    var rec = md[String(day)];

    // 祝日休（明示ON日は除く）
    if (c.holidayOff === true){
      var hn = getHolidayNameByDate(ym, day);
      if (hn && !c.onDates.has(day)){ rec.work=false; rec.hours=0; continue; }
    }

    // 明示休み日
    if (c.offDates.has(day)){ rec.work=false; rec.hours=0; continue; }

    // 明示出勤日
    if (c.onDates.has(day)){ rec.work=true; rec.hours=baseH; continue; }

    // 曜日ベース
    if (c.weekdaysAllowed.size>0){
      // 許可曜日に一致 → 出勤
      if (c.weekdaysAllowed.has(w)){ rec.work=true; rec.hours=baseH; }
      else { rec.work=false; rec.hours=0; }
    } else {
      // 許可曜日が特に無い場合は休みに据え置き
      rec.work=false; rec.hours=0;
    }

    // 曜日NGは最終的に勝つ
    if (c.weekdaysOff.has(w) && !c.onDates.has(day)){
      rec.work=false; rec.hours=0;
    }
  }

  saveState();
  recalcAndRender();
  renderYearSummary();
}

/* ===== 進捗/サマリー ===== */
function recalcAndRender(){ renderCalendar(); renderTotals(); }
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
    title.appendChild(daySpan); title.appendChild(monthBadge);

    var hname = getHolidayNameByDate(ym, day);
    if (hname){
      var hbadge = document.createElement("span");
      hbadge.className = "badge holiday";
      hbadge.title = hname; hbadge.textContent = hname;
      title.appendChild(hbadge);
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

    // 時間入力（スマホ視認性UP）
    var timeRow = document.createElement("div");
    timeRow.className = "time-row";

    var input = document.createElement("input");
    input.type = "number"; input.step = "0.25"; input.min = "0"; input.max = "24";
    input.placeholder = "勤務時間（h）"; input.inputMode = "decimal"; input.autocomplete = "off";
    input.value = rec.work ? String(rec.hours || "") : ""; input.disabled = !rec.work;

    var pill = document.createElement("span");
    pill.className = "val-pill";
    pill.textContent = (rec.work && rec.hours > 0) ? (Number(rec.hours).toFixed(2) + " h") : "";

    input.addEventListener("input", function(){
      var raw = (input.value || "").replace(",", ".");
      var v = Number(raw); if (!isFinite(v)) v = 0;
      v = clamp(Math.round(v*4)/4, 0, 24);
      rec.hours = v;
      input.value = v ? String(v) : "";
      pill.textContent = (rec.work && v>0) ? (v.toFixed(2) + " h") : "";
      saveState(); renderTotals(); renderYearSummary();
    });

    var help = document.createElement("span");
    help.className = "help"; help.textContent = "0.25=15分 / 0.5=30分";

    timeRow.appendChild(input); timeRow.appendChild(pill); timeRow.appendChild(help);
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

  updateCapSummary(); syncSimulatorWage(); recalcSimulator();
}
function setBar(barId, pctId, value, cap){
  var bar=$( "#"+barId ), pct=$("#"+pctId);
  var p = (cap>0) ? Math.min(100, (value/cap)*100) : 0;
  if (bar) bar.value = p;
  if (pct) pct.textContent = Math.round(p) + "%";
}

/* ===== 扶養シミュレーター（UI側の上限→月上限時間の参考） ===== */
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
  var selEl = $("#cap-select"); var sel = selEl ? selEl.value : "";
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

  // スタッフ管理
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

  // 希望票：AI解析→即カレンダーへ強制反映
  onClick("wish-parse", function(){
    var txt = ($("#wish-text") && $("#wish-text").value) || "";
    var c = parseWishText(txt);

    // 解析サマリ表示
    var cap = c.preferCapYen ? ("¥"+c.preferCapYen.toLocaleString()) : (c.mentionFuyou ? "（扶養・UI選択準拠）" : "—");
    var sum = [
      "上限: " + cap,
      "1日基準: " + (c.dailyHoursPrefer!=null ? (c.dailyHoursPrefer + "h") : (DEFAULT_BASE_HOURS+"h[既定]")),
      "祝日: " + (c.holidayOff===true ? "休" : "可"),
      "曜日OK: " + (c.weekdaysAllowed.size>0 ? Array.from(c.weekdaysAllowed).join(",") : "—"),
      "曜日NG: " + (c.weekdaysOff.size>0 ? Array.from(c.weekdaysOff).join(",") : "—"),
      "のみ/だけ/中心: " + (c.allowedIsOnly ? "はい" : (c.weekdaysAllowed.size>0 ? "（OKのみ扱い）" : "—"))
    ].join(" / ");
    var sumEl = $("#wish-summary"); if (sumEl) sumEl.textContent = "解析結果 → " + sum;

    // カレンダーへ強制反映（上書き）
    applyWishHard(state.ui.ym, c);

    // 簡易プレビュー（反映後の実データから生成）
    var md = ensureEmpMonth(currentEmployee().id, state.ui.ym);
    var rows = [];
    Object.keys(md).sort((a,b)=>Number(a)-Number(b)).forEach(function(k){
      var r=md[k]; if (r && r.work && r.hours>0){ rows.push(`<tr><td>${k}日</td><td style="text-align:right;">${Number(r.hours).toFixed(2)} h</td></tr>`); }
    });
    var box = $("#wish-preview");
    if (box){
      box.innerHTML = rows.length
        ? `<table><thead><tr><th>日付</th><th>割付時間</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
        : '<div class="muted">出勤の割付がありません。</div>';
    }

    alert("AI解析結果をカレンダーに反映しました。");
  });

  // 初期描画
  ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){
    if ($("#th-custom-a")) $("#th-custom-a").value = (state.ui.customCaps && state.ui.customCaps.a) || "";
    if ($("#th-custom-b")) $("#th-custom-b").value = (state.ui.customCaps && state.ui.customCaps.b) || "";
    renderEmpTabs(); recalcAndRender(); renderYearSummary(); syncSimulatorWage(); updateCapSummary();
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
