/*
 * PTLife — NOS Generic Program Synchronizer Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * CONTROLLED WRITE TEST.
 *
 * Tests:
 *
 *   NOS provider adapter
 *          ↓
 *   normalizeCatalogue()
 *          ↓
 *   select ONE known program
 *          ↓
 *   generic syncPrograms()
 *
 * Only the selected NOS program is passed to the
 * synchronizer.
 *
 * Missing programs are NEVER deleted or retired.
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


/*
 * Existing controlled-test movie:
 *
 * A Odisseia / The Odyssey
 */

const TEST_EXTERNAL_ID =
  "1e70190b-5cf3-4937-b361-24f67bdd11d0";


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


async function runDiagnostic(
  db
) {

  /*
   * ---------------------------------------------
   * 1. FETCH THROUGH CANONICAL PROVIDER ADAPTER
   * ---------------------------------------------
   */

  const catalogue =
    await fetchCatalogue();


  const normalized =
    normalizeCatalogue(
      catalogue.rows
    );


  /*
   * ---------------------------------------------
   * 2. SELECT EXACTLY ONE PROGRAM
   * ---------------------------------------------
   */

  const selected =
    normalized.movies.find(
      movie =>
        movie.externalId ===
        TEST_EXTERNAL_ID
    );


  if (!selected) {
    throw new Error(
      "Controlled NOS test movie is not present in current catalogue"
    );
  }


  /*
   * Important safety assertion:
   *
   * Never accidentally hand the complete catalogue
   * to this diagnostic.
   */

  const controlledPrograms = [
    selected
  ];


  if (
    controlledPrograms.length !== 1
  ) {
    throw new Error(
      "Controlled program synchronization must contain exactly one program"
    );
  }


  /*
   * ---------------------------------------------
   * 3. GENERIC SYNCHRONIZATION
   * ---------------------------------------------
   */

  const synchronization =
    await syncPrograms({
      db,

      sourceId:
        provider.sourceId,

      programs:
        controlledPrograms
    });


  return {
    diagnostic:
      "NOS controlled generic program synchronization",

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
        "controlled_generic_program_sync",

      stage:
        "generic_program_sync_test",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/program-sync.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/program-sync",


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
              "Controlled synchronization submitted more than one program"
            );
          }


          if (
            data?.selected_program
              ?.external_id !==
            TEST_EXTERNAL_ID
          ) {
            throw new Error(
              "Unexpected program selected for controlled synchronization"
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
            "Inspect created, updated and unchanged. " +
            "If the existing NOS program was recognized correctly, " +
            "run this diagnostic a second time to verify idempotency."
          )
        : (
            "Do not proceed to full program synchronization."
          )
  });
}
