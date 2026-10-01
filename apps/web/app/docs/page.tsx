import type { Metadata } from "next";
import { DocumentEditor } from "./document-editor";

export const metadata: Metadata = {
  title: "Docs · Office Editors",
};

export default function DocsPage() {
  return <DocumentEditor />;
}
