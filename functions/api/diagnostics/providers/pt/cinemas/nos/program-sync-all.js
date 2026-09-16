/*
 * PTLife / WorthAGo — NOS Full Program Catalogue Sync Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * CONTROLLED CATALOGUE WRITE TEST.
 *
 * Purpose:
 *
 *   NOS catalogue
 *        ↓
 *   canonical NOS adapter
 *        ↓
 *   normalizeCatalogue()
 *        ↓
 *   generic syncPrograms()
 *        ↓
 *   programs / program_details / program_sources
 *
 * IMPORTANT:
 *
 *   This synchronizes PROGRAMS ONLY.
 *
 *   It does NOT:
 *     - fetch sessions
 *     - create occurrences
 *     - update occurrences
 *     - delete programs
 *     - retire missing programs
 *
 * Missing provider programs are deliberately left alone.
 */

import {
  safeRun
} from "../../../../../../lib/safe-run.js";

import {
  syncPrograms
} from "../../../../../../lib/sync/programs.js";

import {
  provider,
  fetchCatalogue,
  normalizeCatalogue
} from "../../../../../../providers/pt/cinemas/nos.js";


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


async function countProviderPrograms(
  db
) {
  const row =
    await db
      .prepare(`
        SELECT
          COUNT(*) AS count
        FROM program_sources
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


async function runDiagnostic(
  db
) {

  /*
   * -------------------------------------------------------
   * 1. FETCH CURRENT NOS CATALOGUE
   * -------------------------------------------------------
   */

  const catalogue =
    await fetchCatalogue();


  /*
   * -------------------------------------------------------
   * 2. NORMALIZE THROUGH CANONICAL PROVIDER ADAPTER
   * -------------------------------------------------------
   */

  const normalized =
    normalizeCatalogue(
      catalogue.rows
    );


  if (
    !Array.isArray(
      normalized.movies
    )
  ) {
    throw new Error(
      "NOS normalizer did not return a movies array"
    );
  }


  if (
    normalized.movies.length === 0
  ) {
    throw new Error(
      "NOS normalized catalogue contains zero movies"
    );
  }


  /*
   * -------------------------------------------------------
   * 3. CATALOGUE SAFETY CHECKS
   * -------------------------------------------------------
   *
   * We previously observed roughly 20 aggregate movies.
   *
   * Do NOT require exactly 20 because the provider's
   * legitimate catalogue will change.
   *
   * But an implausibly small result should stop the sync.
   */

  const MINIMUM_MOVIES =
    5;


  if (
    normalized.movies.length <
    MINIMUM_MOVIES
  ) {
    throw new Error(
      "NOS normalized catalogue is suspiciously small: " +
      normalized.movies.length
    );
  }


  /*
   * Reject the complete synchronization if normalization
   * rejected any provider catalogue rows.
   *
   * For this diagnostic we prefer stopping and inspecting
   * the changed provider data rather than silently importing
   * a potentially incomplete interpretation.
   */

  if (
    normalized.rejected.length > 0
  ) {
    throw new Error(
      "NOS normalization rejected " +
      normalized.rejected.length +
      " catalogue row(s)"
    );
  }


  /*
   * -------------------------------------------------------
   * 4. DATABASE STATE BEFORE
   * -------------------------------------------------------
   */

  const knownBefore =
    await countProviderPrograms(
      db
    );


  /*
   * -------------------------------------------------------
   * 5. GENERIC PROGRAM SYNCHRONIZATION
   * -------------------------------------------------------
   */

  const synchronization =
    await syncPrograms({
      db,

      sourceId:
        provider.sourceId,

      programs:
        normalized.movies
    });


  /*
   * -------------------------------------------------------
   * 6. DATABASE STATE AFTER
   * -------------------------------------------------------
   */

  const knownAfter =
    await countProviderPrograms(
      db
    );


  /*
   * -------------------------------------------------------
   * 7. POST-SYNC CONSISTENCY CHECKS
   * -------------------------------------------------------
   */

  if (
    synchronization.incoming !==
    normalized.movies.length
  ) {
    throw new Error(
      "Synchronizer incoming count does not match normalized catalogue"
    );
  }


  if (
    synchronization.created +
      synchronization.updated +
      synchronization.unchanged !==
    synchronization.incoming
  ) {
    throw new Error(
      "Program synchronization result counts do not reconcile"
    );
  }


  /*
   * Because this synchronizer never deletes provider
   * identities, the number after synchronization cannot
   * legitimately be smaller than the number before.
   */

  if (
    knownAfter <
    knownBefore
  ) {
    throw new Error(
      "Provider program count decreased during synchronization"
    );
  }


  /*
   * Every current normalized movie must now have a provider
   * identity in program_sources.
   *
   * There could eventually be MORE stored identities than
   * current movies because missing historical programs are
   * deliberately retained.
   */

  const currentIds =
    normalized.movies.map(
      movie =>
        String(
          movie.externalId
        )
    );


  const placeholders =
    currentIds
      .map(() => "?")
      .join(", ");


  const identityCheck =
    await db
      .prepare(`
        SELECT
          COUNT(*) AS count
        FROM program_sources
        WHERE
          source_id = ?
          AND external_id IN (${placeholders})
      `)
      .bind(
        provider.sourceId,
        ...currentIds
      )
      .first();


  const currentIdentitiesStored =
    Number(
      identityCheck?.count ?? 0
    );


  if (
    currentIdentitiesStored !==
    normalized.movies.length
  ) {
    throw new Error(
      "Not every current NOS movie has a stored provider identity"
    );
  }


  return {
    diagnostic:
      "NOS full generic program catalogue synchronization",

    controlled_write:
      true,

    provider: {
      key:
        provider.key,

      source_id:
        provider.sourceId
    },

    catalogue: {
      rows:
        catalogue.rows.length,

      aggregate_movies:
        normalized.movies.length,

      rejected:
        normalized.rejected.length,

      fetch:
        catalogue.fetch
    },

    database: {
      known_before:
        knownBefore,

      known_after:
        knownAfter,

      current_catalogue_identities_stored:
        currentIdentitiesStored
    },

    synchronization,

    safety: {
      minimum_movies_required:
        MINIMUM_MOVIES,

      rejected_rows_allowed:
        0,

      full_catalogue_submitted:
        true,

      programs_deleted:
        false,

      missing_programs_retired:
        false,

      occurrences_touched:
        false,

      occurrence_fetches_performed:
        false,

      identity:
        "source_id + external_id"
    }
  };
}


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
        "full_generic_program_sync",

      stage:
        "generic_program_catalogue_sync",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/program-sync-all.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/program-sync-all",


      run:
        () =>
          runDiagnostic(
            context.env.DB
          ),


      validate:
        data => {

          if (
            !data?.safety
              ?.full_catalogue_submitted
          ) {
            throw new Error(
              "Full catalogue was not submitted"
            );
          }


          if (
            data?.safety
              ?.occurrences_touched
          ) {
            throw new Error(
              "Program catalogue diagnostic unexpectedly touched occurrences"
            );
          }


          if (
            data?.database
              ?.current_catalogue_identities_stored !==
            data?.catalogue
              ?.aggregate_movies
          ) {
            throw new Error(
              "Current provider identities are incomplete after synchronization"
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

          catalogue_rows:
            data.catalogue.rows,

          aggregate_movies:
            data.catalogue
              .aggregate_movies,

          known_before:
            data.database
              .known_before,

          known_after:
            data.database
              .known_after,

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
        catalogue:
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
            "Verify the full program catalogue synchronization counts. " +
            "If correct, run this same endpoint one more time to verify " +
            "full-catalogue idempotency before building occurrence synchronization."
          )
        : (
            "Stop and inspect the failure. Do not proceed to occurrence synchronization."
          )
  });
}
