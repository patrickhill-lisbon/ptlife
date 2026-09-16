/*
 * WorthAGo — NOS Generic Provider Occurrence Service Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Purpose:
 *   Exercise the production generic provider occurrence
 *   synchronization service using Cinemas NOS.
 *
 * This endpoint intentionally contains almost no
 * synchronization logic.
 *
 * NOS-specific knowledge belongs in:
 *
 *   providers/pt/cinemas/nos.js
 *
 * Generic synchronization belongs in:
 *
 *   lib/sync/provider-occurrences.js
 *
 * This file merely connects the two for diagnostic testing.
 */

import {
  safeRun
} from "../../../../../../lib/safe-run.js";

import {
  syncProviderOccurrences
} from "../../../../../../lib/sync/provider-occurrences.js";

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
        provider.key,

      operation:
        "generic_provider_occurrence_service_test",

      stage:
        "production_service_validation",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/provider-occurrence-sync.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/provider-occurrence-sync",


      run:
        () =>
          syncProviderOccurrences({
            db:
              context.env.DB,

            sourceId:
              provider.sourceId,

            providerKey:
              provider.key,

            fetchOccurrences:
              fetchSessions,

            normalizeOccurrences:
              normalizeSessions,

            concurrency:
              FETCH_CONCURRENCY,

            minimumPrograms:
              MINIMUM_PROGRAMS_REQUIRED,

            timezone:
              "Europe/Lisbon"
          }),


      validate:
        data => {
          if (
            data?.totals?.programs <
            MINIMUM_PROGRAMS_REQUIRED
          ) {
            throw new Error(
              "Too few programs processed"
            );
          }


          if (
            data?.totals
              ?.normalized_occurrences !==
            data?.totals
              ?.mapped_occurrences
          ) {
            throw new Error(
              "Not every normalized occurrence was mapped"
            );
          }


          if (
            data?.totals
              ?.rejected_occurrences !==
            0
          ) {
            throw new Error(
              "Provider occurrence service rejected occurrences"
            );
          }


          if (
            data?.place_mapping
              ?.unresolved_places
              ?.length !== 0
          ) {
            throw new Error(
              "Provider occurrence service has unresolved places"
            );
          }


          if (
            data?.synchronization
              ?.created !== 0
          ) {
            throw new Error(
              "Unexpected occurrence creation during service comparison"
            );
          }


          if (
            data?.synchronization
              ?.updated !== 0
          ) {
            throw new Error(
              "Unexpected occurrence update during service comparison"
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

          occurrences:
            data.totals
              .normalized_occurrences,

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
        provider:
          null,

        programs:
          null,

        totals:
          null,

        place_mapping:
          null,

        synchronization:
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

    production_service_test:
      true,

    total_request_ms:
      Date.now() -
      started,

    expected_reference: {
      programs:
        20,

      /*
       * 2175 was the known-good comparison value at the
       * time this diagnostic was created.
       *
       * NOS is live, so a later run may legitimately have
       * a different occurrence count.
       */

      previous_occurrences:
        2175
    },

    next_step:
      result.ok
        ? (
            "Compare this production-service result with " +
            "the known-good full NOS diagnostic. If program " +
            "coverage, mapping, synchronization and safety " +
            "behavior agree, the orchestration extraction " +
            "is validated."
          )
        : (
            "Stop. Keep the known-good diagnostic unchanged " +
            "and inspect the production service failure."
          )
  });
}
