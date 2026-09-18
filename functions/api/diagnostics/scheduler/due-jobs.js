
import {
  getDueJobs
} from "../../../lib/scheduler.js";


export async function onRequestGet(
  context
) {
  const jobs =
    await getDueJobs(
      context.env.DB
    );

  return Response.json({
    ok: true,
    operation:
      "scheduler_due_jobs",
    count:
      jobs.length,
    jobs
  });
}
