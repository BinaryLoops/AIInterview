import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigValidationError } from "./auth-config.types.js";
import { loadLocalEnv } from "./load-local-env.js";
import { parseAuthConfig } from "./parse-auth-config.js";

export type ValidationResult = {
  success: boolean;
  issues: readonly string[];
  summary?: {
    nodeEnv: string;
    host: string;
    port: number;
    appBaseUrl: string;
    trustProxy: boolean;
    corsAllowedOrigins: readonly string[];
    databaseEnabled: boolean;
    redisEnabled: boolean;
    smtpEnabled: boolean;
  };
};

/**
 * Parses raw text from a `.env` format file into key-value pairs
 * without mutating process.env.
 */
export function parseEnvFileContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

/**
 * Validates a specified environment file directly in an isolated context
 * without modifying process.env or opening external connections.
 */
export function validateEnvFile(filePath: string): ValidationResult {
  let resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    const rootCandidate = path.resolve(process.cwd(), "../..", filePath);
    const parentCandidate = path.resolve(process.cwd(), "..", filePath);
    if (fs.existsSync(rootCandidate)) {
      resolved = rootCandidate;
    } else if (fs.existsSync(parentCandidate)) {
      resolved = parentCandidate;
    } else {
      return {
        success: false,
        issues: [`Environment file not found: ${filePath}`],
      };
    }
  }
  try {
    const content = fs.readFileSync(resolved, "utf-8");
    const parsedEnv = parseEnvFileContent(content);
    return validateEnvironment(parsedEnv);
  } catch (err: unknown) {
    return {
      success: false,
      issues: [`Failed to read environment file: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

/**
 * Validates the provided environment variables against configuration rules
 * in a completely non-destructive manner (0 external connections made).
 */
export function validateEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ValidationResult {
  try {
    const config = parseAuthConfig(env);
    return {
      success: true,
      issues: [],
      summary: {
        nodeEnv: config.nodeEnv,
        host: config.host,
        port: config.port,
        appBaseUrl: config.appBaseUrl,
        trustProxy: config.trustProxy,
        corsAllowedOrigins: config.corsAllowedOrigins,
        databaseEnabled: config.database.enabled,
        redisEnabled: config.redis.enabled,
        smtpEnabled: config.smtp.enabled,
      },
    };
  } catch (err: unknown) {
    if (err instanceof ConfigValidationError) {
      return {
        success: false,
        issues: err.issues,
      };
    }
    return {
      success: false,
      issues: [err instanceof Error ? err.message : String(err)],
    };
  }
}

/**
 * CLI execution handler. Prints safe, redacted summary or error list
 * without leaking passwords, tokens, or connection strings.
 */
export function runValidationCli(
  env: NodeJS.ProcessEnv = process.env,
  logger: { log: (msg: string) => void; error: (msg: string) => void } = console,
  targetFile?: string,
): number {
  let result: ValidationResult;

  if (targetFile) {
    logger.log(`Validating environment file: ${targetFile}`);
    result = validateEnvFile(targetFile);
  } else {
    // If no explicit file passed, load local .env (only in dev, matching main.ts)
    loadLocalEnv();
    result = validateEnvironment(env);
  }

  if (result.success && result.summary) {
    logger.log("==================================================");
    logger.log("  Auth-Service Configuration Validation: PASSED");
    logger.log("  (Zero external socket/network connections made)");
    logger.log("==================================================");
    logger.log(`  Environment:       ${result.summary.nodeEnv}`);
    logger.log(`  Bind Host & Port:  ${result.summary.host}:${result.summary.port}`);
    logger.log(`  App Base URL:      ${result.summary.appBaseUrl}`);
    logger.log(`  Trust Proxy:       ${result.summary.trustProxy}`);
    logger.log(`  CORS Origins:      ${result.summary.corsAllowedOrigins.join(", ")}`);
    logger.log(`  Database Enabled:  ${result.summary.databaseEnabled}`);
    logger.log(`  Redis Enabled:     ${result.summary.redisEnabled}`);
    logger.log(`  SMTP Enabled:      ${result.summary.smtpEnabled}`);
    logger.log("  Secrets Status:    Validated non-placeholder / strong (values redacted)");
    logger.log("==================================================");
    return 0;
  }

  logger.error("==================================================");
  logger.error(`  Auth-Service Configuration Validation: FAILED`);
  logger.error(`  (${result.issues.length} configuration issue(s) detected)`);
  logger.error("==================================================");
  for (const issue of result.issues) {
    logger.error(`  - [ERROR] ${issue}`);
  }
  logger.error("==================================================");
  return 1;
}

// Auto-run when executed directly via Node CLI
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const cliFileArg = process.argv[2]?.startsWith("-") ? undefined : process.argv[2];
  const exitCode = runValidationCli(process.env, console, cliFileArg);
  process.exit(exitCode);
}
