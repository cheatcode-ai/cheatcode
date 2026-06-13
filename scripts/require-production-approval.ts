const APPROVAL_ENV = "CHEATCODE_PROD_DEPLOY_APPROVED";
const REQUIRE_WEB_PUBLIC_ENV = "CHEATCODE_REQUIRE_WEB_PUBLIC_ENV";
const REQUIRED_WEB_PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID",
] as const;

function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}

if (process.env[APPROVAL_ENV] !== "true") {
  writeError(
    `Refusing production deploy. Set ${APPROVAL_ENV}=true only after explicit user approval.`,
  );
  process.exitCode = 1;
}

if (process.env[REQUIRE_WEB_PUBLIC_ENV] === "true") {
  const missing = REQUIRED_WEB_PUBLIC_ENV_KEYS.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    writeError(`Refusing production web deploy. Missing public build env: ${missing.join(", ")}.`);
    process.exitCode = 1;
  }
}
