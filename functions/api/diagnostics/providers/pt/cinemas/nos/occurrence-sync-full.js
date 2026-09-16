/*
 * WorthAGo — NOS Full Occurrence Sync Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * FULL PROVIDER WRITE TEST.
 *
 * Purpose:
 *   Synchronize occurrences for every currently known
 *   Cinemas NOS program using the generic WorthAGo
 *   synchronization infrastructure.
 *
 * Safety:
 *   - bounded provider concurrency
 *   - all provider data fetched before occurrence writes
 *   - all sessions normalized before occurrence writes
 *   - all theater identities resolved before occurrence writes
 *   - duplicate session identities rejected
 *   - rejected sessions cause the run to abort
 *   - no occurrence deletion
 *   - no implicit cancellation of missing occurrences
 */

import {
  safeRun
} from "../../../../../../lib/safe-run.js";

import {
  mapWithConcurrency
} from "../../../../../../lib/concurrency.js";

import {
  syncOccurrences
} from "../../../../../../lib/sync/occurrences.js";

import {
  provider,
  fetchSessions,
  normalizeSessions
} from "../../../../../../providers/pt/cinemas/nos.js";


const FETCH_CONCURRENCY = 3;

const MINIMUM_PROGRAMS_REQUIRED = 5;


// ============================================================
// RESPONSE
// ============================================================

function respond(data, status = 200) {
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
// LOAD ALL KNOWN PROVIDER PROGRAMS
// ============================================================

async function loadPrograms(db) {
  const result =
    await db
      .prepare(`
        SELECT
          p.id AS program_id,
          p.official_title,
          ps.external_id

        FROM program_sources ps

        JOIN programs p
          ON p.id = ps.program_id

        WHERE
          ps.source_id = ?
          AND ps.external_id IS NOT NULL
          AND ps.status = 'active'

        ORDER BY
          p.id ASC
      `)
      .bind(
        provider.sourceId
      )
      .all();


  const rows =
    result?.results || [];


  if (
    rows.length <
    MINIMUM_PROGRAMS_REQUIRED
  ) {
    throw new Error(
      "Too few active NOS programs for full occurrence sync: " +
      rows.length
    );
  }


  const seenExternalIds =
    new Set();


  const programs =
    rows.map(
      row => {

        const externalId =
          clean(
            row.external_id
          );


        if (!externalId) {
          throw new Error(
            "NOS program has no external ID"
          );
        }


        if (
          seenExternalIds.has(
            externalId
          )
        ) {
          throw new Error(
            "Duplicate NOS program external ID: " +
            externalId
          );
        }


        seenExternalIds.add(
          externalId
        );


        return {
          programId:
            Number(row.program_id),

          title:
            row.official_title,

          externalId
        };
      }
    );


  return programs;
}


// ============================================================
// LOAD PROVIDER THEATER MAP
// ============================================================

async function loadTheaterMap(db) {
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


  if (rows.length === 0) {
    throw new Error(
      "No active NOS theater mappings found"
    );
  }


  const map =
    new Map();


  for (const row of rows) {
    const externalId =
      clean(
        row.external_id
      );


    if (!externalId) {
      continue;
    }


    if (
      map.has(
        externalId
      )
    ) {
      throw new Error(
        "Duplicate NOS theater external ID: " +
        externalId
      );
    }


    map.set(
      externalId,
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
// FETCH + NORMALIZE ONE PROGRAM
// ============================================================

async function fetchProgramSessions(
  program
) {
  const started =
    Date.now();


  const fetched =
    await fetchSessions(
      program.externalId
    );


  const normalized =
    normalizeSessions(
      program.externalId,
      fetched.data
    );


  return {
    program,

    fetched,

    normalized,

    totalMs:
      Date.now() - started
  };
}


// ============================================================
// COUNT STORED PROVIDER OCCURRENCES
// ============================================================

async function countStored(db) {
  const row =
    await db
      .prepare(`
        SELECT
          COUNT(*) AS count

        FROM program_occurrences

        WHERE
          source_id = ?
          AND external_id IS NOT NULL
      `)
      .bind(
        provider.sourceId
      )
      .first();


  return Number(
    row?.count ?? 0
  );
}


// ============================================================
// COUNT CURRENT INCOMING IDENTITIES ALREADY STORED
// ============================================================

async function countIncomingStored(
  db,
  externalIds
) {
  /*
   * D1/SQLite parameter limits make a giant IN clause a
   * poor long-term strategy.
   *
   * For this diagnostic we do not actually need a second
   * database query because syncOccurrences() reports its
   * own previouslyStored count.
   *
   * This helper exists only as a semantic placeholder for
   * the future scoped synchronization optimization.
   */

  void db;
  void externalIds;

  return null;
}


// ============================================================
// RUN
// ============================================================

async function runDiagnostic(db) {
  const started =
    Date.now();


  // ---------------------------------------------------------
  // 1. LOAD DATABASE IDENTITIES
  // ---------------------------------------------------------

  const programs =
    await loadPrograms(db);


  const theaters =
    await loadTheaterMap(db);


  const storedBefore =
    await countStored(db);


  // ---------------------------------------------------------
  // 2. FETCH ALL PROGRAM SESSION FEEDS
  //
  // IMPORTANT:
  //
  // mapWithConcurrency guarantees that no more than three
  // provider requests are in flight at once.
  // ---------------------------------------------------------

  const providerFetchStarted =
    Date.now();


  const fetchedPrograms =
    await mapWithConcurrency(
      programs,
      FETCH_CONCURRENCY,
      fetchProgramSessions
    );


  const providerFetchMs =
    Date.now() -
    providerFetchStarted;


  // ---------------------------------------------------------
  // 3. NORMALIZATION VALIDATION
  //
  // Nothing has been written yet.
  // ---------------------------------------------------------

  const occurrences = [];

  const unresolved =
    new Map();

  const perProgram = [];

  let rejectedTotal = 0;


  for (
    const result
    of fetchedPrograms
  ) {
    const {
      program,
      fetched,
      normalized,
      totalMs
    } = result;


    rejectedTotal +=
      normalized.rejected.length;


    if (
      normalized.rejected.length >
      0
    ) {
      throw new Error(
        "NOS normalization rejected " +
        normalized.rejected.length +
        " session(s) for " +
        program.title
      );
    }


    let mappedCount = 0;


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


        unresolved
          .get(key)
          .session_count += 1;


        continue;
      }


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


      mappedCount += 1;
    }


    perProgram.push({
      program_id:
        program.programId,

      external_id:
        program.externalId,

      title:
        program.title,

      days:
        normalized.days,

      sessions:
        normalized.sessions.length,

      mapped:
        mappedCount,

      rejected:
        normalized.rejected.length,

      provider_ms:
        totalMs,

      fetch:
        fetched.fetch
    });
  }


  // ---------------------------------------------------------
  // 4. VALIDATE ALL THEATER IDENTITIES
  // ---------------------------------------------------------

  const unresolvedTheaters =
    Array.from(
      unresolved.values()
    );


  if (
    unresolvedTheaters.length >
    0
  ) {
    throw new Error(
      "Full NOS occurrence sync contains " +
      unresolvedTheaters.length +
      " unresolved theater(s)"
    );
  }


  // ---------------------------------------------------------
  // 5. RECONCILE SESSION COUNTS
  // ---------------------------------------------------------

  const normalizedTotal =
    perProgram.reduce(
      (sum, item) =>
        sum + item.sessions,
      0
    );


  if (
    occurrences.length !==
    normalizedTotal
  ) {
    throw new Error(
      "Not every normalized NOS session was mapped"
    );
  }


  if (
    rejectedTotal !== 0
  ) {
    throw new Error(
      "Full NOS occurrence sync contains rejected sessions"
    );
  }


  // ---------------------------------------------------------
  // 6. CROSS-PROGRAM SESSION IDENTITY VALIDATION
  //
  // A NOS session UUID must identify exactly one occurrence
  // across the complete provider synchronization.
  // ---------------------------------------------------------

  const seenSessionIds =
    new Map();


  for (
    const occurrence
    of occurrences
  ) {
    const previous =
      seenSessionIds.get(
        occurrence.externalId
      );


    if (previous) {
      throw new Error(
        "Duplicate NOS session UUID across programs: " +
        occurrence.externalId +
        " (programs " +
        previous.programId +
        " and " +
        occurrence.programId +
        ")"
      );
    }


    seenSessionIds.set(
      occurrence.externalId,
      occurrence
    );
  }


  // ---------------------------------------------------------
  // 7. PROGRAM COVERAGE VALIDATION
  //
  // Zero sessions is permitted here.
  //
  // A film may legitimately remain in the current catalogue
  // while having no sessions in the provider's current
  // schedule window.
  // ---------------------------------------------------------

  if (
    perProgram.length !==
    programs.length
  ) {
    throw new Error(
      "Not every NOS program was processed"
    );
  }


  // ---------------------------------------------------------
  // 8. GENERIC SYNCHRONIZATION
  //
  // This is the FIRST occurrence-writing operation in this
  // diagnostic. All provider data has already been fetched
  // and validated.
  // ---------------------------------------------------------

  const syncStarted =
    Date.now();


  const synchronization =
    await syncOccurrences({
      db,

      sourceId:
        provider.sourceId,

      occurrences
    });


  const syncMs =
    Date.now() -
    syncStarted;


  // ---------------------------------------------------------
  // 9. DATABASE AFTER
  // ---------------------------------------------------------

  const storedAfter =
    await countStored(db);


  // ---------------------------------------------------------
  // 10. FINAL CONSISTENCY CHECKS
  // ---------------------------------------------------------

  if (
    synchronization.incoming !==
    occurrences.length
  ) {
    throw new Error(
      "Synchronizer incoming count mismatch"
    );
  }


  if (
    synchronization.created +
      synchronization.updated +
      synchronization.unchanged !==
    synchronization.incoming
  ) {
    throw new Error(
      "Synchronization counts do not reconcile"
    );
  }


  if (
    storedAfter <
    storedBefore
  ) {
    throw new Error(
      "Stored NOS occurrence count decreased"
    );
  }


  const expectedStoredAfter =
    storedBefore +
    synchronization.created;


  if (
    storedAfter !==
    expectedStoredAfter
  ) {
    throw new Error(
      "Stored occurrence count does not match expected creation count"
    );
  }


  // ---------------------------------------------------------
  // 11. PERFORMANCE SUMMARY
  // ---------------------------------------------------------

  const providerDurations =
    perProgram
      .map(
        item =>
          item.provider_ms
      );


  const slowestProviderMs =
    providerDurations.length
      ? Math.max(
          ...providerDurations
        )
      : 0;


  const fastestProviderMs =
    providerDurations.length
      ? Math.min(
          ...providerDurations
        )
      : 0;


  const providerWorkMs =
    providerDurations.reduce(
      (sum, value) =>
        sum + value,
      0
    );


  await countIncomingStored(
    db,
    occurrences.map(
      occurrence =>
        occurrence.externalId
    )
  );


  return {
    diagnostic:
      "NOS full generic occurrence synchronization",

    controlled_write:
      true,

    provider: {
      key:
        provider.key,

      source_id:
        provider.sourceId
    },

    catalogue: {
      programs:
        programs.length
    },

    programs:
      perProgram,

    totals: {
      programs:
        programs.length,

      normalized_sessions:
        normalizedTotal,

      mapped_occurrences:
        occurrences.length,

      rejected_sessions:
        rejectedTotal
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

      expected_stored_after:
        expectedStoredAfter
    },

    synchronization,

    timing: {
      provider_fetch_wall_ms:
        providerFetchMs,

      provider_work_ms:
        providerWorkMs,

      fastest_provider_ms:
        fastestProviderMs,

      slowest_provider_ms:
        slowestProviderMs,

      generic_sync_ms:
        syncMs,

      diagnostic_ms:
        Date.now() -
        started
    },

    safety: {
      minimum_programs_required:
        MINIMUM_PROGRAMS_REQUIRED,

      programs_processed:
        programs.length,

      fetch_concurrency:
        FETCH_CONCURRENCY,

      all_provider_fetches_before_write:
        true,

      all_normalization_before_write:
        true,

      all_theaters_resolved_before_write:
        true,

      duplicate_session_ids_checked:
        true,

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


  const result =
    await safeRun({
      db:
        context.env.DB,

      provider:
        provider.key,

      operation:
        "full_generic_occurrence_sync",

      stage:
        "generic_occurrence_full_catalogue_test",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/occurrence-sync-full.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/occurrence-sync-full",


      run:
        () =>
          runDiagnostic(
            context.env.DB
          ),


      validate:
        data => {

          if (
            data?.totals?.programs <
            MINIMUM_PROGRAMS_REQUIRED
          ) {
            throw new Error(
              "Too few programs were processed"
            );
          }


          if (
            data?.totals
              ?.normalized_sessions !==
            data?.totals
              ?.mapped_occurrences
          ) {
            throw new Error(
              "Not every normalized session was mapped"
            );
          }


          if (
            data?.totals
              ?.rejected_sessions !==
            0
          ) {
            throw new Error(
              "Full synchronization contains rejected sessions"
            );
          }


          if (
            data?.theater_mapping
              ?.unresolved_theaters
              ?.length !== 0
          ) {
            throw new Error(
              "Full synchronization contains unresolved theaters"
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

          programs:
            data.totals.programs,

          sessions:
            data.totals
              .normalized_sessions,

          created:
            data.synchronization
              .created,

          updated:
            data.synchronization
              .updated,

          unchanged:
            data.synchronization
              .unchanged,

          provider_fetch_wall_ms:
            data.timing
              .provider_fetch_wall_ms,

          generic_sync_ms:
            data.timing
              .generic_sync_ms
        }),


      fallbackData: {
        catalogue:
          null,

        programs:
          null,

        totals:
          null,

        theater_mapping:
          null,

        database:
          null,

        synchronization:
          null,

        timing:
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
            "Inspect program coverage, session totals, " +
            "created/updated/unchanged counts, provider timing, " +
            "and database counts. Do not run this endpoint a " +
            "second time until the first full result is reviewed."
          )
        : (
            "Stop. Inspect the failure before attempting another full synchronization."
          )
  });
}
