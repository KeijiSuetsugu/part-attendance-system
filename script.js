// ===== 設定値 =====
const THRESHOLDS = { T103: 1030000, T130: 1300000 };
const STORAGE_KEY = "part_attendance_v2"; // v2構造

// ===== ユーティリティ =====
const $ = (sel) => document.querySelector(sel);
const fmtJPY = (n) => "¥" + Math.round(n).toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const uid = () => "emp-" + Math.random().toString(36).slice(2, 9);
const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (ym, d) => `${ym}-${pad2(d)}`;
const youbi = (y, m, d) => ["日","月","火","水","木","金","土"][new Date(y, m-1, d).getDay()];

// ===== 状態（v2構造） =====
let state = loadStateOrMigrate();
// state = { employees:[{id,name,wage}], currentEmpId:"", months:{ [empId]:{ [ym]:{ "1":{work,hours}, ... } } }, ui:{ym:"YYYY-MM", projMode:"thismonth"} }

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

// ===== 初期化 =====
document.addEventListener("DOMContentLoaded", () => {
  renderEmpTabs();

  const emp = currentEmployee();
  $("#emp-name").value = emp?.name || "";
  $("#emp-wage").value = emp?.wage || "";
  $("#month-picker").value = state.ui.ym;
  $("#proj-mode").value = state.ui.projMode || "thismonth";

  $("#save-emp").addEventListener("click", () => {
    const e = currentEmployee();
    if (!e) return;
    e.name = $("#emp-name").value.trim();
    e.wage = Number($("#emp-wage").value) || 0;
    $("#emp-msg").textContent = "従業員情報を保存しました。";
    saveState();
    recalcAndRender();
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
      $("#proj-mode").value = state.ui.projMode;
      renderEmpTabs();
      recalcAndRender();
      syncSimulatorWage();
    }
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
  $("#month-picker").addEventListener("change", (e) => {
    state.ui.ym = e.target.value;
    saveState();
    recalcAndRender();
  });

  // スタッフ追加 / 削除
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
  });

  $("#del-emp").addEventListener("click", () => {
    if (!currentEmployee()) return;
    const e = currentEmployee();
    if (!confirm(`「${e.name || "（無名）"}」を削除します。よろしいですか？`)) return;

    // 削除
    const idx = state.employees.findIndex(x => x.id === e.id);
    if (idx >= 0) state.employees.splice(idx, 1);
    delete state.months[e.id];

    // 最低1人は保持（空なら新規作成）
    if (state.employees.length === 0) {
      const id = uid();
      state.employees.push({ id, name: "", wage: 0 });
      state.currentEmpId = id;
    } else {
      // 次に選択するID
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
  });

  // 見込みモード切替
  $("#proj-mode").addEventListener("change", (e) => {
    state.ui.projMode = e.target.value;
    saveState();
    recalcAndRender();
  });

  // シミュレーター
  $("#cap-select").addEventListener("change", onCapChange);
  $("#cap-custom").addEventListener("input", recalcSimulator);
  syncSimulatorWage();
  onCapChange();

  // 出力
  $("#export-csv-month").addEventListener("click", exportCsvThisMonth);
  $("#export-csv-all").addEventListener("click", exportCsvAll);
  $("#export-xlsx-month").addEventListener("click", exportXlsxThisMonth);

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
      $("#emp-name").value = e.name || "";
      $("#emp-wage").value = e.wage || 0;
      $("#emp-msg").textContent = "";
      recalcAndRender();
      syncSimulatorWage();
      renderEmpTabs();
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

  // 曜日ヘッ
