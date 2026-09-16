/*
 * WorthAGo — Generic Provider Occurrence Synchronization
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Production synchronization infrastructure.
 *
 * This module knows how to:
 *
 *   - load programs belonging to a provider
 *   - optionally restrict synchronization to selected programs
 *   - load provider place mappings
 *   - fetch provider occurrences with bounded concurrency
 *   - normalize provider occurrences
 *   - validate all data before database writes
 *   - synchronize occurrences through the generic
 *     occurrence synchronization layer
 *
 * This module contains NO NOS-specific knowledge.
 */

import {
  mapWithConcurrency
} from "../concurrency.js";

import {
  syncOccurrences
} from "./occurrences.js";


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
// PROVIDER PROGRAMS
// ============================================================

async function loadProviderPrograms(
  db,
  sourceId
) {
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
      .bind(sourceId)
      .all();


  return (result?.results || [])
    .map(row => ({
      programId:
        Number(row.program_id),

      title:
        row.official_title,

      externalId:
        clean(row.external_id)
    }));
}


// ============================================================
// PROGRAM SELECTION
// ============================================================

function selectPrograms(
  programs,
  programExternalIds
) {
  /*
   * No selection supplied:
   * preserve the original behavior and synchronize every
   * active program belonging to the provider.
   */

  if (
    programExternalIds ===
    undefined
  ) {
    return {
      programs,

      selection: {
        mode:
          "all",

        requested:
          null,

        selected:
          programs.length
      }
    };
  }


  if (
    !Array.isArray(
      programExternalIds
    )
  ) {
    throw new Error(
      "programExternalIds must be an array when supplied"
    );
  }


  if (
    programExternalIds.length === 0
  ) {
    throw new Error(
      "programExternalIds cannot be empty when supplied"
    );
  }


  const requested =
    [];

  const requestedSet =
    new Set();


  for (
    const rawExternalId
    of programExternalIds
  ) {
    const externalId =
      clean(rawExternalId);


    if (!externalId) {
      throw new Error(
        "programExternalIds contains an invalid external ID"
      );
    }


    if (
      requestedSet.has(
        externalId
      )
    ) {
      throw new Error(
        "programExternalIds contains duplicate external ID: " +
        externalId
      );
    }


    requestedSet.add(
      externalId
    );

    requested.push(
      externalId
    );
  }


  const byExternalId =
    new Map();


  for (const program of programs) {
    byExternalId.set(
      program.externalId,
      program
    );
  }


  const selected =
    [];

  const missing =
    [];


  /*
   * Preserve the caller's requested order. This makes
   * diagnostics and future queue jobs deterministic.
   */

  for (const externalId of requested) {
    const program =
      byExternalId.get(
        externalId
      );


    if (!program) {
      missing.push(
        externalId
      );

      continue;
    }


    selected.push(
      program
    );
  }


  if (missing.length) {
    throw new Error(
      "Requested provider program(s) not found or inactive: " +
      missing.join(", ")
    );
  }


  return {
    programs:
      selected,

    selection: {
      mode:
        "selected",

      requested:
        requested.length,

      selected:
        selected.length,

      external_ids:
        requested
    }
  };
}


// ============================================================
// PROVIDER PLACE IDENTITIES
// ============================================================

async function loadProviderPlaces(
  db,
  sourceId
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
      .bind(sourceId)
      .all();


  const rows =
    result?.results || [];


  const places =
    new Map();


  for (const row of rows) {
    const externalId =
      clean(row.external_id);


    if (!externalId) {
      continue;
    }


    if (places.has(externalId)) {
      throw new Error(
        "Duplicate provider place external ID: " +
        externalId
      );
    }


    places.set(
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
    places
  };
}


// ============================================================
// GENERIC PROVIDER OCCURRENCE SYNCHRONIZATION
// ============================================================

export async function syncProviderOccurrences({
  db,

  sourceId,

  providerKey,

  fetchOccurrences,

  normalizeOccurrences,

  concurrency = 3,

  minimumPrograms = 1,

  timezone = "UTC",

  programExternalIds
}) {
  if (!db) {
    throw new Error(
      "syncProviderOccurrences requires db"
    );
  }


  if (
    !Number.isInteger(sourceId) ||
    sourceId <= 0
  ) {
    throw new Error(
      "syncProviderOccurrences requires a valid sourceId"
    );
  }


  if (!providerKey) {
    throw new Error(
      "syncProviderOccurrences requires providerKey"
    );
  }


  if (
    typeof fetchOccurrences !==
    "function"
  ) {
    throw new Error(
      "syncProviderOccurrences requires fetchOccurrences"
    );
  }


  if (
    typeof normalizeOccurrences !==
    "function"
  ) {
    throw new Error(
      "syncProviderOccurrences requires normalizeOccurrences"
    );
  }


  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1
  ) {
    throw new Error(
      "syncProviderOccurrences requires concurrency >= 1"
    );
  }


  if (
    !Number.isInteger(minimumPrograms) ||
    minimumPrograms < 1
  ) {
    throw new Error(
      "syncProviderOccurrences requires minimumPrograms >= 1"
    );
  }


  const started =
    Date.now();


  // ---------------------------------------------------------
  // 1. LOAD ALL ACTIVE PROVIDER PROGRAMS
  // ---------------------------------------------------------

  const allPrograms =
    await loadProviderPrograms(
      db,
      sourceId
    );


  /*
   * Provider program identities must themselves be unique.
   */

  const programExternalIdsSeen =
    new Set();


  for (const program of allPrograms) {
    if (!program.externalId) {
      throw new Error(
        "Provider program has no external ID"
      );
    }


    if (
      programExternalIdsSeen.has(
        program.externalId
      )
    ) {
      throw new Error(
        "Duplicate provider program external ID: " +
        program.externalId
      );
    }


    programExternalIdsSeen.add(
      program.externalId
    );
  }


  // ---------------------------------------------------------
  // 2. SELECT PROGRAMS
  //
  // If programExternalIds was not supplied, this returns
  // every active provider program and preserves our previous
  // full-provider behavior.
  // ---------------------------------------------------------

  const selected =
    selectPrograms(
      allPrograms,
      programExternalIds
    );


  const programs =
    selected.programs;


  /*
   * minimumPrograms protects a FULL provider run against an
   * unexpectedly tiny provider catalogue.
   *
   * For an explicitly selected batch, the caller deliberately
   * chose its size, so requiring the provider-wide minimum
   * would make single-program jobs impossible.
   */

  if (
    selected.selection.mode ===
      "all" &&
    programs.length <
      minimumPrograms
  ) {
    throw new Error(
      "Too few provider programs for occurrence sync: " +
      programs.length
    );
  }


  if (
    selected.selection.mode ===
      "selected" &&
    programs.length === 0
  ) {
    throw new Error(
      "No provider programs selected for occurrence sync"
    );
  }


  // ---------------------------------------------------------
  // 3. LOAD PLACE MAP
  // ---------------------------------------------------------

  const placeData =
    await loadProviderPlaces(
      db,
      sourceId
    );


  if (
    placeData.places.size === 0
  ) {
    throw new Error(
      "No provider place mappings found"
    );
  }


  // ---------------------------------------------------------
  // 4. FETCH + NORMALIZE SELECTED PROGRAMS
  //
  // There are NO occurrence writes during this phase.
  // ---------------------------------------------------------

  const providerFetchStarted =
    Date.now();


  const providerResults =
    await mapWithConcurrency(
      programs,
      concurrency,

      async program => {
        const itemStarted =
          Date.now();


        let fetched;


        try {
          fetched =
            await fetchOccurrences(
              program.externalId
            );
        } catch (error) {
          throw new Error(
            "Provider occurrence fetch failed for " +
            providerKey +
            " program " +
            program.programId +
            ' "' +
            program.title +
            '" (' +
            program.externalId +
            "): " +
            (
              error?.message ||
              String(error)
            )
          );
        }


        let normalized;


        try {
          normalized =
            normalizeOccurrences(
              program.externalId,
              fetched.data
            );
        } catch (error) {
          throw new Error(
            "Provider occurrence normalization failed for " +
            providerKey +
            " program " +
            program.programId +
            ' "' +
            program.title +
            '" (' +
            program.externalId +
            "): " +
            (
              error?.message ||
              String(error)
            )
          );
        }


        return {
          program,
          fetched,
          normalized,

          totalMs:
            Date.now() -
            itemStarted
        };
      }
    );


  const providerFetchWallMs =
    Date.now() -
    providerFetchStarted;


  // ---------------------------------------------------------
  // 5. VALIDATE + MAP
  //
  // Still NO occurrence writes.
  // ---------------------------------------------------------

  const occurrences = [];

  const unresolvedPlaces =
    new Map();

  const perProgram = [];

  let rejectedTotal = 0;


  for (
    const result
    of providerResults
  ) {
    const {
      program,
      fetched,
      normalized,
      totalMs
    } = result;


    const sessions =
      Array.isArray(
        normalized?.sessions
      )
        ? normalized.sessions
        : [];


    const rejected =
      Array.isArray(
        normalized?.rejected
      )
        ? normalized.rejected
        : [];


    rejectedTotal +=
      rejected.length;


    if (rejected.length) {
      throw new Error(
        providerKey +
        " rejected " +
        rejected.length +
        " occurrence(s) for " +
        program.title
      );
    }


    let mapped = 0;


    for (const session of sessions) {
      const placeExternalId =
        clean(
          session.theaterExternalId ??
          session.placeExternalId
        );


      const place =
        placeExternalId
          ? placeData.places.get(
              placeExternalId
            )
          : null;


      if (!place) {
        const key =
          placeExternalId ||
          "(missing provider place ID)";


        if (
          !unresolvedPlaces.has(key)
        ) {
          unresolvedPlaces.set(
            key,
            {
              external_id:
                placeExternalId,

              name:
                session.theaterName ??
                session.placeName ??
                null,

              occurrence_count:
                0
            }
          );
        }


        unresolvedPlaces
          .get(key)
          .occurrence_count += 1;


        continue;
      }


      if (!session.externalId) {
        throw new Error(
          providerKey +
          " normalized occurrence has no external ID"
        );
      }


      if (!session.startsAt) {
        throw new Error(
          providerKey +
          " normalized occurrence has no startsAt"
        );
      }


      occurrences.push({
        externalId:
          session.externalId,

        programId:
          program.programId,

        placeId:
          place.placeId,

        startsAt:
          session.startsAt,

        endsAt:
          session.endsAt ??
          null,

        timezone:
          session.timezone ??
          timezone,

        status:
          session.status ??
          "scheduled",

        capacity:
          session.capacity ??
          null,

        placesRemaining:
          session.placesRemaining ??
          null
      });


      mapped += 1;
    }


    perProgram.push({
      program_id:
        program.programId,

      external_id:
        program.externalId,

      title:
        program.title,

      days:
        normalized?.days ??
        null,

      occurrences:
        sessions.length,

      mapped,

      rejected:
        rejected.length,

      provider_ms:
        totalMs,

      fetch:
        fetched?.fetch ??
        null
    });
  }


  // ---------------------------------------------------------
  // 6. FAIL BEFORE WRITE IF ANY PLACE IS UNRESOLVED
  // ---------------------------------------------------------

  const unresolved =
    Array.from(
      unresolvedPlaces.values()
    );


  if (unresolved.length) {
    throw new Error(
      providerKey +
      " contains " +
      unresolved.length +
      " unresolved provider place(s)"
    );
  }


  if (rejectedTotal !== 0) {
    throw new Error(
      providerKey +
      " contains rejected occurrences"
    );
  }


  // ---------------------------------------------------------
  // 7. CROSS-PROGRAM OCCURRENCE IDENTITY CHECK
  // ---------------------------------------------------------

  const occurrenceIds =
    new Map();


  for (const occurrence of occurrences) {
    const previous =
      occurrenceIds.get(
        occurrence.externalId
      );


    if (previous) {
      throw new Error(
        "Duplicate provider occurrence external ID: " +
        occurrence.externalId +
        " (programs " +
        previous.programId +
        " and " +
        occurrence.programId +
        ")"
      );
    }


    occurrenceIds.set(
      occurrence.externalId,
      occurrence
    );
  }


  // ---------------------------------------------------------
  // 8. RECONCILE COUNTS BEFORE WRITE
  // ---------------------------------------------------------

  const normalizedTotal =
    perProgram.reduce(
      (sum, item) =>
        sum + item.occurrences,
      0
    );


  if (
    normalizedTotal !==
    occurrences.length
  ) {
    throw new Error(
      "Not every normalized provider occurrence was mapped"
    );
  }


  if (
    perProgram.length !==
    programs.length
  ) {
    throw new Error(
      "Not every selected provider program was processed"
    );
  }


  // ---------------------------------------------------------
  // 9. WRITE
  //
  // This is deliberately the FIRST occurrence-writing
  // operation in this service.
  // ---------------------------------------------------------

  const syncStarted =
    Date.now();


  const synchronization =
    await syncOccurrences({
      db,
      sourceId,
      occurrences
    });


  const syncMs =
    Date.now() -
    syncStarted;


  // ---------------------------------------------------------
  // 10. FINAL RECONCILIATION
  // ---------------------------------------------------------

  if (
    synchronization.incoming !==
    occurrences.length
  ) {
    throw new Error(
      "Occurrence synchronization incoming count mismatch"
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


  // ---------------------------------------------------------
  // 11. PERFORMANCE
  // ---------------------------------------------------------

  const providerDurations =
    perProgram.map(
      item =>
        item.provider_ms
    );


  const providerWorkMs =
    providerDurations.reduce(
      (sum, value) =>
        sum + value,
      0
    );


  // ---------------------------------------------------------
  // 12. RESULT
  // ---------------------------------------------------------

  return {
    provider: {
      key:
        providerKey,

      source_id:
        sourceId
    },

    selection:
      selected.selection,

    programs:
      perProgram,

    totals: {
      provider_programs_available:
        allPrograms.length,

      programs_processed:
        programs.length,

      normalized_occurrences:
        normalizedTotal,

      mapped_occurrences:
        occurrences.length,

      rejected_occurrences:
        rejectedTotal
    },

    place_mapping: {
      known_places:
        placeData.places.size,

      unresolved_places:
        unresolved
    },

    synchronization,

    timing: {
      provider_fetch_wall_ms:
        providerFetchWallMs,

      provider_work_ms:
        providerWorkMs,

      generic_sync_ms:
        syncMs,

      total_ms:
        Date.now() -
        started
    },

    safety: {
      fetch_concurrency:
        concurrency,

      selection_mode:
        selected.selection.mode,

      all_provider_fetches_before_write:
        true,

      all_normalization_before_write:
        true,

      all_places_resolved_before_write:
        true,

      duplicate_occurrence_ids_checked:
        true,

      missing_occurrences_deleted:
        false,

      missing_occurrences_cancelled:
        false,

      unresolved_places_written:
        false,

      rejected_occurrences_written:
        false,

      identity:
        "source_id + external_id"
    }
  };
}
