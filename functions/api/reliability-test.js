/*
 * PTLife Reliability Framework — Test Endpoint v3
 *
 * Tests the reusable safeRun() wrapper.
 *
 * Modes:
 *
 *   /api/reliability-test
 *   /api/reliability-test?mode=failure
 *       Simulates provider failure.
 *
 *   /api/reliability-test?mode=success
 *       Simulates provider success/recovery.
 *
 *   /api/reliability-test?mode=invalid
 *       Simulates HTTP success with bad provider data.
 *
 * No PTLife event/program/place data is modified.
 */

import {
  safeRun
} from "../lib/safe-run.js";


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


  /*
   * Keep the test provider separate from any
   * real PTLife provider.
   */

  const provider =
    "safe_run_test";


  /*
   * --------------------------------------------------
   * OUTER SAFETY NET
   *
   * safeRun() handles provider failures.
   *
   * This outer try/catch handles a failure in the
   * reliability framework itself.
   * --------------------------------------------------
   */

  try {

    // ==================================================
    // SUCCESS
    // ==================================================

    if (mode === "success") {

      const result =
        await safeRun({
          db,

          provider,

          operation:
            "test_success",

          sourceFile:
            "functions/api/reliability-test.js",

          request:
            context.request,

          run: async () => {
            return {
              items: [
                { id: 1 },
                { id: 2 },
                { id: 3 }
              ],

              source:
                "simulated"
            };
          },

          validate: data => {
            if (
              !Array.isArray(
                data?.items
              )
            ) {
              throw new Error(
                "Test provider did not return an items array"
              );
            }

            return true;
          },

          getMetadata: data => ({
            diagnostic:
              true,

            mode:
              "success",

            source:
              data.source
          })
        });


      return jsonResponse({
        diagnostic_test:
          true,

        requested_mode:
          mode,

        result
      });
    }


    // ==================================================
    // INVALID DATA
    // ==================================================
    //
    // This simulates an especially important failure:
    //
    // upstream HTTP request succeeds, but its schema
    // has changed or its content is unusable.
    //
    // safeRun() should treat this as a provider failure.
    // ==================================================

    if (mode === "invalid") {

      const result =
        await safeRun({
          db,

          provider,

          operation:
            "test_invalid_data",

          stage:
            "validation",

          sourceFile:
            "functions/api/reliability-test.js",

          request:
            context.request,

          reproduction: {
            endpoint:
              "/api/reliability-test?mode=invalid",

            method:
              "GET"
          },

          context: {
            diagnostic:
              true,

            test_type:
              "invalid_provider_schema"
          },

          run: async () => {

            /*
             * Pretend this came from an upstream
             * service with HTTP 200.
             */

            return {
              unexpected_field:
                "The upstream schema changed"
            };
          },

          validate: data => {
            if (
              !Array.isArray(
                data?.items
              )
            ) {
              throw new Error(
                "Provider schema changed: expected items array"
              );
            }

            return true;
          },

          fallbackData: {
            items: []
          }
        });


      return jsonResponse({
        diagnostic_test:
          true,

        requested_mode:
          mode,

        result
      });
    }


    // ==================================================
    // FAILURE
    // ==================================================

    const result =
      await safeRun({
        db,

        provider,

        operation:
          "test_failure",

        stage:
          "provider_fetch",

        sourceFile:
          "functions/api/reliability-test.js",

        request:
          context.request,

        reproduction: {
          endpoint:
            "/api/reliability-test?mode=failure",

          method:
            "GET"
        },

        context: {
          diagnostic:
            true,

          test_type:
            "deliberate_provider_failure"
        },

        run: async () => {
          throw new Error(
            "PTLife deliberate safeRun provider failure"
          );
        },

        fallbackData: {
          items: []
        }
      });


    return jsonResponse({
      diagnostic_test:
        true,

      requested_mode:
        mode,

      result
    });


  } catch (frameworkError) {

    /*
     * If this happens, safeRun itself or the
     * reliability infrastructure failed.
     */

    return jsonResponse(
      {
        ok: false,

        diagnostic_test:
          true,

        stage:
          "safe_run_framework_failure",

        message:
          frameworkError?.message ||
          String(frameworkError),

        stack:
          frameworkError?.stack ||
          null
      },
      500
    );
  }
}
