/*
 * PTLife — Cinemas NOS Colombo Schedule Test v4
 *
 * Diagnostic only.
 *
 * Purpose:
 *   Determine whether PTLife can build a complete schedule
 *   for one NOS cinema using the proven NOS APIs.
 *
 * Test cinema:
 *   Cinemas NOS Colombo
 *
 * Method:
 *   1. Fetch current NOS movie catalogue.
 *   2. Find aggregate movie IDs.
 *   3. Fetch session data for every movie.
 *   4. Run requests in controlled batches.
 *   5. Keep only Colombo sessions.
 *   6. Report timing and failures.
 *
 * IMPORTANT:
 *   - NO program writes
 *   - NO occurrence writes
 *   - NO place writes
 *   - reliability logging only
 */

import {
  safeRun
} from "../lib/safe-run.js";


const NOS_ORIGIN =
  "https://www.cinemas.nos.pt";

const MOVIES_URL =
  NOS_ORIGIN +
  "/graphql/execute.json/cinemas/getMoviesInTheaters";

const SESSIONS_BASE =
  NOS_ORIGIN +
  "/bin/cinemas/render/" +
  "getMovieSessions.getMovieSessionsAggregator.json";


/*
 * Known from the NOS theatre list.
 */

const TARGET_THEATER = {
  uuid:
    "e0ea3044-4a1b-46b1-bca2-69fd8eae16d7",

  name:
    "Cinemas NOS Colombo",

  city:
    "Lisboa"
};


const BATCH_SIZE = 5;


// ============================================================
// RESPONSE
// ============================================================

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


// ============================================================
// PROVIDER ERROR
// ============================================================

function providerError(
  message,
  {
    stage = null,
    httpStatus = null,
    details = null
  } = {}
) {
  const error =
    new Error(message);

  if (stage) {
    error.providerStage =
      stage;
  }

  if (httpStatus !== null) {
    error.httpStatus =
      httpStatus;
  }

  if (details !== null) {
    error.details =
      details;
  }

  return error;
}


// ============================================================
// FETCH JSON
// ============================================================

async function getJson(url) {
  const startedAt =
    Date.now();

  let response;


  try {
    response =
      await fetch(url, {
        headers: {
          accept:
            "application/json"
        }
      });
  } catch (error) {
    throw providerError(
      "NOS network request failed",
      {
        stage:
          "network_fetch",

        details: {
          url,

          original_error:
            error?.message ||
            String(error)
        }
      }
    );
  }


  const text =
    await response.text();

  const durationMs =
    Date.now() - startedAt;


  if (!response.ok) {
    throw providerError(
      `NOS returned HTTP ${response.status}`,
      {
        stage:
          "http_response",

        httpStatus:
          response.status,

        details: {
          url,

          duration_ms:
            durationMs,

          preview:
            text.slice(0, 1000)
        }
      }
    );
  }


  let data;


  try {
    data =
      JSON.parse(text);
  } catch {
    throw providerError(
      "NOS returned invalid JSON",
      {
        stage:
          "json_parse",

        httpStatus:
          response.status,

        details: {
          url,

          duration_ms:
            durationMs,

          preview:
            text.slice(0, 1000)
        }
      }
    );
  }


  return {
    status:
      response.status,

    durationMs,

    data
  };
}


// ============================================================
// MOVIE HELPERS
// ============================================================

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


  return null;
}


function valueByName(obj, wanted) {
  if (
    !obj ||
    typeof obj !== "object"
  ) {
    return null;
  }


  const target =
    wanted.toLowerCase();


  for (
    const [key, value]
    of Object.entries(obj)
  ) {
    if (
      key.toLowerCase() ===
      target
    ) {
      return value;
    }
  }


  return null;
}


function getAggregateId(movie) {
  return (
    valueByName(
      movie,
      "aggregateformatnumber"
    ) ||

    valueByName(
      movie,
      "aggregateMovieId"
    ) ||

    valueByName(
      movie,
      "aggregateMovieID"
    ) ||

    null
  );
}


function getTitle(movie) {
  return (
    valueByName(
      movie,
      "title"
    ) ||

    valueByName(
      movie,
      "name"
    ) ||

    valueByName(
      movie,
      "originalTitle"
    ) ||

    null
  );
}


// ============================================================
// THEATER MATCHING
// ============================================================

function getTheaterId(theater) {
  return (
    theater?.theaterId ||
    theater?.theaterID ||
    theater?.uuid ||
    null
  );
}


function isTargetTheater(theater) {
  const id =
    getTheaterId(theater);


  /*
   * UUID is our primary match.
   */

  if (
    id === TARGET_THEATER.uuid
  ) {
    return true;
  }


  /*
   * Name fallback is useful diagnostically in case NOS
   * changes the identifier field in the session response.
   */

  const name =
    String(
      theater?.name || ""
    )
      .trim()
      .toLowerCase();


  return (
    name ===
    TARGET_THEATER.name
      .toLowerCase()
  );
}


// ============================================================
// FETCH ONE MOVIE'S SESSIONS
// ============================================================

async function fetchMovieSessions(movie) {
  const aggregateId =
    getAggregateId(movie);

  const title =
    getTitle(movie);


  if (!aggregateId) {
    return {
      ok: false,

      title,

      movie_uuid:
        valueByName(
          movie,
          "uuid"
        ),

      aggregate_movie_id:
        null,

      error:
        "aggregate_movie_id_missing"
    };
  }


  const sessionsUrl =
    SESSIONS_BASE +
    "?aggregateMovieId=" +
    encodeURIComponent(
      aggregateId
    );


  try {
    const response =
      await getJson(
        sessionsUrl
      );


    if (
      !Array.isArray(
        response.data?.days
      )
    ) {
      return {
        ok: false,

        title,

        movie_uuid:
          valueByName(
            movie,
            "uuid"
          ),

        aggregate_movie_id:
          aggregateId,

        duration_ms:
          response.durationMs,

        error:
          "days_array_missing",

        response_fields:
          Object.keys(
            response.data || {}
          )
      };
    }


    return {
      ok: true,

      title,

      movie_uuid:
        valueByName(
          movie,
          "uuid"
        ),

      aggregate_movie_id:
        aggregateId,

      duration_ms:
        response.durationMs,

      days:
        response.data.days
    };


  } catch (error) {
    return {
      ok: false,

      title,

      movie_uuid:
        valueByName(
          movie,
          "uuid"
        ),

      aggregate_movie_id:
        aggregateId,

      error:
        error?.message ||
        String(error),

      stage:
        error?.providerStage ||
        null,

      http_status:
        error?.httpStatus ||
        null
    };
  }
}


// ============================================================
// BATCH RUNNER
// ============================================================

async function fetchInBatches(
  movies,
  batchSize
) {
  const results = [];


  for (
    let index = 0;
    index < movies.length;
    index += batchSize
  ) {
    const batch =
      movies.slice(
        index,
        index + batchSize
      );


    const batchResults =
      await Promise.all(
        batch.map(
          fetchMovieSessions
        )
      );


    results.push(
      ...batchResults
    );
  }


  return results;
}


// ============================================================
// NORMALIZE COLOMBO SESSIONS
// ============================================================

function collectTargetSessions(
  movieResults
) {
  const sessions = [];

  const moviesAtTheater =
    new Map();


  for (
    const movieResult
    of movieResults
  ) {
    if (!movieResult.ok) {
      continue;
    }


    for (
      const day
      of movieResult.days
    ) {
      const theaters =
        Array.isArray(
          day?.theaters
        )
          ? day.theaters
          : [];


      for (
        const theater
        of theaters
      ) {
        if (
          !isTargetTheater(
            theater
          )
        ) {
          continue;
        }


        const theaterSessions =
          Array.isArray(
            theater?.sessions
          )
            ? theater.sessions
            : [];


        if (
          theaterSessions.length >
          0
        ) {
          moviesAtTheater.set(
            movieResult.aggregate_movie_id,
            movieResult.title
          );
        }


        for (
          const session
          of theaterSessions
        ) {
          sessions.push({
            movie:
              movieResult.title,

            movie_uuid:
              movieResult.movie_uuid,

            aggregate_movie_id:
              movieResult
                .aggregate_movie_id,

            day_name:
              day?.name ||
              null,

            theater:
              theater?.name ||
              TARGET_THEATER.name,

            theater_id:
              getTheaterId(
                theater
              ),

            session_uuid:
              session?.uuid ||
              null,

            time:
              session?.time ||
              null,

            operational_date:
              session
                ?.operationalDate ||
              null,

            room:
              session?.room ||
              session?.roomName ||
              session?.screen ||
              null,

            type:
              session?.type ||
              null,

            description:
              session
                ?.description ||
              null,

            format:
              session?.format ||
              null,

            version:
              session?.version ||
              null
          });
        }
      }
    }
  }


  return {
    sessions,

    movieCount:
      moviesAtTheater.size
  };
}


// ============================================================
// MAIN NOS DIAGNOSTIC
// ============================================================

async function runNosColomboDiagnostic() {
  const totalStartedAt =
    Date.now();


  /*
   * --------------------------------------------------------
   * STEP 1 — CATALOGUE
   * --------------------------------------------------------
   */

  const catalogueStartedAt =
    Date.now();


  const catalogue =
    await getJson(
      MOVIES_URL
    );


  const catalogueStageMs =
    Date.now() -
    catalogueStartedAt;


  const movies =
    findMovies(
      catalogue.data
    );


  if (!movies) {
    throw providerError(
      "NOS movie array was not found",
      {
        stage:
          "catalogue_schema",

        details: {
          fields:
            Object.keys(
              catalogue.data ||
              {}
            )
        }
      }
    );
  }


  if (movies.length === 0) {
    throw providerError(
      "NOS returned an empty movie catalogue",
      {
        stage:
          "catalogue_empty"
      }
    );
  }


  /*
   * --------------------------------------------------------
   * STEP 2 — SESSION REQUESTS
   * --------------------------------------------------------
   */

  const sessionStageStartedAt =
    Date.now();


  const movieResults =
    await fetchInBatches(
      movies,
      BATCH_SIZE
    );


  const sessionStageMs =
    Date.now() -
    sessionStageStartedAt;


  /*
   * --------------------------------------------------------
   * STEP 3 — ANALYZE REQUEST RESULTS
   * --------------------------------------------------------
   */

  const successfulRequests =
    movieResults.filter(
      result => result.ok
    );


  const failedRequests =
    movieResults.filter(
      result => !result.ok
    );


  /*
   * --------------------------------------------------------
   * STEP 4 — EXTRACT COLOMBO
   * --------------------------------------------------------
   */

  const target =
    collectTargetSessions(
      movieResults
    );


  /*
   * A cinema legitimately might have zero sessions at some
   * future point, so don't automatically classify that as
   * provider failure.
   *
   * But if EVERY movie session request failed, the provider
   * clearly did not work.
   */

  if (
    successfulRequests.length ===
    0
  ) {
    throw providerError(
      "All NOS movie session requests failed",
      {
        stage:
          "sessions_all_failed",

        details: {
          movie_count:
            movies.length,

          failures:
            failedRequests.slice(
              0,
              10
            )
        }
      }
    );
  }


  /*
   * --------------------------------------------------------
   * TIMING STATISTICS
   * --------------------------------------------------------
   */

  const requestDurations =
    successfulRequests
      .map(
        result =>
          result.duration_ms
      )
      .filter(
        value =>
          Number.isFinite(
            value
          )
      );


  const slowestRequests =
    [...successfulRequests]
      .filter(
        result =>
          Number.isFinite(
            result.duration_ms
          )
      )
      .sort(
        (a, b) =>
          b.duration_ms -
          a.duration_ms
      )
      .slice(0, 10)
      .map(
        result => ({
          movie:
            result.title,

          duration_ms:
            result.duration_ms
        })
      );


  const averageRequestMs =
    requestDurations.length
      ? Math.round(
          requestDurations.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
          requestDurations.length
        )
      : null;


  /*
   * Sort schedule primarily by operational date and time.
   */

  target.sessions.sort(
    (a, b) => {
      const aKey =
        `${a.operational_date || ""} ${a.time || ""}`;

      const bKey =
        `${b.operational_date || ""} ${b.time || ""}`;


      return aKey.localeCompare(
        bKey
      );
    }
  );


  return {
    fetched_at:
      new Date()
        .toISOString(),

    writes_to_d1:
      false,

    target_theater:
      TARGET_THEATER,

    configuration: {
      batch_size:
        BATCH_SIZE
    },

    catalogue: {
      http_status:
        catalogue.status,

      movie_count:
        movies.length,

      movies_with_aggregate_id:
        movies.filter(
          movie =>
            Boolean(
              getAggregateId(
                movie
              )
            )
        ).length
    },

    requests: {
      attempted:
        movieResults.length,

      successful:
        successfulRequests.length,

      failed:
        failedRequests.length,

      failures:
        failedRequests.map(
          result => ({
            movie:
              result.title,

            aggregate_movie_id:
              result
                .aggregate_movie_id,

            error:
              result.error,

            stage:
              result.stage ||
              null,

            http_status:
              result.http_status ||
              null
          })
        )
    },

    colombo: {
      movies:
        target.movieCount,

      sessions:
        target.sessions.length,

      schedule:
        target.sessions
    },

    timing: {
      catalogue_ms:
        catalogueStageMs,

      sessions_stage_ms:
        sessionStageMs,

      total_pipeline_ms:
        Date.now() -
        totalStartedAt,

      average_session_request_ms:
        averageRequestMs,

      slowest_session_requests:
        slowestRequests
    }
  };
}


// ============================================================
// REQUEST HANDLER
// ============================================================

export async function onRequestGet(
  context
) {
  const db =
    context.env.DB;


  let result;


  try {
    result =
      await safeRun({
        db,

        provider:
          "cinemas_nos",

        operation:
          "colombo_full_schedule_diagnostic",

        sourceFile:
          "functions/api/nos-test.js",

        request:
          context.request,

        reproduction: {
          endpoint:
            "/api/nos-test",

          method:
            "GET"
        },

        context: {
          diagnostic:
            true,

          target_theater:
            TARGET_THEATER.name,

          target_theater_uuid:
            TARGET_THEATER.uuid,

          batch_size:
            BATCH_SIZE,

          writes_to_content_tables:
            false
        },

        run:
          runNosColomboDiagnostic,

        validate: data => {
          if (
            !data ||
            !data.catalogue ||
            !data.requests ||
            !data.colombo
          ) {
            throw new Error(
              "NOS Colombo diagnostic returned an incomplete result"
            );
          }


          if (
            data.catalogue
              .movie_count <= 0
          ) {
            throw new Error(
              "NOS Colombo diagnostic returned no movies"
            );
          }


          if (
            data.requests
              .successful <= 0
          ) {
            throw new Error(
              "NOS Colombo diagnostic had no successful session requests"
            );
          }


          return true;
        },

        getItemCount:
          data =>
            data?.colombo
              ?.sessions ??
            null,

        getMetadata:
          data => ({
            target_theater:
              TARGET_THEATER.name,

            catalogue_movies:
              data?.catalogue
                ?.movie_count ??
              null,

            request_successes:
              data?.requests
                ?.successful ??
              null,

            request_failures:
              data?.requests
                ?.failed ??
              null,

            theater_movies:
              data?.colombo
                ?.movies ??
              null,

            theater_sessions:
              data?.colombo
                ?.sessions ??
              null,

            pipeline_ms:
              data?.timing
                ?.total_pipeline_ms ??
              null
          }),

        fallbackData: {
          target_theater:
            TARGET_THEATER,

          catalogue: {
            movie_count: 0
          },

          requests: {
            attempted: 0,
            successful: 0,
            failed: 0,
            failures: []
          },

          colombo: {
            movies: 0,
            sessions: 0,
            schedule: []
          }
        }
      });


  } catch (frameworkError) {
    return respond(
      {
        ok: false,

        graceful_failure:
          false,

        stage:
          "reliability_framework_failure",

        message:
          frameworkError
            ?.message ||
          String(
            frameworkError
          ),

        stack:
          frameworkError
            ?.stack ||
          null
      },
      500
    );
  }


  /*
   * NOS failure itself remains graceful.
   */

  if (!result.ok) {
    return respond({
      ok: false,

      graceful_failure:
        true,

      provider:
        result.provider,

      operation:
        result.operation,

      duration_ms:
        result.durationMs,

      error:
        result.error,

      fallback:
        result.data,

      message:
        "The NOS Colombo diagnostic failed, but PTLife remained operational."
    });
  }


  return respond({
    ok: true,

    graceful_success:
      true,

    provider:
      result.provider,

    operation:
      result.operation,

    duration_ms:
      result.durationMs,

    session_count:
      result.itemCount,

    recovered:
      result.recovered,

    recovery:
      result.recovery,

    data:
      result.data,

    next_step:
      "Use the timing and Colombo schedule results to determine the production NOS import strategy."
  });
}
