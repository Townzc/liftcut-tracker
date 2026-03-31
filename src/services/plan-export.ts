import type { AppLocale, PlanWeek, TrainingPlan } from "@/types";

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

  const normalized = trimmed
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return normalized || "plan";
}

function formatDate(locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function weekLabel(locale: AppLocale, weekNumber: number): string {
  return locale === "zh-CN" ? `第${weekNumber}周` : `Week ${weekNumber}`;
}

function dayLabel(locale: AppLocale, dayNumber: number): string {
  return locale === "zh-CN" ? `Day ${dayNumber}` : `Day ${dayNumber}`;
}

function createRenderContainer(): HTMLDivElement {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "920px";
  container.style.background = "#ffffff";
  container.style.padding = "24px";
  container.style.fontFamily = "Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  container.style.color = "#0f172a";
  container.style.lineHeight = "1.45";

  const style = document.createElement("style");
  style.textContent = `
    .pdf-section { margin-bottom: 12px; }
    .pdf-header { margin-bottom: 14px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; }
    .pdf-header h1 { margin: 0 0 6px 0; font-size: 24px; }
    .pdf-header p { margin: 0; font-size: 13px; color: #334155; }
    .pdf-week-title { margin: 0 0 12px 0; font-size: 18px; color: #0f766e; }
    .pdf-day { margin-bottom: 12px; page-break-inside: avoid; }
    .pdf-day h3 { margin: 0 0 4px 0; font-size: 14px; }
    .pdf-day-note { margin: 0 0 8px 0; font-size: 12px; color: #475569; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
    th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; word-break: break-word; }
    th { background: #f1f5f9; font-weight: 600; }
  `;

  container.appendChild(style);
  return container;
}

function buildTableHeaders(locale: AppLocale): string {
  const headers = locale === "zh-CN"
    ? ["动作", "组数", "次数", "RPE", "备注", "替代动作"]
    : ["Exercise", "Sets", "Rep Range", "RPE", "Notes", "Alternatives"];

  return headers.map((item) => `<th>${item}</th>`).join("");
}

function buildWeekSectionHtml(
  plan: TrainingPlan,
  week: PlanWeek,
  locale: AppLocale,
  showHeader: boolean,
): string {
  const exportedAtLabel = locale === "zh-CN" ? "导出日期" : "Exported At";
  const noNotes = locale === "zh-CN" ? "无备注" : "No notes";
  const noExercises = locale === "zh-CN" ? "暂无动作" : "No exercises";

  const headerHtml = showHeader
    ? `
      <header class="pdf-header">
        <h1>${escapeHtml(plan.name)}</h1>
        <p>${exportedAtLabel}: ${formatDate(locale)}</p>
      </header>
    `
    : "";

  const dayHtml = [...week.days]
    .sort((a, b) => a.dayNumber - b.dayNumber)
    .map((day) => {
      const rowsHtml = day.exercises.length
        ? day.exercises.map((exercise) => {
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
        }).join("")
        : `<tr><td colspan="6">${noExercises}</td></tr>`;

      return `
        <section class="pdf-day">
          <h3>${dayLabel(locale, day.dayNumber)} - ${escapeHtml(day.title)}</h3>
          <p class="pdf-day-note">${escapeHtml(day.notes || noNotes)}</p>
          <table>
            <thead>
              <tr>${buildTableHeaders(locale)}</tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");

  return `
    <section class="pdf-section">
      ${headerHtml}
      <h2 class="pdf-week-title">${weekLabel(locale, week.weekNumber)}</h2>
      ${dayHtml}
    </section>
  `;
}

async function renderSectionCanvas(
  html2canvas: typeof import("html2canvas").default,
  container: HTMLDivElement,
  sectionHtml: string,
): Promise<HTMLCanvasElement> {
  const section = document.createElement("div");
  section.innerHTML = sectionHtml;
  container.appendChild(section);

  try {
    return await html2canvas(section, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      windowWidth: section.scrollWidth,
      windowHeight: section.scrollHeight,
    });
  } finally {
    container.removeChild(section);
  }
}

function appendCanvasToPdf(
  pdf: import("jspdf").jsPDF,
  canvas: HTMLCanvasElement,
  options: { margin: number; contentWidth: number; contentHeight: number },
  state: { hasRendered: boolean },
): void {
  const imageData = canvas.toDataURL("image/png");
  const imageHeight = (canvas.height * options.contentWidth) / canvas.width;

  let consumedHeight = 0;
  while (consumedHeight < imageHeight - 0.1) {
    if (state.hasRendered) {
      pdf.addPage();
    }

    const y = options.margin - consumedHeight;
    pdf.addImage(imageData, "PNG", options.margin, y, options.contentWidth, imageHeight);

    consumedHeight += options.contentHeight;
    state.hasRendered = true;
  }
}

export async function exportTrainingPlanPdf(plan: TrainingPlan, locale: AppLocale): Promise<void> {
  const weeks = [...plan.weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  if (!weeks.length) {
    throw new Error(locale === "zh-CN" ? "当前计划为空，无法导出 PDF。" : "Current plan is empty. Unable to export PDF.");
  }

  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
  });

  const margin = 20;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;

  const container = createRenderContainer();
  document.body.appendChild(container);

  const renderState = { hasRendered: false };

  try {
    for (let index = 0; index < weeks.length; index += 1) {
      const week = weeks[index]!;
      const sectionHtml = buildWeekSectionHtml(plan, week, locale, index === 0);
      const canvas = await renderSectionCanvas(html2canvas, container, sectionHtml);
      appendCanvasToPdf(
        pdf,
        canvas,
        { margin, contentWidth, contentHeight },
        renderState,
      );
    }

    if (!renderState.hasRendered) {
      throw new Error(locale === "zh-CN" ? "当前计划为空，无法导出 PDF。" : "Current plan is empty. Unable to export PDF.");
    }

    const fileName = `liftcut-plan-${sanitizeFilePart(plan.name)}.pdf`;
    pdf.save(fileName);
  } catch (error) {
    console.error("Failed to export training plan PDF:", error);
    throw new Error(locale === "zh-CN" ? "导出 PDF 失败，请稍后重试。" : "Failed to export PDF. Please try again.");
  } finally {
    document.body.removeChild(container);
  }
}
