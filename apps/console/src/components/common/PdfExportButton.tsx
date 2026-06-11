import { DownloadOutlined } from "@ant-design/icons";
import { Button, message } from "antd";
import jsPDF from "jspdf";
import type { ReviewApplication } from "../../domain/application/types";

type Props = {
  application?: ReviewApplication;
  pageName: string;
};

export function PdfExportButton({ application, pageName }: Props) {
  const [messageApi, contextHolder] = message.useMessage();

  const onDownload = async () => {
    if (!application) return;
    try {
      await downloadApplicationPdf(application, pageName);
      messageApi.success("PDF downloaded");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Could not generate PDF");
    }
  };

  return (
    <>
      {contextHolder}
      <Button icon={<DownloadOutlined />} onClick={onDownload} disabled={!application}>
        PDF
      </Button>
    </>
  );
}

export async function downloadApplicationPdf(application: ReviewApplication, pageName: string): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 42;
  let y = margin;
  const lineHeight = 15;

  const write = (text: string, options?: { bold?: boolean; gap?: number }) => {
    doc.setFont("helvetica", options?.bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, 528);
    doc.text(lines, margin, y);
    y += lines.length * lineHeight + (options?.gap ?? 6);
    if (y > 724) {
      doc.addPage();
      y = margin;
    }
  };

  write("TTB Label Review Packet", { bold: true, gap: 10 });
  write(`${pageName} export`);
  write(`Application: ${application.title}`, { bold: true });
  write(`Status: ${application.review?.reviewerOverallStatus || application.status}`);
  write(`Source: ${application.source} | Submitter: ${application.submitter}`);
  write(`Created: ${application.createdAt}`);
  write("Expected Application Fields", { bold: true, gap: 8 });

  for (const [key, value] of Object.entries(application.expectedFields)) {
    write(`${key}: ${value || "Not supplied"}`);
  }

  if (application.images[0]) {
    write("Image Evidence", { bold: true, gap: 8 });
    write(`${application.images[0].name} (${application.images[0].role})`);
    await addImageIfPossible(doc, application.images[0].url, margin, y);
    y += 152;
  }

  write("Field Matches", { bold: true, gap: 8 });
  for (const field of application.review?.fields || []) {
    const status = field.reviewerStatus || field.status;
    const reason = field.reviewerReason || field.reason;
    write(`${field.label}: ${status.toUpperCase()}`, { bold: true });
    write(`Expected: ${field.expected}`);
    write(`Extracted: ${field.extracted}`);
    write(`Evidence: ${field.evidence.map((evidence) => evidence.excerpt).join(" | ")}`);
    write(`Reasoning: ${reason}`);
  }

  write("Reviewer Notes", { bold: true, gap: 8 });
  write(application.review?.reviewerNotes || "No reviewer notes recorded.");
  write("Processing Trace", { bold: true, gap: 8 });
  for (const line of application.review?.engineTrace || ["Not processed yet"]) write(line);

  doc.save(`${application.id}-${pageName.toLowerCase().replace(/\s+/g, "-")}.pdf`);
}

async function addImageIfPossible(doc: jsPDF, src: string, x: number, y: number): Promise<void> {
  const image = await loadImage(src).catch(() => null);
  if (!image) return;
  const canvas = document.createElement("canvas");
  const scale = Math.min(220 / image.naturalWidth, 140 / image.naturalHeight, 1);
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  doc.addImage(canvas.toDataURL("image/png"), "PNG", x, y, canvas.width, canvas.height);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
