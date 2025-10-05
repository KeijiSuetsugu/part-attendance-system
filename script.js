// ===== 設定値 =====
var THRESHOLDS = { T103: 1030000, T106: 1060000, T130: 1300000 };
var STORAGE_KEY = "part_attendance_v2";

// 祝日キャッシュ
var HOLIDAY_CACHE_KEY = "holiday_cache_v1";
var HOLIDAY_TTL_DAYS = 30;

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

function normalizeJP(s){
  if (!s) return "";
  s = s.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0)-0xFF10+0x30));
  s = s.replace(/[．｡]/g, ".").replace(/[，､]/g, ",").replace(/[〜～ｰ—–－\-ー]/g, "-");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ===== 祝日キャッシュ管理 =====
var holidayCache = loadHolidayCache();
function loadHolidayCache(){ try{ var raw=localStorage.getItem(HOLIDAY_CACHE_KEY); if(raw) return JSON.parse(raw);}catch(e){} return {years:{},updated:{},source:""}; }
function saveHolidayCache(){ localStorage.setItem(HOLIDAY_CACHE_KEY, JSON.stringify(holidayCache)); }
function updateHolidayStatus(year, loaded, source){
  var el = $("#holiday-status"); if (!el) return;
  el.textContent = loaded ? ("祝日データ：" + year + " 取得済（" + (source==="holidays-jp"?"holidays-jp":"Nager.Date") + "）")
                          : ("祝日データ：" + year + " を取得できませんでした（オフライン？）");
}
function ensureHolidaysForYear(year, cb){
  if (!holidayCache || !holidayCache.years) holidayCache = { years:{}, updated:{}, source:"" };
  var now = Date.now(); var ystr = String(year);
  var have = holidayCache.years[ystr]; var ts = holidayCache.updated ? holidayCache.updated[ystr] : null;
  if (have && ts && ((now - ts)/86400000 < HOLIDAY_TTL_DAYS)){ updateHolidayStatus(year, true, holidayCache.source||"holidays-jp"); cb&&cb(); return; }
  fetchHolidaysJP(year, function(map, src){
    holidayCache.years[ystr]=map; holidayCache.updated[ystr]=Date.now(); holidayCache.source=src; saveHolidayCache(); updateHolidayStatus(year,true,src); cb&&cb();
  }, function(){
    fetchNagerJP(year, function(map, src){
      holidayCache.years[ystr]=map; holidayCache.updated[ystr]=Date.now(); holidayCache.source=src; saveHolidayCache(); updateHolidayStatus(year,true,src); cb&&cb();
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
function migrateV1ToV2(old){
  var firstId = uid();
  var employees=[{id:firstId,name:(old.employee&&old.employee.name)||"",wage:(old.employee&&old.employee.wage)||0}];
  var months={}; months[firstId]=old.months||{};
  return {employees,currentEmpId:firstId,months,ui:{ym:(old.ui&&old.ui.ym)||toYM(new Date()),projMode:"thismonth",customCaps:{a:0,b:0},bulkActiveId:""}};
}
function loadStateOrMigrate(){
  try{var raw2=localStorage.getItem(STORAGE_KEY); if(raw2){ var st=JSON.parse(raw2); if(!st.ui) st.ui={}; if(!st.ui.customCaps) st.ui.customCaps={a:0,b:0}; if(st.ui.bulkActiveId===undefined) st.ui.bulkActiveId=""; return st; }}catch(e){}
  try{var raw1=localStorage.getItem("part_attendance_v1"); if(raw1){ var mig=migrateV1ToV2(JSON.parse(raw1)); saveState(mig); return mig; }}catch(e){}
  var id=uid();
  var fresh={employees:[{id,name:"",wage:0}],currentEmpId:id,months:{},ui:{ym:toYM(new Date()),projMode:"thismonth",customCaps:{a:0,b:0},bulkActiveId:""}};
  saveState(fresh); return fresh;
}
function saveState(s){ localStorage.setItem(STORAGE_KEY, JSON.stringify(s||state)); }

function daysInMonth(ym){ var [y,m]=ym.split("-").map(Number); return new Date(y,m,0).getDate(); }
function firstDow(ym){ var [y,m]=ym.split("-").map(Number); return new Date(y,m-1,1).getDay(); }
function currentEmployee(){ var id=state.currentEmpId; return state.employees.find(e=>e.id===id)||null; }
function ensureEmpMonth(empId, ym){ state.months[empId]=state.months[empId]||{}; state.months[empId][ym]=state.months[empId][ym]||{}; return state.months[empId][ym]; }

// ===== 希望票：ボタンクリック動作公開 =====
window.__parseWishPreview = function(){
  var txt = ($("#wish-text") && $("#wish-text").value) || "";
  var c = parseWishText(txt);
  var plan = planAutoAssignment(state.ui.ym, 6, c, !!($("#wish-keep-existing") && $("#wish-keep-existing").checked));
  renderWishPreview(plan);
  var cap = c.preferCapYen ? ("¥"+c.preferCapYen.toLocaleString()) : (c.mentionFuyou ? "（扶養・UI選択準拠）" : "—");
  var sum = ["上限:"+cap, "1日基準:"+(c.dailyHoursPrefer!=null?(c.dailyHoursPrefer+"h"):"—")].join(" / ");
  var sumEl=$("#wish-summary"); if(sumEl) sumEl.textContent="解析結果 → "+sum;
};

window.__applyFromWish = function(){
  try{
    var txt = ($("#wish-text") && $("#wish-text").value) || "";
    var c = parseWishText(txt);
    var keep = !!($("#wish-keep-existing") && $("#wish-keep-existing").checked);
    var plan = planAutoAssignment(state.ui.ym, 6, c, keep);
    renderWishPreview(plan);
    if (!plan || !plan.entries || plan.entries.length===0){ alert("適用できる候補がありません。時給未設定・条件が厳しすぎ等をご確認ください。"); return; }
    applyWishPlan(plan, !keep, c); // cを渡し、排他指定があれば他日OFF
    var cap = c.preferCapYen ? ("¥"+c.preferCapYen.toLocaleString()) : (c.mentionFuyou ? "（扶養・UI選択準拠）" : "—");
    var sum = ["上限:"+cap, "1日基準:"+(c.dailyHoursPrefer!=null?(c.dailyHoursPrefer+"h"):"—")].join(" / ");
    var sumEl=$("#wish-summary"); if(sumEl) sumEl.textContent="解析結果 → "+sum;
    alert("AI解析の内容を出勤簿へ反映しました。");
  }catch(e){ console.error(e); alert("AI解析中にエラーが発生しました。"); }
};

// ===== 初期化 =====
document.addEventListener("DOMContentLoaded", function(){
  renderEmpTabs();

  var emp=currentEmployee();
  $("#emp-name").value = emp ? (emp.name || "") : "";
  $("#emp-wage").value = emp ? (emp.wage || "") : "";
  $("#month-picker").value = state.ui.ym;
  $("#proj-mode").value = state.ui.projMode || "thismonth";
  var yp=$("#year-picker"); if(yp) yp.value=getYearFromYM(state.ui.ym);

  onClick("save-emp", function(){
    var e=currentEmployee(); if(!e) return;
    e.name = ($("#emp-name").value || "").trim();
    e.wage = Number($("#emp-wage").value) || 0;
    $("#emp-msg").textContent="従業員情報を保存しました。";
    saveState(); renderTotals(); syncSimulatorWage(); renderYearSummary(); updateCapSummary();
  });

  onClick("reset-data", function(){
    if(!confirm("保存データをすべて削除します。よろしいですか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    state=loadStateOrMigrate();
    var cur=currentEmployee();
    $("#emp-name").value = cur ? (cur.name || "") : "";
    $("#emp-wage").value = cur ? (cur.wage || "") : "";
    $("#emp-msg").textContent="データを初期化しました。";
    $("#month-picker").value=state.ui.ym; $("#proj-mode").value=state.ui.projMode;
    if(yp) yp.value=getYearFromYM(state.ui.ym);
    renderEmpTabs(); recalcAndRender(); syncSimulatorWage(); renderYearSummary(); updateBulkRangeLimits(); updateCapSummary(); applyBulkActiveFromState();
  });

  onClick("prev-month", function(){
    var [y,m]=state.ui.ym.split("-").map(Number); var d=new Date(y,m-1,1); d.setMonth(d.getMonth()-1);
    state.ui.ym=toYM(d); $("#month-picker").value=state.ui.ym; if(yp) yp.value=getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateBulkRangeLimits(); updateCapSummary(); });
  });
  onClick("next-month", function(){
    var [y,m]=state.ui.ym.split("-").map(Number); var d=new Date(y,m-1,1); d.setMonth(d.getMonth()+1);
    state.ui.ym=toYM(d); $("#month-picker").value=state.ui.ym; if(yp) yp.value=getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateBulkRangeLimits(); updateCapSummary(); });
  });
  var mp=$("#month-picker");
  mp && mp.addEventListener("change", function(e){
    state.ui.ym=e.target.value; if(yp) yp.value=getYearFromYM(state.ui.ym);
    saveState(); ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){ recalcAndRender(); renderYearSummary(); updateBulkRangeLimits(); updateCapSummary(); });
  });

  onClick("add-emp", function(){
    var name=prompt("スタッフ名を入力してください"); if(!name) return;
    var wageStr=prompt("時給（円）を入力してください（例：1200）"); var wage=Number(wageStr);
    var id=uid(); state.employees.push({id,name:name.trim(),wage:isFinite(wage)?wage:0});
    state.currentEmpId=id; saveState(); renderEmpTabs();
    $("#emp-name").value=name.trim(); $("#emp-wage").value=isFinite(wage)?wage:0;
    $("#emp-msg").textContent="新しいスタッフを追加しました。";
    recalcAndRender(); syncSimulatorWage(); renderYearSummary(); updateCapSummary();
  });

  onClick("del-emp", function(){
    var e=currentEmployee(); if(!e) return;
    if(!confirm("「"+(e.name||"（無名）")+"」を削除します。よろしいですか？")) return;
    var idx=state.employees.findIndex(x=>x.id===e.id);
    if(idx>=0) state.employees.splice(idx,1);
    if(state.months[e.id]) delete state.months[e.id];
    if(state.employees.length===0){ var id=uid(); state.employees.push({id,name:"",wage:0}); state.currentEmpId=id; }
    else { var next=state.employees[Math.max(0,idx-1)]; state.currentEmpId=next.id; }
    saveState(); renderEmpTabs();
    var cur=currentEmployee(); $("#emp-name").value=cur?(cur.name||""):""; $("#emp-wage").value=cur?(cur.wage||0):0;
    $("#emp-msg").textContent="スタッフを削除しました。";
    recalcAndRender(); syncSimulatorWage(); renderYearSummary(); updateCapSummary();
  });

  onClick("move-left", function(){
    var id=state.currentEmpId, idx=state.employees.findIndex(e=>e.id===id);
    if(idx>0){ var t=state.employees[idx-1]; state.employees[idx-1]=state.employees[idx]; state.employees[idx]=t; saveState(); renderEmpTabs(); }
  });
  onClick("move-right", function(){
    var id=state.currentEmpId, idx=state.employees.findIndex(e=>e.id===id);
    if(idx>=0 && idx<state.employees.length-1){ var t=state.employees[idx+1]; state.employees[idx+1]=state.employees[idx]; state.employees[idx]=t; saveState(); renderEmpTabs(); }
  });

  var pm=$("#proj-mode");
  pm && pm.addEventListener("change", function(e){ state.ui.projMode=e.target.value; saveState(); renderTotals(); });

  // 年間サマリー
  var yrPick=$("#year-picker");
  yrPick && yrPick.addEventListener("change", renderYearSummary);
  onClick("refresh-summary", renderYearSummary);

  // 前月コピー
  onClick("copy-prev-fill", function(){ copyPrevMonth(false); });
  onClick("copy-prev-overwrite", function(){ if(confirm("前月の内容で今月をすべて上書きします。よろしいですか？")) copyPrevMonth(true); });

  // カスタムライン
  var a=$("#th-custom-a"), b=$("#th-custom-b");
  if(a) a.addEventListener("input", function(){ state.ui.customCaps.a=Number(a.value)||0; saveState(); renderTotals(); });
  if(b) b.addEventListener("input", function(){ state.ui.customCaps.b=Number(b.value)||0; saveState(); renderTotals(); });

  // 出力
  onClick("export-csv-month", exportCsvThisMonth);
  onClick("export-csv-all", exportCsvAll);
  onClick("export-xlsx-month", exportXlsxThisMonth);

  // 初期描画
  ensureHolidaysForYear(getYearFromYM(state.ui.ym), function(){
    if($("#th-custom-a")) $("#th-custom-a").value=state.ui.customCaps.a||"";
    if($("#th-custom-b")) $("#th-custom-b").value=state.ui.customCaps.b||"";
    recalcAndRender(); renderYearSummary(); updateBulkRangeLimits(); updateCapSummary(); applyBulkActiveFromState();
  });

  // 希望票ボタン（保険）
  onClick("wish-parse-btn", function(){ if(window.__parseWishPreview) window.__parseWishPreview(); });
  onClick("wish-apply", function(){ if(window.__applyFromWish) window.__applyFromWish(); });
});

// ===== タブ描画 =====
function renderEmpTabs(){
  var wrap=$("#emp-tabs"); if(!wrap) return;
  wrap.innerHTML="";
  state.employees.forEach(function(e){
    var b=document.createElement("button");
    b.className="tab"+(e.id===state.currentEmpId?" active":"");
    b.textContent=e.name||"（無名）";
    b.title=(e.name||"（無名）")+" / 時給: "+((e.wage!=null?e.wage:0)+"円");
    b.addEventListener("click", function(){
      state.currentEmpId=e.id; saveState();
      $("#emp-name").value=e.name||""; $("#emp-wage").value=e.wage||0; $("#emp-msg").textContent="";
      recalcAndRender(); syncSimulatorWage(); renderYearSummary(); renderEmpTabs(); updateCapSummary();
    });
    wrap.appendChild(b);
  });
}

// ===== レンダリング =====
function recalcAndRender(){ renderCalendar(); renderTotals(); }

function renderCalendar(){
  var ym=state.ui.ym, empId=state.currentEmpId;
  var root=$("#calendar"); if(!root) return;
  root.innerHTML="";

  ["日","月","火","水","木","金","土"].forEach(function(h){
    var el=document.createElement("div"); el.className="day-head"; el.textContent=h; root.appendChild(el);
  });

  var dow=firstDow(ym), dim=daysInMonth(ym);
  var monthData=ensureEmpMonth(empId, ym);
  var y=getYearFromYM(ym), m=Number(ym.split("-")[1]);

  for(var i=0;i<dow;i++){ var empty=document.createElement("div"); empty.className="day-cell"; empty.style.visibility="hidden"; root.appendChild(empty); }

  for(var day=1; day<=dim; day++){
    var key=String(day);
    if(!monthData[key]) monthData[key]={work:false,hours:0};
    var rec=monthData[key];

    var cell=document.createElement("div"); cell.className="day-cell";

    var title=document.createElement("div"); title.className="day-title";
    var monthBadge=document.createElement("span"); monthBadge.className="badge"; monthBadge.textContent=state.ui.ym;
    var daySpan=document.createElement("span"); daySpan.textContent=day+"日";
    title.appendChild(daySpan); title.appendChild(monthBadge);

    var hname=getHolidayNameByDate(ym, day);
    if(hname){
      var hbadge=document.createElement("span"); hbadge.className="badge holiday"; hbadge.title=hname; hbadge.textContent=hname;
      title.appendChild(hbadge);
      if(!rec.work && (!rec.hours || Number(rec.hours)===0)){ rec.work=false; rec.hours=0; }
    }
    cell.appendChild(title);

    var tog=document.createElement("div");
    tog.className="toggle "+(rec.work?"on":"off");
    tog.textContent=rec.work?"出勤":"休み";
    tog.addEventListener("click", (function(recRef){
      return function(){ recRef.work=!recRef.work; if(!recRef.work) recRef.hours=0; saveState(); recalcAndRender(); };
    })(rec));
    cell.appendChild(tog);

    var timeRow=document.createElement("div"); timeRow.className="time-row";
    var input=document.createElement("input");
    input.type="number"; input.step="0.25"; input.min="0"; input.max="24";
    input.placeholder="勤務時間（h）"; input.inputMode="decimal"; input.autocomplete="off";
    input.value=rec.work?String(rec.hours||""):""; input.disabled=!rec.work;

    var pill=document.createElement("span"); pill.className="val-pill";
    pill.textContent=(rec.work && rec.hours>0)?(Number(rec.hours).toFixed(2)+" h"):"";

    var stepBox=document.createElement("div"); stepBox.className="stepper";
    function applyValue(newVal){
      var v=clamp(newVal,0,24); v=Math.round(v*4)/4;
      rec.hours=v; input.value=v?String(v):""; pill.textContent=(rec.work && v>0)?(v.toFixed(2)+" h"):"";
      saveState(); renderTotals(); renderYearSummary();
    }
    function makeStep(label, delta){
      var b=document.createElement("button"); b.type="button"; b.className="btn-step"; b.textContent=label;
      b.addEventListener("click", function(){ if(!rec.work) return; var current=Number((input.value||"").replace(",", ".")); if(!isFinite(current)) current=0; applyValue(current+delta); });
      return b;
    }
    stepBox.appendChild(makeStep("−0.25",-0.25));
    stepBox.appendChild(makeStep("+0.25",+0.25));
    stepBox.appendChild(makeStep("+1.0",+1.0));

    input.addEventListener("input", function(){ var raw=(input.value||"").replace(",", "."); var v=Number(raw); if(!isFinite(v)) v=0; applyValue(v); });

    var help=document.createElement("span"); help.className="help"; help.textContent="0.25=15分 / 0.5=30分";

    timeRow.appendChild(input); timeRow.appendChild(pill); timeRow.appendChild(stepBox); timeRow.appendChild(help);
    cell.appendChild(timeRow);

    root.appendChild(cell);
  }
}

function renderTotals(){
  var ym=state.ui.ym, emp=currentEmployee();
  var wage=emp ? Number(emp.wage)||0 : 0;
  var empId=emp ? emp.id : "";
  var mdAll=state.months[empId]||{};
  var monthData=mdAll[ym]||{};

  var sumHours=0;
  Object.keys(monthData).forEach(k=>{ var r=monthData[k]; if(r && r.work) sumHours+=Number(r.hours)||0; });
  var sumWage=sumHours*wage;

  var projMode=state.ui.projMode||"thismonth";
  var projAnnual=0;
  if(projMode==="thismonth"){ projAnnual=sumWage*12; }
  else{
    var [year,month]=ym.split("-").map(Number);
    var ytdSum=0,counted=0;
    for(var m=1;m<=month;m++){
      var ym2=year+"-"+pad2(m); var md2=mdAll[ym2]||{};
      var mh=0; Object.keys(md2).forEach(k=>{ var rr=md2[k]; if(rr && rr.work) mh+=Number(rr.hours)||0; });
      var mw=mh*wage; if(mw>0){ ytdSum+=mw; counted++; }
    }
    var avg=counted>0 ? (ytdSum/counted) : 0; var remain=12-month; projAnnual=ytdSum+avg*remain;
  }

  $("#sum-hours").textContent=sumHours.toFixed(2)+" h";
  $("#sum-wage").textContent=fmtJPY(sumWage);
  $("#proj-annual").textContent=fmtJPY(projAnnual);

  setBar("bar-103","pct-103",projAnnual,THRESHOLDS.T103);
  setBar("bar-106","pct-106",projAnnual,THRESHOLDS.T106);
  setBar("bar-130","pct-130",projAnnual,THRESHOLDS.T130);
  setBar("bar-custom-a","pct-custom-a",projAnnual,state.ui.customCaps.a||0);
  setBar("bar-custom-b","pct-custom-b",projAnnual,state.ui.customCaps.b||0);

  var msgs=[];
  if(projAnnual>=THRESHOLDS.T130) msgs.push("130万円ラインを超える見込みです。");
  else if(projAnnual>=THRESHOLDS.T130*0.9) msgs.push("130万円ラインの90%を超えています（要注意）。");
  if(projAnnual>=THRESHOLDS.T106 && projAnnual<THRESHOLDS.T130) msgs.push("106万円ラインを超える可能性。条件により社保加入対象の場合があります。");
  else if(projAnnual>=THRESHOLDS.T106*0.9 && projAnnual<THRESHOLDS.T106) msgs.push("106万円ラインの90%を超えています（要注意）。");
  if(projAnnual>=THRESHOLDS.T103 && projAnnual<THRESHOLDS.T106) msgs.push("103万円ライン超の見込み。");
  else if(projAnnual>=THRESHOLDS.T103*0.9 && projAnnual<THRESHOLDS.T103) msgs.push("103万円ラインの90%を超えています（要注意）。");
  var warn=$("#warn"); if(warn) warn.textContent=msgs.join(" ");

  updateCapSummary();
  syncSimulatorWage();
  recalcSimulator();
}
function setBar(barId, pctId, value, cap){
  var bar=$("#"+barId), pct=$("#"+pctId);
  var p=(cap>0)?Math.min(100,(value/cap)*100):0;
  if(bar) bar.value=p;
  if(pct) pct.textContent=Math.round(p)+"%";
}

// ===== 扶養シミュ =====
function onCapChange(){ var sel=$("#cap-select"), custom=$("#cap-custom"); if(!sel||!custom) return; custom.disabled=(sel.value!=="custom"); recalcSimulator(); }
function syncSimulatorWage(){ var wage=0; var emp=currentEmployee(); if(emp) wage=Number(emp.wage)||0; var w=$("#cap-wage"); if(w) w.value=wage||""; }
function getSelectedCap(){
  var sel=$("#cap-select")?$("#cap-select").value:""; var label="",cap=0;
  if(sel==="custom"){ var v=Number(($("#cap-custom")&&$("#cap-custom").value)||0); cap=isFinite(v)&&v>0?v:0; label=cap>0?"カスタム":"カスタム（未入力）"; }
  else if(sel){ cap=Number(sel)||0; label=(cap===1030000)?"103万円":(cap===1060000)?"106万円":(cap===1300000)?"130万円":"上限"; }
  return {cap,label};
}
function updateCapSummary(){
  var box=$("#sim-cap-summary"); if(!box) return;
  var wage=Number(($("#cap-wage")&&$("#cap-wage").value)||0);
  var info=getSelectedCap();
  if(!info.cap){ box.textContent="シミュレーター設定：—"; return; }
  var hoursText="時給未設定";
  if(wage>0){ var perMonth=info.cap/12/wage; var rounded=Math.round(perMonth*4)/4; hoursText=rounded.toFixed(2)+" h / 月"; }
  box.innerHTML='シミュレーター設定：<strong>'+fmtJPY(info.cap)+'</strong> / 年（'+info.label+'） → 月上限 <strong>'+hoursText+'</strong>';
}
function recalcSimulator(){
  var selEl=$("#cap-select"), custEl=$("#cap-custom"), wageEl=$("#cap-wage"), out=$("#cap-hours");
  if(!selEl||!wageEl||!out) return;
  var sel=selEl.value, customYen=custEl?Number(custEl.value):0, wage=Number(wageEl.value);
  var cap=(sel==="custom")?((isFinite(customYen)&&customYen>0)?customYen:0):Number(sel)||0;
  var hours=""; if(cap>0 && wage>0){ var perMonth=cap/12/wage; var rounded=Math.round(perMonth*4)/4; hours=rounded.toFixed(2)+" h / 月"; }
  out.value=hours; updateCapSummary();
}

// ===== 年間サマリー =====
function calcMonthWage(emp, year, month){
  var ym=year+"-"+pad2(month);
  var mdAll=state.months[emp?emp.id:""]||{};
  var md=mdAll[ym]||{};
  var hours=0; Object.keys(md).forEach(k=>{ var r=md[k]; if(r && r.work) hours+=Number(r.hours)||0; });
  var wage=emp?Number(emp.wage)||0:0;
  return {hours, amount:hours*wage};
}
function renderYearSummary(){
  var tableWrap=$("#year-summary"); if(!tableWrap) return;
  var emp=currentEmployee();
  var yrEl=$("#year-picker"); var year=yrEl ? (Number(yrEl.value)||getYearFromYM(state.ui.ym)) : getYearFromYM(state.ui.ym);
  var months=["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  var html='<table class="year-table"><thead><tr><th class="month">月</th>';
  months.forEach(m=>html+="<th>"+m+"</th>"); html+="<th>合計</th></tr></thead><tbody>";
  html+='<tr><th class="month">金額</th>'; var yearSum=0;
  for(var m=1;m<=12;m++){ var a=calcMonthWage(emp,year,m).amount; yearSum+=a; html+="<td>"+(a>0?fmtJPY(a):"—")+"</td>"; }
  html+="<td>"+fmtJPY(yearSum)+"</td></tr>";
  html+='<tr><th class="month">時間(h)</th>'; var yearHours=0;
  for(var mm=1;mm<=12;mm++){ var h=calcMonthWage(emp,year,mm).hours; yearHours+=h; html+="<td>"+(h>0?h.toFixed(2):"—")+"</td>"; }
  html+="<td>"+yearHours.toFixed(2)+"</td></tr>";
  html+="</tbody></table>";
  tableWrap.innerHTML=html;
}

// ===== CSV / Excel =====
function collectMonthRows(emp, ym){
  var [y,m]=ym.split("-").map(Number);
  var mdAll=state.months[emp?emp.id:""]||{};
  var md=mdAll[ym]||{};
  var wage=emp?Number(emp.wage)||0:0;
  var dim=daysInMonth(ym);

  var rows=[]; var sumH=0,sumW=0;
  rows.push(["Staff",(emp?emp.name:"")||"","Year-Month",ym,"Hourly",wage]);
  rows.push(["Date","Weekday","HolidayName","Work","Hours","DayWage"]);
  for(var d=1; d<=dim; d++){
    var r=md[String(d)]||{work:false,hours:0};
    var hours=r.work?(Number(r.hours)||0):0;
    var w=hours*wage;
    var hname=getHolidayNameByDate(ym,d);
    rows.push([ymd(ym,d),youbi(y,m,d),hname||"",r.work?"出勤":"休み",hours,w]);
    sumH+=hours; sumW+=w;
  }

  var projMode=state.ui.projMode||"thismonth"; var projAnnual=0;
  if(projMode==="thismonth") projAnnual=sumW*12;
  else{
    var ytdSum=0,cnt=0;
    for(var mm=1; mm<=m; mm++){
      var ym2=y+"-"+pad2(mm);
      var md2=mdAll[ym2]||{};
      var mh=0; Object.keys(md2).forEach(k=>{ var rr=md2[k]; if(rr && rr.work) mh+=Number(rr.hours)||0; });
      var mw=mh*wage; if(mw>0){ ytdSum+=mw; cnt++; }
    }
    var avg=cnt>0?(ytdSum/cnt):0; var remain=12-m; projAnnual=ytdSum+avg*remain;
  }
  rows.push([]); rows.push(["SumHours",sumH,"SumWage",sumW,"ProjectedAnnual",projAnnual,"Mode",projMode]);
  return rows;
}
function download(filename, content, mime){
  if(!mime) mime="text/plain;charset=utf-8";
  try{
    var blob=new Blob([content],{type:mime});
    var url=URL.createObjectURL(blob);
    var a=document.createElement("a"); a.href=url; a.download=filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); document.body.removeChild(a); }, 0);
  }catch(e){ alert("ダウンロードに失敗しました。"); throw e; }
}
function exportCsvThisMonth(){
  var emp=currentEmployee(); var ym=state.ui.ym; var rows=collectMonthRows(emp,ym);
  var BOM="\uFEFF";
  var csv=rows.map(r=>r.map(v=>{ var s=(v==null?"":String(v)); return /[",\n]/.test(s)?('"'+s.replace(/"/g,'""')+'"'):s; }).join(",")).join("\n");
  download(((emp&&emp.name)||"noname")+"_"+ym+".csv",BOM+csv,"text/csv;charset=utf-8");
}
function exportCsvAll(){
  var rows=[["Staff","Year-Month","Date","Weekday","HolidayName","Work","Hours","Hourly","DayWage"]];
  state.employees.forEach(emp=>{
    var empMonths=state.months[emp.id]||{};
    Object.keys(empMonths).sort().forEach(ym=>{
      var [y,m]=ym.split("-").map(Number); var dim=daysInMonth(ym); var wage=Number(emp.wage)||0;
      for(var d=1; d<=dim; d++){
        var r=(empMonths[ym][String(d)])||{work:false,hours:0};
        var hours=r.work?(Number(r.hours)||0):0; var w=hours*wage; var hname=getHolidayNameByDate(ym,d);
        rows.push([emp.name||"（無名）",ym,ymd(ym,d),youbi(y,m,d),hname||"",r.work?"出勤":"休み",hours,wage,w]);
      }
    });
  });
  var BOM="\uFEFF";
  var csv=rows.map(r=>r.map(v=>{ var s=(v==null?"":String(v)); return /[",\n]/.test(s)?('"'+s.replace(/"/g,'""')+'"'):s; }).join(",")).join("\n");
  download("all_staff_all_months.csv",BOM+csv,"text/csv;charset=utf-8");
}
function ensureXLSX(ready){
  if(window.XLSX){ ready(); return; }
  var s=document.createElement("script");
  s.src="https://cdn.jsdelivr.net/npm/xlsx@0.20.3/dist/xlsx.full.min.js";
  s.onload=ready;
  s.onerror=function(){
    var s2=document.createElement("script");
    s2.src="https://unpkg.com/xlsx@0.20.3/dist/xlsx.full.min.js";
    s2.onload=ready;
    s2.onerror=function(){ alert("Excel用ライブラリの読み込みに失敗しました。CSV出力をご利用ください。"); };
    document.head.appendChild(s2);
  };
  document.head.appendChild(s);
}
function exportXlsxThisMonth(){
  var emp=currentEmployee(); var ym=state.ui.ym; var rows=collectMonthRows(emp,ym);
  ensureXLSX(function(){
    try{
      var ws=XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"]=[{wch:12},{wch:6},{wch:12},{wch:6},{wch:8},{wch:12}];
      var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Timesheet");
      var fname=(((emp&&emp.name)||"noname")+"_"+ym+".xlsx");
      if(XLSX.writeFileXLSX) XLSX.writeFileXLSX(wb, fname); else XLSX.writeFile(wb, fname);
    }catch(e){ console.error(e); alert("Excelファイルの作成に失敗しました。"); }
  });
}

// =====（廃UIの無害化）=====
function onBulkScopeChange(){}
function updateBulkRangeLimits(){}
function applyBulkActiveFromState(){}
function syncSimulatorWage(){}
function updateCapSummary(){}
function recalcSimulator(){}

// ===== 前月→今月 コピー =====
function getPrevYM(ym){ var [y,m]=ym.split("-").map(Number); m-=1; if(m===0){ y-=1; m=12; } return y+"-"+pad2(m); }
function isEmptyDay(rec){ if(!rec) return true; if(rec.work) return false; var h=Number(rec.hours||0); return h===0; }
function copyPrevMonth(overwrite){
  var curYM=state.ui.ym, prevYM=getPrevYM(curYM), emp=currentEmployee(); if(!emp){ alert("スタッフが選択されていません。"); return; }
  var empId=emp.id, mdPrev=ensureEmpMonth(empId, prevYM), mdCur=ensureEmpMonth(empId, curYM);
  var dimPrev=daysInMonth(prevYM), dimCur=daysInMonth(curYM), limit=Math.min(dimPrev, dimCur);
  var hasData=false; for(var d=1; d<=dimPrev; d++){ var r=mdPrev[String(d)]; if(r && (r.work || (r.hours && Number(r.hours)>0))){ hasData=true; break; } }
  if(!hasData){ alert("前月にコピーできるデータが見つかりません。"); return; }
  for(var day=1; day<=limit; day++){
    var p=mdPrev[String(day)]||{work:false,hours:0};
    mdCur[String(day)]=mdCur[String(day)]||{work:false,hours:0};
    var c=mdCur[String(day)];
    if(overwrite){ c.work=!!p.work; c.hours=p.work?(Number(p.hours)||0):0; }
    else { if(isEmptyDay(c)){ c.work=!!p.work; c.hours=p.work?(Number(p.hours)||0):0; } }
  }
  saveState(); recalcAndRender(); renderYearSummary(); alert("前月の内容を今月へコピーしました。");
}

// === 希望票解析 & 自動割付（強化） ===
function toNumberSafe(s){ if(!s) return NaN; s=normalizeJP(String(s)); s=s.replace(/,/g,"."); return Number(s.replace(/[^\d.]/g,'')); }

var JP_WEEK = { "日":0, "月":1, "火":2, "水":3, "木":4, "金":5, "土":6 };

// 「のみ/だけ/以外/平日のみ」対応（exclusive=trueで他曜日OFF）
function extractWeekdayRule(text){
  var allowed=new Set(), off=new Set(), exclusive=false;
  var weekChars="日月火水木金土";
  function strToDays(str){
    var s=new Set(); for(var i=0;i<str.length;i++){ var ch=str[i]; var idx=weekChars.indexOf(ch); if(idx>=0) s.add(idx); }
    return s;
  }
  var mOnly=text.match(/([日月火水木金土][日月火水木金土・,\/と]*)\s*(?:のみ|だけ)\s*(?:出勤|勤務|OK|可)?/);
  if(mOnly){ allowed=strToDays(mOnly[1].replace(/[・,\/と]/g,"")); exclusive=true; return {allowed,off,exclusive}; }
  var mExcept=text.match(/([日月火水木金土][日月火水木金土・,\/と]*)\s*以外.*?(?:休|不可|NG|出勤不可)?/);
  if(mExcept){ allowed=strToDays(mExcept[1].replace(/[・,\/と]/g,"")); exclusive=true; return {allowed,off,exclusive}; }
  if(/平日(?:のみ|だけ)?/.test(text)){ allowed=new Set([1,2,3,4,5]); exclusive=true; }
  if(/土日.*休/.test(text)){ off.add(0); off.add(6); }
  var mCan=text.match(/([日月火水木金土][日月火水木金土・,\/と]*)\s*(?:は)?\s*(?:出勤|勤務|OK|可|希望)/);
  if(mCan){ allowed=strToDays(mCan[1].replace(/[・,\/と]/g,"")); }
  return {allowed,off,exclusive};
}

function parseWishText(raw){
  var text=normalizeJP(raw||"");
  var c={
    preferCapYen:null,
    mentionFuyou:/(扶養.*(範囲|内)|扶養内)/.test(text),
    weekendPolicy:null,
    holidayOff:null,
    dailyHoursPrefer:null,
    weeklyDays:null,
    weeklyHours:null,
    weekdaysAllowed:new Set(),
    weekdaysOff:new Set(),
    onDates:new Set(),
    offDates:new Set(),
    __exclusiveAllowed:false
  };
  if(/130\s*万|1,?300,?000/.test(text)) c.preferCapYen=1300000;
  else if(/106\s*万|1,?060,?000/.test(text)) c.preferCapYen=1060000;
  else if(/103\s*万|1,?030,?000/.test(text)) c.preferCapYen=1030000;

  if(/祝日.*休/.test(text)) c.holidayOff=true;
  if(/祝日.*可|祝日.*OK/.test(text)) c.holidayOff=false;

  var mHours=text.match(/(?:勤務時間|1日|一日)?\s*([0-9]+(?:\.[0-9]+)?)\s*時間/);
  if(mHours) c.dailyHoursPrefer=toNumberSafe(mHours[1]);
  var mH2=text.match(/([0-9]+(?:\.[0-9]+)?)\s*h/i);
  if(!c.dailyHoursPrefer && mH2) c.dailyHoursPrefer=toNumberSafe(mH2[1]);

  var mSpan=text.match(/(\d{1,2})(?::(\d{2}))?\s*[-~]\s*(\d{1,2})(?::(\d{2}))?/);
  if(mSpan){
    var sH=toNumberSafe(mSpan[1]), sM=toNumberSafe(mSpan[2]||0);
    var eH=toNumberSafe(mSpan[3]), eM=toNumberSafe(mSpan[4]||0);
    var dur=Math.max(0,(eH*60+eM)-(sH*60+sM))/60; if(dur>0) c.dailyHoursPrefer=Math.round(dur*4)/4;
  }

  var mWDays=text.match(/週\s*([0-9]+)\s*日/); if(mWDays) c.weeklyDays=toNumberSafe(mWDays[1]);
  var mWHours=text.match(/週\s*([0-9]+(?:\.[0-9]+)?)\s*時間/); if(mWHours) c.weeklyHours=toNumberSafe(mWHours[1]);

  var wd=extractWeekdayRule(text); c.weekdaysAllowed=wd.allowed; c.weekdaysOff=wd.off; c.__exclusiveAllowed=!!wd.exclusive;

  var reDay=/(\d{1,2})\s*日/g, m;
  while((m=reDay.exec(text))!==null){
    var d=toNumberSafe(m[1]); var around=text.slice(Math.max(0,m.index-8), m.index+8);
    if(/休|不可|NG/.test(around)) c.offDates.add(d);
    if(/入れ|希望|OK|出勤/.test(around)) c.onDates.add(d);
  }
  return c;
}

function calcMonthlyTargetHours(capYen, hourly){ if(!capYen||!hourly||hourly<=0) return 0; return Math.round((capYen/12/hourly)*4)/4; }
function weekIndexInMonth(ym, day){ var dow=firstDow(ym); return Math.floor((dow+(day-1))/7); }

function buildCandidateDays(ym, constraints, weekendPolicyDefault, holidayOffDefault){
  var [y,m]=ym.split("-").map(Number);
  var dim=daysInMonth(ym);
  var res=[];
  var weekendPolicy=(constraints.weekendPolicy!=null)?constraints.weekendPolicy:weekendPolicyDefault;
  var holidayOff=(constraints.holidayOff!=null)?constraints.holidayOff:holidayOffDefault;

  for(var d=1; d<=dim; d++){
    var w=new Date(y,m-1,d).getDay(); var weekend=(w===0||w===6);

    if(constraints.weekdaysOff.has(w)) continue;
    if(constraints.weekdaysAllowed.size>0 && !constraints.weekdaysAllowed.has(w)){
      if(!constraints.onDates.has(d)) continue;
    }
    if(weekend && weekendPolicy!=="on" && !constraints.onDates.has(d)) continue;

    if(holidayOff){
      var hn=getHolidayNameByDate(ym,d);
      if(hn && !constraints.onDates.has(d)) continue;
    }
    if(constraints.offDates.has(d)) continue;

    res.push(d);
  }
  constraints.onDates.forEach(function(d){ var dim2=daysInMonth(ym); if(d>=1 && d<=dim2 && res.indexOf(d)===-1) res.push(d); });
  return res.sort(function(a,b){ return a-b; });
}

function planAutoAssignment(ym, standardHours, constraints, keepExisting){
  var emp=currentEmployee(); if(!emp) return {entries:[],total:0,target:0,note:"スタッフ未選択"};
  var wage=Number(emp.wage)||0;
  var selCap = (typeof getSelectedCap==="function") ? getSelectedCap() : {cap:0};
  var capYen=constraints.preferCapYen || (constraints.mentionFuyou ? (selCap.cap||1030000) : (selCap.cap||0));
  var target=calcMonthlyTargetHours(capYen,wage);
  var md=ensureEmpMonth(emp.id, ym);
  var dim=daysInMonth(ym);

  var existing=0;
  if(keepExisting){
    for(var d=1; d<=dim; d++){ var r=md[String(d)]; if(r && r.work) existing+=Number(r.hours)||0; }
  }
  var remain=Math.max(0,target-existing);

  var candidates=buildCandidateDays(ym, constraints, "off", (constraints.holidayOff===true));
  var baseH=constraints.dailyHoursPrefer || standardHours || 6; baseH=Math.max(0, Math.min(24, Math.round(baseH*4)/4));
  var weeklyLimit=constraints.weeklyDays || Infinity;
  var perWeekCount={}; var entries=[]; var filled=0;

  function hasExisting(d){ if(!keepExisting) return false; var r=md[String(d)]; return r && r.work && (Number(r.hours)||0)>0; }

  for(var i=0;i<candidates.length;i++){
    var d=candidates[i]; if(hasExisting(d)) continue;
    var wi=weekIndexInMonth(ym,d);
    perWeekCount[wi]=perWeekCount[wi]||0; if(perWeekCount[wi]>=weeklyLimit) continue;

    var put=baseH;
    if(target>0){ put=Math.min(baseH, Math.max(0, remain - filled)); }
    if(put<=0 && target>0) break;

    entries.push({day:d, hours: Math.round(put*4)/4});
    perWeekCount[wi]+=1; filled+=put;
  }
  return {entries,total:Math.round(filled*4)/4,target:target,note:""};
}

function renderWishPreview(plan){
  var box=$("#wish-preview"); if(!box) return;
  if(!plan || !plan.entries || plan.entries.length===0){ box.innerHTML='<div class="muted">プレビューなし（候補がない／既存で満たす等）。</div>'; return; }
  var rows=plan.entries.map(e=>`<tr><td>${e.day}日</td><td style="text-align:right;">${e.hours.toFixed(2)} h</td></tr>`).join("");
  box.innerHTML=`<table><thead><tr><th>日付</th><th>割付時間</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td>合計</td><td style="text-align:right;">${plan.total.toFixed(2)} h</td></tr><tr><td>目標（月上限目安）</td><td style="text-align:right;">${plan.target.toFixed(2)} h</td></tr></tfoot></table>`;
}

// ★適用：排他的曜日指定（「のみ/だけ/以外/平日のみ」）かつ上書きONなら、他日は強制で休みにリセット
function applyWishPlan(plan, overwriteAll, constraints){
  var emp=currentEmployee(); if(!emp) return;
  var ym=state.ui.ym;
  var md=ensureEmpMonth(emp.id, ym);
  var dim=daysInMonth(ym);

  var setOthersOff = !!(overwriteAll && constraints && constraints.__exclusiveAllowed);

  if(setOthersOff){
    for(var d=1; d<=dim; d++){
      md[String(d)] = md[String(d)] || {work:false,hours:0};
      md[String(d)].work=false; md[String(d)].hours=0;
    }
  }

  plan.entries.forEach(function(e){
    md[String(e.day)] = md[String(e.day)] || {work:false,hours:0};
    var r=md[String(e.day)];
    if(!overwriteAll){
      if(r.work && (Number(r.hours)||0)>0) return;
    }
    r.work=true; r.hours=e.hours;
  });

  saveState(); recalcAndRender(); renderYearSummary();
}
