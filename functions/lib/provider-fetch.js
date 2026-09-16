/*
 * PTLife — Resilient Provider Fetch
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Shared HTTP fetch layer for external PTLife providers.
 *
 * Features:
 *   - request timeout
 *   - automatic retry
 *   - JSON validation
 *   - timing information
 *   - predictable errors for safeRun()
 */


function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}


function makeError(
  message,
  details = {}
) {
  const error =
    new Error(message);

  Object.assign(
    error,
    details
  );

  return error;
}


/*
 * Fetch JSON from an external provider.
 *
 * Defaults:
 *
 *   timeout:       8 seconds
 *   retries:       1
 *   retry delay:   300 ms
 *
 * Therefore a provider gets at most two attempts.
 */

export async function fetchProviderJson(
  url,
  options = {}
) {

  const {
    timeoutMs = 8000,
    retries = 1,
    retryDelayMs = 300,
    headers = {},
    method = "GET"
  } = options;


  const totalStarted =
    Date.now();

  const attempts = [];

  let lastError = null;


  for (
    let attempt = 1;
    attempt <= retries + 1;
    attempt++
  ) {

    const attemptStarted =
      Date.now();

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        timeoutMs
      );


    try {

      const response =
        await fetch(
          url,
          {
            method,

            headers: {
              accept:
                "application/json",

              ...headers
            },

            signal:
              controller.signal
          }
        );


      const text =
        await response.text();


      clearTimeout(timeout);


      const durationMs =
        Date.now() -
        attemptStarted;


      if (!response.ok) {

        throw makeError(
          `Provider HTTP ${response.status}`,
          {
            httpStatus:
              response.status,

            preview:
              text.slice(
                0,
                1000
              )
          }
        );
      }


      let data;


      try {

        data =
          JSON.parse(text);

      } catch {

        throw makeError(
          "Provider returned invalid JSON",
          {
            httpStatus:
              response.status,

            preview:
              text.slice(
                0,
                1000
              )
          }
        );
      }


      attempts.push({
        attempt,
        ok: true,
        status:
          response.status,
        duration_ms:
          durationMs
      });


      return {
        data,

        status:
          response.status,

        durationMs:
          Date.now() -
          totalStarted,

        attempts,

        retried:
          attempt > 1
      };


    } catch (error) {

      clearTimeout(timeout);


      const durationMs =
        Date.now() -
        attemptStarted;


      const timedOut =
        error?.name ===
        "AbortError";


      lastError =
        timedOut
          ? makeError(
              `Provider request timed out after ${timeoutMs} ms`,
              {
                timedOut: true
              }
            )
          : error;


      attempts.push({
        attempt,
        ok: false,
        timed_out:
          timedOut,
        http_status:
          error?.httpStatus ??
          null,
        duration_ms:
          durationMs,
        message:
          lastError?.message ||
          String(lastError)
      });


      /*
       * No more attempts.
       */

      if (
        attempt >
        retries
      ) {
        break;
      }


      /*
       * Small backoff before retry.
       */

      await sleep(
        retryDelayMs * attempt
      );
    }
  }


  /*
   * Preserve diagnostic information so safeRun()
   * can record the actual provider failure.
   */

  lastError.providerAttempts =
    attempts;

  lastError.totalDurationMs =
    Date.now() -
    totalStarted;


  throw lastError;
}
