/*
 * PTLife — Cinemas NOS Full Catalogue Diagnostic v1
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * READ-ONLY DIAGNOSTIC.
 *
 * This file:
 *   - fetches the complete NOS movie catalogue
 *   - groups variants by aggregateformatnumber
 *   - fetches sessions for every aggregate movie
 *   - uses controlled concurrency
 *   - maps NOS theaters against PTLife place_sources
 *   - detects duplicate session UUIDs
 *   - records retry/timeout/failure information
 *
 * It DOES NOT write programs or occurrences to D1.
 *
 * The only D1 operation performed here is a SELECT
 * used to verify existing NOS theater mappings.
 */

import {
  safeRun
} from "../lib/safe-run.js";

import {
  fetchProviderJson
} from "../lib/provider-fetch.js";


const SOURCE_ID = 8;

const NOS_ORIGIN =
  "https://www.cinemas.nos.pt";

const MOVIES_URL =
  NOS_ORIGIN +
  "/graphql/execute.json/cinemas/getMoviesInTheaters";

const SESSIONS_BASE =
  NOS_ORIGIN +
  "/bin/cinemas/render/" +
  "getMovieSessions.getMovieSessionsAggregator.json";

const CONCURRENCY = 4;


function respond(data, status = 200) {

  return new Response(
    JSON.stringify(data, null, 2),
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


function findMovies(data) {

  const candidates = [
    data?.data?.movieList?.items,
    data?.data?.moviesList?.items,
    data?.data?.movies?.items,
    data?.movieList?.items,
    data?.movies?.items
  ];

  for (const candidate of candidates) {

    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "NOS movie catalogue array not found"
  );
}


function getAggregateId(movie) {

  return clean(
    movie?.aggregateformatnumber
  );
}


function getTitle(variants) {

  for (const movie of variants) {

    const title =
      clean(
        movie?.aggregatetitle
      );

    if (title) {
      return title;
    }
  }


  for (const movie of variants) {

    const title =
      clean(
        movie?.title
      );

    if (title) {
      return title;
    }
  }


  return "Untitled NOS film";
}


/*
 * Group catalogue variants by NOS aggregate movie ID.
 *
 * Example:
 *
 * The Odyssey 2D  ┐
 *                 ├── one aggregate movie
 * The Odyssey IMAX┘
 */

function groupMovies(movies) {

  const groups =
    new Map();

  let rowsWithoutAggregateId = 0;


  for (const movie of movies) {

    const aggregateId =
      getAggregateId(movie);


    if (!aggregateId) {

      rowsWithoutAggregateId++;

      continue;
    }


    if (
      !groups.has(
        aggregateId
      )
    ) {

      groups.set(
        aggregateId,
        []
      );
    }


    groups
      .get(aggregateId)
      .push(movie);
  }


  return {
    groups,
    rowsWithoutAggregateId
  };
}


/*
 * Generic controlled-concurrency worker.
 *
 * At most `limit` NOS session requests are active
 * at the same time.
 */

async function mapWithConcurrency(
  items,
  limit,
  worker
) {

  const results =
    new Array(
      items.length
    );

  let nextIndex = 0;


  async function runner() {

    while (true) {

      const index =
        nextIndex++;


      if (
        index >=
        items.length
      ) {
        return;
      }


      try {

        results[index] =
          await worker(
            items[index],
            index
          );

      } catch (error) {

        /*
         * A single movie failure should not destroy
         * the entire diagnostic.
         */

        results[index] = {
          ok: false,

          worker_exception:
            true,

          aggregate_movie_id:
            items[index]
              ?.aggregateId ||
            null,

          title:
            items[index]
              ?.title ||
            null,

          error: {
            message:
              error?.message ||
              String(error),

            http_status:
              error?.httpStatus ??
              null,

            timed_out:
              error?.timedOut ??
              false,

            attempts:
              error?.providerAttempts ||
              [],

            total_duration_ms:
              error?.totalDurationMs ??
              null
          }
        };
      }
    }
  }


  const workers =
    [];


  const workerCount =
    Math.min(
      limit,
      items.length
    );


  for (
    let i = 0;
    i < workerCount;
    i++
  ) {

    workers.push(
      runner()
    );
  }


  await Promise.all(
    workers
  );


  return results;
}


/*
 * Fetch and inspect one aggregate movie.
 */

async function inspectMovie(
  movie,
  theaterMap
) {

  const sessionsUrl =
    SESSIONS_BASE +
    "?aggregateMovieId=" +
    encodeURIComponent(
      movie.aggregateId
    );


  let fetched;


  try {

    fetched =
      await fetchProviderJson(
        sessionsUrl
      );

  } catch (error) {

    return {
      ok: false,

      aggregate_movie_id:
        movie.aggregateId,

      title:
        movie.title,

      variant_count:
        movie.variants.length,

      error: {
        message:
          error?.message ||
          String(error),

        http_status:
          error?.httpStatus ??
          null,

        timed_out:
          error?.timedOut ??
          false,

        attempts:
          error?.providerAttempts ||
          [],

        total_duration_ms:
          error?.totalDurationMs ??
          null
      }
    };
  }


  const days =
    Array.isArray(
      fetched.data?.days
    )
      ? fetched.data.days
      : [];


  let sessionCount = 0;

  let sessionsWithoutUuid = 0;

  let theatersSeen = 0;


  const uniqueTheaters =
    new Set();

  const unresolvedTheaters =
    new Map();

  const sessionIds =
    [];


  for (const day of days) {

    const theaters =
      Array.isArray(
        day?.theaters
      )
        ? day.theaters
        : [];


    theatersSeen +=
      theaters.length;


    for (const theater of theaters) {

      const theaterUuid =
        clean(
          theater?.theaterId ??
          theater?.theaterID
        );


      if (theaterUuid) {

        uniqueTheaters.add(
          theaterUuid
        );


        if (
          !theaterMap.has(
            theaterUuid
          )
        ) {

          unresolvedTheaters.set(
            theaterUuid,
            clean(
              theater?.name
            )
          );
        }
      }


      const sessions =
        Array.isArray(
          theater?.sessions
        )
          ? theater.sessions
          : [];


      sessionCount +=
        sessions.length;


      for (const session of sessions) {

        const uuid =
          clean(
            session?.uuid
          );


        if (!uuid) {

          sessionsWithoutUuid++;

          continue;
        }


        sessionIds.push(
          uuid
        );
      }
    }
  }


  /*
   * Detect duplicates within this aggregate movie.
   */

  const localSeen =
    new Set();

  const localDuplicates =
    new Set();


  for (const uuid of sessionIds) {

    if (
      localSeen.has(uuid)
    ) {

      localDuplicates.add(
        uuid
      );

    } else {

      localSeen.add(
        uuid
      );
    }
  }


  return {
    ok: true,

    aggregate_movie_id:
      movie.aggregateId,

    title:
      movie.title,

    variant_count:
      movie.variants.length,

    days:
      days.length,

    sessions:
      sessionCount,

    sessions_with_uuid:
      sessionIds.length,

    sessions_without_uuid:
      sessionsWithoutUuid,

    unique_theaters:
      uniqueTheaters.size,

    theater_appearances:
      theatersSeen,

    unresolved_theaters:
      Array.from(
        unresolvedTheaters,
        ([uuid, name]) => ({
          uuid,
          name
        })
      ),

    duplicate_session_ids:
      Array.from(
        localDuplicates
      ),

    session_ids:
      sessionIds,

    fetch: {
      duration_ms:
        fetched.durationMs,

      retried:
        fetched.retried,

      attempts:
        fetched.attempts
    }
  };
}


async function runDiagnostic(db) {

  const timing = {};

  const totalStarted =
    Date.now();


  /*
   * =====================================================
   * 1. FETCH COMPLETE NOS CATALOGUE
   * =====================================================
   */

  const catalogue =
    await fetchProviderJson(
      MOVIES_URL
    );


  timing.catalogue_fetch_ms =
    catalogue.durationMs;


  const movies =
    findMovies(
      catalogue.data
    );


  /*
   * =====================================================
   * 2. GROUP BY AGGREGATE MOVIE ID
   * =====================================================
   */

  const grouped =
    groupMovies(
      movies
    );


  const aggregateMovies =
    Array.from(
      grouped.groups.entries()
    )
      .map(
        ([aggregateId, variants]) => ({
          aggregateId,

          title:
            getTitle(
              variants
            ),

          variants
        })
      );


  if (
    aggregateMovies.length === 0
  ) {

    throw new Error(
      "NOS catalogue produced zero aggregate movies"
    );
  }


  /*
   * =====================================================
   * 3. LOAD EXISTING NOS THEATER MAP
   * =====================================================
   */

  const theaterStarted =
    Date.now();


  const theaterRows =
    await db
      .prepare(`
        SELECT
          place_id,
          external_id
        FROM place_sources
        WHERE
          source_id = ?
          AND external_id IS NOT NULL
          AND status = 'active'
      `)
      .bind(
        SOURCE_ID
      )
      .all();


  const theaterMap =
    new Map(
      (
        theaterRows.results ||
        []
      )
        .map(
          row => [
            String(
              row.external_id
            ),
            row.place_id
          ]
        )
    );


  timing.theater_map_read_ms =
    Date.now() -
    theaterStarted;


  /*
   * =====================================================
   * 4. FETCH ALL AGGREGATE MOVIE SESSIONS
   * =====================================================
   */

  const sessionsStarted =
    Date.now();


  const movieResults =
    await mapWithConcurrency(
      aggregateMovies,
      CONCURRENCY,

      movie =>
        inspectMovie(
          movie,
          theaterMap
        )
    );


  timing.all_sessions_fetch_ms =
    Date.now() -
    sessionsStarted;


  /*
   * =====================================================
   * 5. AGGREGATE RESULTS
   * =====================================================
   */

  let successfulMovies = 0;

  let failedMovies = 0;

  let totalSessions = 0;

  let sessionsWithoutUuid = 0;

  let retriedMovies = 0;

  let timedOutMovies = 0;


  const globalSessionIds =
    new Set();

  const globalDuplicateIds =
    new Set();

  const unresolvedTheaters =
    new Map();


  for (const result of movieResults) {

    if (!result?.ok) {

      failedMovies++;


      if (
        result?.error
          ?.timed_out
      ) {

        timedOutMovies++;
      }


      continue;
    }


    successfulMovies++;


    totalSessions +=
      result.sessions;


    sessionsWithoutUuid +=
      result.sessions_without_uuid;


    if (
      result.fetch?.retried
    ) {

      retriedMovies++;
    }


    for (
      const theater
      of result.unresolved_theaters
    ) {

      unresolvedTheaters.set(
        theater.uuid,
        theater.name
      );
    }


    for (
      const uuid
      of result.session_ids
    ) {

      if (
        globalSessionIds.has(
          uuid
        )
      ) {

        globalDuplicateIds.add(
          uuid
        );

      } else {

        globalSessionIds.add(
          uuid
        );
      }
    }
  }


  /*
   * Strip the potentially huge session ID arrays from
   * the per-movie output now that global validation is
   * complete.
   */

  const compactMovieResults =
    movieResults.map(
      result => {

        if (!result?.ok) {
          return result;
        }


        const {
          session_ids,
          ...compact
        } = result;


        return compact;
      }
    );


  timing.total_diagnostic_ms =
    Date.now() -
    totalStarted;


  /*
   * =====================================================
   * RESULT
   * =====================================================
   */

  return {

    diagnostic:
      "NOS full catalogue read-only test",

    writes_to_d1:
      false,

    source_id:
      SOURCE_ID,

    concurrency:
      CONCURRENCY,


    catalogue: {

      rows:
        movies.length,

      aggregate_movies:
        aggregateMovies.length,

      rows_without_aggregate_id:
        grouped
          .rowsWithoutAggregateId,

      fetch: {
        duration_ms:
          catalogue.durationMs,

        retried:
          catalogue.retried,

        attempts:
          catalogue.attempts
      }
    },


    theaters: {

      known_nos_theaters:
        theaterMap.size,

      unresolved_count:
        unresolvedTheaters.size,

      unresolved:
        Array.from(
          unresolvedTheaters,
          ([uuid, name]) => ({
            uuid,
            name
          })
        )
    },


    sessions: {

      successful_movies:
        successfulMovies,

      failed_movies:
        failedMovies,

      total_sessions:
        totalSessions,

      unique_session_ids:
        globalSessionIds.size,

      sessions_without_uuid:
        sessionsWithoutUuid,

      duplicate_session_ids:
        globalDuplicateIds.size
    },


    resilience: {

      movies_retried:
        retriedMovies,

      movies_timed_out:
        timedOutMovies
    },


    timing,


    movies:
      compactMovieResults,


    safety: {

      programs_written:
        false,

      occurrences_written:
        false,

      places_written:
        false,

      provider_health_note:
        "safeRun records diagnostic provider health; content tables are read-only",

      concurrency_limit:
        CONCURRENCY,

      provider_timeout_ms:
        8000,

      provider_retries:
        1
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
        "cinemas_nos",

      operation:
        "full_catalogue_diagnostic",

      stage:
        "nos_full_catalogue_diagnostic",

      sourceFile:
        "functions/api/nos-full-diagnostic.js",

      request:
        context.request,

      reproduction:
        "GET /api/nos-full-diagnostic",


      run:
        () =>
          runDiagnostic(
            context.env.DB
          ),


      validate:
        result => {

          if (
            result
              ?.catalogue
              ?.aggregate_movies <= 0
          ) {

            throw new Error(
              "NOS diagnostic found zero aggregate movies"
            );
          }


          /*
           * We deliberately do NOT fail the whole diagnostic
           * merely because one movie request failed.
           *
           * We want the report to tell us exactly which
           * movies failed.
           */

          if (
            result
              ?.sessions
              ?.successful_movies <= 0
          ) {

            throw new Error(
              "NOS diagnostic could not retrieve sessions for any movie"
            );
          }


          return true;
        },


      getItemCount:
        result =>
          result
            ?.sessions
            ?.total_sessions ??
          0,


      getMetadata:
        result => ({

          catalogue_rows:
            result.catalogue.rows,

          aggregate_movies:
            result.catalogue
              .aggregate_movies,

          successful_movies:
            result.sessions
              .successful_movies,

          failed_movies:
            result.sessions
              .failed_movies,

          total_sessions:
            result.sessions
              .total_sessions,

          unique_session_ids:
            result.sessions
              .unique_session_ids,

          unresolved_theaters:
            result.theaters
              .unresolved_count
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
            "Inspect aggregate movie count, failures, retries, " +
            "duplicate session IDs, unresolved theaters and total runtime. " +
            "No content records were written."
          )
        : (
            "Inspect system_errors and provider_health before proceeding."
          )
  });
}
