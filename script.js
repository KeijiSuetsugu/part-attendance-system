// ===== 設定値 =====
const THRESHOLDS = { T103: 1030000, T130: 1300000 };
const STORAGE_KEY = "part_attendance_v1";

// ===== ユーティリティ =====
const $ = (sel) => document.querySelector(sel);
const fmtJPY = (n) => "¥" + Math.round(n).toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ===== 状態 =====
let state = loadState() || {
  employee: { name: "", wage: 0 },
  months: {
    // "2025-09": { "1": {work:true, hours:7.5}, ... }
  },
  ui: {
    ym: toYM(new Date()),
  },
};

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
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ===== 初期化 =====
document.addEventListener("DOMContentLoaded", () => {
  // 従業員
  $("#emp-name").value = state.employee.name || "";
  $("#emp-wage").value = state.employee.wage || "";
  $("#save-emp").addEventListener("click", () => {
    const name = $("#emp-name").value.trim();
    const wage = Number($("#emp-wage").value);
    state.employee = { name, wage: isFinite(wage) ? wage : 0 };
    $("#emp-msg").textContent = "従業員情報を保存しました。";
    saveState();
    recalcAndRender();
  });
  $("#reset-data").addEventListener("click", () => {
    if (confirm("保存データをすべて削除します。よろしいですか？")) {
      localStorage.removeItem(STORAGE_KEY);
      state = {
        employee: { name: "", wage: 0 },
        months: {},
        ui: { ym: toYM(new Date()) },
      };
      $("#emp-name").value = "";
      $("#emp-wage").value = "";
      $("#emp-msg").textContent = "データを初期化しました。";
      recalcAndRender();
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

  // レンダリング
  recalcAndRender();
});

// ===== レンダリング =====
function recalcAndRender() {
  renderCalendar();
  renderTotals();
}

function renderCalendar() {
  const ym = state.ui.ym;
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
  const monthData = (state.months[ym] ||= {}); // その月のデータ

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
    const dstr = `${day}`;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = ym;
    title.innerHTML = `<span>${dstr}日</span>`;
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
      renderTotals(); // 毎回集計だけ更新
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
  const wage = Number(state.employee.wage) || 0;
  const monthData = state.months[ym] || {};

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
}
