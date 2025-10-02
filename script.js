// ===== 設定値 =====
var THRESHOLDS = { T103: 1030000, T106: 1060000, T130: 1300000 };
var STORAGE_KEY = "part_attendance_v2";

// 祝日キャッシュ
var HOLIDAY_CACHE_KEY = "holiday_cache_v1";
var HOLIDAY_TTL_DAYS = 30;

// 解析直後に自動適用（true: 解析/プレビュー時に即カレンダーへ反映）
var AUTO_APPLY_ON_PARSE = true;

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
function onClick(id, handler){ var el = document.getElementById(id); if (el) el.addEventListener("click", handler); }

// ===== 祝日キャッシュ管理 =====
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

// ===== 状態 =====
var state = loadStateOrMigrate();
function migrateV1ToV2(old) {
  var firstId = uid();
  var employees = [{ id:firstId, name:(old.employee&&old.employee.name)||"", wage:(old.employee&&old.employee.wage)||0 }];
  var months = {}; months[firstId] = old.months || {};
  return { employees, currentEmpId:firstId, months, ui:{ ym:(old.ui&&old.ui.ym)||toYM(new Date()), projMode:"thismonth", customCaps:{a:0,b:0}, bulkActiveId:"" } };
}
function loadStateOrMigrate() {
  try { var raw2 = localStorage.getItem(STORAGE_KEY); if (raw2) {
    var st = JSON.parse(raw2);
    if (!st.ui) st.ui = {};
    if (!st.ui.customCaps) st.ui.customCaps = {a:0,b:0};
    if (st.ui.bulkActiveId===undefined) st.ui.bulkActiveId = "";
    return st;
  }} catch(e){}
  try { var raw1 = localStorage.getItem("part_attendance_v1"); if (raw1) { var mig = migrateV1ToV2(JSON.parse(raw1)); saveState(mig); return mig; } } catch(e){}
  var id = uid();
  var fresh = { employees:[{id, name:"", wage:0}], currentEmpId:id, months:{}, ui:{ ym:toYM(new Date()), projMode:"thismonth", customCaps:{a:0,b:0}, bulkActiveId:"" } };
  saveState(fresh); return fresh;
}
function saveState(s){ localStorage.setItem(STORAGE_KEY, JSON.stringify(s||state)); }

function daysInMonth(ym){ var [y,m]=ym.split("-").map(Number); return new Date(y, m, 0).getDate(); }
function firstDow(ym){ var [y,m]=ym.split("-").map(Number); return new Date(y, m-1, 1).getDay(); }
function currentEmployee(){ var id=state.currentEmpId; return state.employees.find(e=>e.id===id)||null; }
function ensureEmpMonth(empId, ym){ state.months[empId] = state.months[empId]||{}; state.months[empId][ym] = state.months[empId][ym]||{}; return state.months[empId][ym]; }

// ====== 希望票：解析 / プレビュー / 適用 ======
onClick("wish-parse", function(){
  var txt = ($("#wish-text") && $("#wish-text").value) || "";
  var c = parseWishText(txt);

  var cap = c.preferCapYen ? ("¥"+c.preferCapYen.toLocaleString()) : (c.mentionFuyou ? "（扶養・UI選択準拠）" : "—");
  var sum = [
    "上限: " + cap,
    "1日基準: " + (c.dailyHoursPrefer!=null ? (c.dailyHoursPrefer + "h") : "—"),
    "週: " + (c.weeklyDays!=null ? (c.weeklyDays + "日") : "—") + " / " + (c.weeklyHours!=null ? (c.weeklyHours + "h") : "—"),
    "祝日: " + (c.holidayOff===true ? "休" : (c.holidayOff===false ? "可" : "（指定なし）")),
  ].join(" / ");
  if ($("#wish-summary")) $("#wish-summary").textContent = "解析結果 → " + sum;

  var keep = ($("#wish-keep-existing") && $("#wish-keep-existing").checked) ? true : false;
  var plan = planAutoAssignment(state.ui.ym, c, keep);
  renderWishPreview(plan);

  // ← 解析時に自動適用
  if (AUTO_APPLY_ON_PARSE && plan && plan.entries && plan.entries.length>0){
    var applied = applyWishPlan(plan, !keep);
    if ($("#wish-summary")){
      $("#wish-summary").textContent += " / 自動適用: " + applied + "件";
    }
  } else if (AUTO_APPLY_ON_PARSE && (!plan.entries || plan.entries.length===0)){
    alert("適用できる候補がありません（条件不足／既存で目標達成の可能性）。");
  }
});

onClick("wish-preview-btn", function(){
  var txt = ($("#wish-text") && $("#wish-text").value) || "";
  var c = parseWishText(txt);
  var keep = ($("#wish-keep-existing") && $("#wish-keep-existing").checked) ? true : false;
  var plan = planAutoAssignment(state.ui.ym, c, keep);
  renderWishPreview(plan);

  // ← プレビュー時も自動適用（同じルール）
  if (AUTO_APPLY_ON_PARSE && plan && plan.entries && plan.entries.length>0){
    var applied = applyWishPlan(plan, !keep);
    if ($("#wish-summary")){
      $("#wish-summary").textContent += " / 自動適用: " + applied + "件";
    }
  } else if (AUTO_APPLY_ON_PARSE && (!plan.entries || plan.entries.length===0)){
    alert("適用できる候補がありません（条件不足／既存で目標達成の可能性）。");
  }
});

onClick("wish-apply", function(){
  var txt = ($("#wish-text") && $("#wish-text").value) || "";
  var c = parseWishText(txt);
  var keep = ($("#wish-keep-existing") && $("#wish-keep-existing").checked) ? true : false;
  var plan = planAutoAssignment(state.ui.ym, c, keep);
  if (!plan || !plan.entries || plan.entries.length===0){
    alert("適用できる候補がありません（条件不足／既存で目標達成の可能性）。");
    return;
  }
  var applied = applyWishPlan(plan, !keep);
  alert("自動割付を適用しました（"+applied+"件）。");
});

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
    renderEmpTabs(); recalcAndRender(); syncSimulatorWage(); renderYearSummary(); updateBulkRangeLimits(); updateCapSummary(); applyBulkActiveFromState();
  });

  // 月選択
  onClick("prev-month", function(){
    var [y,m] = state.ui.ym.split("-").map(Number); var d=new Date(y,m-1,1); d.setMonth(d.getMonth()-1);
    state.ui.ym = toYM(d); $("#month-picker").value = state.ui.ym; if (yp) yp.value = getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateBulkRangeLimits(); updateCapSummary(); });
  });
  onClick("next-month", function(){
    var [y,m] = state.ui.ym.split("-").map(Number); var d=new Date(y,m-1,1); d.setMonth(d.getMonth()+1);
    state.ui.ym = toYM(d); $("#month-picker").value = state.ui.ym; if (yp) yp.value = getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateBulkRangeLimits(); updateCapSummary(); });
  });
  var mp = $("#month-picker");
  mp && mp.addEventListener("change", function(e){
    state.ui.ym = e.target.value; if (yp) yp.value = getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateBulkRangeLimits(); updateCapSummary(); });
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

  // 扶養シミュレーター
  var capSel = $("#cap-select"), capCust = $("#cap-custom");
  capSel && capSel.addEventListener("change", onCapChange);
  capCust && capCust.addEventListener("input", recalcSimulator);
  syncSimulatorWage(); onCapChange();

  // 年間サマリー
  var yrPick = $("#year-picker");
  yrPick && yrPick.addEventListener("change", renderYearSummary);
  onClick("refresh-summary", renderYearSummary);

  // 一括操作（出勤/休み）
  onClick("bulk-work-all", function(){ bulkWorkAll(); setBulkActive("bulk-work-all"); });
  onClick("bulk-off-all", function(){ bulkOffAll(); setBulkActive("bulk-off-all"); });
  onClick("bulk-weekdays-work", function(){ bulkWeekdaysWork(); setBulkActive("bulk-weekdays-work"); });
  onClick("bulk-weekends-off", function(){ bulkWeekendsOff(); setBulkActive("bulk-weekends-off"); });
  onClick("bulk-holidays-off", function(){ bulkHolidaysOff(); setBulkActive("bulk-holidays-off"); });

  // 一括操作（時間）
  var bulkScope = $("#bulk-scope"); bulkScope && bulkScope.addEventListener("change", onBulkScopeChange);
  onClick("bulk-apply-hours", bulkApplyHours);

  // 前月コピー
  onClick("copy-prev-fill", function(){ copyPrevMonth(false); });
  onClick("copy-prev-overwrite", function(){ if(confirm("前月の内容で今月をすべて上書きします。よろしいですか？")) copyPrevMonth(true); });

  // カスタムライン（A/B）
  var a=$("#th-custom-a"), b=$("#th-custom-b");
  if (a) a.addEventListener("input", function(){ state.ui.customCaps.a = Number(a.value)||0; saveState(); renderTotals(); });
  if (b) b.addEventListener("input", function(){ state.ui.customCaps.b = Number(b.value)||0; saveState(); renderTotals(); });

  // 出力
  onClick("export-csv-month", exportCsvThisMonth);
  onClick("export-csv-all", exportCsvAll);
  onClick("export-xlsx-month", exportXlsxThisMonth);

  // 初期描画
  ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){
    if ($("#th-custom-a")) $("#th-custom-a").value = state.ui.customCaps.a || "";
    if ($("#th-custom-b")) $("#th-custom-b").value = state.ui.customCaps.b || "";
    recalcAndRender();
    renderYearSummary();
    updateBulkRangeLimits();
    updateCapSummary();
    applyBulkActiveFromState();
  });
});

// ===== タブ描画 =====
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

// ===== レンダリング =====
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

    // 祝日
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

    // === 時間入力 ===
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

    function applyValue(newVal){
      var v = clamp(newVal, 0, 24);
      v = Math.round(v * 4) / 4;
      rec.hours = v;
      input.value = v ? String(v) : "";
      pill.textContent = (rec.work && v>0) ? (v.toFixed(2) + " h") : "";
      saveState(); renderTotals(); renderYearSummary();
    }

    input.addEventListener("input", function(){
      var raw = (input.value || "").replace(",", ".");
      var v = Number(raw);
      if (!isFinite(v)) v = 0;
      applyValue(v);
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
  setBar("bar-custom-a","pct-custom-a", projAnnual, state.ui.customCaps.a||0);
  setBar("bar-custom-b","pct-custom-b", projAnnual, state.ui.customCaps.b||0);

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

// ===== 扶養シミュレーター =====
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
  var label="", cap=0;
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

// ===== 年間サマリー =====
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

  // 金額
  html += '<tr><th class="month">金額</th>';
  var yearSum = 0;
  for (var m=1;m<=12;m++){ var a = calcMonthWage(emp, year, m).amount; yearSum += a; html += "<td>"+(a>0?fmtJPY(a):"—")+"</td>"; }
  html += "<td>"+fmtJPY(yearSum)+"</td></tr>";

  // 時間
  html += '<tr><th class="month">時間(h)</th>';
  var yearHours = 0;
  for (var mm=1;mm<=12;mm++){ var h = calcMonthWage(emp, year, mm).hours; yearHours += h; html += "<td>"+(h>0?h.toFixed(2):"—")+"</td>"; }
  html += "<td>"+yearHours.toFixed(2)+"</td></tr>";

  html += "</tbody></table>";
  tableWrap.innerHTML = html;
}

// ===== CSV / Excel 出力 =====
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

// Excelライブラリのフォールバック
function ensureXLSX(ready){
  if (window.XLSX) { ready(); return; }
  var s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.20.3/dist/xlsx.full.min.js";
  s.onload = ready;
  s.onerror = function(){
    var s2 = document.createElement("script");
    s2.src = "https://unpkg.com/xlsx@0.20.3/dist/xlsx.full.min.js";
    s2.onload = ready;
    s2.onerror = function(){ alert("Excel用ライブラリの読み込みに失敗しました。CSV出力をご利用ください。"); };
    document.head.appendChild(s2);
  };
  document.head.appendChild(s);
}
function exportXlsxThisMonth(){
  var emp = currentEmployee(); var ym = state.ui.ym; var rows = collectMonthRows(emp, ym);
  ensureXLSX(function(){
    try {
      var ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{wch:12},{wch:6},{wch:12},{wch:6},{wch:8},{wch:12}];
      var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Timesheet");
      var fname = (((emp&&emp.name)||"noname")+"_"+ym+".xlsx");
      if (XLSX.writeFileXLSX) XLSX.writeFileXLSX(wb, fname);
      else XLSX.writeFile(wb, fname);
    } catch(e){
      console.error(e);
      alert("Excelファイルの作成に失敗しました。ブラウザのダウンロード設定をご確認ください。");
    }
  });
}

// ===== 一括操作 =====
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
var BULK_IDS = ["bulk-work-all","bulk-off-all","bulk-weekdays-work","bulk-weekends-off","bulk-holidays-off"];
function setBulkActive(id){
  state.ui.bulkActiveId = id; saveState();
  BULK_IDS.forEach(function(k){
    var el = $("#"+k);
    if (!el) return;
    if (k===id) { el.classList.remove("btn-ghost"); el.classList.add("btn-active"); }
    else { el.classList.remove("btn-active"); el.classList.add("btn-ghost"); }
  });
}
function applyBulkActiveFromState(){ if (state.ui.bulkActiveId) setBulkActive(state.ui.bulkActiveId); }
function bulkWorkAll(){
  var ym = state.ui.ym, empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);
  for (var d=1; d<=dim; d++){ md[String(d)] = md[String(d)]||{work:false,hours:0}; md[String(d)].work=true; }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkOffAll(){
  var ym = state.ui.ym, empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);
  for (var d=1; d<=dim; d++){ md[String(d)] = md[String(d)]||{work:false,hours:0}; md[String(d)].work=false; md[String(d)].hours=0; }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkWeekdaysWork(){
  var ym = state.ui.ym, empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);
  var [y,m]=ym.split("-").map(Number);
  for (var d=1; d<=dim; d++){ if (!isWeekend(y,m,d)){ md[String(d)] = md[String(d)]||{work:false,hours:0}; md[String(d)].work=true; } }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkWeekendsOff(){
  var ym = state.ui.ym, empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);
  var [y,m]=ym.split("-").map(Number);
  for (var d=1; d<=dim; d++){ if (isWeekend(y,m,d)){ md[String(d)] = md[String(d)]||{work:false,hours:0}; md[String(d)].work=false; md[String(d)].hours=0; } }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkHolidaysOff(){
  var ym = state.ui.ym, empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);
  for (var d=1; d<=dim; d++){
    var hname = getHolidayNameByDate(ym, d);
    if (hname){ md[String(d)] = md[String(d)]||{work:false,hours:0}; md[String(d)].work=false; md[String(d)].hours=0; }
  }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkApplyHours(){
  var ym = state.ui.ym, [y,m]=ym.split("-").map(Number), empId = state.currentEmpId, md = ensureEmpMonth(empId, ym), dim = daysInMonth(ym);
  var hours = Number(($("#bulk-hours") && $("#bulk-hours").value) || "");
  if (!isFinite(hours) || hours<0){ alert("時間を正しく入力してください（例：7.5）"); return; }
  hours = clamp(Math.round(hours*4)/4, 0, 24);
  var scopeEl = $("#bulk-scope"); var scope = scopeEl? scopeEl.value : "all_working_overwrite";
  var markWork = ($("#bulk-mark-work") && $("#bulk-mark-work").checked) ? true : false;
  var from = Number(($("#bulk-from") && $("#bulk-from").value) || 1);
  var to = Number(($("#bulk-to") && $("#bulk-to").value) || dim);
  if (from>to){ var t=from; from=to; to=t; } from = clamp(from,1,dim); to = clamp(to,1,dim);

  for (var d=1; d<=dim; d++){
    md[String(d)] = md[String(d)] || { work:false, hours:0 };
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

// === 希望票解析 & 自動割付（UI依存なし） ======================

// 和暦っぽい表記も含めてざっくり数字抽出
function toNumberSafe(s){ if (!s) return NaN; return Number(String(s).replace(/[^\d.]/g,'')); }
var JP_WEEK = { "日":0, "月":1, "火":2, "水":3, "木":4, "金":5, "土":6 };

// 希望票を解析
function parseWishText(raw){
  var text = (raw||"").replace(/\s+/g, " ").trim();
  var c = {
    preferCapYen: null,
    mentionFuyou: /扶養.*(範囲|内)/.test(text),
    holidayOff: null,            // true|false|null（テキスト指定のみで反映）
    dailyHoursPrefer: null,
    weeklyDays: null,
    weeklyHours: null,
    weekdaysAllowed: new Set(),
    weekdaysOff: new Set(),
    onDates: new Set(),
    offDates: new Set()
  };

  // 扶養ライン（万・円両対応）
  if (/130\s*万|1[,，]?\s*300[,，]?\s*000/.test(text)) c.preferCapYen = 1300000;
  else if (/106\s*万|1[,，]?\s*060[,，]?\s*000/.test(text)) c.preferCapYen = 1060000;
  else if (/103\s*万|1[,，]?\s*030[,，]?\s*000/.test(text)) c.preferCapYen = 1030000;

  // 祝日ポリシー（テキストにあるときだけ反映）
  if (/祝日.*休/.test(text)) c.holidayOff = true;
  if (/祝日.*可|祝日.*OK/.test(text)) c.holidayOff = false;

  // 1日X時間 / Xh / 時間帯（10:00〜16:30 -> 6.5h）
  var mDay = text.match(/(1日\s*([0-9]+(?:\.[0-9]+)?)\s*時間)|(([0-9]+(?:\.[0-9]+)?)\s*h)/);
  if (mDay){ c.dailyHoursPrefer = toNumberSafe(mDay[2] || mDay[4]); }
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

  // 土日テキスト → 曜日集合へ
  if (/土日.*休|週末.*休/.test(text)) { c.weekdaysOff.add(0); c.weekdaysOff.add(6); }
  if (/土日.*可|週末.*可|土日.*OK/.test(text)) { c.weekdaysAllowed.add(0); c.weekdaysAllowed.add(6); }

  // 曜日ごとの可/不可
  Object.keys(JP_WEEK).forEach(function(k){
    var reOk = new RegExp(k+"[曜日]?(は)?(出勤可|希望|入れる|OK)");
    var reNg = new RegExp(k+"[曜日]?(は)?(不可|NG|休み|入れない)");
    if (reOk.test(text)) c.weekdaysAllowed.add(JP_WEEK[k]);
    if (reNg.test(text)) c.weekdaysOff.add(JP_WEEK[k]);
  });

  // 特定日 例：「15日 休み」「22日は入れます」
  var reDay = /(\d{1,2})\s*日/g, m;
  while ((m = reDay.exec(text)) !== null){
    var d = toNumberSafe(m[1]);
    var around = text.slice(Math.max(0,m.index-8), m.index+8);
    if (/休|不可|NG/.test(around)) c.offDates.add(d);
    if (/入れ|希望|OK/.test(around)) c.onDates.add(d);
  }
  return c;
}

// 月ターゲット時間（扶養上限→月上限）
function calcMonthlyTargetHours(capYen, hourly){
  if (!capYen || !hourly || hourly<=0) return 0;
  return Math.round((capYen/12/hourly)*4)/4;
}

// 月内週インデックス（日曜始まり）
function weekIndexInMonth(ym, day){
  var dow = firstDow(ym);
  return Math.floor((dow + (day-1)) / 7);
}

// 候補日：テキスト制約のみで抽出
function buildCandidateDays(ym, c){
  var [y,m] = ym.split("-").map(Number);
  var dim = daysInMonth(ym);
  var res = [];
  for (var d=1; d<=dim; d++){
    var w = new Date(y, m-1, d).getDay(); // 0日 6土
    if (c.offDates.has(d)) continue;
    if (c.weekdaysOff.has(w) && !c.onDates.has(d)) continue;
    if (c.weekdaysAllowed.size>0 && !c.weekdaysAllowed.has(w) && !c.onDates.has(d)) continue;
    if (c.holidayOff===true){
      var hn = getHolidayNameByDate(ym, d);
      if (hn && !c.onDates.has(d)) continue;
    }
    res.push(d);
  }
  c.onDates.forEach(function(d){ if (d>=1 && d<=dim && res.indexOf(d)===-1) res.push(d); });
  return res.sort(function(a,b){ return a-b; });
}

// 希望優先（onDatesを先頭へ）
function orderByWish(ym, candidates, c){
  var strong = candidates.filter(d=>c.onDates.has(d));
  var rest = candidates.filter(d=>!c.onDates.has(d));
  return strong.concat(rest);
}

// === 核心：標準シフト＆土日UIなしで割付 ===
function planAutoAssignment(ym, c, keepExisting){
  var emp = currentEmployee(); 
  if (!emp) return {entries:[], total:0, target:0, note:"スタッフ未選択"};
  var hourly = Number(emp.wage)||0;

  // 上限金額（希望票優先。『扶養』があればUI選択／なければ103万を既定に）
  var selCap = getSelectedCap();
  var defaultCap = c.mentionFuyou ? (selCap.cap||1030000) : 0;
  var capYen = (c.preferCapYen!=null) ? c.preferCapYen : defaultCap;

  // 月目標
  var targetHours = calcMonthlyTargetHours(capYen, hourly);

  var md = ensureEmpMonth(emp.id, ym);
  var dim = daysInMonth(ym);

  // 既存集計（保持時）
  var existingSum = 0;
  var perWeekDays = {}, perWeekHours = {};
  function weekIdx(d){ return weekIndexInMonth(ym, d); }
  if (keepExisting){
    for (var d=1; d<=dim; d++){
      var r = md[String(d)];
      if (r && r.work && (Number(r.hours)||0)>0){
        var wi = weekIdx(d);
        perWeekDays[wi]  = (perWeekDays[wi]||0) + 1;
        perWeekHours[wi] = (perWeekHours[wi]||0) + Number(r.hours);
        existingSum += Number(r.hours)||0;
      }
    }
  }

  // 候補日
  var cand = buildCandidateDays(ym, c);
  cand = orderByWish(ym, cand, c);

  // 週制限（任意指定）
  var dayLimit   = (c.weeklyDays!=null && isFinite(c.weeklyDays)) ? c.weeklyDays : Infinity;
  var hourLimit  = (c.weeklyHours!=null && isFinite(c.weeklyHours)) ? c.weeklyHours : Infinity;

  var entries = [];
  var filled = existingSum;

  function canPlace(d, put){
    var wi = weekIdx(d);
    var nd = (perWeekDays[wi]||0);
    var nh = (perWeekHours[wi]||0);
    if (nd >= dayLimit && dayLimit !== Infinity) return false;
    if (nh + put > hourLimit && hourLimit !== Infinity) return false;
    return true;
  }
  function place(d, put){
    var wi = weekIdx(d);
    perWeekDays[wi]  = (perWeekDays[wi]||0) + 1;
    perWeekHours[wi] = (perWeekHours[wi]||0) + put;
    entries.push({ day:d, hours: Math.round(put*4)/4 });
    filled += put;
  }

  // ケースA：cap/時給が揃っている → 目標時間に向けて配分
  if (targetHours > 0){
    var remain = Math.max(0, targetHours - existingSum);
    if (remain <= 0) return { entries:[], total:0, target:Math.round(targetHours*4)/4, note:"既存入力で月目標に達しています" };

    var strong = cand.filter(d=>c.onDates.has(d));
    var rest   = cand.filter(d=>!c.onDates.has(d));

    var baseH = isFinite(c.dailyHoursPrefer||NaN) && (c.dailyHoursPrefer||0) > 0 ? Math.min(24, Math.max(0, c.dailyHoursPrefer)) : null;

    // onDatesに先配分
    if (strong.length>0){
      for (var i=0;i<strong.length && remain>0;i++){
        var d = strong[i];
        if (keepExisting){
          var r = md[String(d)];
          if (r && r.work && (Number(r.hours)||0)>0) continue;
        }
        var put = baseH!=null ? Math.min(baseH, remain) : 0;
        if (put>0 && canPlace(d, put)){ place(d, put); remain -= put; }
      }
    }

    // 残りを候補全体で均等配分
    if (remain>0){
      var left = cand.filter(d=>{
        var already = entries.some(e=>e.day===d);
        if (already) return false;
        if (!keepExisting) return true;
        var r = md[String(d)];
        return !(r && r.work && (Number(r.hours)||0)>0);
      });
      if (left.length>0){
        var per = Math.max(0, Math.min(24, Math.round((remain/left.length)*4)/4));
        if (per===0) per = 1;
        for (var j=0;j<left.length && remain>0;j++){
          var d2 = left[j];
          var put2 = Math.min(per, remain);
          if (put2>0 && canPlace(d2, put2)){ place(d2, put2); remain -= put2; }
        }
      }
    }

    return { entries, total: Math.round((filled-existingSum)*4)/4, target: Math.round(targetHours*4)/4, note:"" };
  }

  // ケースB：cap/時給が未設定 → 1日基準時間があり、希望日(onDates)があればそこだけ入れる
  if (isFinite(c.dailyHoursPrefer||NaN) && (c.dailyHoursPrefer||0)>0){
    var base = Math.min(24, Math.max(0, c.dailyHoursPrefer));
    var strongOnly = cand.filter(d=>c.onDates.has(d));
    if (strongOnly.length===0) {
      return { entries:[], total:0, target:0, note:"上限未設定かつ希望日が未指定のため割付なし" };
    }
    for (var k=0;k<strongOnly.length;k++){
      var d3 = strongOnly[k];
      if (keepExisting){
        var r3 = md[String(d3)];
        if (r3 && r3.work && (Number(r3.hours)||0)>0) continue;
      }
      if (canPlace(d3, base)) place(d3, base);
    }
    return { entries, total: Math.round((filled-existingSum)*4)/4, target: Math.round((filled-existingSum)*4)/4, note:"上限未設定：希望日のみ配分" };
  }

  return { entries:[], total:0, target:0, note:"上限金額/時給の設定、または1日基準時間の記載が必要です" };
}

// プレビュー描画
function renderWishPreview(plan){
  var box = $("#wish-preview");
  if (!box) return;
  if (!plan || !plan.entries || plan.entries.length===0){
    box.innerHTML = '<div class="muted">プレビューなし（'+ (plan && plan.note ? plan.note : "条件に合う候補がありません") +'）。</div>';
    return;
  }
  var rows = plan.entries.map(function(e){ return `<tr><td>${e.day}日</td><td style="text-align:right;">${e.hours.toFixed(2)} h</td></tr>`; }).join("");
  var note = plan.note ? `<div class="muted" style="margin-top:.5rem;">${plan.note}</div>` : "";
  box.innerHTML =
    `<table><thead><tr><th>日付</th><th>割付時間</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>合計</td><td style="text-align:right;">${plan.total.toFixed(2)} h</td></tr>
      <tr><td>目標（月上限目安）</td><td style="text-align:right;">${plan.target.toFixed(2)} h</td></tr></tfoot></table>${note}`;
}

// 適用（実際に何件適用したかを返す）
function applyWishPlan(plan, overwriteAll){
  var emp = currentEmployee(); if (!emp) return 0;
  var ym = state.ui.ym;
  var md = ensureEmpMonth(emp.id, ym);

  var applied = 0;
  plan.entries.forEach(function(e){
    md[String(e.day)] = md[String(e.day)] || {work:false,hours:0};
    var r = md[String(e.day)];
    if (!overwriteAll){
      if (r.work && (Number(r.hours)||0)>0) return;
    }
    var beforeH = Number(r.hours)||0, beforeW = !!r.work;
    r.work = true;
    r.hours = e.hours;
    var changed = (!beforeW) || (Math.abs(beforeH - e.hours) > 1e-9);
    if (changed) applied += 1;
  });

  saveState();
  recalcAndRender();
  renderYearSummary();
  return applied;
}
