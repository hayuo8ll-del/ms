const runButton = document.getElementById("run-plan");
const startDateInput = document.getElementById("start-date");
const kpisEl = document.getElementById("kpis");
const warningsEl = document.getElementById("warnings");
const warningListEl = document.getElementById("warning-list");
const ganttEl = document.getElementById("gantt");
const utilGridEl = document.getElementById("util-grid");
const errorBanner = document.getElementById("error-banner");
const importButton = document.getElementById("import-button");
const importFileInput = document.getElementById("import-file");
const importResultEl = document.getElementById("import-result");
const exportButton = document.getElementById("export-plan");
const bottleneckButton = document.getElementById("bottleneck-button");
const ledgerFileInput = document.getElementById("ledger-file");
const matrixPanelEl = document.getElementById("shift-matrix");
const matrixTableEl = document.getElementById("matrix-table");
const bnPanelEl = document.getElementById("bn-panel");
const bnKpisEl = document.getElementById("bn-kpis");
const bnWarningsEl = document.getElementById("bn-warnings");
const bnWarningListEl = document.getElementById("bn-warning-list");
const bnMatrixEl = document.getElementById("bn-matrix");
const bnMilEl = document.getElementById("bn-mil");
const bnProgressEl = document.getElementById("bn-progress");
const bnRemediesEl = document.getElementById("bn-remedies");
const bnRemedyListEl = document.getElementById("bn-remedy-list");
const bnValidateButton = document.getElementById("bn-validate");
const felicaFileInput = document.getElementById("felica-file");
const bnValidationEl = document.getElementById("bn-validation");
const bnValidationBodyEl = document.getElementById("bn-validation-body");
const bnApplyButton = document.getElementById("bn-apply-calibration");
const bnApplyResultEl = document.getElementById("bn-apply-result");
const bnExportButton = document.getElementById("bn-export");
const bnLinesInput = document.getElementById("bn-lines");

// 直近に取り込んだ台帳ファイル(画面表示 → Excel出力で再利用)
let lastLedgerFile = null;
// 直近の照合結果(推奨値のconfig反映で再利用)
let lastValidation = null;

const BN_STAGE_COLOR = { ANT: "var(--accent-a)", TAL: "var(--accent-b)", HAL: "var(--danger)", MIL: "var(--accent-c)" };

const HOUR_PX = 26;

// シフト定義(勤務帯)はstart_dateに依存しないため初回のみ取得してキャッシュする
let shiftDefsCache = null;

function fmt(dt) {
  const d = new Date(dt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

function renderKpis(schedule, warnings, utilization) {
  const totalOrders = new Set(schedule.map((s) => s.order_id)).size;
  const avgUtil = utilization.length
    ? (utilization.reduce((a, b) => a + b.utilization_pct, 0) / utilization.length).toFixed(1)
    : "0.0";
  const overloaded = utilization.filter((u) => u.utilization_pct > 90).length;

  const cards = [
    ["対象オーダー数", `${totalOrders} 件`],
    ["平均稼働率", `${avgUtil} %`],
    ["高稼働設備(90%超)", `${overloaded} 台`],
    ["警告", `${warnings.length} 件`],
  ];

  kpisEl.innerHTML = cards
    .map(([label, value]) => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join("");
}

function renderWarnings(warnings) {
  if (warnings.length === 0) {
    warningsEl.hidden = true;
    return;
  }
  warningsEl.hidden = false;
  warningListEl.innerHTML = warnings
    .map((w) => `<div class="w-item">[${w.order_id}] ${w.message}</div>`)
    .join("");
}

function renderGantt(schedule) {
  ganttEl.innerHTML = "";
  if (schedule.length === 0) {
    return;
  }

  const allTimes = schedule.flatMap((op) => [new Date(op.start).getTime(), new Date(op.end).getTime()]);
  const minT = Math.min(...allTimes);
  const maxT = Math.max(...allTimes);
  const totalHours = Math.max((maxT - minT) / 3600000, 1);

  const stages = new Map();
  for (const op of schedule) {
    if (!stages.has(op.stage_id)) stages.set(op.stage_id, new Map());
    const machines = stages.get(op.stage_id);
    if (!machines.has(op.machine_id)) machines.set(op.machine_id, []);
    machines.get(op.machine_id).push(op);
  }

  for (const stageId of [...stages.keys()].sort()) {
    const block = document.createElement("div");
    block.className = "stage-block";

    const title = document.createElement("div");
    title.className = "stage-title";
    title.textContent = stageId;
    block.appendChild(title);

    const machines = stages.get(stageId);
    for (const machineId of [...machines.keys()].sort()) {
      const row = document.createElement("div");
      row.className = "row";

      const label = document.createElement("div");
      label.className = "row-label";
      label.textContent = machineId;
      row.appendChild(label);

      const timeline = document.createElement("div");
      timeline.className = "timeline";
      timeline.style.setProperty("--hourpx", `${HOUR_PX}px`);
      timeline.style.minWidth = `${totalHours * HOUR_PX + 40}px`;

      for (const op of machines.get(machineId)) {
        const startOffset = ((new Date(op.start).getTime() - minT) / 3600000) * HOUR_PX;
        const width = Math.max(((new Date(op.end).getTime() - new Date(op.start).getTime()) / 3600000) * HOUR_PX, 3);
        const bar = document.createElement("div");
        bar.className = `bar ${stageId}`;
        bar.style.left = `${startOffset}px`;
        bar.style.width = `${width}px`;
        bar.textContent = op.lot_id;
        bar.title = `${op.lot_id} / ${op.product} / ${op.quantity}個\n${fmt(op.start)} → ${fmt(op.end)}${
          op.note ? "\n" + op.note : ""
        }`;
        timeline.appendChild(bar);
      }

      row.appendChild(timeline);
      block.appendChild(row);
    }

    ganttEl.appendChild(block);
  }
}

async function loadShiftDefs() {
  if (shiftDefsCache) return shiftDefsCache;
  const res = await fetch("/api/equipment");
  if (!res.ok) throw new Error(`設備情報の取得に失敗: ${res.status}`);
  const eq = await res.json();
  const defs = eq.shift_modes[eq.default_shift_mode];
  if (!Array.isArray(defs) || defs.length === 0) {
    throw new Error("シフト定義が空です。");
  }
  shiftDefsCache = defs;
  return defs;
}

// "HH:MM" を分に変換("24:00" は 1440 として日跨ぎ判定に乗せる)
function parseTimeToMinutes(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

// shift_calendar.py の _build_windows を踏襲: 稼働ウィンドウ配列を作る
function buildShiftWindows(shiftDefs, minDate, maxDate) {
  const windows = [];
  const day = new Date(minDate);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - 1); // 夜勤の日跨ぎに備え1日前から
  const last = new Date(maxDate);
  last.setDate(last.getDate() + 1);
  while (day <= last) {
    for (const shift of shiftDefs) {
      const startMin = parseTimeToMinutes(shift.start);
      const endMin = parseTimeToMinutes(shift.end);
      const wStart = new Date(day);
      wStart.setMinutes(startMin);
      const wEnd = new Date(day);
      wEnd.setMinutes(endMin);
      if (endMin <= startMin) wEnd.setDate(wEnd.getDate() + 1); // 折り返し(夜勤)
      windows.push({ start: wStart, end: wEnd, name: shift.shiftName });
    }
    day.setDate(day.getDate() + 1);
  }
  windows.sort((a, b) => a.start - b.start);
  return windows;
}

const MATRIX_STAGES = ["STAGE1", "STAGE2", "STAGE3"];

function renderShiftMatrix(schedule, shiftDefs) {
  if (!schedule.length || !shiftDefs) {
    matrixPanelEl.hidden = true;
    return;
  }

  const times = schedule.flatMap((op) => [new Date(op.start), new Date(op.end)]);
  const minDate = new Date(Math.min(...times));
  const maxDate = new Date(Math.max(...times));

  // opがいずれか重なるウィンドウのみを列に採用
  const allWindows = buildShiftWindows(shiftDefs, minDate, maxDate);
  const activeWindows = allWindows.filter((w) =>
    schedule.some((op) => new Date(op.start) < w.end && new Date(op.end) > w.start)
  );
  if (!activeWindows.length) {
    matrixPanelEl.hidden = true;
    return;
  }

  // (order, windowIndex, stage) -> 稼働号機の集合
  const orders = [...new Set(schedule.map((op) => op.order_id))].sort();
  const productOf = {};
  for (const op of schedule) productOf[op.order_id] = op.product;

  const counts = new Map(); // key: `${order}|${wi}|${stage}` -> Set(machine)
  for (const op of schedule) {
    const s = new Date(op.start);
    const e = new Date(op.end);
    activeWindows.forEach((w, wi) => {
      if (s < w.end && e > w.start) {
        const key = `${op.order_id}|${wi}|${op.stage_id}`;
        if (!counts.has(key)) counts.set(key, new Set());
        counts.get(key).add(op.machine_id);
      }
    });
  }

  const dayKey = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

  // ヘッダー1段目(日付, colspan=その日の勤務帯数) と 2段目(シフト名)
  const dateGroups = [];
  for (const w of activeWindows) {
    const key = dayKey(w.start);
    const last = dateGroups[dateGroups.length - 1];
    if (last && last.key === key) last.span += 1;
    else dateGroups.push({ key, span: 1 });
  }

  const headRow1 =
    `<th class="col-order" rowspan="2">受注</th>` +
    dateGroups.map((g) => `<th class="th-date" colspan="${g.span}">${g.key}</th>`).join("");
  const headRow2 = activeWindows.map((w) => `<th class="th-shift">${w.name}</th>`).join("");

  const bodyRows = orders
    .map((order) => {
      const cells = activeWindows
        .map((_w, wi) => {
          const badges = MATRIX_STAGES.map((stage) => {
            const set = counts.get(`${order}|${wi}|${stage}`);
            const n = set ? set.size : 0;
            const cls = n === 0 ? "cnt zero" : `cnt ${stage}`;
            return `<span class="${cls}">${n}</span>`;
          }).join("");
          const total = MATRIX_STAGES.reduce((acc, stage) => {
            const set = counts.get(`${order}|${wi}|${stage}`);
            return acc + (set ? set.size : 0);
          }, 0);
          const titleAttr = total
            ? ` title="工程A ${counts.get(`${order}|${wi}|STAGE1`)?.size || 0}台 / 工程B ${
                counts.get(`${order}|${wi}|STAGE2`)?.size || 0
              }台 / 工程C ${counts.get(`${order}|${wi}|STAGE3`)?.size || 0}台"`
            : "";
          return `<td${titleAttr}><span class="matrix-cell">${badges}</span></td>`;
        })
        .join("");
      return (
        `<tr><td class="col-order"><span class="ord-id">${order}</span>` +
        `<span class="ord-prod">${productOf[order] || ""}</span></td>${cells}</tr>`
      );
    })
    .join("");

  matrixTableEl.innerHTML =
    `<thead><tr>${headRow1}</tr><tr>${headRow2}</tr></thead><tbody>${bodyRows}</tbody>`;
  matrixPanelEl.hidden = false;
}

function renderUtilization(utilization) {
  utilGridEl.innerHTML = utilization
    .map((u) => {
      const color = u.utilization_pct > 90 ? "var(--danger)" : u.utilization_pct > 70 ? "var(--accent-c)" : "var(--accent-a)";
      return `
        <div class="util-card">
          <div class="name">${u.name} <span style="color:var(--text-dim)">(${u.stage_name})</span></div>
          <div class="util-bar-bg"><div class="util-bar-fg" style="width:${u.utilization_pct}%;background:${color}"></div></div>
          <div class="util-pct">${u.utilization_pct}%</div>
        </div>`;
    })
    .join("");
}

async function runPlan() {
  errorBanner.hidden = true;
  runButton.disabled = true;
  runButton.textContent = "立案中...";

  try {
    const body = startDateInput.value ? { start_date: startDateInput.value } : {};
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`APIエラー: ${res.status}`);
    }
    const result = await res.json();
    if (!startDateInput.value) {
      startDateInput.value = result.plan_start.slice(0, 10);
    }
    renderKpis(result.schedule, result.warnings, result.machine_utilization);
    renderWarnings(result.warnings);
    renderGantt(result.schedule);
    renderUtilization(result.machine_utilization);
    try {
      const shiftDefs = await loadShiftDefs();
      renderShiftMatrix(result.schedule, shiftDefs);
    } catch (matrixErr) {
      // マトリクスの描画失敗は既存ガントの表示を妨げない
      matrixPanelEl.hidden = true;
      console.error("シフトマトリクスの描画に失敗しました:", matrixErr);
    }
  } catch (err) {
    errorBanner.hidden = false;
    errorBanner.textContent = `計画の立案に失敗しました: ${err.message}`;
  } finally {
    runButton.disabled = false;
    runButton.textContent = "計画を立案する";
  }
}

async function importExcel() {
  const file = importFileInput.files[0];
  if (!file) return;

  errorBanner.hidden = true;
  importResultEl.hidden = true;
  importButton.disabled = true;
  importButton.textContent = "取り込み中...";

  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/import", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      const details = Array.isArray(data.detail) ? data.detail : [];
      if (details.length > 0) {
        const lines = details.map((d) => `[${d.sheet}${d.row ? " 行" + d.row : ""}] ${d.message}`);
        throw new Error(lines.join("\n"));
      }
      throw new Error(typeof data.detail === "string" ? data.detail : "取り込みに失敗しました。");
    }

    importResultEl.hidden = false;
    importResultEl.textContent =
      `取り込み完了: 工程${data.stages}件 / 号機${data.machines}台 / ` +
      `段取り替えルール${data.changeover_rules}件 / 受注${data.orders}件 / ` +
      `在庫品目${data.inventory_items}件 / 原材料${data.raw_materials}件`;

    startDateInput.value = "";
    await runPlan();
    // 取り込み成功後は、その計画結果のExcelを自動でダウンロードする
    await exportPlan();
  } catch (err) {
    errorBanner.hidden = false;
    errorBanner.textContent = `Excel取り込みエラー:\n${err.message}`;
  } finally {
    importButton.disabled = false;
    importButton.textContent = "Excelを取り込む";
    importFileInput.value = "";
  }
}

async function exportPlan() {
  errorBanner.hidden = true;
  exportButton.disabled = true;
  exportButton.textContent = "出力中...";

  try {
    const body = startDateInput.value ? { start_date: startDateInput.value } : {};
    const res = await fetch("/api/plan/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`APIエラー: ${res.status}`);
    }

    // Content-Disposition からファイル名を拾う(無ければ既定名)
    let filename = "production_plan.xlsx";
    const disp = res.headers.get("Content-Disposition") || "";
    const m = disp.match(/filename=([^;]+)/);
    if (m) filename = m[1].trim().replace(/["']/g, "");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    errorBanner.hidden = false;
    errorBanner.textContent = `Excel出力に失敗しました: ${err.message}`;
  } finally {
    exportButton.disabled = false;
    exportButton.textContent = "計画をExcel出力";
  }
}

async function loadBottleneckPlan() {
  const file = ledgerFileInput.files[0];
  if (!file) return;
  lastLedgerFile = file;

  errorBanner.hidden = true;
  bottleneckButton.disabled = true;
  bottleneckButton.textContent = "計画中...";

  try {
    const formData = new FormData();
    formData.append("file", file);
    if (startDateInput.value) formData.append("start_date", startDateInput.value);
    if (bnLinesInput.value.trim()) formData.append("lines", bnLinesInput.value.trim());
    const res = await fetch("/api/bottleneck/plan", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(typeof data.detail === "string" ? data.detail : `APIエラー: ${res.status}`);
    }
    renderBottleneckPlan(data);
    bnPanelEl.hidden = false;
    bnPanelEl.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    errorBanner.hidden = false;
    errorBanner.textContent = `ボトルネック計画の作成に失敗しました:\n${err.message}`;
  } finally {
    bottleneckButton.disabled = false;
    bottleneckButton.textContent = "台帳→ボトルネック計画";
    ledgerFileInput.value = "";
  }
}

function fmtNum(n) {
  return Math.round(n).toLocaleString();
}

function fmtMd(iso) {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function renderBottleneckPlan(data) {
  // KPIカード
  const s = data.summary;
  const cards = [
    ["選択シフト", data.shift_mode],
    ["日次能力(HAL)", fmtNum(data.daily_capacity)],
    ["必要日次レート", fmtNum(data.required_daily_rate)],
    ["対象ロット(製番)", `${s.lot_count} 件`],
    ["需要総数(残)", fmtNum(s.total_qty)],
    ["MIL納期超過", `${s.late_count} 件`],
    ...s.extra.map(([label, value]) => [label, typeof value === "number" ? fmtNum(value) : value]),
  ];
  bnKpisEl.innerHTML = cards
    .map(([label, value]) => `<div class="bn-kpi"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join("");

  // 納期遅れ解消の提案（遅れがあるときのみ、"ok"は非表示）
  const remedies = (data.remedies || []).filter((r) => r.kind !== "ok");
  if (remedies.length === 0) {
    bnRemediesEl.hidden = true;
  } else {
    bnRemediesEl.hidden = false;
    bnRemedyListEl.innerHTML = remedies
      .map((r) => `<div class="bn-remedy"><span class="bn-remedy-t">${r.title}</span><span class="bn-remedy-d">${r.detail}</span></div>`)
      .join("");
  }

  // 警告
  if (data.warnings.length === 0) {
    bnWarningsEl.hidden = true;
  } else {
    bnWarningsEl.hidden = false;
    bnWarningListEl.innerHTML = data.warnings.map((w) => `<div class="w-item">${w}</div>`).join("");
  }

  renderBnMatrix(data);
  renderBnMil(data.mil_lots);
  renderBnProgress(data);
}

function renderBnProgress(data) {
  const rows = data.progress || [];
  const days = rows.map((p) => fmtMd(p.day));
  const cell = (v, cls) => `<td class="${cls || ""}">${v == null ? "" : fmtNum(v)}</td>`;
  const head = `<thead><tr><th class="bn-c-metric">指標</th>${days.map((d) => `<th>${d}</th>`).join("")}</tr></thead>`;

  const metricRow = (label, pick, opts = {}) =>
    `<tr><td class="bn-c-metric">${label}</td>` +
    rows
      .map((p) => {
        const v = pick(p);
        const neg = opts.redNeg && v != null && v < 0;
        return cell(v, neg ? "bn-judge-late" : "");
      })
      .join("") +
    `</tr>`;

  let body = metricRow("計画", (p) => (p.plan ? p.plan : null)) + metricRow("計画累計", (p) => p.plan_cum);
  if (data.has_actuals) {
    body +=
      metricRow("実績", (p) => p.actual) +
      metricRow("実績累計", (p) => p.actual_cum) +
      metricRow("差", (p) => p.diff, { redNeg: true }) +
      metricRow("進捗(累計)", (p) => p.progress_cum, { redNeg: true });
  }
  bnProgressEl.innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderBnMatrix(data) {
  const days = data.working_days;
  const stages = data.stage_order;
  // (product, stage, day) -> qty
  const agg = new Map();
  const halFirstDay = new Map();
  for (const c of data.stage_allocation) {
    const key = `${c.product} ${c.stage_id} ${c.day}`;
    agg.set(key, (agg.get(key) || 0) + c.quantity);
    if (c.stage_id === "HAL") {
      const cur = halFirstDay.get(c.product);
      if (cur === undefined || c.day < cur) halFirstDay.set(c.product, c.day);
    }
  }
  const products = [...new Set(data.stage_allocation.map((c) => c.product))].sort((a, b) => {
    const da = halFirstDay.get(a) || "9999";
    const db = halFirstDay.get(b) || "9999";
    return da < db ? -1 : da > db ? 1 : a < b ? -1 : 1;
  });

  const head =
    `<thead><tr><th class="bn-c-prod">機種</th><th class="bn-c-stage">工程</th>` +
    days.map((d) => `<th>${fmtMd(d)}</th>`).join("") +
    `</tr></thead>`;

  const body = products
    .map((product) =>
      stages
        .map((stage, si) => {
          const cells = days
            .map((d) => {
              const q = agg.get(`${product} ${stage} ${d}`);
              return `<td>${q ? fmtNum(q) : ""}</td>`;
            })
            .join("");
          const prodCell = si === 0 ? `<td class="bn-c-prod" rowspan="${stages.length}">${product}</td>` : "";
          return `<tr>${prodCell}<td class="bn-c-stage" style="color:${BN_STAGE_COLOR[stage] || "var(--text)"}">${stage}</td>${cells}</tr>`;
        })
        .join("")
    )
    .join("");

  bnMatrixEl.innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderBnMil(lots) {
  const head =
    `<thead><tr><th>製番</th><th>機種</th><th class="bn-num">数量</th><th>MIL完成</th><th>納期</th><th>判定</th></tr></thead>`;
  const body = lots
    .map((lot) => {
      const late = lot.on_time === false;
      const judge = lot.on_time == null ? "—" : late ? "× 超過" : "○ 納期内";
      return (
        `<tr class="${late ? "bn-late" : ""}">` +
        `<td class="bn-mono">${lot.order_id}</td><td>${lot.product}</td>` +
        `<td class="bn-num">${fmtNum(lot.quantity)}</td>` +
        `<td class="bn-mono">${fmtMd(lot.completion_day)}</td>` +
        `<td class="bn-mono">${lot.due_date ? fmtMd(lot.due_date) : "—"}</td>` +
        `<td class="${late ? "bn-judge-late" : "bn-judge-ok"}">${judge}</td></tr>`
      );
    })
    .join("");
  bnMilEl.innerHTML = head + `<tbody>${body}</tbody>`;
}

async function exportBottleneckPlan() {
  if (!lastLedgerFile) return;
  errorBanner.hidden = true;
  bnExportButton.disabled = true;
  bnExportButton.textContent = "出力中...";

  try {
    const formData = new FormData();
    formData.append("file", lastLedgerFile);
    if (startDateInput.value) formData.append("start_date", startDateInput.value);
    if (bnLinesInput.value.trim()) formData.append("lines", bnLinesInput.value.trim());
    const res = await fetch("/api/bottleneck/export", { method: "POST", body: formData });
    if (!res.ok) {
      let detail = `APIエラー: ${res.status}`;
      try {
        const data = await res.json();
        if (data.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
      } catch (_) {}
      throw new Error(detail);
    }

    let filename = "bottleneck_plan.xlsx";
    const disp = res.headers.get("Content-Disposition") || "";
    const m = disp.match(/filename=([^;]+)/);
    if (m) filename = m[1].trim().replace(/["']/g, "");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    errorBanner.hidden = false;
    errorBanner.textContent = `ボトルネック計画のExcel出力に失敗しました:\n${err.message}`;
  } finally {
    bnExportButton.disabled = false;
    bnExportButton.textContent = "この計画をExcel出力";
  }
}

async function validateAgainstFelica() {
  const felica = felicaFileInput.files[0];
  if (!felica || !lastLedgerFile) return;

  errorBanner.hidden = true;
  bnValidateButton.disabled = true;
  bnValidateButton.textContent = "照合中...";

  try {
    const formData = new FormData();
    formData.append("file", lastLedgerFile);
    formData.append("felica_file", felica);
    if (startDateInput.value) formData.append("start_date", startDateInput.value);
    if (bnLinesInput.value.trim()) formData.append("lines", bnLinesInput.value.trim());
    const res = await fetch("/api/bottleneck/validate", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(typeof data.detail === "string" ? data.detail : `APIエラー: ${res.status}`);
    }
    renderValidation(data);
    bnValidationEl.hidden = false;
    bnValidationEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    errorBanner.hidden = false;
    errorBanner.textContent = `実計画との照合に失敗しました:\n${err.message}`;
  } finally {
    bnValidateButton.disabled = false;
    bnValidateButton.textContent = "実計画と照合(精度検証)";
    felicaFileInput.value = "";
  }
}

function offStr(o) {
  return `ANT ${o.ANT} / TAL ${o.TAL} / HAL ${o.HAL} / MIL ${o.MIL}`;
}

function renderValidation(d) {
  lastValidation = d;
  const row = (label, cur, rec) =>
    `<tr><td>${label}</td><td class="bn-num">${cur}</td><td class="bn-num">${rec}</td></tr>`;
  const better = (c, r) => (r < c ? ' class="bn-improved"' : "");
  bnValidationBodyEl.innerHTML =
    `<p class="bn-validation-note">FeliCa実計画の${d.felica_lots}製番のうち一致した${d.current.matched}製番で照合（単位=稼働日）。推奨較正後の値は下の「推奨値をconfigに反映」で書き戻せます。</p>` +
    `<table class="bn-vtable"><thead><tr><th>指標</th><th>現状</th><th>推奨較正後</th></tr></thead><tbody>` +
    `<tr><td>完成日 MAE</td><td class="bn-num">${d.current.completion_mae}</td><td class="bn-num"${better(d.current.completion_mae, d.recommended.completion_mae)}>${d.recommended.completion_mae}</td></tr>` +
    `<tr><td>完成日 バイアス(our−実)</td><td class="bn-num">${d.current.completion_bias}</td><td class="bn-num">${d.recommended.completion_bias}</td></tr>` +
    `<tr><td>投入日 MAE</td><td class="bn-num">${d.current.start_mae}</td><td class="bn-num"${better(d.current.start_mae, d.recommended.start_mae)}>${d.recommended.start_mae}</td></tr>` +
    `<tr><td>工程オフセット</td><td>${offStr(d.current_offsets)}</td><td>${offStr(d.recommended_offsets)}</td></tr>` +
    `<tr><td>A勤割合</td><td class="bn-num">${d.current_a_shift_fraction}</td><td class="bn-num">${d.recommended_a_shift_fraction}</td></tr>` +
    `</tbody></table>` +
    renderDerivedOffsets(d.derived_offsets_by_product);

  // 推奨値が現状と異なるときだけ「configに反映」ボタンを出す
  const differs =
    offStr(d.current_offsets) !== offStr(d.recommended_offsets) ||
    d.current_a_shift_fraction !== d.recommended_a_shift_fraction;
  bnApplyResultEl.textContent = differs ? "" : "現状の config が較正の最適値と一致しています（反映不要）。";
  bnApplyButton.hidden = !differs;
}

async function applyCalibration() {
  if (!lastValidation) return;
  bnApplyButton.disabled = true;
  bnApplyButton.textContent = "反映中...";
  try {
    const res = await fetch("/api/bottleneck/apply-calibration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offsets: lastValidation.recommended_offsets,
        a_shift_fraction: lastValidation.recommended_a_shift_fraction,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(typeof data.detail === "string" ? data.detail : `APIエラー: ${res.status}`);
    }
    bnApplyResultEl.textContent = `config に反映しました（オフセット ${offStr(data.offsets)} / A勤割合 ${data.a_shift_fraction}）。次回の立案・照合から有効です。`;
    bnApplyButton.hidden = true;
  } catch (err) {
    bnApplyResultEl.textContent = `反映に失敗しました: ${err.message}`;
  } finally {
    bnApplyButton.disabled = false;
    bnApplyButton.textContent = "推奨値をconfigに反映";
  }
}

function renderDerivedOffsets(derived) {
  if (!derived) return "";
  const stages = ["ANT", "TAL", "MIL"];
  const products = [...new Set(stages.flatMap((s) => Object.keys(derived[s] || {})))].sort();
  if (products.length === 0) return "";
  const head = `<tr><th>機種</th>${stages.map((s) => `<th class="bn-num">${s}</th>`).join("")}</tr>`;
  const rows = products
    .map((p) => {
      const cells = stages.map((s) => `<td class="bn-num">${derived[s] && derived[s][p] != null ? derived[s][p] : "-"}</td>`).join("");
      return `<tr><td>${p}</td>${cells}</tr>`;
    })
    .join("");
  return (
    `<p class="bn-validation-note" style="margin-top:10px">機種別 実リード由来オフセット（FeliCaの投入→完成スパン由来。config の <code>stageFlows[].leadOffsetByProduct</code> に手動反映で機種別に動的化できます）</p>` +
    `<table class="bn-vtable"><thead>${head}</thead><tbody>${rows}</tbody></table>`
  );
}

runButton.addEventListener("click", runPlan);
exportButton.addEventListener("click", exportPlan);
importButton.addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", importExcel);
bottleneckButton.addEventListener("click", () => ledgerFileInput.click());
ledgerFileInput.addEventListener("change", loadBottleneckPlan);
bnExportButton.addEventListener("click", exportBottleneckPlan);
bnValidateButton.addEventListener("click", () => felicaFileInput.click());
felicaFileInput.addEventListener("change", validateAgainstFelica);
bnApplyButton.addEventListener("click", applyCalibration);
runPlan();
