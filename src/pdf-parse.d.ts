/* pdf-parse v1.x 型別定義 */
declare module "pdf-parse" {
  interface PDFInfo {
    Title?: string;
    Author?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
  }
  interface PDFResult {
    numpages: number;
    numrender: number;
    info: PDFInfo;
    text: string;
    version: string;
  }
  function pdfParse(buffer: Buffer): Promise<PDFResult>;
  export default pdfParse;
}

/* pdf-parse/lib/pdf-parse.js — 繞過 index.js 的 debug 自動執行 */
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PDFResult {
    numpages: number;
    numrender: number;
    info: Record<string, string | undefined>;
    text: string;
    version: string;
  }
  function pdfParse(buffer: Buffer): Promise<PDFResult>;
  export = pdfParse;
}
