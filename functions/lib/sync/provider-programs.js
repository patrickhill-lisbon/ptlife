/*
 * WorthAGo — Generic Provider Program Synchronization
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Production synchronization infrastructure.
 *
 * This module knows how to:
 *
 *   - fetch a provider catalogue
 *   - normalize provider catalogue records
 *   - validate provider program identities
 *   - synchronize programs through the generic
 *     program synchronization layer
 *
 * This module contains NO NOS-specific knowledge.
 */

import {
  syncPrograms
} from "./programs.js";


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
// GENERIC PROVIDER PROGRAM SYNCHRONIZATION
// ============================================================

export async function syncProviderPrograms({
  db,

  sourceId,

  providerKey,

  fetchCatalogue,

  normalizeCatalogue,

  minimumPrograms = 1,

  originalLanguage = "en"
}) {
  if (!db) {
    throw new Error(
      "syncProviderPrograms requires db"
    );
  }


  if (
    !Number.isInteger(sourceId) ||
    sourceId <= 0
  ) {
    throw new Error(
      "syncProviderPrograms requires a valid sourceId"
    );
  }


  if (!providerKey) {
    throw new Error(
      "syncProviderPrograms requires providerKey"
    );
  }


  if (
    typeof fetchCatalogue !==
    "function"
  ) {
    throw new Error(
      "syncProviderPrograms requires fetchCatalogue"
    );
  }


  if (
    typeof normalizeCatalogue !==
    "function"
  ) {
    throw new Error(
      "syncProviderPrograms requires normalizeCatalogue"
    );
  }


  if (
    !Number.isInteger(minimumPrograms) ||
    minimumPrograms < 1
  ) {
    throw new Error(
      "syncProviderPrograms requires minimumPrograms >= 1"
    );
  }


  const started =
    Date.now();


  // ---------------------------------------------------------
  // 1. FETCH PROVIDER CATALOGUE
  //
  // No database writes occur during this phase.
  // ---------------------------------------------------------

  const fetchStarted =
    Date.now();


  let fetched;


  try {
    fetched =
      await fetchCatalogue();
  } catch (error) {
    throw new Error(
      "Provider catalogue fetch failed for " +
      providerKey +
      ": " +
      (
        error?.message ||
        String(error)
      )
    );
  }


  const fetchMs =
    Date.now() -
    fetchStarted;


  // ---------------------------------------------------------
  // 2. NORMALIZE PROVIDER CATALOGUE
  //
  // Still no database writes.
  // ---------------------------------------------------------

  const normalizeStarted =
    Date.now();


  let normalized;


  try {
    normalized =
      normalizeCatalogue(
        fetched.rows
      );
  } catch (error) {
    throw new Error(
      "Provider catalogue normalization failed for " +
      providerKey +
      ": " +
      (
        error?.message ||
        String(error)
      )
    );
  }


  const normalizeMs =
    Date.now() -
    normalizeStarted;


  const movies =
    Array.isArray(
      normalized?.movies
    )
      ? normalized.movies
      : [];


  const rejected =
    Array.isArray(
      normalized?.rejected
    )
      ? normalized.rejected
      : [];


  // ---------------------------------------------------------
  // 3. SAFETY THRESHOLD
  //
  // A suddenly tiny catalogue may indicate a provider
  // failure or provider format change.
  // ---------------------------------------------------------

  if (
    movies.length <
    minimumPrograms
  ) {
    throw new Error(
      "Too few normalized provider programs for " +
      providerKey +
      ": " +
      movies.length
    );
  }


  // ---------------------------------------------------------
  // 4. REJECTED PROVIDER RECORDS
  //
  // For now our production policy is conservative:
  // if normalization rejected anything, abort the entire
  // program synchronization before writing.
  // ---------------------------------------------------------

  if (rejected.length) {
    throw new Error(
      providerKey +
      " catalogue normalization rejected " +
      rejected.length +
      " record(s)"
    );
  }


  // ---------------------------------------------------------
  // 5. VALIDATE + CONVERT TO GENERIC PROGRAMS
  // ---------------------------------------------------------

  const programs = [];

  const externalIds =
    new Set();


  for (const movie of movies) {
    const externalId =
      clean(
        movie?.externalId
      );


    if (!externalId) {
      throw new Error(
        providerKey +
        " normalized program has no external ID"
      );
    }


    if (
      externalIds.has(
        externalId
      )
    ) {
      throw new Error(
        "Duplicate provider program external ID: " +
        externalId
      );
    }


    externalIds.add(
      externalId
    );


    const title =
      clean(
        movie?.title
      );


    if (!title) {
      throw new Error(
        providerKey +
        " normalized program " +
        externalId +
        " has no title"
      );
    }


    programs.push({
      externalId,

      programType:
        movie.programType ??
        "film",

      title,

      originalTitle:
        clean(
          movie.originalTitle
        ),

      originalLanguage:
        clean(
          movie.originalLanguage
        ) ??
        originalLanguage,

      runtimeMinutes:
        movie.runtimeMinutes ??
        null,

      contentRating:
        clean(
          movie.contentRating
        ),

      sourceUrl:
        clean(
          movie.sourceUrl
        )
    });
  }


  if (
    programs.length !==
    movies.length
  ) {
    throw new Error(
      "Not every normalized provider program was converted"
    );
  }


  // ---------------------------------------------------------
  // 6. WRITE
  //
  // This is deliberately the FIRST database-writing
  // operation in this service.
  // ---------------------------------------------------------

  const syncStarted =
    Date.now();


  const synchronization =
    await syncPrograms({
      db,

      sourceId,

      programs
    });


  const syncMs =
    Date.now() -
    syncStarted;


  // ---------------------------------------------------------
  // 7. FINAL RECONCILIATION
  // ---------------------------------------------------------

  if (
    synchronization.incoming !==
    programs.length
  ) {
    throw new Error(
      "Program synchronization incoming count mismatch"
    );
  }


  if (
    synchronization.created +
      synchronization.updated +
      synchronization.unchanged !==
    synchronization.incoming
  ) {
    throw new Error(
      "Program synchronization counts do not reconcile"
    );
  }


  // ---------------------------------------------------------
  // 8. RESULT
  // ---------------------------------------------------------

  return {
    provider: {
      key:
        providerKey,

      source_id:
        sourceId
    },

    catalogue: {
      provider_rows:
        Array.isArray(fetched.rows)
          ? fetched.rows.length
          : null,

      normalized_programs:
        movies.length,

      rejected:
        rejected.length,

      fetch:
        fetched.fetch ??
        null
    },

    synchronization,

    timing: {
      provider_fetch_ms:
        fetchMs,

      normalization_ms:
        normalizeMs,

      generic_sync_ms:
        syncMs,

      total_ms:
        Date.now() -
        started
    },

    safety: {
      minimum_programs_required:
        minimumPrograms,

      all_provider_data_before_write:
        true,

      all_normalization_before_write:
        true,

      duplicate_program_ids_checked:
        true,

      rejected_programs_written:
        false,

      missing_programs_deleted:
        false,

      missing_programs_retired:
        false,

      identity:
        "source_id + external_id"
    }
  };
}
