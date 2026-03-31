import type { AppLocale, TrainingPlan } from "@/types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeFilePart(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "plan";
  }

  return trimmed
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .toLowerCase();
}

function formatDate(locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function buildPlanExportHtml(plan: TrainingPlan, locale: AppLocale): string {
  const isZh = locale === "zh-CN";
  const exportedAtLabel = isZh ? "导出日期" : "Exported At";
  const weekLabel = isZh ? "第" : "Week ";
  const weekSuffix = isZh ? "周" : "";
  const dayLabel = isZh ? "第" : "Day ";
  const daySuffix = isZh ? "天" : "";
  const headers = isZh
    ? ["动作", "组数", "次数", "RPE", "备注", "替代动作"]
    : ["Exercise", "Sets", "Rep Range", "RPE", "Notes", "Alternatives"];

  const weeksHtml = plan.weeks
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((week) => {
      const daysHtml = [...week.days]
        .sort((a, b) => a.dayNumber - b.dayNumber)
        .map((day) => {
          const rows = day.exercises.length
            ? day.exercises
                .map((exercise) => {
                  const alternatives = exercise.alternativeExercises?.length
                    ? exercise.alternativeExercises.join(" / ")
                    : "-";

                  return `
                    <tr>
                      <td>${escapeHtml(exercise.name)}</td>
                      <td>${exercise.sets}</td>
                      <td>${escapeHtml(exercise.repRange)}</td>
                      <td>${exercise.targetRpe}</td>
                      <td>${escapeHtml(exercise.notes || "-")}</td>
                      <td>${escapeHtml(alternatives)}</td>
                    </tr>
                  `;
                })
                .join("")
            : `<tr><td colspan="6">${isZh ? "暂无动作" : "No exercises"}</td></tr>`;

          return `
            <section class="day-section">
              <h3>${dayLabel}${day.dayNumber}${daySuffix} - ${escapeHtml(day.title)}</h3>
              <p class="day-note">${escapeHtml(day.notes || (isZh ? "无备注" : "No notes"))}</p>
              <table>
                <thead>
                  <tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </section>
          `;
        })
        .join("");

      return `
        <section class="week-section">
          <h2>${weekLabel}${week.weekNumber}${weekSuffix}</h2>
          ${daysHtml}
        </section>
      `;
    })
    .join("");

  return `
    <div class="pdf-container">
      <header>
        <h1>${escapeHtml(plan.name)}</h1>
        <p>${exportedAtLabel}: ${formatDate(locale)}</p>
      </header>
      ${weeksHtml}
    </div>
  `;
}

export async function exportTrainingPlanPdf(plan: TrainingPlan, locale: AppLocale): Promise<void> {
  if (!plan.weeks.length) {
    throw new Error(locale === "zh-CN" ? "当前计划为空，无法导出 PDF。" : "Current plan is empty. Unable to export PDF.");
  }

  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-10000px";
  wrapper.style.top = "0";
  wrapper.style.width = "920px";
  wrapper.style.background = "#ffffff";
  wrapper.style.padding = "24px";
  wrapper.style.fontFamily = "Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  wrapper.style.color = "#0f172a";
  wrapper.style.lineHeight = "1.45";
  wrapper.innerHTML = `
    <style>
      .pdf-container header { margin-bottom: 18px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; }
      .pdf-container h1 { margin: 0 0 6px 0; font-size: 24px; }
      .pdf-container p { margin: 0; font-size: 13px; color: #334155; }
      .week-section { margin-top: 18px; }
      .week-section h2 { margin: 0 0 10px 0; font-size: 18px; color: #0f766e; }
      .day-section { margin-bottom: 14px; page-break-inside: avoid; }
      .day-section h3 { margin: 0 0 4px 0; font-size: 14px; }
      .day-note { margin: 0 0 8px 0; font-size: 12px; color: #475569; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
      th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; word-break: break-word; }
      th { background: #f1f5f9; font-weight: 600; }
      td:nth-child(1) { width: 20%; }
      td:nth-child(2) { width: 8%; }
      td:nth-child(3) { width: 12%; }
      td:nth-child(4) { width: 8%; }
      td:nth-child(5) { width: 24%; }
      td:nth-child(6) { width: 28%; }
    </style>
    ${buildPlanExportHtml(plan, locale)}
  `;

  document.body.appendChild(wrapper);

  try {
    const canvas = await html2canvas(wrapper, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;

    const imageData = canvas.toDataURL("image/png");
    const imageHeight = (canvas.height * contentWidth) / canvas.width;

    let remainingHeight = imageHeight;
    let offsetY = margin;

    pdf.addImage(imageData, "PNG", margin, offsetY, contentWidth, imageHeight);
    remainingHeight -= contentHeight;

    while (remainingHeight > 0) {
      pdf.addPage();
      offsetY = margin - (imageHeight - remainingHeight);
      pdf.addImage(imageData, "PNG", margin, offsetY, contentWidth, imageHeight);
      remainingHeight -= contentHeight;
    }

    const fileName = `liftcut-plan-${sanitizeFilePart(plan.name)}.pdf`;
    pdf.save(fileName);
  } finally {
    document.body.removeChild(wrapper);
  }
}
