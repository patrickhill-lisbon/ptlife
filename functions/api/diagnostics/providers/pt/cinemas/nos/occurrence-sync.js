/*
 * WorthAGo — NOS Controlled Generic Occurrence Sync Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * CONTROLLED WRITE TEST.
 *
 * Tests occurrence synchronization for ONE explicitly
 * selected NOS aggregate movie.
 *
 * Flow:
 *
 *   NOS aggregate movie ID
 *          ↓
 *   fetchSessions()
 *          ↓
 *   normalizeSessions()
 *          ↓
 *   resolve aggregate movie → WorthAGo program_id
 *   resolve theater UUIDs   → WorthAGo place_id
 *          ↓
 *   syncOccurrences()
 *
 * Safety:
 *
 *   - requires explicit aggregate_movie_id
 *   - synchronizes only that movie's sessions
 *   - never deletes occurrences
 *   - never cancels missing occurrences
 *   - rejects unresolved theaters
 *   - rejects malformed NOS sessions
 */

import {
  safeRun
} from "../../../../../../lib/safe-run.js";

import {
  syncOccurrences
} from "../../../../../../lib/sync/occurrences.js";

import {
  provider,
  fetchSessions,
  normalizeSessions
} from "../../../../../../providers/pt/cinemas/nos.js";


// ============================================================
// RESPONSE
// ============================================================

function respond(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
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


// ============================================================
// RESOLVE PROGRAM
// ============================================================

async function resolveProgram(
  db,
  aggregateMovieId
) {
  const row =
    await db
      .prepare(`
        SELECT
          ps.program_id,
          ps.external_id,
          p.official_title

        FROM program_sources ps

        JOIN programs p
          ON p.id = ps.program_id

        WHERE
          ps.source_id = ?
          AND ps.external_id = ?

        LIMIT 1
      `)
      .bind(
        provider.sourceId,
        aggregateMovieId
      )
      .first();


  if (!row) {
    throw new Error(
      "NOS aggregate movie is not mapped to a WorthAGo program: " +
      aggregateMovieId
    );
  }


  return {
    programId:
      Number(row.program_id),

    externalId:
      String(row.external_id),

    title:
      row.official_title
  };
}


// ============================================================
// LOAD NOS THEATER → PLACE MAP
// ============================================================

async function loadTheaterMap(
  db
) {
  const result =
    await db
      .prepare(`
        SELECT
          ps.place_id,
          ps.external_id,
          p.official_name

        FROM place_sources ps

        JOIN places p
          ON p.id = ps.place_id

        WHERE
          ps.source_id = ?
          AND ps.external_id IS NOT NULL
          AND ps.status = 'active'
      `)
      .bind(
        provider.sourceId
      )
      .all();


  const rows =
    result?.results || [];


  const map =
    new Map();


  for (const row of rows) {
    map.set(
      String(row.external_id),
      {
        placeId:
          Number(row.place_id),

        name:
          row.official_name
      }
    );
  }


  return {
    rows,
    map
  };
}


// ============================================================
// COUNT OCCURRENCES FOR THIS PROGRAM/SOURCE
// ============================================================

async function countStoredOccurrences(
  db,
  programId
) {
  const row =
    await db
      .prepare(`
        SELECT
          COUNT(*) AS count

        FROM program_occurrences

        WHERE
          source_id = ?
          AND program_id = ?
          AND external_id IS NOT NULL
      `)
      .bind(
        provider.sourceId,
        programId
      )
      .first();


  return Number(
    row?.count ?? 0
  );
}


// ============================================================
// RUN DIAGNOSTIC
// ============================================================

async function runDiagnostic(
  db,
  requestedAggregateMovieId
) {

  // ---------------------------------------------------------
  // 1. REQUIRE EXPLICIT MOVIE
  // ---------------------------------------------------------

  const aggregateMovieId =
    clean(
      requestedAggregateMovieId
    );


  if (!aggregateMovieId) {
    throw new Error(
      "This diagnostic requires an explicit aggregate_movie_id query parameter"
    );
  }


  // ---------------------------------------------------------
  // 2. RESOLVE MOVIE TO CANONICAL PROGRAM
  // ---------------------------------------------------------

  const program =
    await resolveProgram(
      db,
      aggregateMovieId
    );


  // ---------------------------------------------------------
  // 3. FETCH NOS SESSIONS
  // ---------------------------------------------------------

  const fetched =
    await fetchSessions(
      aggregateMovieId
    );


  // ---------------------------------------------------------
  // 4. NORMALIZE PROVIDER DATA
  // ---------------------------------------------------------

  const normalized =
    normalizeSessions(
      aggregateMovieId,
      fetched.data
    );


  /*
   * For this controlled diagnostic, rejected sessions are
   * treated as a provider/schema problem.
   *
   * We do not silently continue with a partial schedule.
   */

  if (
    normalized.rejected.length > 0
  ) {
    throw new Error(
      "NOS session normalization rejected " +
      normalized.rejected.length +
      " session(s)"
    );
  }


  if (
    normalized.sessions.length === 0
  ) {
    throw new Error(
      "NOS returned zero usable sessions for requested movie"
    );
  }


  // ---------------------------------------------------------
  // 5. LOAD THEATER MAP
  // ---------------------------------------------------------

  const theaters =
    await loadTheaterMap(
      db
    );


  if (
    theaters.rows.length === 0
  ) {
    throw new Error(
      "No NOS theater mappings exist in place_sources"
    );
  }


  // ---------------------------------------------------------
  // 6. RESOLVE PROVIDER THEATERS
  // ---------------------------------------------------------

  const unresolved =
    new Map();

  const occurrences = [];


  for (
    const session
    of normalized.sessions
  ) {

    const theaterExternalId =
      clean(
        session.theaterExternalId
      );


    const theater =
      theaterExternalId
        ? theaters.map.get(
            theaterExternalId
          )
        : null;


    if (!theater) {

      const key =
        theaterExternalId ||
        "(missing theater ID)";


      if (
        !unresolved.has(key)
      ) {
        unresolved.set(
          key,
          {
            theater_external_id:
              theaterExternalId,

            theater_name:
              session.theaterName,

            session_count:
              0
          }
        );
      }


      unresolved.get(
        key
      ).session_count += 1;


      continue;
    }


    /*
     * This is the provider-independent shape consumed by
     * syncOccurrences().
     */

    occurrences.push({
      externalId:
        session.externalId,

      programId:
        program.programId,

      placeId:
        theater.placeId,

      startsAt:
        session.startsAt,

      endsAt:
        null,

      timezone:
        "Europe/Lisbon",

      status:
        "scheduled",

      capacity:
        null,

      placesRemaining:
        null
    });
  }


  const unresolvedTheaters =
    Array.from(
      unresolved.values()
    );


  /*
   * Critical safety rule:
   *
   * If NOS knows about a theater that WorthAGo does not,
   * stop the entire occurrence synchronization.
   *
   * This is exactly how discovery of a newly added NOS
   * theater can surface instead of silently losing its
   * sessions.
   */

  if (
    unresolvedTheaters.length > 0
  ) {
    throw new Error(
      "NOS sessions reference " +
      unresolvedTheaters.length +
      " unresolved theater(s)"
    );
  }


  if (
    occurrences.length !==
    normalized.sessions.length
  ) {
    throw new Error(
      "Not every normalized NOS session was mapped to an occurrence"
    );
  }


  // ---------------------------------------------------------
  // 7. DATABASE STATE BEFORE
  // ---------------------------------------------------------

  const storedBefore =
    await countStoredOccurrences(
      db,
      program.programId
    );


  // ---------------------------------------------------------
  // 8. GENERIC OCCURRENCE SYNCHRONIZATION
  // ---------------------------------------------------------

  const synchronization =
    await syncOccurrences({
      db,

      sourceId:
        provider.sourceId,

      occurrences
    });


  // ---------------------------------------------------------
  // 9. DATABASE STATE AFTER
  // ---------------------------------------------------------

  const storedAfter =
    await countStoredOccurrences(
      db,
      program.programId
    );


  // ---------------------------------------------------------
  // 10. CONSISTENCY CHECKS
  // ---------------------------------------------------------

  if (
    synchronization.incoming !==
    occurrences.length
  ) {
    throw new Error(
      "Occurrence synchronizer incoming count does not match normalized sessions"
    );
  }


  if (
    synchronization.created +
      synchronization.updated +
      synchronization.unchanged !==
    synchronization.incoming
  ) {
    throw new Error(
      "Occurrence synchronization counts do not reconcile"
    );
  }


  if (
    storedAfter <
    storedBefore
  ) {
    throw new Error(
      "Stored occurrence count decreased during synchronization"
    );
  }


  /*
   * Verify every currently supplied session identity exists
   * after synchronization.
   */

  const incomingIds =
    occurrences.map(
      occurrence =>
        occurrence.externalId
    );


  let currentIdentitiesStored = 0;


  /*
   * D1/SQLite has parameter limits, so deliberately verify
   * in small chunks rather than constructing one enormous
   * IN (...) statement.
   */

  const VERIFY_CHUNK_SIZE =
    80;


  for (
    let offset = 0;
    offset < incomingIds.length;
    offset += VERIFY_CHUNK_SIZE
  ) {

    const chunk =
      incomingIds.slice(
        offset,
        offset +
          VERIFY_CHUNK_SIZE
      );


    const placeholders =
      chunk
        .map(() => "?")
        .join(", ");


    const row =
      await db
        .prepare(`
          SELECT
            COUNT(*) AS count

          FROM program_occurrences

          WHERE
            source_id = ?
            AND external_id IN (${placeholders})
        `)
        .bind(
          provider.sourceId,
          ...chunk
        )
        .first();


    currentIdentitiesStored +=
      Number(
        row?.count ?? 0
      );
  }


  if (
    currentIdentitiesStored !==
    occurrences.length
  ) {
    throw new Error(
      "Not every current NOS session identity exists after synchronization"
    );
  }


  return {
    diagnostic:
      "NOS controlled generic occurrence synchronization",

    controlled_write:
      true,

    provider: {
      key:
        provider.key,

      source_id:
        provider.sourceId
    },

    program: {
      program_id:
        program.programId,

      external_id:
        program.externalId,

      title:
        program.title
    },

    provider_sessions: {
      days:
        normalized.days,

      normalized:
        normalized.sessions.length,

      rejected:
        normalized.rejected.length,

      fetch:
        fetched.fetch
    },

    theater_mapping: {
      known_theaters:
        theaters.rows.length,

      unresolved_theaters:
        unresolvedTheaters
    },

    database: {
      stored_before:
        storedBefore,

      stored_after:
        storedAfter,

      current_session_identities_stored:
        currentIdentitiesStored
    },

    synchronization,

    safety: {
      one_program_only:
        true,

      requested_program:
        aggregateMovieId,

      missing_occurrences_deleted:
        false,

      missing_occurrences_cancelled:
        false,

      unresolved_theaters_written:
        false,

      rejected_sessions_written:
        false,

      identity:
        "source_id + external_id"
    }
  };
}


// ============================================================
// HTTP ENDPOINT
// ============================================================

export async function onRequestGet(
  context
) {

  const started =
    Date.now();


  const url =
    new URL(
      context.request.url
    );


  const aggregateMovieId =
    url.searchParams.get(
      "aggregate_movie_id"
    );


  const result =
    await safeRun({
      db:
        context.env.DB,

      provider:
        provider.key,

      operation:
        "controlled_generic_occurrence_sync",

      stage:
        "generic_occurrence_sync_test",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/occurrence-sync.js",

      request:
        context.request,

      reproduction:
        aggregateMovieId
          ? (
              "GET /api/diagnostics/providers/pt/cinemas/nos/occurrence-sync" +
              "?aggregate_movie_id=" +
              encodeURIComponent(
                aggregateMovieId
              )
            )
          : (
              "GET /api/diagnostics/providers/pt/cinemas/nos/occurrence-sync"
            ),


      run:
        () =>
          runDiagnostic(
            context.env.DB,
            aggregateMovieId
          ),


      validate:
        data => {

          if (
            !data?.safety
              ?.one_program_only
          ) {
            throw new Error(
              "Occurrence diagnostic was not limited to one program"
            );
          }


          if (
            data?.theater_mapping
              ?.unresolved_theaters
              ?.length !== 0
          ) {
            throw new Error(
              "Occurrence diagnostic contains unresolved theaters"
            );
          }


          if (
            data?.provider_sessions
              ?.rejected !== 0
          ) {
            throw new Error(
              "Occurrence diagnostic contains rejected sessions"
            );
          }


          if (
            data?.database
              ?.current_session_identities_stored !==
            data?.provider_sessions
              ?.normalized
          ) {
            throw new Error(
              "Current session identities are incomplete after synchronization"
            );
          }


          return true;
        },


      getItemCount:
        data =>
          data?.synchronization
            ?.incoming ??
          0,


      getMetadata:
        data => ({
          provider_key:
            data.provider.key,

          program_id:
            data.program.program_id,

          aggregate_movie_id:
            data.program.external_id,

          sessions:
            data.provider_sessions
              .normalized,

          created:
            data.synchronization
              .created,

          updated:
            data.synchronization
              .updated,

          unchanged:
            data.synchronization
              .unchanged
        }),


      fallbackData: {
        program:
          null,

        provider_sessions:
          null,

        theater_mapping:
          null,

        database:
          null,

        synchronization:
          null
      }
    });


  return respond({
    ...result,

    diagnostic_test:
      true,

    total_request_ms:
      Date.now() -
      started,

    next_step:
      result.ok
        ? (
            "Inspect occurrence counts and idempotency. " +
            "Do not expand occurrence synchronization to the full NOS catalogue yet."
          )
        : (
            "Stop and inspect the failure before proceeding."
          )
  });
}
