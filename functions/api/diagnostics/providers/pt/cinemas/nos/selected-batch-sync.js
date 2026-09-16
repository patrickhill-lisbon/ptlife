/*
 * WorthAGo — NOS Selected Batch Occurrence Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Purpose:
 *   Validate selected multi-program synchronization through
 *   the generic provider occurrence service.
 *
 * This test deliberately synchronizes exactly three
 * NOS programs.
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


const TEST_PROGRAMS = [
  {
    externalId:
      "1e70190b-5cf3-4937-b361-24f67bdd11d0",

    title:
      "A Odisseia"
  },

  {
    externalId:
      "edcb6c20-132c-41bd-8c90-dafaaf4aa654",

    title:
      "A Qualquer Custo"
  },

  {
    externalId:
      "06771ac1-fbc4-425a-b670-98f9c0ce4310",

    title:
      "Homem-Aranha - Um Novo Dia"
  }
];


const TEST_EXTERNAL_IDS =
  TEST_PROGRAMS.map(
    program =>
      program.externalId
  );


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
        "nos_selected_batch_occurrence_sync_test",

      stage:
        "selected_batch_service_validation",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/selected-batch-sync.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/selected-batch-sync",


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
              3,

            minimumPrograms:
              5,

            timezone:
              "Europe/Lisbon",

            programExternalIds:
              TEST_EXTERNAL_IDS
          }),


      validate:
        data => {
          if (
            data?.selection?.mode !==
            "selected"
          ) {
            throw new Error(
              "Expected selected synchronization mode"
            );
          }


          if (
            data?.selection?.requested !==
            TEST_PROGRAMS.length
          ) {
            throw new Error(
              "Requested program count mismatch"
            );
          }


          if (
            data?.selection?.selected !==
            TEST_PROGRAMS.length
          ) {
            throw new Error(
              "Selected program count mismatch"
            );
          }


          if (
            data?.totals
              ?.programs_processed !==
            TEST_PROGRAMS.length
          ) {
            throw new Error(
              "Processed program count mismatch"
            );
          }


          const processedIds =
            new Set(
              (data?.programs || [])
                .map(
                  item =>
                    item.external_id
                )
            );


          for (
            const expected
            of TEST_PROGRAMS
          ) {
            if (
              !processedIds.has(
                expected.externalId
              )
            ) {
              throw new Error(
                "Expected program was not processed: " +
                expected.title
              );
            }
          }


          if (
            data?.totals
              ?.rejected_occurrences !==
            0
          ) {
            throw new Error(
              "Selected batch contains rejected occurrences"
            );
          }


          if (
            data?.place_mapping
              ?.unresolved_places
              ?.length !== 0
          ) {
            throw new Error(
              "Selected batch contains unresolved places"
            );
          }


          if (
            data?.totals
              ?.normalized_occurrences !==
            data?.totals
              ?.mapped_occurrences
          ) {
            throw new Error(
              "Not every selected occurrence was mapped"
            );
          }


          if (
            data?.synchronization
              ?.incoming !==
            data?.totals
              ?.mapped_occurrences
          ) {
            throw new Error(
              "Synchronization incoming count mismatch"
            );
          }


          return true;
        },


      getItemCount:
        data =>
          data?.totals
            ?.mapped_occurrences ??
          0,


      getMetadata:
        data => ({
          provider_programs_available:
            data.totals
              .provider_programs_available,

          programs_requested:
            data.selection
              .requested,

          programs_processed:
            data.totals
              .programs_processed,

          occurrences:
            data.totals
              .mapped_occurrences,

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

          provider_work_ms:
            data.timing
              .provider_work_ms,

          generic_sync_ms:
            data.timing
              .generic_sync_ms
        }),


      fallbackData: {
        selection:
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

    selected_batch_test:
      true,

    test_programs:
      TEST_PROGRAMS,

    total_request_ms:
      Date.now() -
      started,

    next_step:
      result.ok
        ? (
            "Selected three-program batch synchronization passed. " +
            "If counts, mapping, idempotency and timing are correct, " +
            "the generic selected-batch mechanism is validated."
          )
        : (
            "Stop. Selected three-program batch synchronization failed. " +
            "Inspect the failure before building scheduled job execution."
          )
  });
}
