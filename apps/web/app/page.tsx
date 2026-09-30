import { packageName as commandCore } from "@office/command-core";
import { packageName as docs } from "@office/docs";
import { packageName as excel } from "@office/excel";
import { packageName as ppt } from "@office/ppt";
import { packageName as ui } from "@office/ui";

const packages = [commandCore, ui, excel, docs, ppt];

export default function Home() {
  return (
    <main>
      <h1>Office Editors</h1>
      <ul aria-label="연결된 패키지">
        {packages.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </main>
  );
}
