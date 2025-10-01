// ===== 設定値 =====
var THRESHOLDS = { T103: 1030000, T106: 1060000, T130: 1300000 };
var STORAGE_KEY = "part_attendance_v2"; // v2構造

// 祝日キャッシュ（ローカル保存）
var HOLIDAY_CACHE_KEY = "holiday_cache_v1";
var HOLIDAY_TTL_DAYS = 30; // 30日で更新

// ===== ユーティリティ =====
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

// 安全にイベントをつけるヘルパ
function onClick(id, handler){
  var el = document.getElementById(id);
  if (el) el.addEventListener("click", handler);
}

// ===== 祝日キャッシュ管理 =====
var holidayCache = loadHolidayCache();
function loadHolidayCache(){
  try {
    var raw = localStorage.getItem(HOLIDAY_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e){}
  return { years:{}, updated:{}, source:"" };
}
function saveHolidayCache(){
  localStorage.setItem(HOLIDAY_CACHE_KEY, JSON.stringify(holidayCache));
}
function updateHolidayStatus(year, loaded, source){
  var el = $("#holiday-status"); if (!el) return;
  if (loaded) el.textContent = "祝日データ：" + year + " 取得済（" + (source==="holidays-jp"?"holidays-jp":"Nager.Date") + "）";
  else el.textContent = "祝日データ：" + year + " を取得できませんでした（オフライン？）";
}
function ensureHolidaysForYear(year, callback){
  if (!holidayCache || !holidayCache.years) holidayCache = { years:{}, updated:{}, source:"" };
  var now = Date.now();
  var ystr = String(year);
  var have = holidayCache.years[ystr];
  var ts = holidayCache.updated ? holidayCache.updated[ystr] : null;
  var fresh = false;
  if (have && ts){
    var ageDays = (now - ts)/86400000;
    if (ageDays < HOLIDAY_TTL_DAYS) fresh = true;
  }
  if (fresh){ updateHolidayStatus(year, true, holidayCache.source||"holidays-jp"); if (callback) callback(); return; }

  // 1) holidays-jp（年別のJSON）→ 2) Nager.Date にフォールバック
  fetchHolidaysJP(year, function(map, src){
    holidayCache.years[ystr] = map; if (!holidayCache.updated) holidayCache.updated = {};
    holidayCache.updated[ystr] = Date.now(); holidayCache.source = src; saveHolidayCache();
    updateHolidayStatus(year, true, src);
    if (callback) callback();
  }, function(){
    fetchNagerJP(year, function(map, src){
      holidayCache.years[ystr] = map; if (!holidayCache.updated) holidayCache.updated = {};
      holidayCache.updated[ystr] = Date.now(); holidayCache.source = src; saveHolidayCache();
      updateHolidayStatus(year, true, src);
      if (callback) callback();
    }, function(){
      updateHolidayStatus(year, false, "");
      if (callback) callback();
    });
  });
}
function fetchHolidaysJP(year, success, fail){
  var url = "https://holidays-jp.github.io/api/v1/" + year + "/date.json";
  fetch(url, { cache: "no-store" })
    .then(function(r){ if (!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
    .then(function(json){ success(json, "holidays-jp"); })
    .catch(function(e){ if (fail) fail(e); });
}
function fetchNagerJP(year, success, fail){
  var url = "https://date.nager.at/api/v3/PublicHolidays/" + year + "/JP";
  fetch(url, { cache: "no-store" })
    .then(function(r){ if (!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
    .then(function(list){
      var map = {};
      for (var i=0;i<list.length;i++){
        var it = list[i]; // {date:"YYYY-MM-DD", localName:"元日", ...}
        map[it.date] = it.localName || it.name || "祝日";
      }
      success(map, "nager");
    })
    .catch(function(e){ if (fail) fail(e); });
}
function getHolidayNameByDate(ym, d){
  var y = String(getYearFromYM(ym));
  var map = holidayCache && holidayCache.years ? holidayCache.years[y] : null;
  if (!map) return "";
  var key = ymd(ym, d);
  return map[key] || "";
}

// ===== 状態（v2構造） =====
// state = { employees:[{id,name,wage}], currentEmpId:"", months:{ [empId]:{ [ym]:{ "1":{work,hours}, ... } } }, ui:{ym:"YYYY-MM", projMode:"thismonth"} }
var state = loadStateOrMigrate();

// ==== 旧v1→v2 移行 ====
function migrateV1ToV2(old) {
  var firstId = uid();
  var employees = [{ id: firstId, name: (old.employee && old.employee.name) || "", wage: (old.employee && old.employee.wage) || 0 }];
  var months = {}; months[firstId] = old.months || {};
  return { employees: employees, currentEmpId: firstId, months: months, ui: { ym: (old.ui && old.ui.ym) || toYM(new Date()), projMode: "thismonth" } };
}
function loadStateOrMigrate() {
  try {
    var raw2 = localStorage.getItem(STORAGE_KEY);
    if (raw2) return JSON.parse(raw2);
  } catch(e){}
  try {
    var raw1 = localStorage.getItem("part_attendance_v1");
    if (raw1) {
      var migrated = migrateV1ToV2(JSON.parse(raw1));
      saveState(migrated);
      return migrated;
    }
  } catch(e){}
  var id = uid();
  var fresh = { employees:[{ id:id, name:"", wage:0 }], currentEmpId:id, months:{}, ui:{ ym:toYM(new Date()), projMode:"thismonth" } };
  saveState(fresh);
  return fresh;
}
function saveState(s){ localStorage.setItem(STORAGE_KEY, JSON.stringify(s || state)); }

function daysInMonth(ym){ var sp=ym.split("-"); var y=Number(sp[0]), m=Number(sp[1]); return new Date(y, m, 0).getDate(); }
function firstDow(ym){ var sp=ym.split("-"); var y=Number(sp[0]), m=Number(sp[1]); return new Date(y, m-1, 1).getDay(); }
function currentEmployee(){
  var id = state.currentEmpId;
  for (var i=0;i<state.employees.length;i++) if (state.employees[i].id===id) return state.employees[i];
  return null;
}
function ensureEmpMonth(empId, ym){
  if (!state.months[empId]) state.months[empId] = {};
  if (!state.months[empId][ym]) state.months[empId][ym] = {};
  return state.months[empId][ym];
}

// ===== 初期化 =====
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
    saveState(); recalcAndRender(); syncSimulatorWage(); renderYearSummary();
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
    renderEmpTabs(); recalcAndRender(); syncSimulatorWage(); renderYearSummary(); updateBulkRangeLimits();
  });

  // 月選択
  onClick("prev-month", function(){
    var sp = state.ui.ym.split("-"); var y=Number(sp[0]), m=Number(sp[1]);
    var d = new Date(y, m-1, 1); d.setMonth(d.getMonth()-1);
    state.ui.ym = toYM(d); $("#month-picker").value = state.ui.ym; if (yp) yp.value = getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateBulkRangeLimits(); });
  });
  onClick("next-month", function(){
    var sp = state.ui.ym.split("-"); var y=Number(sp[0]), m=Number(sp[1]);
    var d = new Date(y, m-1, 1); d.setMonth(d.getMonth()+1);
    state.ui.ym = toYM(d); $("#month-picker").value = state.ui.ym; if (yp) yp.value = getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateBulkRangeLimits(); });
  });
  var mp = $("#month-picker");
  if (mp) mp.addEventListener("change", function(e){
    state.ui.ym = e.target.value; if (yp) yp.value = getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateBulkRangeLimits(); });
  });

  // スタッフ追加 / 削除 / 並び替え
  onClick("add-emp", function(){
    var name = prompt("スタッフ名を入力してください"); if (!name) return;
    var wageStr = prompt("時給（円）を入力してください（例：1200）"); var wage = Number(wageStr);
    var id = uid(); state.employees.push({ id:id, name:name.trim(), wage: isFinite(wage)?wage:0 });
    state.currentEmpId = id; saveState(); renderEmpTabs();
    $("#emp-name").value = name.trim(); $("#emp-wage").value = isFinite(wage)?wage:0;
    $("#emp-msg").textContent = "新しいスタッフを追加しました。";
    recalcAndRender(); syncSimulatorWage(); renderYearSummary();
  });

  onClick("del-emp", function(){
    var e = currentEmployee(); if (!e) return;
    if (!confirm("「" + (e.name || "（無名）") + "」を削除します。よろしいですか？")) return;
    var idx = -1; for (var i=0;i<state.employees.length;i++){ if (state.employees[i].id===e.id){ idx=i; break; } }
    if (idx>=0) state.employees.splice(idx,1);
    if (state.months[e.id]) delete state.months[e.id];

    if (state.employees.length===0){
      var id = uid(); state.employees.push({id:id, name:"", wage:0}); state.currentEmpId = id;
    } else {
      var next = state.employees[Math.max(0, idx-1)]; state.currentEmpId = next.id;
    }
    saveState(); renderEmpTabs();
    var cur = currentEmployee(); $("#emp-name").value = cur ? (cur.name||"") : ""; $("#emp-wage").value = cur ? (cur.wage||0) : 0;
    $("#emp-msg").textContent = "スタッフを削除しました。";
    recalcAndRender(); syncSimulatorWage(); renderYearSummary();
  });

  onClick("move-left", function(){
    var id = state.currentEmpId, idx=-1; for (var i=0;i<state.employees.length;i++){ if(state.employees[i].id===id){idx=i;break;} }
    if (idx>0){ var t = state.employees[idx-1]; state.employees[idx-1]=state.employees[idx]; state.employees[idx]=t; saveState(); renderEmpTabs(); }
  });
  onClick("move-right", function(){
    var id = state.currentEmpId, idx=-1; for (var i=0;i<state.employees.length;i++){ if(state.employees[i].id===id){idx=i;break;} }
    if (idx>=0 && idx<state.employees.length-1){ var t = state.employees[idx+1]; state.employees[idx+1]=state.employees[idx]; state.employees[idx]=t; saveState(); renderEmpTabs(); }
  });

  var pm = $("#proj-mode");
  if (pm) pm.addEventListener("change", function(e){ state.ui.projMode = e.target.value; saveState(); recalcAndRender(); });

  // 扶養シミュレーター
  var capSel = $("#cap-select"), capCust = $("#cap-custom");
  if (capSel) capSel.addEventListener("change", onCapChange);
  if (capCust) capCust.addEventListener("input", recalcSimulator);
  syncSimulatorWage(); onCapChange();

  // 年間サマリー
  var yrPick = $("#year-picker");
  if (yrPick) yrPick.addEventListener("change", renderYearSummary);
  onClick("refresh-summary", renderYearSummary);

  // 一括操作（出勤/休み）
  onClick("bulk-work-all", bulkWorkAll);
  onClick("bulk-off-all", bulkOffAll);
  onClick("bulk-weekdays-work", bulkWeekdaysWork);
  onClick("bulk-weekends-off", bulkWeekendsOff);
  onClick("bulk-holidays-off", bulkHolidaysOff); // 新規：祝日を休みに

  // 一括操作（時間）
  var bulkScope = $("#bulk-scope"); if (bulkScope) bulkScope.addEventListener("change", onBulkScopeChange);
  onClick("bulk-apply-hours", bulkApplyHours);

  // 前月コピー
  onClick("copy-prev-fill", function(){ copyPrevMonth(false); });
  onClick("copy-prev-overwrite", function(){ 
    if (confirm("前月の内容で今月をすべて上書きします。よろしいですか？")) copyPrevMonth(true);
  });

  // 出力
  onClick("export-csv-month", exportCsvThisMonth);
  onClick("export-csv-all", exportCsvAll);
  onClick("export-xlsx-month", exportXlsxThisMonth);

  // 初期描画：まず祝日データを確保してから描画
  ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){
    recalcAndRender();
    renderYearSummary();
    updateBulkRangeLimits();
  });
});

// ===== タブ描画 =====
function renderEmpTabs() {
  var wrap = $("#emp-tabs"); if (!wrap) return;
  wrap.innerHTML = "";
  for (var i=0;i<state.employees.length;i++){
    (function(e){
      var b = document.createElement("button");
      b.className = "tab" + (e.id===state.currentEmpId ? " active" : "");
      b.textContent = e.name || "（無名）";
      b.title = (e.name || "（無名）") + " / 時給: " + ((e.wage!=null?e.wage:0) + "円");
      b.addEventListener("click", function(){
        state.currentEmpId = e.id; saveState();
        $("#emp-name").value = e.name || ""; $("#emp-wage").value = e.wage || 0; $("#emp-msg").textContent = "";
        recalcAndRender(); syncSimulatorWage(); renderYearSummary(); renderEmpTabs();
      });
      wrap.appendChild(b);
    })(state.employees[i]);
  }
}

// ===== レンダリング（カレンダー・集計） =====
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
    var badge = document.createElement("span"); badge.className = "badge"; badge.textContent = ym;
    title.innerHTML = "<span>"+day+"日</span>"; title.appendChild(badge);

    // 祝日バッジ
    var hname = getHolidayNameByDate(ym, day);
    if (hname){
      var hbadge = document.createElement("span");
      hbadge.className = "badge holiday";
      hbadge.textContent = hname;
      title.appendChild(hbadge);
      // まだ未入力なら休みにしておく（手入力は上書きしない）
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

    var timeRow = document.createElement("div"); timeRow.className = "time-row";
    var input = document.createElement("input"); input.type="number"; input.step="0.25"; input.min="0"; input.placeholder="勤務時間（h）";
    input.value = rec.work ? String(rec.hours || "") : ""; input.disabled = !rec.work;
    input.addEventListener("input", function(recRef, inputRef){
      return function(){
        var v = Number(inputRef.value); recRef.hours = isFinite(v) ? clamp(v,0,24) : 0;
        saveState(); renderTotals(); renderYearSummary();
      };
    }(rec, input));

    var help = document.createElement("span"); help.className = "help"; help.textContent = "0.25=15分 / 0.5=30分";
    timeRow.appendChild(input); timeRow.appendChild(help); cell.appendChild(timeRow);

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
  var keys = Object.keys(monthData);
  for (var i=0;i<keys.length;i++){ var r = monthData[keys[i]]; if (r && r.work) sumHours += Number(r.hours)||0; }
  var sumWage = sumHours * wage;

  // 年収見込み
  var projMode = state.ui.projMode || "thismonth";
  var projAnnual = 0;
  if (projMode === "thismonth") {
    projAnnual = sumWage * 12;
  } else {
    var sp = ym.split("-"); var year = Number(sp[0]), month = Number(sp[1]);
    var ytdSum = 0, countedMonths = 0;
    for (var m=1;m<=month;m++){
      var ym2 = year + "-" + pad2(m);
      var md2 = (mdAll[ym2]) || {};
      var mh = 0; var k2 = Object.keys(md2);
      for (var j=0;j<k2.length;j++){ var rr = md2[k2[j]]; if (rr && rr.work) mh += Number(rr.hours)||0; }
      var mw = mh * wage;
      if (mw > 0){ ytdSum += mw; countedMonths++; }
    }
    var avg = countedMonths>0 ? (ytdSum / countedMonths) : 0;
    var remain = 12 - month;
    projAnnual = ytdSum + avg * remain;
  }

  $("#sum-hours").textContent = sumHours.toFixed(2) + " h";
  $("#sum-wage").textContent = fmtJPY(sumWage);
  $("#proj-annual").textContent = fmtJPY(projAnnual);

  // バー
  var pct103 = THRESHOLDS.T103 ? Math.min(100, (projAnnual/THRESHOLDS.T103)*100) : 0;
  var pct106 = THRESHOLDS.T106 ? Math.min(100, (projAnnual/THRESHOLDS.T106)*100) : 0;
  var pct130 = THRESHOLDS.T130 ? Math.min(100, (projAnnual/THRESHOLDS.T130)*100) : 0;
  var b103=$("#bar-103"), p103=$("#pct-103"); if(b103){ b103.value=pct103; } if(p103){ p103.textContent = Math.round(pct103)+"%"; }
  var b106=$("#bar-106"), p106=$("#pct-106"); if(b106){ b106.value=pct106; } if(p106){ p106.textContent = Math.round(pct106)+"%"; }
  var b130=$("#bar-130"), p130=$("#pct-130"); if(b130){ b130.value=pct130; } if(p130){ p130.textContent = Math.round(pct130)+"%"; }

  // 注意
  var msgs = [];
  if (projAnnual >= THRESHOLDS.T130) msgs.push("130万円ラインを超える見込みです。");
  else if (projAnnual >= THRESHOLDS.T130*0.9) msgs.push("130万円ラインの90%を超えています（要注意）。");

  if (projAnnual >= THRESHOLDS.T106 && projAnnual < THRESHOLDS.T130) msgs.push("106万円ラインを超える可能性があります。条件により社会保険加入対象となる場合があります。");
  else if (projAnnual >= THRESHOLDS.T106*0.9 && projAnnual < THRESHOLDS.T106) msgs.push("106万円ラインの90%を超えています（要注意）。");

  if (projAnnual >= THRESHOLDS.T103 && projAnnual < THRESHOLDS.T106) msgs.push("103万円ライン超の見込みです。");
  else if (projAnnual >= THRESHOLDS.T103*0.9 && projAnnual < THRESHOLDS.T103) msgs.push("103万円ラインの90%を超えています（要注意）。");

  var warn=$("#warn"); if (warn) warn.textContent = msgs.join(" ");

  // シミュレーター
  syncSimulatorWage();
  recalcSimulator();
}

// ===== 扶養シミュレーター =====
function onCapChange(){
  var sel = $("#cap-select"); var custom=$("#cap-custom");
  if (!sel || !custom) return;
  var v = sel.value;
  custom.disabled = (v !== "custom");
  recalcSimulator();
}
function syncSimulatorWage(){
  var wage = 0; var emp = currentEmployee(); if (emp) wage = Number(emp.wage)||0;
  var w = $("#cap-wage"); if (w) w.value = wage || "";
}
function recalcSimulator(){
  var selEl = $("#cap-select"), custEl=$("#cap-custom"), wageEl=$("#cap-wage"), out=$("#cap-hours");
  if (!selEl || !wageEl || !out) return;
  var sel = selEl.value;
  var customYen = custEl ? Number(custEl.value) : 0;
  var wage = Number(wageEl.value);

  var cap = 0;
  if (sel==="custom") cap = (isFinite(customYen) && customYen>0) ? customYen : 0;
  else cap = Number(sel)||0;

  var hours = "";
  if (cap>0 && wage>0){
    var perMonth = cap/12/wage;
    var rounded = Math.round(perMonth*4)/4;
    hours = rounded.toFixed(2) + " h / 月";
  }
  out.value = hours;
}

// ===== 年間サマリー =====
function calcMonthWage(emp, year, month){
  var ym = year + "-" + pad2(month);
  var mdAll = state.months[emp ? emp.id : ""] || {};
  var md = mdAll[ym] || {};
  var hours = 0; var ks = Object.keys(md);
  for (var i=0;i<ks.length;i++){ var r = md[ks[i]]; if (r && r.work) hours += Number(r.hours)||0; }
  var wage = emp ? Number(emp.wage)||0 : 0;
  return { hours:hours, amount: hours*wage };
}
function renderYearSummary(){
  var tableWrap = $("#year-summary"); if (!tableWrap) return;
  var emp = currentEmployee();
  var yrEl = $("#year-picker"); var year = yrEl ? (Number(yrEl.value)||getYearFromYM(state.ui.ym)) : getYearFromYM(state.ui.ym);
  var months = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  var html = '<table class="year-table"><thead><tr><th class="month">月</th>';
  for (var i=0;i<months.length;i++) html += "<th>"+months[i]+"</th>";
  html += "<th>合計</th></tr></thead><tbody>";

  // 金額行
  html += '<tr><th class="month">金額</th>';
  var yearSum = 0;
  for (var m=1;m<=12;m++){ var a = calcMonthWage(emp, year, m).amount; yearSum += a; html += "<td>"+(a>0?fmtJPY(a):"—")+"</td>"; }
  html += "<td>"+fmtJPY(yearSum)+"</td></tr>";

  // 時間行
  html += '<tr><th class="month">時間(h)</th>';
  var yearHours = 0;
  for (var mm=1;mm<=12;mm++){ var h = calcMonthWage(emp, year, mm).hours; yearHours += h; html += "<td>"+(h>0?h.toFixed(2):"—")+"</td>"; }
  html += "<td>"+yearHours.toFixed(2)+"</td></tr>";

  html += "</tbody></table>";
  tableWrap.innerHTML = html;
}

// ===== 出力（CSV / Excel） =====
function collectMonthRows(emp, ym){
  var sp=ym.split("-"); var y=Number(sp[0]), m=Number(sp[1]);
  var mdAll = state.months[emp ? emp.id : ""] || {};
  var md = mdAll[ym] || {};
  var wage = emp ? Number(emp.wage)||0 : 0;
  var dim = daysInMonth(ym);

  var rows = []; var sumH=0, sumW=0;
  rows.push(["Staff", (emp?emp.name:"") || "", "Year-Month", ym, "Hourly", wage]);
  // 祝日名列を追加
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
      var mh = 0; var ks = Object.keys(md2);
      for (var k=0;k<ks.length;k++){ var rr = md2[ks[k]]; if (rr && rr.work) mh += Number(rr.hours)||0; }
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
  var csv = rows.map(function(r){ return r.map(function(v){
    var s = (v==null?"":String(v));
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }).join(","); }).join("\n");
  download(((emp&&emp.name)||"noname")+"_"+ym+".csv", BOM+csv, "text/csv;charset=utf-8");
}
function exportCsvAll(){
  var rows = [["Staff","Year-Month","Date","Weekday","HolidayName","Work","Hours","Hourly","DayWage"]];
  for (var i=0;i<state.employees.length;i++){
    var emp = state.employees[i];
    var empMonths = state.months[emp.id] || {};
    var yms = Object.keys(empMonths).sort();
    for (var j=0;j<yms.length;j++){
      var ym = yms[j]; var sp=ym.split("-"); var y=Number(sp[0]), m=Number(sp[1]);
      var dim = daysInMonth(ym); var wage = Number(emp.wage)||0;
      for (var d=1; d<=dim; d++){
        var r = (empMonths[ym][String(d)]) || { work:false, hours:0 };
        var hours = r.work ? (Number(r.hours)||0) : 0; var w = hours*wage;
        var hname = getHolidayNameByDate(ym, d);
        rows.push([emp.name||"（無名）", ym, ymd(ym,d), youbi(y,m,d), hname || "", r.work?"出勤":"休み", hours, wage, w]);
      }
    }
  }
  var BOM = "\uFEFF";
  var csv = rows.map(function(r){ return r.map(function(v){
    var s = (v==null?"":String(v));
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }).join(","); }).join("\n");
  download("all_staff_all_months.csv", BOM+csv, "text/csv;charset=utf-8");
}
function exportXlsxThisMonth(){
  if (typeof XLSX === "undefined"){ alert("Excel出力用ライブラリの読み込みに失敗しました。ネット接続をご確認ください。"); return; }
  var emp = currentEmployee(); var ym = state.ui.ym; var rows = collectMonthRows(emp, ym);
  var ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{wch:12},{wch:6},{wch:10},{wch:6},{wch:8},{wch:12}]; // HolidayName列の分広げる
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Timesheet");
  XLSX.writeFile(wb, (((emp&&emp.name)||"noname")+"_"+ym+".xlsx"));
}

// ===== 一括操作（出勤/休み & 時間） =====
function onBulkScopeChange(){
  var scope = $("#bulk-scope"); if (!scope) return;
  var rangeEnabled = scope.value === "date_range_overwrite";
  var from = $("#bulk-from"), to = $("#bulk-to");
  if (from) from.disabled = !rangeEnabled;
  if (to) to.disabled = !rangeEnabled;
}
function updateBulkRangeLimits(){
  var dim = daysInMonth(state.ui.ym);
  var from = $("#bulk-from"), to = $("#bulk-to");
  if (from){ from.min=1; from.max=dim; if (!from.value) from.value=1; }
  if (to){ to.min=1; to.max=dim; if (!to.value) to.value=dim; }
}

function bulkWorkAll(){
  var ym = state.ui.ym, empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);
  for (var d=1; d<=dim; d++){ if (!md[String(d)]) md[String(d)]={work:false,hours:0}; md[String(d)].work=true; }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkOffAll(){
  var ym = state.ui.ym, empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);
  for (var d=1; d<=dim; d++){ if (!md[String(d)]) md[String(d)]={work:false,hours:0}; md[String(d)].work=false; md[String(d)].hours=0; }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkWeekdaysWork(){
  var ym = state.ui.ym, empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);
  var sp=ym.split("-"); var y=Number(sp[0]), m=Number(sp[1]);
  for (var d=1; d<=dim; d++){ if (!isWeekend(y,m,d)){ if (!md[String(d)]) md[String(d)]={work:false,hours:0}; md[String(d)].work=true; } }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkWeekendsOff(){
  var ym = state.ui.ym, empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);
  var sp=ym.split("-"); var y=Number(sp[0]), m=Number(sp[1]);
  for (var d=1; d<=dim; d++){ if (isWeekend(y,m,d)){ if (!md[String(d)]) md[String(d)]={work:false,hours:0}; md[String(d)].work=false; md[String(d)].hours=0; } }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkHolidaysOff(){
  var ym = state.ui.ym, empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);
  for (var d=1; d<=dim; d++){
    var hname = getHolidayNameByDate(ym, d);
    if (hname){
      if (!md[String(d)]) md[String(d)] = { work:false, hours:0 };
      md[String(d)].work = false; md[String(d)].hours = 0;
    }
  }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkApplyHours(){
  var ym = state.ui.ym, sp=ym.split("-"), y=Number(sp[0]), m=Number(sp[1]);
  var empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);

  var hours = Number(($("#bulk-hours") && $("#bulk-hours").value) || "");
  if (!isFinite(hours) || hours<0){ alert("時間を正しく入力してください（例：7.5）"); return; }
  hours = clamp(Math.round(hours*4)/4, 0, 24);

  var scopeEl = $("#bulk-scope"); var scope = scopeEl? scopeEl.value : "all_working_overwrite";
  var markWork = ($("#bulk-mark-work") && $("#bulk-mark-work").checked) ? true : false;
  var from = Number(($("#bulk-from") && $("#bulk-from").value) || 1);
  var to = Number(($("#bulk-to") && $("#bulk-to").value) || dim);
  if (from>to){ var t=from; from=to; to=t; }
  from = clamp(from,1,dim); to = clamp(to,1,dim);

  for (var d=1; d<=dim; d++){
    if (!md[String(d)]) md[String(d)] = { work:false, hours:0 };
    var rec = md[String(d)];
    var weekday = !isWeekend(y,m,d);
    var inScope = false;

    if (scope==="all_working_overwrite") inScope = (rec.work || markWork);
    else if (scope==="working_empty_only") inScope = (rec.work || markWork) && (!rec.hours || rec.hours===0);
    else if (scope==="weekdays_overwrite") inScope = weekday && (rec.work || markWork);
    else if (scope==="weekends_overwrite") inScope = !weekday && (rec.work || markWork);
    else if (scope==="date_range_overwrite") inScope = (d>=from && d<=to) && (rec.work || markWork);

    if (!inScope) continue;
    if (markWork) rec.work = true;
    if (rec.work) rec.hours = hours;
  }

  saveState(); recalcAndRender(); renderYearSummary();
}

// ===== 前月→今月 コピー =====
function getPrevYM(ym){
  var sp = ym.split("-"); var y = Number(sp[0]), m = Number(sp[1]);
  m -= 1; if (m===0){ y -= 1; m = 12; }
  return y + "-" + pad2(m);
}
function isEmptyDay(rec){
  if (!rec) return true;
  if (rec.work) return false;
  var h = Number(rec.hours||0);
  return h===0;
}
function copyPrevMonth(overwrite){
  var curYM = state.ui.ym;
  var prevYM = getPrevYM(curYM);
  var emp = currentEmployee(); if (!emp){ alert("スタッフが選択されていません。"); return; }
  var empId = emp.id;

  var mdPrev = ensureEmpMonth(empId, prevYM);
  var mdCur  = ensureEmpMonth(empId, curYM);

  var dimPrev = daysInMonth(prevYM);
  var dimCur  = daysInMonth(curYM);
  var limit = Math.min(dimPrev, dimCur);

  var hasData = false;
  for (var d=1; d<=dimPrev; d++){
    var r = mdPrev[String(d)];
    if (r && (r.work || (r.hours && Number(r.hours)>0))){ hasData = true; break; }
  }
  if (!hasData){
    alert("前月にコピーできるデータが見つかりません。");
    return;
  }

  for (var day=1; day<=limit; day++){
    var p = mdPrev[String(day)] || { work:false, hours:0 };
    if (!mdCur[String(day)]) mdCur[String(day)] = { work:false, hours:0 };
    var c = mdCur[String(day)];

    if (overwrite){
      c.work  = !!p.work;
      c.hours = p.work ? (Number(p.hours)||0) : 0;
    } else {
      if (isEmptyDay(c)){
        c.work  = !!p.work;
        c.hours = p.work ? (Number(p.hours)||0) : 0;
      }
    }
  }

  saveState();
  recalcAndRender();
  renderYearSummary();
  alert("前月の内容を今月へコピーしました。");
}
