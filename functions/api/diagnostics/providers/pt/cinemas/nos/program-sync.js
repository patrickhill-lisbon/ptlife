/*
 * PTLife / WorthAGo — NOS Generic Program Sync Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * CONTROLLED WRITE TEST.
 *
 * Tests one explicitly selected NOS program through:
 *
 *   NOS provider adapter
 *          ↓
 *   normalizeCatalogue()
 *          ↓
 *   select requested external_id
 *          ↓
 *   generic syncPrograms()
 *
 * Usage:
 *
 * /api/diagnostics/providers/pt/cinemas/nos/program-sync
 *   ?external_id=<NOS aggregate movie ID>
 *
 * Safety:
 *
 *   - requires an explicit external_id
 *   - submits exactly one program
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


async function runDiagnostic(
  db,
  requestedExternalId
) {

  /*
   * -------------------------------------------------------
   * 1. REQUIRE EXPLICIT PROGRAM IDENTITY
   * -------------------------------------------------------
   */

  const externalId =
    clean(
      requestedExternalId
    );


  if (!externalId) {
    throw new Error(
      "This diagnostic requires an explicit external_id query parameter"
    );
  }


  /*
   * -------------------------------------------------------
   * 2. FETCH + NORMALIZE CURRENT NOS CATALOGUE
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
   * 3. SELECT EXACTLY THE REQUESTED PROGRAM
   * -------------------------------------------------------
   */

  const selected =
    normalized.movies.find(
      movie =>
        String(
          movie?.externalId ?? ""
        ) === externalId
    );


  if (!selected) {
    throw new Error(
      "Requested NOS external_id is not present in the current catalogue: " +
      externalId
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
      "Controlled synchronization must contain exactly one program"
    );
  }


  /*
   * -------------------------------------------------------
   * 4. CHECK WHETHER IDENTITY EXISTS BEFORE SYNC
   * -------------------------------------------------------
   */

  const existingBefore =
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
        externalId
      )
      .first();


  /*
   * -------------------------------------------------------
   * 5. GENERIC SYNCHRONIZATION
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
   * 6. VERIFY IDENTITY AFTER SYNC
   * -------------------------------------------------------
   */

  const existingAfter =
    await db
      .prepare(`
        SELECT
          ps.program_id,
          ps.external_id,
          ps.status AS source_status,
          ps.last_verified_at,

          p.official_title,
          p.status AS program_status

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
        externalId
      )
      .first();


  if (!existingAfter) {
    throw new Error(
      "Program identity does not exist after synchronization"
    );
  }


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

    requested_external_id:
      externalId,

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

    database_before: {
      existed:
        Boolean(
          existingBefore
        ),

      program_id:
        existingBefore?.program_id ??
        null,

      title:
        existingBefore?.official_title ??
        null
    },

    synchronization,

    database_after: {
      exists:
        Boolean(
          existingAfter
        ),

      program_id:
        existingAfter?.program_id ??
        null,

      title:
        existingAfter?.official_title ??
        null,

      program_status:
        existingAfter?.program_status ??
        null,

      source_status:
        existingAfter?.source_status ??
        null,

      last_verified_at:
        existingAfter?.last_verified_at ??
        null
    },

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


  /*
   * Read the requested provider identity directly
   * from the query string.
   */

  const url =
    new URL(
      context.request.url
    );


  const externalId =
    url.searchParams.get(
      "external_id"
    );


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
        externalId
          ? (
              "GET /api/diagnostics/providers/pt/cinemas/nos/program-sync" +
              "?external_id=" +
              encodeURIComponent(
                externalId
              )
            )
          : (
              "GET /api/diagnostics/providers/pt/cinemas/nos/program-sync"
            ),


      run:
        () =>
          runDiagnostic(
            context.env.DB,
            externalId
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
            data?.requested_external_id
          ) {
            throw new Error(
              "Selected program does not match requested external_id"
            );
          }


          if (
            !data?.database_after
              ?.exists
          ) {
            throw new Error(
              "Program does not exist after synchronization"
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

          program_id:
            data.database_after
              .program_id,

          existed_before:
            data.database_before
              .existed,

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
          null,

        database_after:
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
            "Inspect database_before, synchronization, and database_after. " +
            "For an already synchronized unchanged program, expect " +
            "created=0, updated=0, unchanged=1."
          )
        : (
            "Stop and inspect the failure before proceeding."
          )
  });
}
