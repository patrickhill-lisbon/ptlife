/*
 * PTLife — Cinemas NOS End-to-End Test v3
 *
 * Diagnostic only.
 *
 * Purpose:
 *   Run the real NOS catalogue → sessions pipeline
 *   through PTLife's safeRun reliability framework.
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

          preview:
            text.slice(0, 1000)
        }
      }
    );
  }


  return {
    status:
      response.status,

    data
  };
}


// ============================================================
// NOS MOVIE HELPERS
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
// NOS PIPELINE
// ============================================================

async function runNosDiagnostic() {

  /*
   * --------------------------------------------------------
   * STEP 1 — MOVIE CATALOGUE
   * --------------------------------------------------------
   */

  const catalogue =
    await getJson(
      MOVIES_URL
    );


  /*
   * --------------------------------------------------------
   * STEP 2 — LOCATE MOVIE ARRAY
   * --------------------------------------------------------
   */

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
          data_fields:
            Object.keys(
              catalogue.data ||
              {}
            ),

          inner_data_fields:
            Object.keys(
              catalogue.data
                ?.data ||
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
   * STEP 3 — FIND FIRST MOVIE WITH AGGREGATE ID
   * --------------------------------------------------------
   */

  let selected = null;
  let aggregateId = null;


  for (const movie of movies) {
    const id =
      getAggregateId(movie);

    if (id) {
      selected =
        movie;

      aggregateId =
        id;

      break;
    }
  }


  if (!selected) {
    throw providerError(
      "NOS movie aggregate ID was not found",
      {
        stage:
          "aggregate_id",

        details: {
          movie_count:
            movies.length,

          first_movie_fields:
            Object.keys(
              movies[0] ||
              {}
            ),

          first_movie:
            movies[0] ||
            null
        }
      }
    );
  }


  /*
   * --------------------------------------------------------
   * STEP 4 — FETCH SESSIONS
   * --------------------------------------------------------
   */

  const sessionsUrl =
    SESSIONS_BASE +
    "?aggregateMovieId=" +
    encodeURIComponent(
      aggregateId
    );


  const sessionResult =
    await getJson(
      sessionsUrl
    );


  /*
   * --------------------------------------------------------
   * STEP 5 — READ SESSION STRUCTURE
   * --------------------------------------------------------
   */

  if (
    !Array.isArray(
      sessionResult.data?.days
    )
  ) {
    throw providerError(
      "NOS sessions response does not contain a days array",
      {
        stage:
          "sessions_schema",

        details: {
          movie:
            getTitle(
              selected
            ),

          aggregate_movie_id:
            aggregateId,

          session_fields:
            Object.keys(
              sessionResult.data ||
              {}
            )
        }
      }
    );
  }


  const days =
    sessionResult.data.days;


  if (days.length === 0) {
    throw providerError(
      "NOS returned no session days for the selected movie",
      {
        stage:
          "sessions_empty",

        details: {
          movie:
            getTitle(
              selected
            ),

          aggregate_movie_id:
            aggregateId
        }
      }
    );
  }


  let theaterAppearances = 0;
  let sessionCount = 0;

  const theaters =
    new Map();

  const samples = [];


  for (const day of days) {

    const dayTheaters =
      Array.isArray(
        day?.theaters
      )
        ? day.theaters
        : [];


    theaterAppearances +=
      dayTheaters.length;


    for (
      const theater
      of dayTheaters
    ) {

      const theaterId =
        theater?.theaterId ||
        theater?.theaterID ||
        theater?.name;


      if (!theaterId) {
        continue;
      }


      if (
        !theaters.has(
          theaterId
        )
      ) {
        theaters.set(
          theaterId,
          {
            name:
              theater?.name ||
              null,

            theater_id:
              theater
                ?.theaterId ||
              theater
                ?.theaterID ||
              null,

            region_id:
              theater
                ?.regionId ||
              theater
                ?.regionID ||
              null,

            location:
              theater
                ?.location ||
              null
          }
        );
      }


      const sessions =
        Array.isArray(
          theater?.sessions
        )
          ? theater.sessions
          : [];


      sessionCount +=
        sessions.length;


      for (
        const session
        of sessions
      ) {

        if (
          samples.length >=
          20
        ) {
          continue;
        }


        samples.push({
          day:
            day?.name ||
            null,

          theater:
            theater?.name ||
            null,

          theater_id:
            theater
              ?.theaterId ||
            theater
              ?.theaterID ||
            null,

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


  /*
   * A valid-looking response with zero sessions should
   * still be considered a failure for this diagnostic.
   *
   * Otherwise a NOS schema/content problem could be
   * mistaken for a healthy provider.
   */

  if (sessionCount === 0) {
    throw providerError(
      "NOS returned zero sessions for the selected movie",
      {
        stage:
          "session_count_zero",

        details: {
          movie:
            getTitle(
              selected
            ),

          aggregate_movie_id:
            aggregateId,

          days:
            days.length,

          theater_appearances:
            theaterAppearances
        }
      }
    );
  }


  /*
   * --------------------------------------------------------
   * SUCCESS RESULT
   * --------------------------------------------------------
   */

  return {
    fetched_at:
      new Date()
        .toISOString(),

    writes_to_d1:
      false,

    catalogue: {
      status:
        catalogue.status,

      movie_count:
        movies.length
    },

    selected_movie: {
      title:
        getTitle(
          selected
        ),

      uuid:
        valueByName(
          selected,
          "uuid"
        ),

      aggregate_movie_id:
        aggregateId,

      fields:
        Object.keys(
          selected
        )
    },

    sessions_request: {
      status:
        sessionResult.status,

      url:
        sessionsUrl
    },

    result: {
      days:
        days.length,

      unique_theaters:
        theaters.size,

      theater_appearances:
        theaterAppearances,

      sessions:
        sessionCount
    },

    theaters:
      Array.from(
        theaters.values()
      ),

    session_sample:
      samples,

    raw_session_fields:
      Object.keys(
        sessionResult.data ||
        {}
      )
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


  /*
   * safeRun handles:
   *
   *   provider attempt
   *   success
   *   failure
   *   duplicate errors
   *   recovery
   *   provider health
   */

  let result;


  try {
    result =
      await safeRun({
        db,

        provider:
          "cinemas_nos",

        operation:
          "catalogue_to_sessions_diagnostic",

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

          writes_to_content_tables:
            false,

          movie_catalogue_url:
            MOVIES_URL
        },

        run:
          runNosDiagnostic,

        /*
         * This is a second safety check after the
         * provider-specific validation above.
         */

        validate: data => {
          if (
            !data ||
            !data.result
          ) {
            throw new Error(
              "NOS diagnostic result is missing"
            );
          }


          if (
            !Number.isFinite(
              data.result.sessions
            ) ||
            data.result.sessions <= 0
          ) {
            throw new Error(
              "NOS diagnostic produced no usable sessions"
            );
          }


          return true;
        },

        getItemCount:
          data =>
            data?.result
              ?.sessions ??
            null,

        getMetadata:
          data => ({
            movie_count:
              data?.catalogue
                ?.movie_count ??
              null,

            selected_movie:
              data
                ?.selected_movie
                ?.title ??
              null,

            days:
              data?.result
                ?.days ??
              null,

            unique_theaters:
              data?.result
                ?.unique_theaters ??
              null,

            sessions:
              data?.result
                ?.sessions ??
              null
          }),

        fallbackData: {
          fetched_at:
            new Date()
              .toISOString(),

          writes_to_d1:
            false,

          result: {
            days: 0,
            unique_theaters: 0,
            theater_appearances: 0,
            sessions: 0
          },

          theaters: [],

          session_sample: []
        }
      });


  } catch (frameworkError) {

    /*
     * safeRun itself failed.
     *
     * This is different from NOS failing.
     */

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
   * --------------------------------------------------------
   * GRACEFUL NOS FAILURE
   * --------------------------------------------------------
   *
   * Deliberately return HTTP 200 from this diagnostic
   * endpoint even when NOS failed.
   *
   * The JSON tells us the provider failed; Cloudflare
   * does not replace the useful diagnostic with a
   * generic gateway-error page.
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
        "The NOS diagnostic failed, but PTLife handled the failure without crashing.",

      next_step:
        "Inspect system_errors and provider_health using the returned error ID."
    });
  }


  /*
   * --------------------------------------------------------
   * SUCCESS
   * --------------------------------------------------------
   */

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
      "Back-test specific NOS cinemas in Lisbon, Porto and Algarve before building the production importer."
  });
}
