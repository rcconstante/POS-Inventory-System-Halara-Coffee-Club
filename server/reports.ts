import type Database from "better-sqlite3";
import PDFDocument from "pdfkit";
import type { Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";

export interface ReportRange {
  from: string;
  to: string;
}

export interface SalesReport {
  range: ReportRange;
  summary: { totalSalesCentavos: number; totalTransactions: number; averageSaleCentavos: number };
  daily: Array<{ date: string; totalCentavos: number }>;
  topProducts: Array<{ name: string; quantity: number; totalCentavos: number }>;
  payments: Array<{ method: string; transactions: number; totalCentavos: number }>;
  transactions: Array<{
    receipt: string;
    date: string;
    payment: string;
    status: string;
    totalCentavos: number;
    items: string;
  }>;
  lines: Array<{
    receipt: string;
    date: string;
    productName: string;
    quantity: number;
    unitPriceCentavos: number;
    lineTotalCentavos: number;
    payment: string;
    status: string;
    orderTotalCentavos: number;
  }>;
}

export function buildSalesReport(db: Database.Database, range: ReportRange): SalesReport {
  const summary = db.prepare(`
    SELECT COALESCE(SUM(total_centavos), 0) AS total,
           COUNT(*) AS count,
           COALESCE(ROUND(AVG(total_centavos)), 0) AS average
    FROM sales
    WHERE business_date BETWEEN ? AND ? AND status = 'Completed'
  `).get(range.from, range.to) as { total: number; count: number; average: number };

  const daily = db.prepare(`
    SELECT business_date AS date, SUM(total_centavos) AS totalCentavos
    FROM sales
    WHERE business_date BETWEEN ? AND ? AND status = 'Completed'
    GROUP BY business_date ORDER BY business_date
  `).all(range.from, range.to) as Array<{ date: string; totalCentavos: number }>;

  const topProducts = db.prepare(`
    SELECT si.product_name AS name, SUM(si.quantity) AS quantity,
           SUM(si.line_total_centavos) AS totalCentavos
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.business_date BETWEEN ? AND ? AND s.status = 'Completed'
    GROUP BY si.product_name ORDER BY quantity DESC, totalCentavos DESC LIMIT 10
  `).all(range.from, range.to) as Array<{ name: string; quantity: number; totalCentavos: number }>;

  const payments = db.prepare(`
    SELECT payment_method AS method, COUNT(*) AS transactions,
           SUM(total_centavos) AS totalCentavos
    FROM sales
    WHERE business_date BETWEEN ? AND ? AND status = 'Completed'
    GROUP BY payment_method ORDER BY totalCentavos DESC
  `).all(range.from, range.to) as Array<{ method: string; transactions: number; totalCentavos: number }>;

  const transactions = db.prepare(`
    SELECT s.id, s.receipt, s.business_date AS date, s.payment_method AS payment,
           s.status, s.total_centavos AS totalCentavos,
           COALESCE(GROUP_CONCAT(si.product_name || ' x' || si.quantity, '; '), '') AS items
    FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
    WHERE s.business_date BETWEEN ? AND ?
    GROUP BY s.id ORDER BY s.business_date DESC, s.created_at DESC
  `).all(range.from, range.to) as SalesReport["transactions"];

  const lines = db.prepare(`
    SELECT s.receipt, s.business_date AS date, si.product_name AS productName,
           si.quantity, si.unit_price_centavos AS unitPriceCentavos,
           si.line_total_centavos AS lineTotalCentavos, s.payment_method AS payment,
           s.status, s.total_centavos AS orderTotalCentavos
    FROM sales s JOIN sale_items si ON si.sale_id = s.id
    WHERE s.business_date BETWEEN ? AND ?
    ORDER BY s.business_date DESC, s.created_at DESC, si.rowid
  `).all(range.from, range.to) as SalesReport["lines"];

  return {
    range,
    summary: {
      totalSalesCentavos: summary.total,
      totalTransactions: summary.count,
      averageSaleCentavos: summary.average,
    },
    daily,
    topProducts,
    payments,
    transactions,
    lines,
  };
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function reportCsv(report: SalesReport): string {
  const headers = ["Receipt", "Date", "Product", "Quantity", "Unit Price PHP", "Line Total PHP", "Order Total PHP", "Payment", "Status"];
  const rows = report.lines.map((line) => [
    line.receipt,
    line.date,
    line.productName,
    line.quantity,
    (line.unitPriceCentavos / 100).toFixed(2),
    (line.lineTotalCentavos / 100).toFixed(2),
    (line.orderTotalCentavos / 100).toFixed(2),
    line.payment,
    line.status,
  ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

export function streamReportPdf(response: Response, report: SalesReport): void {
  const document = new PDFDocument({ margin: 46, size: "A4", bufferPages: true });
  document.pipe(response);
  const logoPath = path.resolve(process.cwd(), "assets", "Logo.png");
  if (existsSync(logoPath)) document.image(logoPath, 46, 38, { fit: [72, 54] });
  document.fillColor("#35170a").fontSize(20).font("Helvetica-Bold").text("Sales Report", 130, 48);
  document.fillColor("#6f625b").fontSize(10).font("Helvetica").text(`${report.range.from} to ${report.range.to}`, 130, 76);
  document.moveDown(4);

  const summaryY = 122;
  const metrics = [
    ["TOTAL SALES", money.format(report.summary.totalSalesCentavos / 100)],
    ["TRANSACTIONS", String(report.summary.totalTransactions)],
    ["AVERAGE SALE", money.format(report.summary.averageSaleCentavos / 100)],
  ];
  metrics.forEach(([label, value], index) => {
    const x = 46 + index * 174;
    document.roundedRect(x, summaryY, 158, 66, 6).lineWidth(0.7).strokeColor("#ded5cf").stroke();
    document.fillColor("#8b3d10").fontSize(8).font("Helvetica-Bold").text(label ?? "", x + 12, summaryY + 13);
    document.fillColor("#1c1714").fontSize(15).text(value ?? "", x + 12, summaryY + 32, { width: 134 });
  });

  let y = 214;
  document.fillColor("#35170a").fontSize(13).font("Helvetica-Bold").text("Daily revenue", 46, y);
  y += 24;
  if (!report.daily.length) {
    document.fillColor("#6f625b").fontSize(10).font("Helvetica").text("No completed sales in this period.", 46, y);
    y += 28;
  } else {
    report.daily.forEach((day) => {
      document.fillColor("#332a25").fontSize(9).font("Helvetica").text(day.date, 46, y);
      document.text(money.format(day.totalCentavos / 100), 300, y, { width: 120, align: "right" });
      y += 18;
    });
    y += 12;
  }

  document.fillColor("#35170a").fontSize(13).font("Helvetica-Bold").text("Top products", 46, y);
  y += 24;
  report.topProducts.slice(0, 6).forEach((product, index) => {
    document.fillColor("#332a25").fontSize(9).font("Helvetica").text(`${index + 1}. ${product.name}`, 46, y);
    document.text(`${product.quantity} sold`, 260, y);
    document.text(money.format(product.totalCentavos / 100), 370, y, { width: 120, align: "right" });
    y += 18;
  });
  y += 14;

  if (y > 670) { document.addPage(); y = 52; }
  document.fillColor("#35170a").fontSize(13).font("Helvetica-Bold").text("Transactions", 46, y);
  y += 23;
  const headings = ["Receipt", "Date", "Payment", "Status", "Total"];
  const widths = [95, 90, 85, 90, 95];
  let x = 46;
  document.fillColor("#6b2d0c").fontSize(8).font("Helvetica-Bold");
  headings.forEach((heading, index) => { document.text(heading, x, y, { width: widths[index] }); x += widths[index] ?? 0; });
  y += 16;
  for (const sale of report.transactions) {
    if (y > 760) { document.addPage(); y = 52; }
    x = 46;
    const cells = [sale.receipt, sale.date, sale.payment, sale.status, money.format(sale.totalCentavos / 100)];
    document.fillColor("#332a25").fontSize(8).font("Helvetica");
    cells.forEach((cell, index) => { document.text(cell, x, y, { width: widths[index] }); x += widths[index] ?? 0; });
    y += 16;
  }
  document.end();
}
