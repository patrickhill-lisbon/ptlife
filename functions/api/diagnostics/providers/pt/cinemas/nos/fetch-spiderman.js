/*
 * WorthAGo — NOS Spider-Man Session Fetch Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * READ ONLY.
 *
 * Tests the NOS session feed for the program that timed
 * out during the production occurrence-service test.
 *
 * No database writes are performed.
 */

import {
  safeRun
} from "../../../../../../lib/safe-run.js";

import {
  provider,
  fetchSessions,
  normalizeSessions
} from "../../../../../../providers/pt/cinemas/nos.js";


const EXTERNAL_ID =
  "06771ac1-fbc4-425a-b670-98f9c0ce4310";

const TITLE =
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


async function runDiagnostic() {
  const started =
    Date.now();


  const fetched =
    await fetchSessions(
      EXTERNAL_ID
    );


  const normalized =
    normalizeSessions(
      EXTERNAL_ID,
      fetched.data
    );


  return {
    program: {
      title:
        TITLE,

      external_id:
        EXTERNAL_ID
    },

    provider_fetch:
      fetched.fetch,

    normalization: {
      days:
        normalized.days,

      sessions:
        normalized.sessions.length,

      rejected:
        normalized.rejected.length
    },

    total_ms:
      Date.now() - started,

    read_only:
      true
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
        "nos_spiderman_fetch_test",

      stage:
        "provider_fetch_diagnostic",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/fetch-spiderman.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/fetch-spiderman",


      run:
        () =>
          runDiagnostic(),


      validate:
        data => {
          if (
            data?.normalization
              ?.rejected !== 0
          ) {
            throw new Error(
              "NOS Spider-Man feed contains rejected sessions"
            );
          }

          return true;
        },


      getItemCount:
        data =>
          data?.normalization
            ?.sessions ??
          0,


      getMetadata:
        data => ({
          external_id:
            data.program.external_id,

          sessions:
            data.normalization.sessions,

          fetch_ms:
            data.provider_fetch
              ?.durationMs,

          retried:
            data.provider_fetch
              ?.retried
        }),


      fallbackData: {
        program: {
          title:
            TITLE,

          external_id:
            EXTERNAL_ID
        },

        provider_fetch:
          null,

        normalization:
          null,

        read_only:
          true
      }
    });


  return respond({
    ...result,

    diagnostic_test:
      true,

    read_only:
      true,

    total_request_ms:
      Date.now() -
      started,

    next_step:
      result.ok
        ? (
            "Inspect fetch duration and retry behavior. " +
            "Do not change provider timeout policy yet."
          )
        : (
            "The isolated NOS program fetch also failed. " +
            "Inspect the failure before changing timeout policy."
          )
  });
}
