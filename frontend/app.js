const runButton = document.getElementById("run-plan");
const startDateInput = document.getElementById("start-date");
const kpisEl = document.getElementById("kpis");
const warningsEl = document.getElementById("warnings");
const warningListEl = document.getElementById("warning-list");
const ganttEl = document.getElementById("gantt");
const utilGridEl = document.getElementById("util-grid");
const errorBanner = document.getElementById("error-banner");

const HOUR_PX = 26;

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
  } catch (err) {
    errorBanner.hidden = false;
    errorBanner.textContent = `計画の立案に失敗しました: ${err.message}`;
  } finally {
    runButton.disabled = false;
    runButton.textContent = "計画を立案する";
  }
}

runButton.addEventListener("click", runPlan);
runPlan();
