/*
 * PTLife Reliability Framework — Test Endpoint v2
 *
 * Diagnostic only.
 *
 * Modes:
 *
 *   /api/reliability-test
 *       Deliberately fails.
 *
 *   /api/reliability-test?mode=success
 *       Simulates successful provider recovery.
 *
 * No PTLife event/program/place data is modified.
 */

import {
  logError,
  markProviderAttempt,
  markProviderFailure,
  markProviderSuccess
} from "../lib/reliability.js";


function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store"
      }
    }
  );
}


export async function onRequestGet(context) {
  const db =
    context.env.DB;

  const url =
    new URL(context.request.url);

  const mode =
    (
      url.searchParams.get("mode") ||
      "failure"
    ).toLowerCase();

  const provider =
    "reliability_test";

  const startedAt =
    Date.now();


  /*
   * ==================================================
   * OUTER SAFETY NET
   * ==================================================
   *
   * If the reliability framework itself fails,
   * return useful diagnostic JSON instead of allowing
   * an unexplained Cloudflare failure.
   */

  try {

    /*
     * =================================================
     * SUCCESS / RECOVERY TEST
     * =================================================
     */

    if (mode === "success") {

      const operation =
        "deliberate_test_success";


      await markProviderAttempt(
        db,
        provider,
        operation
      );


      const durationMs =
        Date.now() - startedAt;


      const recovery =
        await markProviderSuccess(
          db,
          provider,
          {
            operation,

            durationMs,

            httpStatus: 200,

            itemCount: 42,

            metadata: {
              diagnostic:
                true,

              simulated_items:
                42,

              note:
                "Deliberate successful run used to test PTLife provider recovery."
            }
          }
        );


      return jsonResponse({
        ok: true,

        graceful_success:
          true,

        diagnostic_test:
          true,

        message:
          recovery.recovered
            ? "The provider recovered successfully and its open errors were resolved."
            : "The provider completed successfully.",

        provider: {
          name:
            provider,

          operation,

          status:
            "healthy"
        },

        recovery: {
          recovered:
            recovery.recovered,

          previous_failures:
            recovery.previousFailures,

          previous_error_id:
            recovery.previousErrorId,

          resolved_error_count:
            recovery.resolvedErrorCount
        },

        simulated_result: {
          item_count: 42,
          http_status: 200
        },

        duration_ms:
          durationMs,

        next_step:
          "Inspect provider_health and system_errors in D1."
      });
    }


    /*
     * =================================================
     * FAILURE TEST
     * =================================================
     */

    const operation =
      "deliberate_test_failure";


    await markProviderAttempt(
      db,
      provider,
      operation
    );


    try {

      /*
       * Deliberately fail.
       */

      throw new Error(
        "PTLife deliberate reliability test error"
      );


    } catch (error) {

      const durationMs =
        Date.now() - startedAt;


      const logged =
        await logError(
          db,
          error,
          {
            provider,

            operation,

            stage:
              "deliberate_test",

            severity:
              "error",

            /*
             * Logical source location.
             *
             * This is the filename we recognize
             * in GitHub, rather than Cloudflare's
             * generated bundle filename.
             */

            sourceFile:
              "functions/api/reliability-test.js",

            requestMethod:
              context.request.method,

            requestUrl:
              context.request.url,

            reproduction: {
              endpoint:
                "/api/reliability-test",

              method:
                "GET",

              instructions:
                "Open /api/reliability-test in a browser."
            },

            context: {
              diagnostic:
                true,

              expected_error:
                true,

              note:
                "This error was deliberately generated to test PTLife reliability handling."
            }
          }
        );


      await markProviderFailure(
        db,
        provider,
        logged.errorId,
        {
          operation,
          durationMs
        }
      );


      return jsonResponse({
        ok: false,

        graceful_failure:
          true,

        diagnostic_test:
          true,

        message:
          "The deliberate error was caught. PTLife remained operational.",

        error: {
          id:
            logged.errorId,

          repeated:
            logged.repeated,

          occurrence_count:
            logged.occurrenceCount
        },

        provider: {
          name:
            provider,

          operation,

          expected_status:
            "failing"
        },

        duration_ms:
          durationMs,

        next_step:
          "Run ?mode=success to test automatic provider recovery."
      });
    }


  } catch (frameworkError) {

    /*
     * =================================================
     * FRAMEWORK FAILURE
     * =================================================
     *
     * Do not try to log this through the framework,
     * because the framework itself may be what failed.
     */

    return jsonResponse(
      {
        ok: false,

        graceful_failure:
          false,

        diagnostic_test:
          true,

        stage:
          "reliability_framework_failure",

        message:
          frameworkError?.message ||
          String(frameworkError),

        stack:
          frameworkError?.stack ||
          null,

        warning:
          "The reliability framework itself encountered an error."
      },
      500
    );
  }
}
