import type { Metadata } from "next";
import { Spreadsheet } from "./spreadsheet";

export const metadata: Metadata = {
  title: "Excel · Office Editors",
};

export default function ExcelPage() {
  return <Spreadsheet />;
}
