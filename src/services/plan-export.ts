import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import type { AppLocale, TrainingPlan } from "@/types";

type PlanExportErrorCode =
  | "NO_PLAN"
  | "FONT_LOAD_FAILED"
  | "PDF_RENDER_FAILED"
  | "PDF_SAVE_FAILED";

class PlanExportError extends Error {
  constructor(public readonly code: PlanExportErrorCode, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PlanExportError";
  }
}

const CJK_FONT_URL = "/fonts/NotoSansCJKsc-VF.ttf";
const CJK_FONT_VFS_NAME = "NotoSansCJKsc-VF.ttf";
const CJK_FONT_NAME = "NotoSansCJKsc";

let cachedChineseFontBase64: string | null = null;

function localize(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

function formatDate(locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function ensureChineseFont(pdf: jsPDF, locale: AppLocale): Promise<void> {
  try {
    if (!cachedChineseFontBase64) {
      const response = await fetch(CJK_FONT_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const fontBuffer = await response.arrayBuffer();
      cachedChineseFontBase64 = arrayBufferToBase64(fontBuffer);
    }

    pdf.addFileToVFS(CJK_FONT_VFS_NAME, cachedChineseFontBase64);
    pdf.addFont(CJK_FONT_VFS_NAME, CJK_FONT_NAME, "normal");
    pdf.setFont(CJK_FONT_NAME, "normal");
  } catch (error) {
    throw new PlanExportError(
      "FONT_LOAD_FAILED",
      localize(locale, "中文字体加载失败，无法导出 PDF。", "Failed to load Chinese font for PDF export."),
      error,
    );
  }
}

function getTableHead(locale: AppLocale): string[][] {
  return [
    locale === "zh-CN"
      ? ["动作", "组数", "次数", "RPE", "备注", "替代动作"]
      : ["Exercise", "Sets", "Rep Range", "RPE", "Notes", "Alternatives"],
  ];
}

function getWeekLabel(locale: AppLocale, weekNumber: number): string {
  return localize(locale, `第 ${weekNumber} 周`, `Week ${weekNumber}`);
}

function getDayLabel(locale: AppLocale, dayNumber: number): string {
  return localize(locale, `第 ${dayNumber} 天`, `Day ${dayNumber}`);
}

export async function exportTrainingPlanPdf(plan: TrainingPlan, locale: AppLocale): Promise<void> {
  const weeks = [...plan.weeks].sort((a, b) => a.weekNumber - b.weekNumber);

  if (!weeks.length) {
    throw new PlanExportError(
      "NO_PLAN",
      localize(locale, "当前计划为空，无法导出 PDF。", "Current plan is empty. Unable to export PDF."),
    );
  }

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
  });

  try {
    if (locale === "zh-CN") {
      await ensureChineseFont(pdf, locale);
    } else {
      pdf.setFont("helvetica", "normal");
    }

    const left = 24;
    const right = 24;
    const pageHeight = pdf.internal.pageSize.getHeight();
    const contentBottom = pageHeight - 24;

    pdf.setFontSize(18);
    pdf.text(plan.name, left, 32);

    pdf.setFontSize(10);
    pdf.text(
      localize(locale, `导出日期：${formatDate(locale)}`, `Exported at: ${formatDate(locale)}`),
      left,
      50,
    );

    let cursorY = 68;

    for (const week of weeks) {
      if (cursorY > contentBottom - 80) {
        pdf.addPage();
        if (locale === "zh-CN") {
          pdf.setFont(CJK_FONT_NAME, "normal");
        }
        cursorY = 32;
      }

      pdf.setFontSize(13);
      pdf.text(getWeekLabel(locale, week.weekNumber), left, cursorY);
      cursorY += 12;

      const sortedDays = [...week.days].sort((a, b) => a.dayNumber - b.dayNumber);

      for (const day of sortedDays) {
        if (cursorY > contentBottom - 120) {
          pdf.addPage();
          if (locale === "zh-CN") {
            pdf.setFont(CJK_FONT_NAME, "normal");
          }
          cursorY = 32;
        }

        pdf.setFontSize(11);
        pdf.text(`${getDayLabel(locale, day.dayNumber)} - ${day.title}`, left, cursorY);
        cursorY += 10;

        pdf.setFontSize(9);
        const noteLine = localize(locale, "备注", "Notes");
        pdf.text(`${noteLine}: ${day.notes || "-"}`, left, cursorY);
        cursorY += 6;

        const rows = day.exercises.length
          ? day.exercises.map((exercise) => [
              exercise.name,
              String(exercise.sets),
              exercise.repRange,
              String(exercise.targetRpe),
              exercise.notes || "-",
              exercise.alternativeExercises?.length ? exercise.alternativeExercises.join(" / ") : "-",
            ])
          : [[localize(locale, "暂无动作", "No exercises"), "-", "-", "-", "-", "-"]];

        autoTable(pdf, {
          startY: cursorY,
          head: getTableHead(locale),
          body: rows,
          theme: "grid",
          margin: { left, right },
          styles: {
            font: locale === "zh-CN" ? CJK_FONT_NAME : "helvetica",
            fontSize: 9,
            cellPadding: 4,
            lineColor: [203, 213, 225],
            lineWidth: 0.5,
          },
          headStyles: {
            fillColor: [241, 245, 249],
            textColor: [15, 23, 42],
            fontStyle: "bold",
          },
          bodyStyles: {
            textColor: [30, 41, 59],
          },
          pageBreak: "auto",
        });

        const autoTableState = pdf as jsPDF & {
          lastAutoTable?: {
            finalY: number;
          };
        };

        cursorY = (autoTableState.lastAutoTable?.finalY ?? cursorY + 20) + 14;
      }
    }

    try {
      const fileName = `liftcut-plan-${sanitizeFilePart(plan.name)}.pdf`;
      pdf.save(fileName);
    } catch (saveError) {
      throw new PlanExportError(
        "PDF_SAVE_FAILED",
        localize(locale, "PDF 文件保存失败。", "Failed to save PDF file."),
        saveError,
      );
    }
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[plan-export] PDF export failed", {
        locale,
        planId: plan.id,
        planName: plan.name,
        weeks: plan.weeks.length,
        error,
      });
    }

    if (error instanceof PlanExportError) {
      throw error;
    }

    throw new PlanExportError(
      "PDF_RENDER_FAILED",
      localize(locale, "导出 PDF 失败，请稍后重试。", "Failed to export PDF. Please try again."),
      error,
    );
  }
}
