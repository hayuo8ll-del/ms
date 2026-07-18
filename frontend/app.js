const runButton = document.getElementById("run-plan");
const summaryEl = document.getElementById("summary");
const ordersBody = document.querySelector("#orders-table tbody");
const stepsBody = document.querySelector("#steps-table tbody");
const workCenterLoadEl = document.getElementById("work-center-load");
const errorBanner = document.getElementById("error-banner");

function formatCurrency(value) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function renderSummary(summary) {
  const cards = [
    { label: "受注数", value: `${summary.total_orders} 件` },
    { label: "納期遵守", value: `${summary.on_time_orders} 件` },
    { label: "遅延", value: `${summary.delayed_orders} 件` },
    { label: "総コスト", value: formatCurrency(summary.total_cost) },
    { label: "定時稼働", value: `${summary.total_regular_hours.toFixed(1)} h` },
    { label: "残業", value: `${summary.total_overtime_hours.toFixed(1)} h` },
  ];

  summaryEl.innerHTML = cards
    .map(
      (c) => `
        <div class="stat-card">
          <div class="label">${c.label}</div>
          <div class="value">${c.value}</div>
        </div>`
    )
    .join("");
}

function renderOrders(orders) {
  ordersBody.innerHTML = orders
    .map((o) => {
      const late = o.delay_days > 0;
      const badge = late
        ? `<span class="badge late">遅延 ${o.delay_days}日</span>`
        : `<span class="badge ok">順調</span>`;
      return `
        <tr>
          <td>${badge}</td>
          <td>${o.order_id}</td>
          <td>${o.product_name}</td>
          <td>${o.due_date}</td>
          <td>${o.completion_date}</td>
          <td>${late ? o.delay_days + "日" : "-"}</td>
          <td>${formatCurrency(o.total_cost)}</td>
        </tr>`;
    })
    .join("");
}

function renderSteps(orders) {
  const rows = [];
  for (const order of orders) {
    for (const step of order.steps) {
      rows.push(`
        <tr>
          <td>${order.order_id}</td>
          <td>${step.process_id}</td>
          <td>${step.start_date}</td>
          <td>${step.end_date}</td>
          <td>${step.regular_hours.toFixed(1)}</td>
          <td>${step.overtime_hours.toFixed(1)}</td>
          <td>${formatCurrency(step.cost)}</td>
        </tr>`);
    }
  }
  stepsBody.innerHTML = rows.join("");
}

function renderWorkCenterLoad(orders) {
  const totals = new Map();
  for (const order of orders) {
    for (const step of order.steps) {
      const t = totals.get(step.process_id) || { regular: 0, overtime: 0 };
      t.regular += step.regular_hours;
      t.overtime += step.overtime_hours;
      totals.set(step.process_id, t);
    }
  }

  const maxHours = Math.max(1, ...[...totals.values()].map((t) => t.regular + t.overtime));

  workCenterLoadEl.innerHTML = [...totals.entries()]
    .map(([processId, t]) => {
      const total = t.regular + t.overtime;
      const regularPct = (t.regular / maxHours) * 100;
      const overtimePct = (t.overtime / maxHours) * 100;
      return `
        <div class="wc-row">
          <div class="wc-name">${processId}</div>
          <div class="wc-bar">
            <div class="regular" style="width:${regularPct}%"></div>
            <div class="overtime" style="width:${overtimePct}%"></div>
          </div>
          <div class="wc-hours">${total.toFixed(1)} h</div>
        </div>`;
    })
    .join("");
}

async function runPlan() {
  errorBanner.hidden = true;
  runButton.disabled = true;
  runButton.textContent = "立案中...";

  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      throw new Error(`APIエラー: ${res.status}`);
    }
    const result = await res.json();
    renderSummary(result.summary);
    renderOrders(result.orders);
    renderSteps(result.orders);
    renderWorkCenterLoad(result.orders);
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
