// JSON Schemas for authored content (tools/pipeline/schemas), and validation
// against them. The schemas are the reference for anyone, or anything, writing
// openings, courses and lessons; the TypeScript types in config.ts mirror them.
//
// Every file carries `schemaVersion`. A breaking format change bumps
// SCHEMA_VERSION (and the schemas' `const`), and comes with a script that
// rewrites existing content to the new version.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import { REPO_ROOT } from './http.ts';

export const SCHEMA_VERSION = 1;
export const SCHEMAS_DIR = join(REPO_ROOT, 'tools/pipeline/schemas');

export type SchemaKind = 'opening' | 'course' | 'lesson';

const schemaFile = (name: string) => join(SCHEMAS_DIR, `${name}.schema.json`);

const ajv = new Ajv2020({ allErrors: true });
for (const name of ['common', 'opening', 'course', 'lesson']) {
  ajv.addSchema(JSON.parse(readFileSync(schemaFile(name), 'utf8')) as object);
}

/** A file's `$schema` value: the schema's path relative to the file, for editors. */
export const schemaRef = (kind: SchemaKind, file: string): string => relative(join(file, '..'), schemaFile(kind));

/** Problems with `data` as a `kind` file, worded for a person; empty when valid. */
export function validate(kind: SchemaKind, data: unknown): string[] {
  const version = (data as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version === undefined) return [`missing "schemaVersion" (this pipeline reads version ${SCHEMA_VERSION})`];
  if (version !== SCHEMA_VERSION) return [`"schemaVersion" is ${JSON.stringify(version)}; this pipeline reads version ${SCHEMA_VERSION}`];
  const check = ajv.getSchema(`${kind}.schema.json`)!;
  return check(data) ? [] : describe(check.errors ?? []);
}

function describe(errors: ErrorObject[]): string[] {
  // A failed `oneOf`/`$ref` reports the same spot several times; keep each message once.
  return [
    ...new Set(
      errors.map((e) => {
        const at = e.instancePath || '(top level)';
        if (e.keyword === 'additionalProperties') return `${at}: unknown property "${e.params.additionalProperty}"`;
        if (e.keyword === 'enum') return `${at}: must be one of ${(e.params.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(', ')}`;
        return `${at}: ${e.message}`;
      }),
    ),
  ];
}
