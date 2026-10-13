import { existsSync } from "node:fs";
import path from "node:path";

export function resolveLocalEnvPath(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env["NODE_ENV"] === "test" || env["NODE_ENV"] === "production") {
    return undefined;
  }

  const candidates = [
    path.resolve(cwd, ".env"),
    path.resolve(cwd, "../../.env"),
  ];

  return candidates.find((file) => existsSync(file));
}

export function loadLocalEnv(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const file = resolveLocalEnvPath(cwd, env);
  if (file === undefined) {
    return undefined;
  }
  process.loadEnvFile(file);
  return file;
}
