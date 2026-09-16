/*
 * PTLife / WorthAGo — NOS Generic Program Creation Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * CONTROLLED WRITE TEST.
 *
 * Purpose:
 *
 *   1. Fetch the current NOS catalogue.
 *   2. Normalize it through the canonical NOS adapter.
 *   3. Read existing NOS program identities from D1.
 *   4. Select EXACTLY ONE previously unseen movie.
 *   5. Pass ONLY that movie to generic syncPrograms().
 *
 * This tests the CREATE path of the generic synchronizer.
 *
 * Safety:
 *
 *   - never submits more than one program
 *   - never imports the complete catalogue
 *   - never touches occurrences
 *   - never deletes or retires missing programs
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


/*
 * Load the external IDs already owned by this provider.
 */

async function loadExistingExternalIds(
  db,
  sourceId
) {
  const result =
    await db
      .prepare(`
        SELECT
          external_id
        FROM program_sources
        WHERE
          source_id = ?
          AND external_id IS NOT NULL
      `)
      .bind(sourceId)
      .all();


  return new Set(
    (result.results || [])
      .map(
        row =>
          String(row.external_id)
      )
  );
}


async function runDiagnostic(
  db
) {

  /*
   * -------------------------------------------------------
   * 1. FETCH + NORMALIZE CURRENT NOS CATALOGUE
   * -------------------------------------------------------
   */

  const catalogue =
    await fetchCatalogue();


  const normalized =
    normalizeCatalogue(
      catalogue.rows
    );


  if (
    !Array.isArray(
      normalized.movies
    ) ||
    normalized.movies.length === 0
  ) {
    throw new Error(
      "NOS normalized catalogue contains no movies"
    );
  }


  /*
   * -------------------------------------------------------
   * 2. READ EXISTING NOS IDENTITIES
   * -------------------------------------------------------
   */

  const existingExternalIds =
    await loadExistingExternalIds(
      db,
      provider.sourceId
    );


  /*
   * -------------------------------------------------------
   * 3. FIND EXACTLY ONE PREVIOUSLY UNSEEN MOVIE
   * -------------------------------------------------------
   *
   * Do NOT select by title.
   *
   * Provider identity is:
   *
   *   source_id + external_id
   */

  const selected =
    normalized.movies.find(
      movie =>
        movie?.externalId &&
        !existingExternalIds.has(
          String(
            movie.externalId
          )
        )
    );


  if (!selected) {
    throw new Error(
      "No previously unseen NOS movie exists in the current catalogue"
    );
  }


  const controlledPrograms = [
    selected
  ];


  /*
   * Hard safety assertion.
   */

  if (
    controlledPrograms.length !== 1
  ) {
    throw new Error(
      "Controlled creation diagnostic must submit exactly one program"
    );
  }


  if (
    existingExternalIds.has(
      String(
        selected.externalId
      )
    )
  ) {
    throw new Error(
      "Selected NOS movie already exists in program_sources"
    );
  }


  /*
   * -------------------------------------------------------
   * 4. GENERIC PROGRAM SYNCHRONIZATION
   * -------------------------------------------------------
   */

  const synchronization =
    await syncPrograms({
      db,

      sourceId:
        provider.sourceId,

      programs:
        controlledPrograms
    });


  /*
   * -------------------------------------------------------
   * 5. VERIFY THE CREATE RESULT
   * -------------------------------------------------------
   *
   * This endpoint exists specifically to test creation.
   *
   * Therefore the expected result is exactly:
   *
   *   incoming   = 1
   *   created    = 1
   *   updated    = 0
   *   unchanged  = 0
   */

  if (
    synchronization.incoming !== 1
  ) {
    throw new Error(
      "Creation diagnostic did not synchronize exactly one program"
    );
  }


  if (
    synchronization.created !== 1
  ) {
    throw new Error(
      "Expected exactly one newly created program"
    );
  }


  if (
    synchronization.updated !== 0 ||
    synchronization.unchanged !== 0
  ) {
    throw new Error(
      "Unexpected update/unchanged result during controlled creation"
    );
  }


  return {
    diagnostic:
      "NOS controlled generic program creation",

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
        normalized.rejected.length
    },

    database_before: {
      known_provider_programs:
        existingExternalIds.size
    },

    selected_program: {
      external_id:
        selected.externalId,

      title:
        selected.title,

      original_title:
        selected.originalTitle,

      runtime_minutes:
        selected.runtimeMinutes,

      content_rating:
        selected.contentRating
    },

    synchronization,

    safety: {
      programs_submitted:
        controlledPrograms.length,

      selected_was_previously_unknown:
        true,

      full_catalogue_submitted:
        false,

      missing_programs_deleted:
        false,

      missing_programs_retired:
        false,

      occurrences_touched:
        false
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
        "controlled_generic_program_create",

      stage:
        "generic_program_create_test",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/program-create.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/program-create",


      run:
        () =>
          runDiagnostic(
            context.env.DB
          ),


      validate:
        data => {

          if (
            data?.safety
              ?.programs_submitted !== 1
          ) {
            throw new Error(
              "Creation diagnostic submitted more than one program"
            );
          }


          if (
            data?.synchronization
              ?.created !== 1
          ) {
            throw new Error(
              "Creation diagnostic did not create exactly one program"
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

          external_id:
            data.selected_program
              .external_id,

          title:
            data.selected_program
              .title,

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
        selected_program:
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
            "Verify that exactly one new NOS program was created. " +
            "Do not run this endpoint again yet."
          )
        : (
            "Stop and inspect the failure before any further NOS imports."
          )
  });
}
