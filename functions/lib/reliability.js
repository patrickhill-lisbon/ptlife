/*
 * PTLife Reliability Framework
 * Version 2
 *
 * Centralized error logging and provider-health tracking.
 *
 * Features:
 *   - unique human-readable error IDs
 *   - duplicate-error fingerprinting
 *   - secret/sensitive-data sanitization
 *   - D1 error logging
 *   - provider health tracking
 *   - logical GitHub source locations
 *   - raw Cloudflare stack preservation
 *   - automatic resolution after provider recovery
 *
 * Future additions:
 *   - admin notifications
 *   - admin error dashboard
 */


// ============================================================
// BASIC HELPERS
// ============================================================

function nowISO() {
  return new Date().toISOString();
}


function randomPart() {
  return crypto.randomUUID()
    .replaceAll("-", "")
    .slice(0, 8);
}


function makeErrorId() {
  const stamp = new Date()
    .toISOString()
    .replace(/\D/g, "")
    .slice(0, 14);

  return `err_${stamp}_${randomPart()}`;
}


function safeString(value, maxLength = 10000) {
  if (value === null || value === undefined) {
    return null;
  }

  let text;

  try {
    text =
      typeof value === "string"
        ? value
        : JSON.stringify(value);
  } catch {
    text = String(value);
  }

  if (text.length > maxLength) {
    return (
      text.slice(0, maxLength) +
      "...[truncated]"
    );
  }

  return text;
}


// ============================================================
// SANITIZATION
// ============================================================

const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "x-api-key",
  "x-algolia-api-key"
];


function isSensitiveKey(key) {
  const lower =
    String(key || "").toLowerCase();

  return SENSITIVE_KEYS.some(
    sensitive =>
      lower === sensitive ||
      lower.includes(sensitive)
  );
}


function sanitizeValue(value, depth = 0) {
  if (depth > 6) {
    return "[maximum depth]";
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map(item =>
        sanitizeValue(
          item,
          depth + 1
        )
      );
  }

  if (typeof value === "object") {
    const result = {};

    for (
      const [key, child]
      of Object.entries(value)
    ) {
      if (isSensitiveKey(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] =
          sanitizeValue(
            child,
            depth + 1
          );
      }
    }

    return result;
  }

  return String(value);
}


function sanitizeUrl(input) {
  if (!input) {
    return null;
  }

  try {
    const url = new URL(input);

    for (
      const key
      of Array.from(
        url.searchParams.keys()
      )
    ) {
      if (isSensitiveKey(key)) {
        url.searchParams.set(
          key,
          "[REDACTED]"
        );
      }
    }

    return url.toString();
  } catch {
    return safeString(input, 2000);
  }
}


// ============================================================
// STACK TRACE PARSING
// ============================================================

function parseStackLocation(stack) {
  if (!stack) {
    return {
      sourceFile: null,
      sourceLine: null,
      sourceColumn: null
    };
  }

  const lines =
    String(stack).split("\n");

  for (const line of lines) {
    const match =
      line.match(
        /(?:\(|\s)([^()\s]+\.js):(\d+):(\d+)\)?/
      );

    if (match) {
      return {
        sourceFile:
          match[1],

        sourceLine:
          Number(match[2]),

        sourceColumn:
          Number(match[3])
      };
    }
  }

  return {
    sourceFile: null,
    sourceLine: null,
    sourceColumn: null
  };
}


// ============================================================
// HASH / FINGERPRINT
// ============================================================

async function sha256(text) {
  const bytes =
    new TextEncoder().encode(text);

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      bytes
    );

  return Array.from(
    new Uint8Array(hash)
  )
    .map(byte =>
      byte
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}


async function makeFingerprint({
  provider,
  operation,
  stage,
  errorName,
  errorMessage,
  httpStatus,
  logicalSource
}) {
  const source = [
    provider || "",
    operation || "",
    stage || "",
    errorName || "",
    errorMessage || "",
    httpStatus || "",
    logicalSource || ""
  ].join("|");

  return await sha256(source);
}


// ============================================================
// ERROR NORMALIZATION
// ============================================================

function normalizeError(error) {
  if (error instanceof Error) {
    return {
      name:
        error.name || "Error",

      message:
        error.message ||
        String(error),

      stack:
        error.stack || null
    };
  }

  if (
    error &&
    typeof error === "object"
  ) {
    return {
      name:
        error.name || "Error",

      message:
        error.message ||
        safeString(error, 3000) ||
        "Unknown error",

      stack:
        error.stack || null
    };
  }

  return {
    name: "Error",

    message:
      String(
        error || "Unknown error"
      ),

    stack: null
  };
}


// ============================================================
// LOG ERROR
// ============================================================

export async function logError(
  db,
  error,
  options = {}
) {
  const normalized =
    normalizeError(error);

  const timestamp =
    nowISO();

  const errorId =
    makeErrorId();

  const stackLocation =
    parseStackLocation(
      normalized.stack
    );


  /*
   * logicalSource is the source location WE provide.
   *
   * Example:
   *
   *   functions/providers/nos.js
   *
   * This is more useful than Cloudflare's bundled
   * functionsWorker-xxxxx.js location.
   */

  const logicalSource =
    options.sourceFile || null;

  const logicalLine =
    options.sourceLine ?? null;

  const logicalColumn =
    options.sourceColumn ?? null;


  const provider =
    options.provider || null;

  const operation =
    options.operation || null;

  const stage =
    options.stage || null;

  const severity =
    options.severity || "error";

  const httpStatus =
    options.httpStatus ?? null;

  const requestMethod =
    options.requestMethod || null;

  const requestUrl =
    sanitizeUrl(
      options.requestUrl
    );

  const reproduction =
    sanitizeValue(
      options.reproduction || null
    );

  const context =
    sanitizeValue({
      ...(options.context || {}),

      /*
       * Preserve the Cloudflare-generated location
       * separately when a logical location exists.
       */

      runtime_source:
        stackLocation.sourceFile,

      runtime_line:
        stackLocation.sourceLine,

      runtime_column:
        stackLocation.sourceColumn
    });


  const fingerprint =
    await makeFingerprint({
      provider,
      operation,
      stage,

      errorName:
        normalized.name,

      errorMessage:
        normalized.message,

      httpStatus,

      logicalSource
    });


  const existing =
    await db
      .prepare(`
        SELECT
          id,
          error_id,
          occurrence_count
        FROM system_errors
        WHERE fingerprint = ?
          AND status = 'open'
        ORDER BY last_occurred_at DESC
        LIMIT 1
      `)
      .bind(fingerprint)
      .first();


  if (existing) {
    await db
      .prepare(`
        UPDATE system_errors
        SET
          last_occurred_at = ?,

          occurrence_count =
            occurrence_count + 1,

          updated_at = ?,

          http_status =
            COALESCE(
              ?,
              http_status
            ),

          request_url =
            COALESCE(
              ?,
              request_url
            ),

          reproduction_json =
            COALESCE(
              ?,
              reproduction_json
            ),

          context_json =
            COALESCE(
              ?,
              context_json
            )

        WHERE id = ?
      `)
      .bind(
        timestamp,
        timestamp,
        httpStatus,
        requestUrl,

        reproduction
          ? safeString(reproduction)
          : null,

        context
          ? safeString(context)
          : null,

        existing.id
      )
      .run();


    return {
      errorId:
        existing.error_id,

      fingerprint,

      repeated:
        true,

      occurrenceCount:
        Number(
          existing.occurrence_count || 1
        ) + 1
    };
  }


  /*
   * Prefer our logical source.
   *
   * If none was supplied, fall back to the
   * Cloudflare runtime stack location.
   */

  const sourceFile =
    logicalSource ||
    stackLocation.sourceFile;

  const sourceLine =
    logicalLine ??
    stackLocation.sourceLine;

  const sourceColumn =
    logicalColumn ??
    stackLocation.sourceColumn;


  await db
    .prepare(`
      INSERT INTO system_errors (
        error_id,
        fingerprint,
        provider,
        operation,
        stage,
        severity,
        error_name,
        error_message,
        stack_trace,
        source_file,
        source_line,
        source_column,
        request_method,
        request_url,
        http_status,
        reproduction_json,
        context_json,
        first_occurred_at,
        last_occurred_at,
        occurrence_count,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        1,
        'open',
        ?, ?
      )
    `)
    .bind(
      errorId,
      fingerprint,
      provider,
      operation,
      stage,
      severity,

      normalized.name,
      normalized.message,
      normalized.stack,

      sourceFile,
      sourceLine,
      sourceColumn,

      requestMethod,
      requestUrl,
      httpStatus,

      reproduction
        ? safeString(reproduction)
        : null,

      context
        ? safeString(context)
        : null,

      timestamp,
      timestamp,
      timestamp,
      timestamp
    )
    .run();


  return {
    errorId,
    fingerprint,
    repeated: false,
    occurrenceCount: 1
  };
}


// ============================================================
// PROVIDER ATTEMPT
// ============================================================

export async function markProviderAttempt(
  db,
  provider,
  operation = null
) {
  const timestamp =
    nowISO();


  await db
    .prepare(`
      INSERT INTO provider_health (
        provider,
        status,
        last_attempt_at,
        last_operation,
        created_at,
        updated_at
      )
      VALUES (
        ?,
        'unknown',
        ?,
        ?,
        ?,
        ?
      )
      ON CONFLICT(provider)
      DO UPDATE SET
        last_attempt_at =
          excluded.last_attempt_at,

        last_operation =
          excluded.last_operation,

        updated_at =
          excluded.updated_at
    `)
    .bind(
      provider,
      timestamp,
      operation,
      timestamp,
      timestamp
    )
    .run();
}


// ============================================================
// RESOLVE PROVIDER ERRORS
// ============================================================

async function resolveProviderErrors(
  db,
  provider,
  timestamp
) {
  const result =
    await db
      .prepare(`
        UPDATE system_errors
        SET
          status = 'resolved',
          resolved_at = ?,
          updated_at = ?
        WHERE provider = ?
          AND status = 'open'
      `)
      .bind(
        timestamp,
        timestamp,
        provider
      )
      .run();

  return (
    result?.meta?.changes ??
    0
  );
}


// ============================================================
// PROVIDER SUCCESS
// ============================================================

export async function markProviderSuccess(
  db,
  provider,
  options = {}
) {
  const timestamp =
    nowISO();

  const durationMs =
    options.durationMs ?? null;

  const itemCount =
    options.itemCount ?? null;

  const operation =
    options.operation || null;

  const metadata =
    sanitizeValue(
      options.metadata || null
    );


  /*
   * First determine whether this represents
   * recovery from a previous failure.
   */

  const previous =
    await db
      .prepare(`
        SELECT
          status,
          consecutive_failures,
          last_error_id
        FROM provider_health
        WHERE provider = ?
        LIMIT 1
      `)
      .bind(provider)
      .first();


  const wasFailing =
    previous?.status === "failing";


  let resolvedErrorCount = 0;


  if (wasFailing) {
    resolvedErrorCount =
      await resolveProviderErrors(
        db,
        provider,
        timestamp
      );
  }


  await db
    .prepare(`
      INSERT INTO provider_health (
        provider,
        status,
        last_attempt_at,
        last_success_at,
        consecutive_failures,
        last_error_id,
        last_http_status,
        last_operation,
        last_duration_ms,
        last_item_count,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (
        ?,
        'healthy',
        ?,
        ?,
        0,
        NULL,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
      ON CONFLICT(provider)
      DO UPDATE SET
        status = 'healthy',

        last_attempt_at =
          excluded.last_attempt_at,

        last_success_at =
          excluded.last_success_at,

        consecutive_failures = 0,

        last_error_id = NULL,

        last_http_status =
          excluded.last_http_status,

        last_operation =
          excluded.last_operation,

        last_duration_ms =
          excluded.last_duration_ms,

        last_item_count =
          excluded.last_item_count,

        metadata_json =
          excluded.metadata_json,

        updated_at =
          excluded.updated_at
    `)
    .bind(
      provider,
      timestamp,
      timestamp,

      options.httpStatus ?? 200,

      operation,
      durationMs,
      itemCount,

      metadata
        ? safeString(metadata)
        : null,

      timestamp,
      timestamp
    )
    .run();


  return {
    recovered:
      wasFailing,

    previousFailures:
      Number(
        previous?.consecutive_failures ||
        0
      ),

    previousErrorId:
      previous?.last_error_id ||
      null,

    resolvedErrorCount
  };
}


// ============================================================
// PROVIDER FAILURE
// ============================================================

export async function markProviderFailure(
  db,
  provider,
  errorId,
  options = {}
) {
  const timestamp =
    nowISO();

  const operation =
    options.operation || null;

  const httpStatus =
    options.httpStatus ?? null;

  const durationMs =
    options.durationMs ?? null;


  await db
    .prepare(`
      INSERT INTO provider_health (
        provider,
        status,
        last_attempt_at,
        last_failure_at,
        consecutive_failures,
        last_error_id,
        last_http_status,
        last_operation,
        last_duration_ms,
        created_at,
        updated_at
      )
      VALUES (
        ?,
        'failing',
        ?,
        ?,
        1,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
      ON CONFLICT(provider)
      DO UPDATE SET
        status = 'failing',

        last_attempt_at =
          excluded.last_attempt_at,

        last_failure_at =
          excluded.last_failure_at,

        consecutive_failures =
          provider_health.consecutive_failures
          + 1,

        last_error_id =
          excluded.last_error_id,

        last_http_status =
          excluded.last_http_status,

        last_operation =
          excluded.last_operation,

        last_duration_ms =
          excluded.last_duration_ms,

        updated_at =
          excluded.updated_at
    `)
    .bind(
      provider,
      timestamp,
      timestamp,
      errorId,
      httpStatus,
      operation,
      durationMs,
      timestamp,
      timestamp
    )
    .run();
}
