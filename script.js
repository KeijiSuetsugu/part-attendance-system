// ===== 設定値 =====
const THRESHOLDS = { T103: 1030000, T130: 1300000 };
const STORAGE_KEY = "part_attendance_v2"; // v1から移行

// ===== ユーティリティ =====
const $ = (sel) => document.querySelector(sel);
const fmtJPY = (n) => "¥" + Math.round(n).toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const uid = () => "emp-" + Math.random().toString(36).slice(2, 9);

// ===== 状態（v2構造） =====
// v2: { employees:[{id,name,wage}], currentEmpId:"", months:{ [empId]: { [ym]: { "1":{work,hours}, ... } } }, ui:{ym:"YYYY-MM"} }
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
    ui: old.ui || { ym: toYM(new Date()) },
  };
}
function loadStateOrMigrate() {
  // v2
  try {
    const raw2 = localStorage.getItem(STORAGE_KEY);
    if (raw2) return JSON.parse(raw2);
  } catch {}
  // v1
  try {
    const raw1 = localStorage.getItem("part_attendance_v1");
    if (raw1) {
      const migrated = migrateV1ToV2(JSON.parse(raw1));
      saveState(migrated);
      return migrated;
    }
  } catch {}
  // fresh
  const id = uid();
  const fresh = {
    employees: [{ id, name: "", wage: 0 }],
    currentEmpId: id,
    months: {},
    ui: { ym: toYM(new Date()) },
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
  return new Date(y, m - 1, 1).getDay(); // 0:日〜6:土
}

function currentEmployee() {
  return state.employees.find(e => e.id === state.currentEmpId);
}
function ensureEmpMonth(empId, ym) {
  state.months[empId] ||= {};
  state.months[empId][ym] ||= {};
  return state.months[empId][ym];
}

// ===== 初期化 =====
document.addEventListener("DOMContentLoaded", () => {
  // タブ描画
  renderEmpTabs();

  // 従業員フォーム初期値
  const emp = currentEmployee();
  $("#emp-name").value = emp?.name || "";
  $("#emp-wage").value = emp?.wage || "";

  $("#save-emp").addEventListener("click", () => {
    const e = currentEmployee();
    if (!e) return;
    e.name = $("#emp-name").value.trim();
    e.wage = Number($("#emp-wage").value) || 0;
    $("#emp-msg").textContent = "従業員情報を保存しました。";
    saveState();
    recalcAndRender();
    // シミュレーター時給も反映
    syncSimulatorWage();
  });

  $("#reset-data").addEventListener("click", () => {
    if (confirm("保存データをすべて削除します。よろしいですか？")) {
      localStorage.removeItem(STORAGE_KEY);
      state = loadStateOrMigrate();
      $("#emp-name").value = currentEmployee()?.name || "";
      $("#emp-wage").value = currentEmployee()?.wage || "";
      $("#emp-msg").textContent = "データを初期化しました。";
      $("#month-picker").value = state.ui.ym;
      renderEmpTabs();
      recalcAndRender();
      syncSimulatorWage();
    }
  });

  // 月選択
  $("#month-picker").value = state.ui.ym;
  $("#month-picker").addEventListener("change", (e) => {
    state.ui.ym = e.target.value;
    saveState();
    recalcAndRender();
  });
  $("#prev-month").addEventListener("click", () => {
    const [y, m] = state.ui.ym.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() - 1);
    state.ui.ym = toYM(d);
    $("#month-picker").value = state.ui.ym;
    saveState();
    recalcAndRender();
  });
  $("#next-month").addEventListener("click", () => {
    const [y, m] = state.ui.ym.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    d.setMonth(d.getMonth() + 1);
    state.ui.ym = toYM(d);
    $("#month-picker").value = state.ui.ym;
    saveState();
    recalcAndRender();
  });

  // スタッフ追加
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
    // フォーム反映
    $("#emp-name").value = name.trim();
    $("#emp-wage").value = isFinite(wage) ? wage : 0;
    $("#emp-msg").textContent = "新しいスタッフを追加しました。";
    recalcAndRender();
    syncSimulatorWage();
  });

  // シミュレーター
  $("#cap-select").addEventListener("change", onCapChange);
  $("#cap-custom").addEventListener("input", recalcSimulator);
  // 初期値同期
  syncSimulatorWage();
  onCapChange();

  // 初期描画
  recalcAndRender();
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
      // フォーム反映
      $("#emp-name").value = e.name || "";
      $("#emp-wage").value = e.wage || 0;
      $("#emp-msg").textContent = "";
      recalcAndRender();
      syncSimulatorWage();
      renderEmpTabs(); // アクティブ更新
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
  const ym = state.ui.ym;
  const empId = state.currentEmpId;
  const root = $("#calendar");
  root.innerHTML = "";

  // 曜日ヘッダ
  const heads = ["日", "月", "火", "水", "木", "金", "土"];
  heads.forEach((h) => {
    const el = document.createElement("div");
    el.className = "day-head";
    el.textContent = h;
    root.appendChild(el);
  });

  const dow = firstDow(ym);
  const dim = daysInMonth(ym);
  const monthData = ensureEmpMonth(empId, ym);

  // 空白（前詰め）
  for (let i = 0; i < dow; i++) {
    const empty = document.createElement("div");
    empty.className = "day-cell";
    empty.style.visibility = "hidden";
    root.appendChild(empty);
  }

  // 各日セル
  for (let day = 1; day <= dim; day++) {
    const key = String(day);
    const rec = (monthData[key] ||= { work: false, hours: 0 });

    const cell = document.createElement("div");
    cell.className = "day-cell";

    // タイトル行
    const title = document.createElement("div");
    title.className = "day-title";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = ym;
    title.innerHTML = `<span>${day}日</span>`;
    title.appendChild(badge);
    cell.appendChild(title);

    // 出勤トグル
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

    // 時間入力
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
      renderTotals(); // 集計だけ更新
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

  // 年収見込み（簡易：今月×12）
  const projAnnual = sumWage * 12;

  // 画面反映
  $("#sum-hours").textContent = `${sumHours.toFixed(2)} h`;
  $("#sum-wage").textContent = fmtJPY(sumWage);
  $("#proj-annual").textContent = fmtJPY(projAnnual);

  // 扶養ラインのバー
  const pct103 = THRESHOLDS.T103 ? Math.min(100, (projAnnual / THRESHOLDS.T103) * 100) : 0;
  const pct130 = THRESHOLDS.T130 ? Math.min(100, (projAnnual / THRESHOLDS.T130) * 100) : 0;
  $("#bar-103").value = pct103;
  $("#bar-130").value = pct130;
  $("#pct-103").textContent = `${Math.round(pct103)}%`;
  $("#pct-130").textContent = `${Math.round(pct130)}%`;

  // 警告メッセージ
  const msgs = [];
  if (projAnnual >= THRESHOLDS.T130) msgs.push("130万円ラインを超える見込みです。");
  else if (projAnnual >= THRESHOLDS.T130 * 0.9) msgs.push("130万円ラインの90%を超えています（要注意）。");

  if (projAnnual >= THRESHOLDS.T103 && projAnnual < THRESHOLDS.T130) {
    msgs.push("103万円ライン超の見込みです。");
  } else if (projAnnual >= THRESHOLDS.T103 * 0.9 && projAnnual < THRESHOLDS.T103) {
    msgs.push("103万円ラインの90%を超えています（要注意）。");
  }

  $("#warn").textContent = msgs.join(" ");

  // シミュレーターの時給同期（念のため）
  syncSimulatorWage();
  recalcSimulator();
}

// ===== 扶養シミュレーター =====
function onCapChange() {
  const sel = $("#cap-select").value;
  const custom = $("#cap-custom");
  if (sel === "custom") {
    custom.disabled = false;
    custom.placeholder = "円で入力（例：1060000）";
  } else {
    custom.disabled = true;
  }
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
    const perMonth = cap / 12 / wage;            // 月あたり上限時間（理論値）
    const rounded = Math.round(perMonth * 4) / 4; // 15分刻みへ丸め
    hours = `${rounded.toFixed(2)} h / 月`;
  }
  $("#cap-hours").value = hours;
}
