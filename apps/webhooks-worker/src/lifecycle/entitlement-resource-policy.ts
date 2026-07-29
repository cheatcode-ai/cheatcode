/** Owns archiveGraceDays policy; maxProjects passes through from @cheatcode/billing. */

const PROJECT_ARCHIVE_GRACE_DAYS = 30;

export function entitlementResourcePolicy(maxProjects: number): {
  archiveGraceDays: number;
  maxProjects: number;
} {
  return { archiveGraceDays: PROJECT_ARCHIVE_GRACE_DAYS, maxProjects };
}
