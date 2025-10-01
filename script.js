// ===== 設定値 =====
const THRESHOLDS = { T103: 1030000, T106: 1060000, T130: 1300000 };
const STORAGE_KEY = "part_attendance_v2"; // v2構造

// ===== ユーティリティ =====
const $ = (sel) => document.querySelector(sel);
const fmtJPY = (n) => "¥" + Math.round(n).toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const uid = () => "emp-" + Math.random().toString(36).slice(2, 9);
const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (ym, d) => `${ym}-${pad2(d)}`;
const youbi = (y, m, d) => ["日","月","火","水","木","金","土"][new Date(y, m-1, d).getDay()];
const isWeekend = (y, m, d) => {
  const w = new Date(y, m-1, d).getDay(); // 0=日,6=土
  return w === 0 || w === 6;
};

// ===== 状態（v2構造） =====
// state = { employees:[{id,name,wage}], currentEmpId:"", months:{ [empId]:{ [ym]:{ "1":{work,hours}, ... } } }, ui:{ym:"YYYY-MM", projMode:"thismonth"} }
let state = loadStateOrMigrate();

// ==== 旧v1→v2 移行 ====
function migrateV1ToV2(old) {
  const firstId = uid();
  const employees = [{ id: firstId, name: old.employee?.name || "", wage: old.employee?.wage || 0 }];
  const months = { [firstId]: old.months || {} };
  return {
    employees,
    currentEmpId: firstId,
    months,
    ui: { ym: old.ui?.ym || toYM(new Date()), projMode: "thismonth" },
  };
}
function loadStateOrMigrate() {
  try {
    const raw2 = localStorage.getItem(STORAGE_KEY);
    if (raw2) return JSON.parse(raw2);
  } catch {}
  try {
    const raw1 = localStorage.getItem("part_attendance_v1");
    if (raw1) {
      const migrated = migrateV1ToV2(JSON.parse(raw1));
      saveState(migrated);
      return migrated;
    }
  } catch {}
  const id = uid();
  const fresh = {
    employees: [{ id, name: "", wage: 0 }],
    currentEmpId: id,
    months: {},
    ui: { ym: toYM(new Date()), projMode: "thismonth" },
  };
  saveState(fresh);
  return fresh;
}
function saveState(s = state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function toYM(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function daysInMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function firstDow(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).getDay();
}
function currentEmployee() {
  return state.employees.find(e => e.id === state.currentEmpId);
}
function ensureEmpMonth(empId, ym) {
  state.months[empId] ||= {};
  state.months[empId][ym] ||= {};
  return state.months[empId][ym];
}
function getYearFromYM(ym) { return Number(ym.split("-")[0]); }

// ===== 初期化 =====
document.addEventListener("DOMContentLoaded", () => {
  renderEmpTabs();

  const emp = currentEmployee();
  $("#emp-name").value = emp?.name || "";
  $("#emp-wage").value = emp?.wage || "";
  $("#month-picker").value = state.ui.ym;
  $("#proj-mode").value = state.ui.projMode || "thismonth";
  $("#year-picker").value = getYearFromYM(state.ui.ym);

  // 従業員情報
  $("#save-emp").addEventListener("click", () => {
    const e = currentEmployee();
    if (!e) return;
    e.name = $("#emp-name").value.trim();
    e.wage = Number($("#emp-wage").value) || 0;
    $("#emp-msg").textContent = "従業員情報を保存しました。";
    saveState();
    recalcAndRender();
    syncSimulatorWage();
    renderYearSummary();
  });

  $("#reset-data").addEventListener("click", () => {
    if (confirm("保存データをすべて削除します。よろしいですか？")) {
      localStorage.removeItem(STORAGE_KEY);
      state = loadStateOrMigrate();
      $("#emp-name").value = currentEmployee()?.name || "";
      $("#emp-wage").value = currentEmployee()?.wage || "";
      $("#emp-msg").textContent = "データを初期化しました。";
      $("#month-picker").value = state.ui.ym;
      $("#proj-mode").value = state.ui.projMode;
      $("#year-picker").value = getYearFromYM(state.ui.ym);
      renderEmpTabs();
      recalcAndRender();
      syncSimulatorWage();
      renderYearSummary();
      updateBulkRangeLimits();
    }
  });

  // 月選択
  $("#prev-month").addEventListener("click", () => {
    const [y, m] = state.ui.ym.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() - 1);
    state.ui.ym = toYM(d);
    $("#month-picker").value = state.ui.ym;
    $("#year-picker").value = getYearFromYM(state.ui.ym);
    saveState();
    recalcAndRender();
    renderYearSummary();
    updateBulkRangeLimits();
  });
  $("#next-month").addEventListener("click", () => {
    const [y, m] = state.ui.ym.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() + 1);
    state.ui.ym = toYM(d);
    $("#month-picker").value = state.ui.ym;
    $("#year-picker").value = getYearFromYM(state.ui.ym);
    saveState();
    recalcAndRender();
    renderYearSummary();
    updateBulkRangeLimits();
  });
  $("#month-picker").addEventListener("change", (e) => {
    state.ui.ym = e.target.value;
    $("#year-picker").value = getYearFromYM(state.ui.ym);
    saveState();
    recalcAndRender();
    renderYearSummary();
    updateBulkRangeLimits();
  });

  // スタッフ追加 / 削除 / 並び替え
  $("#add-emp").addEventListener("click", () => {
    const name = prompt("スタッフ名を入力してください");
    if (!name) return;
    const wageStr = prompt("時給（円）を入力してください（例：1200）");
    const wage = Number(wageStr);
    const id = uid();
    state.employees.push({ id, name: name.trim(), wage: isFinite(wage) ? wage : 0 });
    state.currentEmpId = id;
    saveState();
    renderEmpTabs();
    $("#emp-name").value = name.trim();
    $("#emp-wage").value = isFinite(wage) ? wage : 0;
    $("#emp-msg").textContent = "新しいスタッフを追加しました。";
    recalcAndRender();
    syncSimulatorWage();
    renderYearSummary();
  });

  $("#del-emp").addEventListener("click", () => {
    if (!currentEmployee()) return;
    const e = currentEmployee();
    if (!confirm(`「${e.name || "（無名）"}」を削除します。よろしいですか？`)) return;

    const idx = state.employees.findIndex(x => x.id === e.id);
    if (idx >= 0) state.employees.splice(idx, 1);
    delete state.months[e.id];

    if (state.employees.length === 0) {
      const id = uid();
      state.employees.push({ id, name: "", wage: 0 });
      state.currentEmpId = id;
    } else {
      const next = state.employees[Math.max(0, idx - 1)];
      state.currentEmpId = next.id;
    }
    saveState();
    renderEmpTabs();
    const cur = currentEmployee();
    $("#emp-name").value = cur?.name || "";
    $("#emp-wage").value = cur?.wage || "";
    $("#emp-msg").textContent = "スタッフを削除しました。";
    recalcAndRender();
    syncSimulatorWage();
    renderYearSummary();
  });

  $("#move-left").addEventListener("click", () => {
    const id = state.currentEmpId;
    const idx = state.employees.findIndex(e => e.id === id);
    if (idx > 0) {
      const tmp = state.employees[idx - 1];
      state.employees[idx - 1] = state.employees[idx];
      state.employees[idx] = tmp;
      saveState();
      renderEmpTabs();
    }
  });
  $("#move-right").addEventListener("click", () => {
    const id = state.currentEmpId;
    const idx = state.employees.findIndex(e => e.id === id);
    if (idx >= 0 && idx < state.employees.length - 1) {
      const tmp = state.employees[idx + 1];
      state.employees[idx + 1] = state.employees[idx];
      state.employees[idx] = tmp;
      saveState();
      renderEmpTabs();
    }
  });

  // 見込みモード切替
  $("#proj-mode").addEventListener("change", (e) => {
    state.ui.projMode = e.target.value;
    saveState();
    recalcAndRender();
  });

  // 扶養シミュレーター
  $("#cap-select").addEventListener("change", onCapChange);
  $("#cap-custom").addEventListener("input", recalcSimulator);
  syncSimulatorWage();
  onCapChange();

  // 年間サマリー
  $("#year-picker").addEventListener("change", renderYearSummary);
  $("#refresh-summary").addEventListener("click", renderYearSummary);

  // 一括操作（出勤/休み）
  $("#bulk-work-all").addEventListener("click", bulkWorkAll);
  $("#bulk-off-all").addEventListener("click", bulkOffAll);
  $("#bulk-weekdays-work").addEventListener("click", bulkWeekdaysWork);
  $("#bulk-weekends-off").addEventListener("click", bulkWeekendsOff);

  // 一括操作（時間）
  $("#bulk-scope").addEventListener("change", onBulkScopeChange);
  $("#bulk-apply-hours").addEventListener("click", bulkApplyHours);

  // 初期描画
  recalcAndRender();
  renderYearSummary();
  updateBulkRangeLimits();
});

// ===== タブ描画 =====
function renderEmpTabs() {
  const wrap = $("#emp-tabs");
  wrap.innerHTML = "";
  state.employees.forEach(e => {
    const b = document.createElement("button");
    b.className = "tab" + (e.id === state.currentEmpId ? " active" : "");
    b.textContent = e.name || "（無名）";
    b.title = `${e.name || "（無名）"} / 時給: ${e.wage ?? 0}円`;
    b.addEventListener("click", () => {
      state.currentEmpId = e.id;
      saveState();
      $("#emp-name").value = e.name || "";
      $("#emp-wage").value = e.wage || 0;
      $("#emp-msg").textContent = "";
      recalcAndRender();
      syncSimulatorWage();
      renderYearSummary();
      renderEmpTabs();
    });
    wrap.appendChild(b);
  });
}

// ===== レンダリング（カレンダー・集計） =====
function recalcAndRender() {
  renderCalendar();
  renderTotals();
}

function renderCalendar() {
  const ym = state.ui.ym;
  const empId = state.currentEmpId;
  const root = $("#calendar");
  root.innerHTML = "";

  ["日","月","火","水","木","金","土"].forEach((h) => {
    const el = document.createElement("div");
    el.className = "day-head";
    el.textContent = h;
    root.appendChild(el);
  });

  const dow = firstDow(ym);
  const dim = daysInMonth(ym);
  const monthData = ensureEmpMonth(empId, ym);

  for (let i = 0; i < dow; i++) {
    const empty = document.createElement("div");
    empty.className = "day-cell";
    empty.style.visibility = "hidden";
    root.appendChild(empty);
  }

  for (let day = 1; day <= dim; day++) {
    const key = String(day);
    const rec = (monthData[key] ||= { work: false, hours: 0 });

    const cell = document.createElement("div");
    cell.className = "day-cell";

    const title = document.createElement("div");
    title.className = "day-title";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = ym;
    title.innerHTML = `<span>${day}日</span>`;
    title.appendChild(badge);
    cell.appendChild(title);

    const tog = document.createElement("div");
    tog.className = "toggle " + (rec.work ? "on" : "off");
    tog.textContent = rec.work ? "出勤" : "休み";
    tog.addEventListener("click", () => {
      rec.work = !rec.work;
      if (!rec.work) rec.hours = 0;
      saveState();
      recalcAndRender();
    });
    cell.appendChild(tog);

    const timeRow = document.createElement("div");
    timeRow.className = "time-row";
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.25";
    input.min = "0";
    input.placeholder = "勤務時間（h）";
    input.value = rec.work ? String(rec.hours || "") : "";
    input.disabled = !rec.work;

    input.addEventListener("input", () => {
      const v = Number(input.value);
      rec.hours = isFinite(v) ? clamp(v, 0, 24) : 0;
      saveState();
      renderTotals();
      renderYearSummary();
    });

    const help = document.createElement("span");
    help.className = "help";
    help.textContent = "0.25=15分 / 0.5=30分";

    timeRow.appendChild(input);
    timeRow.appendChild(help);
    cell.appendChild(timeRow);

    root.appendChild(cell);
  }
}

function renderTotals() {
  const ym = state.ui.ym;
  const emp = currentEmployee();
  const wage = Number(emp?.wage) || 0;
  const monthData = (state.months[emp?.id || ""] || {})[ym] || {};

  // 月合計
  let sumHours = 0;
  Object.values(monthData).forEach((r) => {
    if (r.work) sumHours += Number(r.hours) || 0;
  });
  const sumWage = sumHours * wage;

  // 年収見込み（モード）
  const projMode = state.ui.projMode || "thismonth";
  let projAnnual = 0;
  if (projMode === "thismonth") {
    projAnnual = sumWage * 12;
  } else {
    const [year, month] = ym.split("-").map(Number);
    let ytdSum = 0;
    let countedMonths = 0;
    for (let m = 1; m <= month; m++) {
      const ym2 = `${year}-${pad2(m)}`;
      const md = ((state.months[emp?.id || ""] || {})[ym2]) || {};
      let mh = 0;
      Object.values(md).forEach(r => { if (r.work) mh += Number(r.hours) || 0; });
      const mw = mh * wage;
      if (mw > 0) { ytdSum += mw; countedMonths += 1; }
    }
    const avg = countedMonths > 0 ? (ytdSum / countedMonths) : 0;
    const remain = 12 - month;
    projAnnual = ytdSum + avg * remain;
  }

  $("#sum-hours").textContent = `${sumHours.toFixed(2)} h`;
  $("#sum-wage").textContent = fmtJPY(sumWage);
  $("#proj-annual").textContent = fmtJPY(projAnnual);

  // 扶養ラインのバー（103/106/130）
  const pct103 = THRESHOLDS.T103 ? Math.min(100, (projAnnual / THRESHOLDS.T103) * 100) : 0;
  const pct106 = THRESHOLDS.T106 ? Math.min(100, (projAnnual / THRESHOLDS.T106) * 100) : 0;
  const pct130 = THRESHOLDS.T130 ? Math.min(100, (projAnnual / THRESHOLDS.T130) * 100) : 0;
  $("#bar-103").value = pct103; $("#pct-103").textContent = `${Math.round(pct103)}%`;
  $("#bar-106").value = pct106; $("#pct-106").textContent = `${Math.round(pct106)}%`;
  $("#bar-130").value = pct130; $("#pct-130").textContent = `${Math.round(pct130)}%`;

  // 警告メッセージ
  const msgs = [];
  if (projAnnual >= THRESHOLDS.T130) msgs.push("130万円ラインを超える見込みです。");
  else if (projAnnual >= THRESHOLDS.T130 * 0.9) msgs.push("130万円ラインの90%を超えています（要注意）。");

  if (projAnnual >= THRESHOLDS.T106 && projAnnual < THRESHOLDS.T130) {
    msgs.push("106万円ラインを超える可能性があります。条件により社会保険加入対象となる場合があります。");
  } else if (projAnnual >= THRESHOLDS.T106 * 0.9 && projAnnual < THRESHOLDS.T106) {
    msgs.push("106万円ラインの90%を超えています（要注意）。");
  }

  if (projAnnual >= THRESHOLDS.T103 && projAnnual < THRESHOLDS.T106) {
    msgs.push("103万円ライン超の見込みです。");
  } else if (projAnnual >= THRESHOLDS.T103 * 0.9 && projAnnual < THRESHOLDS.T103) {
    msgs.push("103万円ラインの90%を超えています（要注意）。");
  }

  $("#warn").textContent = msgs.join(" ");

  // シミュレーター連動
  syncSimulatorWage();
  recalcSimulator();
}

// ===== 扶養シミュレーター =====
function onCapChange() {
  const sel = $("#cap-select").value;
  const custom = $("#cap-custom");
  custom.disabled = sel !== "custom";
  recalcSimulator();
}
function syncSimulatorWage() {
  const wage = Number(currentEmployee()?.wage) || 0;
  $("#cap-wage").value = wage || "";
}
function recalcSimulator() {
  const sel = $("#cap-select").value;
  const customYen = Number($("#cap-custom").value);
  const wage = Number($("#cap-wage").value);

  let cap = 0;
  if (sel === "custom") {
    cap = isFinite(customYen) && customYen > 0 ? customYen : 0;
  } else {
    cap = Number(sel) || 0;
  }

  let hours = "";
  if (cap > 0 && wage > 0) {
    const perMonth = cap / 12 / wage;
    const rounded = Math.round(perMonth * 4) / 4; // 15分刻み
    hours = `${rounded.toFixed(2)} h / 月`;
  }
  $("#cap-hours").value = hours;
}

// ===== 年間サマリー（各月×金額） =====
function calcMonthWage(emp, year, month) {
  const ym = `${year}-${pad2(month)}`;
  const md = ((state.months[emp?.id || ""] || {})[ym]) || {};
  let hours = 0;
  Object.values(md).forEach(r => { if (r.work) hours += Number(r.hours) || 0; });
  const wage = Number(emp?.wage) || 0;
  return { hours, amount: hours * wage };
}
function renderYearSummary() {
  const emp = currentEmployee();
  const year = Number($("#year-picker").value) || getYearFromYM(state.ui.ym);

  const tableWrap = $("#year-summary");
  const months = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  let html = `<table class="year-table"><thead><tr><th class="month">月</th>`;
  months.forEach(m => html += `<th>${m}</th>`);
  html += `<th>合計</th></tr></thead><tbody>`;

  // 1行目：金額
  html += `<tr><th class="month">金額</th>`;
  let yearSum = 0;
  for (let m = 1; m <= 12; m++) {
    const { amount } = calcMonthWage(emp, year, m);
    yearSum += amount;
    html += `<td>${amount > 0 ? fmtJPY(amount) : "—"}</td>`;
  }
  html += `<td>${fmtJPY(yearSum)}</td></tr>`;

  // 2行目：時間（参考）
  html += `<tr><th class="month">時間(h)</th>`;
  let yearHours = 0;
  for (let m = 1; m <= 12; m++) {
    const { hours } = calcMonthWage(emp, year, m);
    yearHours += hours;
    html += `<td>${hours > 0 ? hours.toFixed(2) : "—"}</td>`;
  }
  html += `<td>${yearHours.toFixed(2)}</td></tr>`;

  html += `</tbody></table>`;
  tableWrap.innerHTML = html;
}

// ===== 出力（CSV / Excel） =====
function collectMonthRows(emp, ym) {
  const [y, m] = ym.split("-").map(Number);
  const md = ((state.months[emp?.id || ""] || {})[ym]) || {};
  const wage = Number(emp?.wage) || 0;
  const dim = daysInMonth(ym);

  const rows = [];
  let sumH = 0, sumW = 0;

  rows.push(["Staff", emp?.name || "", "Year-Month", ym, "Hourly", wage]);
  rows.push(["Date","Weekday","Work","Hours","DayWage"]);

  for (let d = 1; d <= dim; d++) {
    const r = md[String(d)] || { work:false, hours:0 };
    const hours = r.work ? (Number(r.hours) || 0) : 0;
    const w = hours * wage;
    rows.push([ ymd(ym, d), youbi(y, m, d), r.work ? "出勤" : "休み", hours, w ]);
    sumH += hours; sumW += w;
  }

  // 見込み
  const projMode = state.ui.projMode || "thismonth";
  let projAnnual = 0;
  if (projMode === "thismonth") projAnnual = sumW * 12;
  else {
    let ytdSum = 0, cnt = 0;
    for (let mm = 1; mm <= m; mm++) {
      const ym2 = `${y}-${pad2(mm)}`;
      const md2 = ((state.months[emp?.id || ""] || {})[ym2]) || {};
      let mh = 0;
      Object.values(md2).forEach(r => { if (r.work) mh += Number(r.hours) || 0; });
      const mw = mh * wage;
      if (mw > 0) { ytdSum += mw; cnt++; }
    }
    const avg = cnt > 0 ? (ytdSum / cnt) : 0;
    const remain = 12 - m;
    projAnnual = ytdSum + avg * remain;
  }

  rows.push([]);
  rows.push(["SumHours", sumH, "SumWage", sumW, "ProjectedAnnual", projAnnual, "Mode", projMode]);
  return rows;
}
function download(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 0);
}
function exportCsvThisMonth() {
  const emp = currentEmployee();
  const ym = state.ui.ym;
  const rows = collectMonthRows(emp, ym);
  const BOM = "\uFEFF";
  const csv = rows.map(r => r.map(v => {
    const s = (v ?? "").toString();
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  }).join(",")).join("\n");
  download(`${(emp?.name||"noname")}_${ym}.csv`, BOM + csv, "text/csv;charset=utf-8");
}
function exportCsvAll() {
  const rows = [["Staff","Year-Month","Date","Weekday","Work","Hours","Hourly","DayWage"]];
  state.employees.forEach(emp => {
    const empMonths = state.months[emp.id] || {};
    Object.keys(empMonths).sort().forEach(ym => {
      const [y, m] = ym.split("-").map(Number);
      const dim = daysInMonth(ym);
      const wage = Number(emp.wage) || 0;
      for (let d = 1; d <= dim; d++) {
        const r = (empMonths[ym][String(d)]) || { work:false, hours:0 };
        const hours = r.work ? (Number(r.hours) || 0) : 0;
        const w = hours * wage;
        rows.push([emp.name || "（無名）", ym, ymd(ym,d), youbi(y,m,d), r.work ? "出勤" : "休み", hours, wage, w]);
      }
    });
  });
  const BOM = "\uFEFF";
  const csv = rows.map(r => r.map(v => {
    const s = (v ?? "").toString();
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  }).join(",")).join("\n");
  download(`all_staff_all_months.csv`, BOM + csv, "text/csv;charset=utf-8");
}
function exportXlsxThisMonth() {
  if (typeof XLSX === "undefined") {
    alert("Excel出力用ライブラリの読み込みに失敗しました。ネット接続をご確認ください。");
    return;
  }
  const emp = currentEmployee();
  const ym = state.ui.ym;
  const rows = collectMonthRows(emp, ym);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{wch:12},{wch:6},{wch:6},{wch:8},{wch:12}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Timesheet");
  XLSX.writeFile(wb, `${(emp?.name||"noname")}_${ym}.xlsx`);
}

// ===== 一括操作のロジック =====
function onBulkScopeChange() {
  const scope = $("#bulk-scope").value;
  const rangeEnabled = scope === "date_range_overwrite";
  $("#bulk-from").disabled = !rangeEnabled;
  $("#bulk-to").disabled = !rangeEnabled;
}
function updateBulkRangeLimits() {
  const dim = daysInMonth(state.ui.ym);
  const from = $("#bulk-from"), to = $("#bulk-to");
  from.min = 1; from.max = dim; to.min = 1; to.max = dim;
  if (!from.value) from.value = 1;
  if (!to.value) to.value = dim;
}

function bulkWorkAll() {
  const ym = state.ui.ym;
  const empId = state.currentEmpId;
  const md = ensureEmpMonth(empId, ym);
  const dim = daysInMonth(ym);
  for (let d = 1; d <= dim; d++) {
    const rec = (md[String(d)] ||= { work:false, hours:0 });
    rec.work = true; // 時間は維持（必要なら後で一括時間設定）
  }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkOffAll() {
  const ym = state.ui.ym;
  const empId = state.currentEmpId;
  const md = ensureEmpMonth(empId, ym);
  const dim = daysInMonth(ym);
  for (let d = 1; d <= dim; d++) {
    const rec = (md[String(d)] ||= { work:false, hours:0 });
    rec.work = false; rec.hours = 0;
  }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkWeekdaysWork() {
  const ym = state.ui.ym; const [y,m] = ym.split("-").map(Number);
  const empId = state.currentEmpId; const md = ensureEmpMonth(empId, ym);
  const dim = daysInMonth(ym);
  for (let d = 1; d <= dim; d++) {
    if (!isWeekend(y,m,d)) {
      const rec = (md[String(d)] ||= { work:false, hours:0 });
      rec.work = true;
    }
  }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkWeekendsOff() {
  const ym = state.ui.ym; const [y,m] = ym.split("-").map(Number);
  const empId = state.currentEmpId; const md = ensureEmpMonth(empId, ym);
  const dim = daysInMonth(ym);
  for (let d = 1; d <= dim; d++) {
    if (isWeekend(y,m,d)) {
      const rec = (md[String(d)] ||= { work:false, hours:0 });
      rec.work = false; rec.hours = 0;
    }
  }
  saveState(); recalcAndRender(); renderYearSummary();
}
function bulkApplyHours() {
  const ym = state.ui.ym; const [y,m] = ym.split("-").map(Number);
  const empId = state.currentEmpId; const md = ensureEmpMonth(empId, ym);
  const dim = daysInMonth(ym);

  let hours = Number($("#bulk-hours").value);
  if (!isFinite(hours) || hours < 0) { alert("時間を正しく入力してください（例：7.5）"); return; }
  hours = clamp(Math.round(hours * 4) / 4, 0, 24); // 15分刻み

  const scope = $("#bulk-scope").value;
  const markWork = $("#bulk-mark-work").checked;
  let from = Number($("#bulk-from").value) || 1;
  let to = Number($("#bulk-to").value) || dim;
  if (from > to) { const t = from; from = to; to = t; }
  from = clamp(from, 1, dim); to = clamp(to, 1, dim);

  const applyToDay = (d) => {
    const rec = (md[String(d)] ||= { work:false, hours:0 });
    // スコープ判定
    const weekday = !isWeekend(y,m,d);
    let inScope = false;
    if (scope === "all_working_overwrite") {
      inScope = rec.work || markWork;
    } else if (scope === "working_empty_only") {
      inScope = (rec.work || markWork) && (!rec.hours || rec.hours === 0);
    } else if (scope === "weekdays_overwrite") {
      inScope = weekday && (rec.work || markWork);
    } else if (scope === "weekends_overwrite") {
      inScope = !weekday && (rec.work || markWork);
    } else if (scope === "date_range_overwrite") {
      inScope = d >= from && d <= to && (rec.work || markWork);
    }
    if (!inScope) return;

    if (markWork) rec.work = true; // 必要なら出勤化
    if (rec.work) rec.hours = hours; // 出勤日のみ時間反映
  };

  for (let d = 1; d <= dim; d++) applyToDay(d);

  saveState(); recalcAndRender(); renderYearSummary();
}
