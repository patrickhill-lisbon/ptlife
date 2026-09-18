/*
 * WorthAGo — Cinemas NOS Production Sync Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Purpose:
 *   Exercise the complete production Cinemas NOS
 *   synchronization path.
 *
 * Production orchestration belongs in:
 *
 *   lib/providers/pt/cinemas/nos-sync.js
 *
 * This endpoint contains no NOS synchronization logic.
 * It merely provides an HTTP diagnostic boundary around
 * the production orchestrator.
 */

import {
  safeRun
} from "../../../../../../lib/safe-run.js";

import {
  syncNos
} from "../../../../../../lib/providers/pt/cinemas/nos-sync.js";


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
        "pt.cinema.nos",

      operation:
        "nos_production_sync_test",

      stage:
        "production_orchestrator_validation",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/production-sync.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/production-sync",


      run:
        () =>
          syncNos({
            db:
              context.env.DB
          }),


      validate:
        data => {
          const programIncoming =
            data?.programs
              ?.synchronization
              ?.incoming;


          const occurrencePrograms =
            data?.occurrences
              ?.totals
              ?.programs_processed;


          const normalizedOccurrences =
            data?.occurrences
              ?.totals
              ?.normalized_occurrences;


          const mappedOccurrences =
            data?.occurrences
              ?.totals
              ?.mapped_occurrences;


          if (
            !Number.isInteger(
              programIncoming
            ) ||
            programIncoming < 5
          ) {
            throw new Error(
              "Production NOS sync returned too few programs"
            );
          }


          if (
            programIncoming !==
            occurrencePrograms
          ) {
            throw new Error(
              "Production NOS program coverage mismatch"
            );
          }


          if (
            normalizedOccurrences !==
            mappedOccurrences
          ) {
            throw new Error(
              "Production NOS occurrence mapping mismatch"
            );
          }


          if (
            data?.programs
              ?.catalogue
              ?.rejected !== 0
          ) {
            throw new Error(
              "Production NOS program catalogue contains rejected records"
            );
          }


          if (
            data?.occurrences
              ?.totals
              ?.rejected_occurrences !==
            0
          ) {
            throw new Error(
              "Production NOS occurrence feed contains rejected records"
            );
          }


          if (
            data?.occurrences
              ?.place_mapping
              ?.unresolved_places
              ?.length !== 0
          ) {
            throw new Error(
              "Production NOS sync contains unresolved places"
            );
          }


          return true;
        },


      getItemCount:
        data =>
          data?.occurrences
            ?.totals
            ?.mapped_occurrences ??
          0,


      getMetadata:
        data => ({
          provider_key:
            data.provider.key,

          programs:
            data.programs
              .synchronization
              .incoming,

          occurrences:
            data.occurrences
              .totals
              .mapped_occurrences,

          programs_created:
            data.programs
              .synchronization
              .created,

          programs_updated:
            data.programs
              .synchronization
              .updated,

          occurrences_created:
            data.occurrences
              .synchronization
              .created,

          occurrences_updated:
            data.occurrences
              .synchronization
              .updated,

          programs_ms:
            data.timing
              .programs_ms,

          occurrences_ms:
            data.timing
              .occurrences_ms,

          total_ms:
            data.timing
              .total_ms
        }),


      fallbackData: {
        provider:
          null,

        programs:
          null,

        occurrences:
          null,

        timing:
          null,

        safety:
          null
      }
    });


  return respond({
    ...result,

    diagnostic_test:
      true,

    production_orchestrator_test:
      true,

    total_request_ms:
      Date.now() -
      started,

    next_step:
      result.ok
        ? (
            "Production NOS synchronization completed. " +
            "Inspect program and occurrence counts, changes, " +
            "timing and safety before enabling scheduled execution."
          )
        : (
            "Stop. Production NOS synchronization failed. " +
            "Keep scheduled execution disabled and inspect the failure."
          )
  });
}
