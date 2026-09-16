/*
 * PTLife Reliability Framework — Test Endpoint
 *
 * Diagnostic only.
 *
 * Purpose:
 *   Verify that the central reliability framework:
 *
 *   1. catches an exception
 *   2. creates an error ID
 *   3. stores the error in D1
 *   4. records stack/source information
 *   5. updates provider_health
 *   6. returns a graceful JSON response
 *
 * This endpoint deliberately throws a harmless test error.
 * It does NOT modify PTLife event/program/place data.
 */

import {
  logError,
  markProviderAttempt,
  markProviderFailure
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
  const db = context.env.DB;

  const provider =
    "reliability_test";

  const operation =
    "deliberate_test_failure";

  const startedAt =
    Date.now();


  /*
   * --------------------------------------------------
   * OUTER SAFETY NET
   *
   * Even the reliability test itself should return
   * useful JSON rather than an unexplained 500/502.
   * --------------------------------------------------
   */

  try {

    /*
     * Record that this provider operation began.
     */

    await markProviderAttempt(
      db,
      provider,
      operation
    );


    try {

      /*
       * ------------------------------------------------
       * DELIBERATE ERROR
       *
       * This is intentional.
       * ------------------------------------------------
       */

      throw new Error(
        "PTLife deliberate reliability test error"
      );


    } catch (error) {

      const durationMs =
        Date.now() - startedAt;


      /*
       * Store the diagnostic error.
       */

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


      /*
       * Update provider health.
       */

      await markProviderFailure(
        db,
        provider,
        logged.errorId,
        {
          operation,
          durationMs
        }
      );


      /*
       * IMPORTANT:
       *
       * The operation failed internally, but the
       * endpoint itself responds normally.
       *
       * That is the graceful-failure behavior we
       * eventually want for provider jobs.
       */

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
          "Inspect the D1 system_errors and provider_health tables."
      });
    }


  } catch (frameworkError) {

    /*
     * If we arrive here, the reliability framework
     * itself failed.
     *
     * We cannot safely rely on D1 logging at this
     * point, so return the framework error directly
     * as diagnostic JSON.
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
          "The test error was not handled successfully by the reliability framework."
      },
      500
    );
  }
}
