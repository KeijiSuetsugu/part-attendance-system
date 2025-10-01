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
    const name = prompt("スタッフ名を入力
