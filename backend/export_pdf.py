"""Export schedule_result.json to an A4 landscape PDF summary.

Page 1: simplified Gantt chart grouped by equipment.
Page 2: warnings list.

Expected schedule_result.json shape is the same as export_excel.py.
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.backends.backend_pdf import PdfPages

A4_LANDSCAPE = (11.69, 8.27)

# Best-effort Japanese glyph support: falls back silently to the default
# font (with missing-glyph boxes) if none of these are installed.
plt.rcParams["font.family"] = [
    "IPAexGothic", "Noto Sans CJK JP", "Yu Gothic", "Meiryo", "MS Gothic", "sans-serif",
]
plt.rcParams["axes.unicode_minus"] = False


def load_data(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def parse_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).replace("Z", "+00:00")
    return datetime.fromisoformat(text)


def draw_gantt_page(pdf, tasks):
    fig, ax = plt.subplots(figsize=A4_LANDSCAPE)

    valid_tasks = []
    for task in tasks:
        start = parse_datetime(task.get("start"))
        end = parse_datetime(task.get("end"))
        if start is None or end is None:
            continue
        valid_tasks.append((task, start, end))

    if not valid_tasks:
        ax.text(0.5, 0.5, "表示できるスケジュールデータがありません", ha="center", va="center")
        ax.axis("off")
        fig.suptitle("設備別ガントチャート", fontsize=16, fontweight="bold")
        pdf.savefig(fig)
        plt.close(fig)
        return

    equipments = sorted({task.get("equipment", "不明") for task, _, _ in valid_tasks})
    equipment_pos = {eq: i for i, eq in enumerate(equipments)}
    cmap = plt.get_cmap("tab20")
    items = sorted({task.get("item", "") for task, _, _ in valid_tasks})
    item_color = {item: cmap(i % 20) for i, item in enumerate(items)}

    for task, start, end in valid_tasks:
        equipment = task.get("equipment", "不明")
        y = equipment_pos[equipment]
        duration = end - start
        color = item_color.get(task.get("item", ""), "steelblue")
        ax.barh(y, duration, left=start, height=0.5, color=color, edgecolor="black")
        label = f"{task.get('item', '')} ({task.get('quantity', '')})"
        ax.text(start + duration / 2, y, label, ha="center", va="center", fontsize=7, color="white")

    ax.set_yticks(list(equipment_pos.values()))
    ax.set_yticklabels(list(equipment_pos.keys()))
    ax.xaxis_date()
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m/%d %H:%M"))
    fig.autofmt_xdate()
    ax.set_xlabel("時間")
    ax.set_ylabel("設備")
    ax.set_title("設備別ガントチャート(簡易版)", fontsize=14, fontweight="bold")
    ax.grid(True, axis="x", linestyle="--", alpha=0.5)

    fig.tight_layout()
    pdf.savefig(fig)
    plt.close(fig)


def draw_warnings_page(pdf, warnings):
    fig, ax = plt.subplots(figsize=A4_LANDSCAPE)
    ax.axis("off")
    ax.set_title("警告一覧", fontsize=16, fontweight="bold", loc="left")

    if not warnings:
        ax.text(0.02, 0.9, "警告はありません", fontsize=12, va="top", transform=ax.transAxes)
    else:
        lines = [f"{i}. {warning}" for i, warning in enumerate(warnings, start=1)]
        text = "\n".join(lines)
        ax.text(0.02, 0.92, text, fontsize=11, va="top", ha="left", transform=ax.transAxes, wrap=True)

    pdf.savefig(fig)
    plt.close(fig)


def build_pdf(data, output_path):
    tasks = data.get("tasks", [])
    warnings = data.get("warnings", [])
    with PdfPages(output_path) as pdf:
        draw_gantt_page(pdf, tasks)
        draw_warnings_page(pdf, warnings)


def main():
    parser = argparse.ArgumentParser(description="Export schedule_result.json to a PDF summary")
    parser.add_argument("--input", default="schedule_result.json", help="Input JSON path")
    parser.add_argument("--output", default="schedule_result.pdf", help="Output PDF path")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise SystemExit(f"入力ファイルが見つかりません: {input_path}")

    data = load_data(input_path)
    build_pdf(data, args.output)
    print(f"PDFファイルを出力しました: {args.output}")


if __name__ == "__main__":
    main()
