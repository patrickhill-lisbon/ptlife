/*
 * WorthAGo — Cinemas NOS Production Synchronization
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Provider:
 *   pt.cinema.nos
 *
 * Production orchestration for a complete Cinemas NOS sync.
 *
 * Order is deliberate:
 *
 *   1. synchronize provider catalogue/programs
 *   2. only after successful program synchronization,
 *      synchronize provider occurrences
 *
 * NOS-specific parsing and fetching remain in:
 *
 *   providers/pt/cinemas/nos.js
 *
 * Generic synchronization remains in:
 *
 *   lib/sync/provider-programs.js
 *   lib/sync/provider-occurrences.js
 *
 * This module does NOT expose an HTTP endpoint.
 */

import {
  syncProviderPrograms
} from "../../../sync/provider-programs.js";

import {
  syncProviderOccurrences
} from "../../../sync/provider-occurrences.js";

import {
  provider,
  fetchCatalogue,
  normalizeCatalogue,
  fetchSessions,
  normalizeSessions
} from "../../../../providers/pt/cinemas/nos.js";


const MINIMUM_PROGRAMS_REQUIRED = 5;

const OCCURRENCE_FETCH_CONCURRENCY = 3;

const TIMEZONE =
  "Europe/Lisbon";


// ============================================================
// COMPLETE NOS SYNCHRONIZATION
// ============================================================

export async function syncNos({
  db
}) {
  if (!db) {
    throw new Error(
      "syncNos requires db"
    );
  }


  const started =
    Date.now();


  // ---------------------------------------------------------
  // 1. PROGRAM CATALOGUE
  //
  // Occurrence synchronization MUST NOT begin unless this
  // stage completes successfully.
  // ---------------------------------------------------------

  const programsStarted =
    Date.now();


  const programs =
    await syncProviderPrograms({
      db,

      sourceId:
        provider.sourceId,

      providerKey:
        provider.key,

      fetchCatalogue,

      normalizeCatalogue,

      minimumPrograms:
        MINIMUM_PROGRAMS_REQUIRED,

      originalLanguage:
        "pt-PT"
    });


  const programsMs =
    Date.now() -
    programsStarted;


  // ---------------------------------------------------------
  // 2. OCCURRENCES
  //
  // Reached only after successful catalogue synchronization.
  // ---------------------------------------------------------

  const occurrencesStarted =
    Date.now();


  const occurrences =
    await syncProviderOccurrences({
      db,

      sourceId:
        provider.sourceId,

      providerKey:
        provider.key,

      fetchOccurrences:
        fetchSessions,

      normalizeOccurrences:
        normalizeSessions,

      concurrency:
        OCCURRENCE_FETCH_CONCURRENCY,

      minimumPrograms:
        MINIMUM_PROGRAMS_REQUIRED,

      timezone:
        TIMEZONE
    });


  const occurrencesMs =
    Date.now() -
    occurrencesStarted;


  // ---------------------------------------------------------
  // 3. CROSS-STAGE VALIDATION
  // ---------------------------------------------------------

  const synchronizedPrograms =
    programs?.synchronization
      ?.incoming;


    const occurrencePrograms =
      occurrences?.totals
        ?.programs_processed;


  if (
    !Number.isInteger(
      synchronizedPrograms
    ) ||
    !Number.isInteger(
      occurrencePrograms
    )
  ) {
    throw new Error(
      "NOS synchronization returned invalid program counts"
    );
  }


  if (
    synchronizedPrograms !==
    occurrencePrograms
  ) {
    throw new Error(
      "NOS program/occurrence stage count mismatch: " +
      synchronizedPrograms +
      " catalogue programs versus " +
      occurrencePrograms +
      " occurrence programs"
    );
  }


  if (
    occurrences?.totals
      ?.normalized_occurrences !==
    occurrences?.totals
      ?.mapped_occurrences
  ) {
    throw new Error(
      "NOS occurrence mapping count mismatch"
    );
  }


  // ---------------------------------------------------------
  // 4. RESULT
  // ---------------------------------------------------------

  return {
    provider: {
      key:
        provider.key,

      source_id:
        provider.sourceId,

      country:
        provider.country,

      category:
        provider.category,

      name:
        provider.name
    },

    programs,

    occurrences,

    timing: {
      programs_ms:
        programsMs,

      occurrences_ms:
        occurrencesMs,

      total_ms:
        Date.now() -
        started
    },

    safety: {
      programs_before_occurrences:
        true,

      occurrence_sync_requires_successful_program_sync:
        true,

      missing_programs_deleted:
        false,

      missing_programs_retired:
        false,

      missing_occurrences_deleted:
        false,

      missing_occurrences_cancelled:
        false,

      provider_identity:
        provider.key,

      program_identity:
        "source_id + external_id",

      occurrence_identity:
        "source_id + external_id"
    }
  };
}
