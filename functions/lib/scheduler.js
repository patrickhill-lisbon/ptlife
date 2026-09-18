
/**
 * PTLife general scheduler.
 *
 * This module contains scheduler logic only.
 * It does not create a Cloudflare Cron Trigger and does not cause
 * anything to run automatically.
 */


/**
 * Return enabled scheduled jobs that are due at or before `now`.
 *
 * A job is due when:
 *   - it is enabled
 *   - next_run_at is not NULL
 *   - next_run_at <= now
 *
 * @param {D1Database} db
 * @param {Date} now
 * @returns {Promise<Array>}
 */
export async function getDueJobs(
  db,
  now = new Date()
) {
  if (!db) {
    throw new Error(
      "Scheduler requires a D1 database binding"
    );
  }

  const nowIso =
    now.toISOString();

  const result = await db
    .prepare(
      `
      SELECT
        id,
        job_key,
        job_type,
        scope_type,
        scope_id,
        frequency_minutes,
        next_run_at,
        last_attempt_at,
        last_success_at,
        last_failure_at,
        consecutive_failures,
        config_json
      FROM scheduled_jobs
      WHERE enabled = 1
        AND next_run_at IS NOT NULL
        AND next_run_at <= ?
      ORDER BY next_run_at ASC, id ASC
      `
    )
    .bind(nowIso)
    .all();

  return result.results ?? [];
}
