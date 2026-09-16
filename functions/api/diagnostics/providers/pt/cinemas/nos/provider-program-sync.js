/*
 * WorthAGo — NOS Generic Provider Program Service Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Purpose:
 *   Exercise the production generic provider program
 *   synchronization service using Cinemas NOS.
 *
 * NOS-specific knowledge belongs in:
 *
 *   providers/pt/cinemas/nos.js
 *
 * Generic synchronization belongs in:
 *
 *   lib/sync/provider-programs.js
 *
 * This file merely connects the two for diagnostic testing.
 */

import {
  safeRun
} from "../../../../../../lib/safe-run.js";

import {
  syncProviderPrograms
} from "../../../../../../lib/sync/provider-programs.js";

import {
  provider,
  fetchCatalogue,
  normalizeCatalogue
} from "../../../../../../providers/pt/cinemas/nos.js";


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
        "generic_provider_program_service_test",

      stage:
        "production_service_validation",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/provider-program-sync.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/provider-program-sync",


      run:
        () =>
          syncProviderPrograms({
            db:
              context.env.DB,

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
          }),


      validate:
        data => {
          if (
            data?.catalogue
              ?.normalized_programs <
            MINIMUM_PROGRAMS_REQUIRED
          ) {
            throw new Error(
              "Too few programs processed"
            );
          }


          if (
            data?.catalogue
              ?.rejected !== 0
          ) {
            throw new Error(
              "Provider catalogue contains rejected records"
            );
          }


          if (
            data?.synchronization
              ?.created !== 0
          ) {
            throw new Error(
              "Unexpected program creation during service comparison"
            );
          }


          if (
            data?.synchronization
              ?.updated !== 0
          ) {
            throw new Error(
              "Unexpected program update during service comparison"
            );
          }


          if (
            data?.synchronization
              ?.unchanged !==
            data?.catalogue
              ?.normalized_programs
          ) {
            throw new Error(
              "Not every current provider program was unchanged"
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

          provider_rows:
            data.catalogue
              .provider_rows,

          programs:
            data.catalogue
              .normalized_programs,

          created:
            data.synchronization
              .created,

          updated:
            data.synchronization
              .updated,

          unchanged:
            data.synchronization
              .unchanged,

          provider_fetch_ms:
            data.timing
              .provider_fetch_ms,

          generic_sync_ms:
            data.timing
              .generic_sync_ms
        }),


      fallbackData: {
        provider:
          null,

        catalogue:
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
      /*
       * These are comparison values from our previously
       * validated NOS catalogue synchronization.
       *
       * NOS is live, so catalogue counts can legitimately
       * change.
       */

      previous_provider_rows:
        30,

      previous_programs:
        20
    },

    next_step:
      result.ok
        ? (
            "Compare this production-service result with " +
            "the known-good NOS catalogue synchronization. " +
            "If counts, identities and safety behavior agree, " +
            "the program orchestration extraction is validated."
          )
        : (
            "Stop. Keep the known-good catalogue diagnostic " +
            "unchanged and inspect the production service failure."
          )
  });
}
