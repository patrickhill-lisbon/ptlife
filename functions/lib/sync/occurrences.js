/*
 * WorthAGo — Generic Occurrence Synchronizer
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Generic synchronization layer for program occurrences.
 *
 * This module knows nothing about NOS, cinemas, Portugal,
 * movies, concerts, museums, classes, or any other specific
 * provider/domain.
 *
 * Provider adapters are responsible for converting their
 * source data into the normalized occurrence shape expected
 * here.
 *
 * Identity:
 *
 *   source_id + external_id
 *
 * Database protection:
 *
 *   UNIQUE (source_id, external_id)
 *   WHERE external_id IS NOT NULL
 *
 * Design goals:
 *
 *   - provider-independent
 *   - idempotent
 *   - create new occurrences
 *   - update changed occurrences
 *   - skip unchanged occurrences
 *   - never delete missing occurrences
 *   - never cancel missing occurrences
 *   - validate references before writing
 */


// ============================================================
// HELPERS
// ============================================================

function clean(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const result =
    String(value).trim();

  return result || null;
}


function normalizeInteger(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  if (
    !Number.isInteger(number)
  ) {
    return null;
  }

  return number;
}


function sameNullable(a, b) {
  return (
    (a ?? null) ===
    (b ?? null)
  );
}


// ============================================================
// NORMALIZE ONE OCCURRENCE
// ============================================================

function normalizeOccurrence(
  occurrence
) {
  if (
    !occurrence ||
    typeof occurrence !== "object"
  ) {
    throw new Error(
      "Occurrence must be an object"
    );
  }


  const externalId =
    clean(
      occurrence.externalId ??
      occurrence.external_id
    );


  if (!externalId) {
    throw new Error(
      "Occurrence requires externalId"
    );
  }


  const programId =
    normalizeInteger(
      occurrence.programId ??
      occurrence.program_id
    );


  if (!programId) {
    throw new Error(
      "Occurrence " +
      externalId +
      " requires a valid programId"
    );
  }


  const startsAt =
    clean(
      occurrence.startsAt ??
      occurrence.starts_at
    );


  if (!startsAt) {
    throw new Error(
      "Occurrence " +
      externalId +
      " requires startsAt"
    );
  }


  const placeId =
    normalizeInteger(
      occurrence.placeId ??
      occurrence.place_id
    );


  const endsAt =
    clean(
      occurrence.endsAt ??
      occurrence.ends_at
    );


  const timezone =
    clean(
      occurrence.timezone
    ) ||
    "Europe/Lisbon";


  const status =
    clean(
      occurrence.status
    ) ||
    "scheduled";


  const allowedStatuses =
    new Set([
      "scheduled",
      "cancelled",
      "postponed",
      "sold_out",
      "waitlist",
      "completed"
    ]);


  if (
    !allowedStatuses.has(status)
  ) {
    throw new Error(
      "Occurrence " +
      externalId +
      " has invalid status: " +
      status
    );
  }


  const capacity =
    normalizeInteger(
      occurrence.capacity
    );


  const placesRemaining =
    normalizeInteger(
      occurrence.placesRemaining ??
      occurrence.places_remaining
    );


  return {
    externalId,
    programId,
    placeId,
    startsAt,
    endsAt,
    timezone,
    status,
    capacity,
    placesRemaining
  };
}


// ============================================================
// VALIDATE INPUT SET
// ============================================================

function normalizeOccurrences(
  occurrences
) {
  if (
    !Array.isArray(occurrences)
  ) {
    throw new Error(
      "syncOccurrences requires an occurrences array"
    );
  }


  const normalized =
    occurrences.map(
      normalizeOccurrence
    );


  /*
   * Catch duplicate provider identities before touching D1.
   *
   * The UNIQUE index would protect the database anyway,
   * but detecting the problem here gives us a much more
   * useful diagnostic.
   */

  const seen =
    new Set();


  for (
    const occurrence of normalized
  ) {
    if (
      seen.has(
        occurrence.externalId
      )
    ) {
      throw new Error(
        "Duplicate occurrence externalId in incoming data: " +
        occurrence.externalId
      );
    }

    seen.add(
      occurrence.externalId
    );
  }


  return normalized;
}


// ============================================================
// LOAD EXISTING PROVIDER OCCURRENCES
// ============================================================

async function loadExistingOccurrences(
  db,
  sourceId
) {
  const result =
    await db
      .prepare(`
        SELECT
          id,
          program_id,
          place_id,
          starts_at,
          ends_at,
          timezone,
          status,
          capacity,
          places_remaining,
          external_id
        FROM program_occurrences
        WHERE
          source_id = ?
          AND external_id IS NOT NULL
      `)
      .bind(sourceId)
      .all();


  const rows =
    result?.results || [];


  const byExternalId =
    new Map();


  for (
    const row of rows
  ) {
    byExternalId.set(
      String(row.external_id),
      row
    );
  }


  return {
    rows,
    byExternalId
  };
}


// ============================================================
// DETERMINE WHETHER EXISTING ROW CHANGED
// ============================================================

function occurrenceChanged(
  existing,
  incoming
) {
  return !(
    Number(existing.program_id) ===
      incoming.programId &&

    sameNullable(
      existing.place_id === null
        ? null
        : Number(existing.place_id),
      incoming.placeId
    ) &&

    sameNullable(
      existing.starts_at,
      incoming.startsAt
    ) &&

    sameNullable(
      existing.ends_at,
      incoming.endsAt
    ) &&

    sameNullable(
      existing.timezone,
      incoming.timezone
    ) &&

    sameNullable(
      existing.status,
      incoming.status
    ) &&

    sameNullable(
      existing.capacity === null
        ? null
        : Number(existing.capacity),
      incoming.capacity
    ) &&

    sameNullable(
      existing.places_remaining === null
        ? null
        : Number(
            existing.places_remaining
          ),
      incoming.placesRemaining
    )
  );
}


// ============================================================
// VERIFY PROGRAM REFERENCES
// ============================================================

async function verifyPrograms(
  db,
  occurrences
) {
  const ids =
    [
      ...new Set(
        occurrences.map(
          occurrence =>
            occurrence.programId
        )
      )
    ];


  if (
    ids.length === 0
  ) {
    return;
  }


  const placeholders =
    ids
      .map(() => "?")
      .join(", ");


  const result =
    await db
      .prepare(`
        SELECT id
        FROM programs
        WHERE id IN (${placeholders})
      `)
      .bind(...ids)
      .all();


  const found =
    new Set(
      (result?.results || [])
        .map(
          row =>
            Number(row.id)
        )
    );


  const missing =
    ids.filter(
      id =>
        !found.has(id)
    );


  if (
    missing.length > 0
  ) {
    throw new Error(
      "Occurrence synchronization references missing program_id(s): " +
      missing.join(", ")
    );
  }
}


// ============================================================
// VERIFY PLACE REFERENCES
// ============================================================

async function verifyPlaces(
  db,
  occurrences
) {
  const ids =
    [
      ...new Set(
        occurrences
          .map(
            occurrence =>
              occurrence.placeId
          )
          .filter(
            value =>
              value !== null
          )
      )
    ];


  if (
    ids.length === 0
  ) {
    return;
  }


  const placeholders =
    ids
      .map(() => "?")
      .join(", ");


  const result =
    await db
      .prepare(`
        SELECT id
        FROM places
        WHERE id IN (${placeholders})
      `)
      .bind(...ids)
      .all();


  const found =
    new Set(
      (result?.results || [])
        .map(
          row =>
            Number(row.id)
        )
    );


  const missing =
    ids.filter(
      id =>
        !found.has(id)
    );


  if (
    missing.length > 0
  ) {
    throw new Error(
      "Occurrence synchronization references missing place_id(s): " +
      missing.join(", ")
    );
  }
}


// ============================================================
// MAIN SYNCHRONIZER
// ============================================================

export async function syncOccurrences(
  options
) {
  if (!options) {
    throw new Error(
      "syncOccurrences requires an options object"
    );
  }


  const {
    db,
    sourceId,
    occurrences
  } = options;


  if (!db) {
    throw new Error(
      "syncOccurrences requires a D1 database binding"
    );
  }


  const normalizedSourceId =
    normalizeInteger(
      sourceId
    );


  if (!normalizedSourceId) {
    throw new Error(
      "syncOccurrences requires a valid sourceId"
    );
  }


  const normalized =
    normalizeOccurrences(
      occurrences
    );


  /*
   * Validate all foreign-key references before writing
   * anything.
   */

  await verifyPrograms(
    db,
    normalized
  );


  await verifyPlaces(
    db,
    normalized
  );


  /*
   * Read the provider's existing occurrence identities once.
   *
   * This avoids one SELECT per occurrence.
   */

  const existing =
    await loadExistingOccurrences(
      db,
      normalizedSourceId
    );


  const creates = [];
  const updates = [];
  let unchanged = 0;


  for (
    const occurrence of normalized
  ) {

    const previous =
      existing.byExternalId.get(
        occurrence.externalId
      );


    if (!previous) {
      creates.push(
        occurrence
      );

      continue;
    }


    if (
      occurrenceChanged(
        previous,
        occurrence
      )
    ) {
      updates.push({
        id:
          Number(previous.id),

        ...occurrence
      });

      continue;
    }


    unchanged += 1;
  }


  // ==========================================================
  // BUILD D1 WRITE BATCH
  // ==========================================================

  const statements = [];


  for (
    const occurrence of creates
  ) {
    statements.push(
      db
        .prepare(`
          INSERT INTO program_occurrences (
            program_id,
            starts_at,
            ends_at,
            timezone,
            status,
            capacity,
            places_remaining,
            source_id,
            place_id,
            external_id
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `)
        .bind(
          occurrence.programId,
          occurrence.startsAt,
          occurrence.endsAt,
          occurrence.timezone,
          occurrence.status,
          occurrence.capacity,
          occurrence.placesRemaining,
          normalizedSourceId,
          occurrence.placeId,
          occurrence.externalId
        )
    );
  }


  for (
    const occurrence of updates
  ) {
    statements.push(
      db
        .prepare(`
          UPDATE program_occurrences
          SET
            program_id = ?,
            starts_at = ?,
            ends_at = ?,
            timezone = ?,
            status = ?,
            capacity = ?,
            places_remaining = ?,
            place_id = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE
            id = ?
            AND source_id = ?
            AND external_id = ?
        `)
        .bind(
          occurrence.programId,
          occurrence.startsAt,
          occurrence.endsAt,
          occurrence.timezone,
          occurrence.status,
          occurrence.capacity,
          occurrence.placesRemaining,
          occurrence.placeId,
          occurrence.id,
          normalizedSourceId,
          occurrence.externalId
        )
    );
  }


  /*
   * D1 batch semantics give us the commit/rollback behavior
   * we want for the write set.
   *
   * If there is nothing to change, do not issue a batch.
   */

  if (
    statements.length > 0
  ) {
    await db.batch(
      statements
    );
  }


  // ==========================================================
  // RESULT
  // ==========================================================

  return {
    incoming:
      normalized.length,

    previouslyStored:
      existing.rows.length,

    created:
      creates.length,

    updated:
      updates.length,

    unchanged,

    createdOccurrences:
      creates.map(
        occurrence => ({
          externalId:
            occurrence.externalId,

          programId:
            occurrence.programId,

          placeId:
            occurrence.placeId,

          startsAt:
            occurrence.startsAt
        })
      ),

    updatedOccurrences:
      updates.map(
        occurrence => ({
          externalId:
            occurrence.externalId,

          programId:
            occurrence.programId,

          placeId:
            occurrence.placeId,

          startsAt:
            occurrence.startsAt
        })
      ),

    safety: {
      occurrencesDeleted:
        false,

      missingOccurrencesCancelled:
        false,

      identity:
        "source_id + external_id",

      foreignKeysValidatedBeforeWrite:
        true,

      unchangedOccurrencesWritten:
        false
    }
  };
}
