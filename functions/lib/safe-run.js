/*
 * PTLife — Safe Provider Runner
 * Version 1
 *
 * Runs a provider operation inside the PTLife
 * reliability framework.
 *
 * Responsibilities:
 *   - mark provider attempt
 *   - execute provider code
 *   - mark successful runs
 *   - catch failures
 *   - log diagnostic information
 *   - mark provider failure
 *   - return a predictable result object
 *
 * Provider code should THROW when something is wrong.
 * safeRun() converts that exception into a controlled result.
 */

import {
  logError,
  markProviderAttempt,
  markProviderFailure,
  markProviderSuccess
} from "./reliability.js";


// ============================================================
// RESULT VALIDATION
// ============================================================

function validateConfiguration(options) {
  if (!options) {
    throw new Error(
      "safeRun requires an options object"
    );
  }

  if (!options.db) {
    throw new Error(
      "safeRun requires a D1 database binding"
    );
  }

  if (!options.provider) {
    throw new Error(
      "safeRun requires a provider name"
    );
  }

  if (!options.operation) {
    throw new Error(
      "safeRun requires an operation name"
    );
  }

  if (typeof options.run !== "function") {
    throw new Error(
      "safeRun requires a run function"
    );
  }
}


// ============================================================
// SAFE RUN
// ============================================================

export async function safeRun(options) {
  validateConfiguration(options);

  const {
    db,
    provider,
    operation,
    run
  } = options;

  const startedAt =
    Date.now();

  /*
   * This is intentionally outside the provider
   * try/catch.
   *
   * If our reliability infrastructure itself cannot
   * record the attempt, that is a framework problem,
   * not a provider failure.
   */

  await markProviderAttempt(
    db,
    provider,
    operation
  );


  try {

    // --------------------------------------------------------
    // RUN PROVIDER
    // --------------------------------------------------------

    const result =
      await run();


    // --------------------------------------------------------
    // OPTIONAL RESULT VALIDATION
    // --------------------------------------------------------
    //
    // A request can technically succeed with HTTP 200 while
    // returning nonsense, an empty response, or a changed
    // upstream schema.
    //
    // Providers may therefore supply:
    //
    // validate(result)
    //
    // It should either:
    //
    //   return true
    //
    // or throw an Error explaining what is wrong.
    // --------------------------------------------------------

    if (
      typeof options.validate ===
      "function"
    ) {
      const validationResult =
        await options.validate(result);

      if (
        validationResult !== true &&
        validationResult !== undefined
      ) {
        throw new Error(
          typeof validationResult ===
          "string"
            ? validationResult
            : "Provider result validation failed"
        );
      }
    }


    const durationMs =
      Date.now() - startedAt;


    // --------------------------------------------------------
    // DETERMINE ITEM COUNT
    // --------------------------------------------------------

    let itemCount = null;

    if (
      typeof options.getItemCount ===
      "function"
    ) {
      itemCount =
        options.getItemCount(result);
    } else if (
      Array.isArray(result)
    ) {
      itemCount =
        result.length;
    } else if (
      Array.isArray(result?.items)
    ) {
      itemCount =
        result.items.length;
    } else if (
      Array.isArray(result?.results)
    ) {
      itemCount =
        result.results.length;
    }


    // --------------------------------------------------------
    // MARK SUCCESS / RECOVERY
    // --------------------------------------------------------

    const recovery =
      await markProviderSuccess(
        db,
        provider,
        {
          operation,

          durationMs,

          httpStatus:
            options.successHttpStatus ??
            200,

          itemCount,

          metadata:
            typeof options.getMetadata ===
            "function"
              ? options.getMetadata(result)
              : options.metadata || null
        }
      );


    return {
      ok: true,

      provider,

      operation,

      durationMs,

      itemCount,

      recovered:
        recovery.recovered,

      recovery: {
        previousFailures:
          recovery.previousFailures,

        previousErrorId:
          recovery.previousErrorId,

        resolvedErrorCount:
          recovery.resolvedErrorCount
      },

      data:
        result
    };


  } catch (error) {

    const durationMs =
      Date.now() - startedAt;


    // --------------------------------------------------------
    // LOG PROVIDER FAILURE
    // --------------------------------------------------------

    const logged =
      await logError(
        db,
        error,
        {
          provider,

          operation,

          stage:
            options.stage ||
            "provider_run",

          severity:
            options.severity ||
            "error",

          sourceFile:
            options.sourceFile ||
            null,

          sourceLine:
            options.sourceLine ??
            null,

          sourceColumn:
            options.sourceColumn ??
            null,

          requestMethod:
            options.request?.method ||
            null,

          requestUrl:
            options.request?.url ||
            null,

          httpStatus:
            error?.httpStatus ??
            options.failureHttpStatus ??
            null,

          reproduction:
            options.reproduction ||
            null,

          context: {
            ...(options.context || {}),

            duration_ms:
              durationMs
          }
        }
      );


    // --------------------------------------------------------
    // UPDATE PROVIDER HEALTH
    // --------------------------------------------------------

    await markProviderFailure(
      db,
      provider,
      logged.errorId,
      {
        operation,

        durationMs,

        httpStatus:
          error?.httpStatus ??
          options.failureHttpStatus ??
          null
      }
    );


    // --------------------------------------------------------
    // CONTROLLED FAILURE RESULT
    // --------------------------------------------------------

    return {
      ok: false,

      provider,

      operation,

      durationMs,

      error: {
        id:
          logged.errorId,

        message:
          error?.message ||
          String(error),

        repeated:
          logged.repeated,

        occurrenceCount:
          logged.occurrenceCount
      },

      data:
        options.fallbackData ??
        null
    };
  }
}
