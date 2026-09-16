/*
 * WorthAGo — NOS Selected Program Occurrence Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Purpose:
 *   Validate selective program synchronization through the
 *   generic provider occurrence service.
 *
 * This test deliberately synchronizes only one NOS program.
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


const TEST_PROGRAM_EXTERNAL_ID =
  "06771ac1-fbc4-425a-b670-98f9c0ce4310";

const TEST_PROGRAM_TITLE =
  "Homem-Aranha - Um Novo Dia";


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
        "nos_selected_program_occurrence_sync_test",

      stage:
        "selected_program_service_validation",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/selected-program-sync.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/selected-program-sync",


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
              1,

            minimumPrograms:
              5,

            timezone:
              "Europe/Lisbon",

            programExternalIds: [
              TEST_PROGRAM_EXTERNAL_ID
            ]
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
            1
          ) {
            throw new Error(
              "Expected exactly one requested program"
            );
          }


          if (
            data?.selection?.selected !==
            1
          ) {
            throw new Error(
              "Expected exactly one selected program"
            );
          }


          if (
            data?.totals
              ?.programs_processed !==
            1
          ) {
            throw new Error(
              "Expected exactly one processed program"
            );
          }


          if (
            data?.programs?.[0]
              ?.external_id !==
            TEST_PROGRAM_EXTERNAL_ID
          ) {
            throw new Error(
              "Wrong provider program was processed"
            );
          }


          if (
            data?.totals
              ?.rejected_occurrences !==
            0
          ) {
            throw new Error(
              "Selected program contained rejected occurrences"
            );
          }


          if (
            data?.place_mapping
              ?.unresolved_places
              ?.length !== 0
          ) {
            throw new Error(
              "Selected program contained unresolved places"
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


          return true;
        },


      getItemCount:
        data =>
          data?.totals
            ?.mapped_occurrences ??
          0,


      getMetadata:
        data => ({
          selected_program:
            TEST_PROGRAM_TITLE,

          selected_external_id:
            TEST_PROGRAM_EXTERNAL_ID,

          provider_programs_available:
            data.totals
              .provider_programs_available,

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

    selected_program_test:
      true,

    test_program: {
      title:
        TEST_PROGRAM_TITLE,

      external_id:
        TEST_PROGRAM_EXTERNAL_ID
    },

    total_request_ms:
      Date.now() -
      started,

    next_step:
      result.ok
        ? (
            "Selected-program synchronization passed. " +
            "Inspect selection, occurrence counts, timing " +
            "and idempotency before testing a small batch."
          )
        : (
            "Stop. Selected-program synchronization failed. " +
            "Inspect the failure before building batch execution."
          )
  });
}
