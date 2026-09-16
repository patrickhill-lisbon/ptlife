/*
 * WorthAGo — NOS Three-Program Occurrence Sync Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * CONTROLLED WRITE TEST.
 *
 * Purpose:
 *   Test generic occurrence synchronization across three
 *   NOS programs using bounded parallel provider fetching.
 *
 * Safety:
 *   - exactly 3 provider programs
 *   - maximum fetch concurrency = 3
 *   - no occurrence deletion
 *   - no implicit cancellation
 *   - no unresolved theaters permitted
 *   - no rejected sessions permitted
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


const PROGRAM_COUNT = 3;
const FETCH_CONCURRENCY = 3;


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
// SELECT THREE KNOWN NOS PROGRAMS
// ============================================================

async function loadPrograms(db) {
  /*
   * Include A Odisseia deliberately because we already know
   * its occurrence history and can verify that those rows
   * remain stable.
   *
   * Select two additional NOS programs deterministically.
   */

  const knownAggregateId =
    "1e70190b-5cf3-4937-b361-24f67bdd11d0";


  const known =
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
          AND ps.external_id = ?

        LIMIT 1
      `)
      .bind(
        provider.sourceId,
        knownAggregateId
      )
      .first();


  if (!known) {
    throw new Error(
      "A Odisseia provider mapping was not found"
    );
  }


  const othersResult =
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
          AND ps.external_id <> ?

        ORDER BY
          p.id ASC

        LIMIT 2
      `)
      .bind(
        provider.sourceId,
        knownAggregateId
      )
      .all();


  const others =
    othersResult?.results || [];


  const rows = [
    known,
    ...others
  ];


  if (
    rows.length !==
    PROGRAM_COUNT
  ) {
    throw new Error(
      "Expected exactly 3 NOS programs for diagnostic"
    );
  }


  return rows.map(
    row => ({
      programId:
        Number(row.program_id),

      title:
        row.official_title,

      externalId:
        String(row.external_id)
    })
  );
}


// ============================================================
// LOAD THEATER MAP
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


  if (map.size === 0) {
    throw new Error(
      "No NOS theater mappings found"
    );
  }


  return {
    rows,
    map
  };
}


// ============================================================
// FETCH ONE PROGRAM
// ============================================================

async function fetchProgramSessions(
  program
) {
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
    normalized
  };
}


// ============================================================
// FETCH THREE WITH BOUNDED CONCURRENCY
// ============================================================

async function fetchAllPrograms(
  programs
) {
  /*
   * There are exactly three items and our concurrency limit
   * is exactly three, so Promise.all is bounded here.
   *
   * When we later expand to the complete catalogue we will
   * use a reusable concurrency worker rather than launching
   * all provider requests simultaneously.
   */

  if (
    programs.length >
    FETCH_CONCURRENCY
  ) {
    throw new Error(
      "Diagnostic exceeds configured fetch concurrency"
    );
  }


  return Promise.all(
    programs.map(
      fetchProgramSessions
    )
  );
}


// ============================================================
// COUNT STORED OCCURRENCES FOR SELECTED PROGRAMS
// ============================================================

async function countStored(
  db,
  programIds
) {
  const placeholders =
    programIds
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
          AND program_id IN (${placeholders})
          AND external_id IS NOT NULL
      `)
      .bind(
        provider.sourceId,
        ...programIds
      )
      .first();


  return Number(
    row?.count ?? 0
  );
}


// ============================================================
// RUN DIAGNOSTIC
// ============================================================

async function runDiagnostic(db) {

  const started =
    Date.now();


  // ---------------------------------------------------------
  // 1. SELECT PROGRAMS
  // ---------------------------------------------------------

  const programs =
    await loadPrograms(db);


  const programIds =
    programs.map(
      program =>
        program.programId
    );


  // ---------------------------------------------------------
  // 2. LOAD THEATER IDENTITIES
  // ---------------------------------------------------------

  const theaters =
    await loadTheaterMap(db);


  // ---------------------------------------------------------
  // 3. FETCH THREE PROVIDER SESSION FEEDS
  // ---------------------------------------------------------

  const fetchStarted =
    Date.now();


  const fetchedPrograms =
    await fetchAllPrograms(
      programs
    );


  const parallelFetchMs =
    Date.now() -
    fetchStarted;


  // ---------------------------------------------------------
  // 4. VALIDATE + MAP TO GENERIC OCCURRENCES
  // ---------------------------------------------------------

  const occurrences = [];

  const unresolved =
    new Map();

  const perProgram = [];


  for (
    const result
    of fetchedPrograms
  ) {

    const {
      program,
      fetched,
      normalized
    } = result;


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


    /*
     * Zero sessions is not automatically corruption in the
     * eventual production system.
     *
     * But for this controlled diagnostic we want programs
     * that actually exercise occurrence synchronization.
     */

    if (
      normalized.sessions.length ===
      0
    ) {
      throw new Error(
        "NOS returned zero sessions for diagnostic program: " +
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


        unresolved.get(
          key
        ).session_count += 1;


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

      fetch:
        fetched.fetch
    });
  }


  const unresolvedTheaters =
    Array.from(
      unresolved.values()
    );


  if (
    unresolvedTheaters.length >
    0
  ) {
    throw new Error(
      "NOS session feeds contain " +
      unresolvedTheaters.length +
      " unresolved theater(s)"
    );
  }


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


  // ---------------------------------------------------------
  // 5. CHECK CROSS-PROGRAM SESSION UUID COLLISIONS
  // ---------------------------------------------------------

  const sessionIds =
    new Set();


  for (
    const occurrence
    of occurrences
  ) {
    if (
      sessionIds.has(
        occurrence.externalId
      )
    ) {
      throw new Error(
        "Duplicate NOS session UUID across diagnostic programs: " +
        occurrence.externalId
      );
    }


    sessionIds.add(
      occurrence.externalId
    );
  }


  // ---------------------------------------------------------
  // 6. DATABASE BEFORE
  // ---------------------------------------------------------

  const storedBefore =
    await countStored(
      db,
      programIds
    );


  // ---------------------------------------------------------
  // 7. GENERIC SYNCHRONIZATION
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
  // 8. DATABASE AFTER
  // ---------------------------------------------------------

  const storedAfter =
    await countStored(
      db,
      programIds
    );


  // ---------------------------------------------------------
  // 9. CONSISTENCY
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
      "Stored occurrence count decreased"
    );
  }


  return {
    diagnostic:
      "NOS three-program generic occurrence synchronization",

    controlled_write:
      true,

    provider: {
      key:
        provider.key,

      source_id:
        provider.sourceId
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
        perProgram.reduce(
          (sum, item) =>
            sum + item.rejected,
          0
        )
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
        storedAfter
    },

    synchronization,

    timing: {
      parallel_provider_fetch_ms:
        parallelFetchMs,

      generic_sync_ms:
        syncMs,

      diagnostic_ms:
        Date.now() -
        started
    },

    safety: {
      program_limit:
        PROGRAM_COUNT,

      fetch_concurrency:
        FETCH_CONCURRENCY,

      full_catalogue:
        false,

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
        "controlled_three_program_occurrence_sync",

      stage:
        "generic_occurrence_multi_program_test",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/occurrence-sync-three.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/occurrence-sync-three",


      run:
        () =>
          runDiagnostic(
            context.env.DB
          ),


      validate:
        data => {

          if (
            data?.totals?.programs !==
            PROGRAM_COUNT
          ) {
            throw new Error(
              "Diagnostic did not process exactly three programs"
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
              "Diagnostic contains rejected sessions"
            );
          }


          if (
            data?.theater_mapping
              ?.unresolved_theaters
              ?.length !== 0
          ) {
            throw new Error(
              "Diagnostic contains unresolved theaters"
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

          parallel_provider_fetch_ms:
            data.timing
              .parallel_provider_fetch_ms,

          generic_sync_ms:
            data.timing
              .generic_sync_ms
        }),


      fallbackData: {
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
            "Inspect per-program fetch times, synchronization counts, " +
            "and generic synchronization time. Do not expand to the " +
            "full NOS catalogue until this result is reviewed."
          )
        : (
            "Stop and inspect the failure before proceeding."
          )
  });
}
