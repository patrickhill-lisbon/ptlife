/*
 * PTLife — Cinemas NOS Adapter Catalogue Diagnostic
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * READ ONLY.
 *
 * Verifies the canonical provider adapter:
 *
 *   functions/providers/pt/cinemas/nos.js
 *
 * Expected current result:
 *
 *   provider key:       pt.cinema.nos
 *   catalogue rows:     30
 *   aggregate movies:   20
 *
 * No D1 content writes.
 */

import {
  safeRun
} from "../../../../../../lib/safe-run.js";

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


async function runDiagnostic() {

  /*
   * Fetch using the canonical NOS adapter.
   */

  const catalogue =
    await fetchCatalogue();


  /*
   * Normalize NOS variants into aggregate movies.
   */

  const normalized =
    normalizeCatalogue(
      catalogue.rows
    );


  return {
    diagnostic:
      "NOS canonical adapter catalogue test",

    writes_to_d1:
      false,

    provider: {
      key:
        provider.key,

      country:
        provider.country,

      category:
        provider.category,

      slug:
        provider.slug,

      name:
        provider.name,

      source_id:
        provider.sourceId
    },

    catalogue: {
      rows:
        catalogue.rows.length,

      aggregate_movies:
        normalized.movies.length,

      rejected_rows:
        normalized.rejected.length,

      fetch:
        catalogue.fetch
    },

    movies:
      normalized.movies.map(
        movie => ({
          external_id:
            movie.externalId,

          title:
            movie.title,

          original_title:
            movie.originalTitle,

          runtime_minutes:
            movie.runtimeMinutes,

          content_rating:
            movie.contentRating,

          source_url:
            movie.sourceUrl,

          variants:
            movie.variants
        })
      ),

    rejected:
      normalized.rejected
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
        "adapter_catalogue_diagnostic",

      stage:
        "provider_adapter_test",

      sourceFile:
        "functions/api/diagnostics/providers/pt/cinemas/nos/catalogue.js",

      request:
        context.request,

      reproduction:
        "GET /api/diagnostics/providers/pt/cinemas/nos/catalogue",


      run:
        () =>
          runDiagnostic(),


      validate:
        data => {

          if (
            data?.provider?.key !==
            "pt.cinema.nos"
          ) {
            throw new Error(
              "Unexpected provider key"
            );
          }


          if (
            data?.catalogue?.rows <= 0
          ) {
            throw new Error(
              "NOS adapter returned zero catalogue rows"
            );
          }


          if (
            data?.catalogue
              ?.aggregate_movies <= 0
          ) {
            throw new Error(
              "NOS adapter returned zero aggregate movies"
            );
          }


          return true;
        },


      getItemCount:
        data =>
          data?.catalogue
            ?.aggregate_movies ??
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

          rejected_rows:
            data.catalogue
              .rejected_rows
        }),


      fallbackData: {
        catalogue:
          null,

        movies:
          []
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
            "Verify provider key, catalogue rows, " +
            "aggregate movie count and rejected rows."
          )
        : (
            "Do not proceed to production synchronization."
          )
  });
}
