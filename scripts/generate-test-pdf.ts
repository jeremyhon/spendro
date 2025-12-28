import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

interface ExpenseItem {
  date: string;
  description: string;
  amount: number;
  currency: string;
}

export async function generateTestPdf(
  expenses: ExpenseItem[] = []
): Promise<Buffer> {
  const uniqueId = Date.now() + Math.random().toString(36).substring(2);

  // Create default expenses if none provided
  const defaultExpenses: ExpenseItem[] = [
    {
      date: "2024-01-15",
      description: "Test Grocery Shopping - Test FairPrice",
      amount: 85.5,
      currency: "SGD",
    },
    {
      date: "2024-01-16",
      description: "Test Coffee - Test Starbucks",
      amount: 6.8,
      currency: "SGD",
    },
    {
      date: "2024-01-17",
      description: "Test Lunch - Test Hawker Center",
      amount: 12.0,
      currency: "SGD",
    },
    {
      date: "2024-01-18",
      description: "Test Transport - Test MRT",
      amount: 2.4,
      currency: "SGD",
    },
  ];

  const expensesToUse = expenses.length > 0 ? expenses : defaultExpenses;

  return await createBankStatementPdf(expensesToUse, uniqueId);
}

async function createBankStatementPdf(
  expenses: ExpenseItem[],
  uniqueId: string
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 size
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  // Header
  page.drawText("TEST BANK STATEMENT", {
    x: 50,
    y: 780,
    size: 20,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  page.drawText("Statement Period: January 1, 2024 - January 31, 2024", {
    x: 50,
    y: 750,
    size: 12,
    font: font,
  });

  page.drawText("Account Number: 123-456789-0", {
    x: 50,
    y: 730,
    size: 12,
    font: font,
  });

  page.drawText(`Generated: ${new Date().toISOString()} (ID: ${uniqueId})`, {
    x: 50,
    y: 710,
    size: 10,
    font: font,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Transaction header
  page.drawText("TRANSACTION DETAILS", {
    x: 50,
    y: 670,
    size: 14,
    font: boldFont,
  });

  page.drawText("Date", {
    x: 50,
    y: 640,
    size: 12,
    font: boldFont,
  });

  page.drawText("Description", {
    x: 150,
    y: 640,
    size: 12,
    font: boldFont,
  });

  page.drawText("Amount", {
    x: 450,
    y: 640,
    size: 12,
    font: boldFont,
  });

  // Draw line under header
  page.drawLine({
    start: { x: 50, y: 630 },
    end: { x: 545, y: 630 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });

  // Transaction rows
  let yPosition = 610;
  expenses.forEach((expense) => {
    page.drawText(expense.date, {
      x: 50,
      y: yPosition,
      size: 11,
      font: font,
    });

    page.drawText(expense.description, {
      x: 150,
      y: yPosition,
      size: 11,
      font: font,
    });

    page.drawText(`${expense.currency} ${expense.amount.toFixed(2)}`, {
      x: 450,
      y: yPosition,
      size: 11,
      font: font,
    });

    yPosition -= 25;
  });

  // Summary
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  yPosition -= 20;

  page.drawLine({
    start: { x: 400, y: yPosition + 10 },
    end: { x: 545, y: yPosition + 10 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });

  page.drawText("Total Expenses:", {
    x: 350,
    y: yPosition,
    size: 12,
    font: boldFont,
  });

  page.drawText(`SGD ${total.toFixed(2)}`, {
    x: 450,
    y: yPosition,
    size: 12,
    font: boldFont,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// CLI usage
const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  (async () => {
    const pdfBuffer = await generateTestPdf();
    const fileName = `test-statement-${Date.now()}.pdf`;
    const filePath = join(process.cwd(), "temp", fileName);

    // Create temp directory if it doesn't exist
    mkdirSync(dirname(filePath), { recursive: true });

    writeFileSync(filePath, pdfBuffer);
    console.log(`Generated test PDF: ${filePath}`);
  })();
}
