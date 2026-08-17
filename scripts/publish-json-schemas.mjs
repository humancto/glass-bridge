import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaNames = [
  "glassbridge-capacity-5.schema.json",
  "glassbridge-device-run-1.schema.json",
];
const publicSpecBase = "https://humancto.github.io/glass-bridge/spec/";
const outputDirectory = join(projectRoot, "dist", "spec");

await mkdir(outputDirectory, { recursive: true });

for (const schemaName of schemaNames) {
  const sourcePath = join(projectRoot, "spec", schemaName);
  const source = await readFile(sourcePath, "utf8");
  const schema = JSON.parse(source);
  const expectedId = `${publicSpecBase}${basename(schemaName)}`;

  if (schema.$id !== expectedId) {
    throw new Error(
      `${schemaName} declares ${JSON.stringify(schema.$id)}; expected ${JSON.stringify(expectedId)}`,
    );
  }

  await copyFile(sourcePath, join(outputDirectory, schemaName));
}

console.log(`Published ${schemaNames.length} canonical JSON schemas to dist/spec.`);
