/*
 * PTLife — Cinemas NOS End-to-End Test v1
 *
 * Diagnostic only.
 *
 * Purpose:
 *   Prove that PTLife can automatically:
 *
 *   1. Fetch the current NOS movie catalogue.
 *   2. Find a movie with an aggregateMovieId.
 *   3. Fetch that movie's sessions.
 *   4. Parse days -> theaters -> sessions.
 *   5. Identify Lisbon-area and Algarve screenings.
 *
 * This does NOT:
 *   - write to D1
 *   - modify the generic extractor
 *   - modify production event data
 *
 * Endpoint after deployment:
 *
 *   /api/nos-test
 *
 * Optional:
 *
 *   /api/nos-test?q=odisseia
 *
 * The q parameter lets us try to select a movie
 * whose title contains the supplied text.
 */

const NOS_ORIGIN =
  "https://www.cinemas.nos.pt";

const MOVIES_URL =
  NOS_ORIGIN +
  "/graphql/execute.json/cinemas/getMoviesInTheaters";

const SESSIONS_URL =
  NOS_ORIGIN +
  "/bin/cinemas/render/getMovieSessions.getMovieSessionsAggregator.json";


function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store",
      },
    }
  );
}


async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "accept":
        "application/json,text/plain,*/*",

      "user-agent":
        "PTLife-NOS-Diagnostic/1.0",
    },
  });

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    url,
    text,
    data,
  };
}


/*
 * Recursively search an arbitrary JSON object
 * for arrays.
 *
 * We use this because we don't want this
 * diagnostic test to fail merely because NOS
 * changes one wrapper-property name.
 */
function collectArrays(
  value,
  path = "$",
  output = []
) {
  if (Array.isArray(value)) {
    output.push({
      path,
      value,
    });

    for (
      let i = 0;
      i < value.length;
      i++
    ) {
      collectArrays(
        value[i],
        `${path}[${i}]`,
        output
      );
    }

    return output;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    for (
      const [key, child]
      of Object.entries(value)
    ) {
      collectArrays(
        child,
        `${path}.${key}`,
        output
      );
    }
  }

  return output;
}


/*
 * Find the most likely movie array.
 *
 * A movie record should contain some
 * combination of:
 *
 *   uuid
 *   title
 *   originalTitle
 *   aggregateMovieId
 */
function findMovieArray(data) {
  const arrays =
    collectArrays(data);

  let best = null;
  let bestScore = -1;

  for (const candidate of arrays) {
    if (!candidate.value.length) {
      continue;
    }

    const objects =
      candidate.value.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item)
      );

    if (!objects.length) {
      continue;
    }

    let score = 0;

    for (
      const item of objects.slice(0, 10)
    ) {
      const keys =
        Object.keys(item);

      if (
        keys.some(
          (key) =>
            key.toLowerCase() ===
            "aggregatemovieid"
        )
      ) {
        score += 10;
      }

      if ("uuid" in item) {
        score += 2;
      }

      if (
        "title" in item ||
        "name" in item
      ) {
        score += 2;
      }

      if (
        "originalTitle" in item ||
        "originaltitle" in item
      ) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;

      best = {
        path:
          candidate.path,

        value:
          candidate.value,
      };
    }
  }

  return best;
}


function getCaseInsensitive(
  object,
  wantedKey
) {
  if (
    !object ||
    typeof object !== "object"
  ) {
    return undefined;
  }

  const wanted =
    wantedKey.toLowerCase();

  for (
    const [key, value]
    of Object.entries(object)
  ) {
    if (
      key.toLowerCase() === wanted
    ) {
      return value;
    }
  }

  return undefined;
}


function movieTitle(movie) {
  return (
    getCaseInsensitive(
      movie,
      "title"
    ) ||

    getCaseInsensitive(
      movie,
      "name"
    ) ||

    getCaseInsensitive(
      movie,
      "originalTitle"
    ) ||

    null
  );
}


function movieOriginalTitle(movie) {
  return (
    getCaseInsensitive(
      movie,
      "originalTitle"
    ) ||

    getCaseInsensitive(
      movie,
      "originaltitle"
    ) ||

    null
  );
}


function aggregateMovieId(movie) {
  return (
    getCaseInsensitive(
      movie,
      "aggregateMovieId"
    ) ||

    getCaseInsensitive(
      movie,
      "aggregatemovieid"
    ) ||

    null
  );
}


function movieUuid(movie) {
  return (
    getCaseInsensitive(
      movie,
      "uuid"
    ) ||
    null
  );
}


/*
 * Choose a movie.
 *
 * If ?q= is supplied, prefer a title match.
 *
 * Otherwise choose the first movie for which
 * NOS gives us an aggregateMovieId.
 */
function chooseMovie(
  movies,
  query
) {
  const usable =
    movies.filter(
      (movie) =>
        aggregateMovieId(movie)
    );

  if (!usable.length) {
    return null;
  }

  if (query) {
    const q =
      query
        .trim()
        .toLowerCase();

    const match =
      usable.find(
        (movie) => {
          const text = [
            movieTitle(movie),
            movieOriginalTitle(movie),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          return text.includes(q);
        }
      );

    if (match) {
      return match;
    }
  }

  return usable[0];
}


/*
 * NOS session response helpers.
 */

function getDays(data) {
  if (
    Array.isArray(data?.days)
  ) {
    return data.days;
  }

  /*
   * Fallback:
   *
   * Find an array whose objects contain
   * a theaters array.
   */
  const arrays =
    collectArrays(data);

  for (const candidate of arrays) {
    const first =
      candidate.value.find(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item)
      );

    if (
      first &&
      Array.isArray(first.theaters)
    ) {
      return candidate.value;
    }
  }

  return [];
}


function getTheaters(day) {
  return Array.isArray(
    day?.theaters
  )
    ? day.theaters
    : [];
}


function getSessions(theater) {
  return Array.isArray(
    theater?.sessions
  )
    ? theater.sessions
    : [];
}


function normalizeText(value) {
  return String(
    value ?? ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase();
}


/*
 * Diagnostic geographic grouping.
 *
 * These are NOT intended as the final PTLife
 * geographic definitions.
 */

function isLisbonArea(theater) {
  const text =
    normalizeText(
      [
        theater?.name,
        theater?.location,
      ]
        .filter(Boolean)
        .join(" ")
    );

  const clues = [
    "lisboa",
    "lisbon",
    "colombo",
    "amoreiras",
    "vasco da gama",
    "cascai",
    "alcabideche",
    "oeiras",
    "odivelas",
    "almada",
    "montijo",
  ];

  return clues.some(
    (clue) =>
      text.includes(clue)
  );
}


function isAlgarve(theater) {
  const text =
    normalizeText(
      [
        theater?.name,
        theater?.location,
      ]
        .filter(Boolean)
        .join(" ")
    );

  const clues = [
    "algarve",
    "faro",
    "almancil",
    "portimao",
  ];

  return clues.some(
    (clue) =>
      text.includes(clue)
  );
}


function compactSession(
  day,
  theater,
  session
) {
  return {
    day:
      day?.name ??
      null,

    theater:
      theater?.name ??
      null,

    theater_id:
      theater?.theaterId ??
      theater?.theaterID ??
      null,

    region_id:
      theater?.regionId ??
      theater?.regionID ??
      null,

    location:
      theater?.location ??
      null,

    session_uuid:
      session?.uuid ??
      null,

    time:
      session?.time ??
      null,

    operational_date:
      session?.operationalDate ??
      null,

    type:
      session?.type ??
      null,

    description:
      session?.description ??
      null,

    format:
      session?.format ??
      null,

    version:
      session?.version ??
      null,

    room:
      session?.room ??
      session?.auditorium ??
      null,

    ticket_url:
      session?.uuid
        ? (
          "https://bilheteira.cinemas.nos.pt/" +
          "Cinemas/Ticket?SessionUUID=" +
          encodeURIComponent(
            session.uuid
          )
        )
        : null,
  };
}


export async function onRequestGet(
  context
) {
  const requestUrl =
    new URL(
      context.request.url
    );

  const q =
    requestUrl.searchParams.get(
      "q"
    );


  /*
   * STEP 1
   *
   * Fetch NOS movie catalogue.
   */

  let moviesResult;

  try {
    moviesResult =
      await fetchJson(
        MOVIES_URL
      );
  } catch (error) {
    return jsonResponse(
      {
        ok: false,

        stage:
          "fetch_movies",

        error:
          String(
            error?.message ||
            error
          ),
      },
      502
    );
  }


  if (!moviesResult.ok) {
    return jsonResponse(
      {
        ok: false,

        stage:
          "fetch_movies",

        nos_http_status:
          moviesResult.status,

        source_url:
          moviesResult.url,

        response_preview:
          moviesResult.text.slice(
            0,
            2000
          ),
      },
      moviesResult.status
    );
  }


  if (!moviesResult.data) {
    return jsonResponse(
      {
        ok: false,

        stage:
          "parse_movies",

        reason:
          "NOS movie response was not valid JSON.",

        response_preview:
          moviesResult.text.slice(
            0,
            2000
          ),
      },
      502
    );
  }


  /*
   * STEP 2
   *
   * Locate the movie array.
   */

  const movieArrayInfo =
    findMovieArray(
      moviesResult.data
    );


  if (
    !movieArrayInfo ||
    !Array.isArray(
      movieArrayInfo.value
    )
  ) {
    return jsonResponse(
      {
        ok: false,

        stage:
          "locate_movie_array",

        reason:
          "Could not identify the movie array in the NOS response.",

        top_level_fields:
          Object.keys(
            moviesResult.data ||
            {}
          ),
      },
      502
    );
  }


  const movies =
    movieArrayInfo.value;


  /*
   * STEP 3
   *
   * Choose a movie automatically.
   */

  const selectedMovie =
    chooseMovie(
      movies,
      q
    );


  if (!selectedMovie) {
    return jsonResponse(
      {
        ok: false,

        stage:
          "choose_movie",

        movie_array_path:
          movieArrayInfo.path,

        movie_count:
          movies.length,

        reason:
          "No movie with an aggregateMovieId was found.",

        sample_movie_fields:
          movies
            .slice(0, 5)
            .map(
              (movie) =>
                Object.keys(
                  movie || {}
                )
            ),
      },
      502
    );
  }


  const selectedAggregateId =
    aggregateMovieId(
      selectedMovie
    );


  /*
   * STEP 4
   *
   * Fetch sessions automatically using
   * the aggregateMovieId discovered above.
   */

  const sessionsUrl =
    SESSIONS_URL +
    "?aggregateMovieId=" +
    encodeURIComponent(
      selectedAggregateId
    );


  let sessionsResult;

  try {
    sessionsResult =
      await fetchJson(
        sessionsUrl
      );
  } catch (error) {
    return jsonResponse(
      {
        ok: false,

        stage:
          "fetch_sessions",

        selected_movie: {
          title:
            movieTitle(
              selectedMovie
            ),

          aggregate_movie_id:
            selectedAggregateId,
        },

        error:
          String(
            error?.message ||
            error
          ),
      },
      502
    );
  }


  if (!sessionsResult.ok) {
    return jsonResponse(
      {
        ok: false,

        stage:
          "fetch_sessions",

        selected_movie: {
          title:
            movieTitle(
              selectedMovie
            ),

          aggregate_movie_id:
            selectedAggregateId,
        },

        nos_http_status:
          sessionsResult.status,

        source_url:
          sessionsUrl,

        response_preview:
          sessionsResult.text.slice(
            0,
            2000
          ),
      },
      sessionsResult.status
    );
  }


  if (!sessionsResult.data) {
    return jsonResponse(
      {
        ok: false,

        stage:
          "parse_sessions",

        reason:
          "NOS sessions response was not valid JSON.",

        selected_movie: {
          title:
            movieTitle(
              selectedMovie
            ),

          aggregate_movie_id:
            selectedAggregateId,
        },

        response_preview:
          sessionsResult.text.slice(
            0,
            2000
          ),
      },
      502
    );
  }


  /*
   * STEP 5
   *
   * Parse:
   *
   * days -> theaters -> sessions
   */

  const days =
    getDays(
      sessionsResult.data
    );


  const allSessions = [];

  const uniqueTheaters =
    new Map();


  for (const day of days) {
    for (
      const theater
      of getTheaters(day)
    ) {
      const theaterKey =
        theater?.theaterId ??
        theater?.theaterID ??
        theater?.name ??
        JSON.stringify(
          theater
        );

      if (
        !uniqueTheaters.has(
          theaterKey
        )
      ) {
        uniqueTheaters.set(
          theaterKey,
          {
            name:
              theater?.name ??
              null,

            theater_id:
              theater?.theaterId ??
              theater?.theaterID ??
              null,

            region_id:
              theater?.regionId ??
              theater?.regionID ??
              null,

            location:
              theater?.location ??
              null,
          }
        );
      }


      for (
        const session
        of getSessions(theater)
      ) {
        allSessions.push(
          compactSession(
            day,
            theater,
            session
          )
        );
      }
    }
  }


  /*
   * STEP 6
   *
   * Geographic diagnostic subsets.
   */

  const lisbonSessions =
    [];

  const algarveSessions =
    [];


  for (const day of days) {
    for (
      const theater
      of getTheaters(day)
    ) {
      const sessions =
        getSessions(theater);

      if (
        isLisbonArea(theater)
      ) {
        for (
          const session
          of sessions
        ) {
          lisbonSessions.push(
            compactSession(
              day,
              theater,
              session
            )
          );
        }
      }

      if (
        isAlgarve(theater)
      ) {
        for (
          const session
          of sessions
        ) {
          algarveSessions.push(
            compactSession(
              day,
              theater,
              session
            )
          );
        }
      }
    }
  }


  /*
   * STEP 7
   *
   * Return a compact but useful diagnostic.
   */

  return jsonResponse({
    ok: true,

    fetched_at:
      new Date().toISOString(),

    test: {
      purpose:
        "Prove the complete NOS catalogue -> aggregateMovieId -> sessions pipeline without manually supplying a movie ID.",

      query:
        q ?? null,

      writes_to_d1:
        false,

      modifies_generic_extractor:
        false,
    },


    movie_catalogue: {
      source_url:
        MOVIES_URL,

      http_status:
        moviesResult.status,

      detected_movie_array_path:
        movieArrayInfo.path,

      movie_count:
        movies.length,

      movies_with_aggregate_id:
        movies.filter(
          (movie) =>
            aggregateMovieId(
              movie
            )
        ).length,
    },


    selected_movie: {
      uuid:
        movieUuid(
          selectedMovie
        ),

      title:
        movieTitle(
          selectedMovie
        ),

      original_title:
        movieOriginalTitle(
          selectedMovie
        ),

      aggregate_movie_id:
        selectedAggregateId,

      top_level_fields:
        Object.keys(
          selectedMovie ||
          {}
        ),
    },


    sessions_source: {
      url:
        sessionsUrl,

      http_status:
        sessionsResult.status,
    },


    parsed_sessions: {
      days_count:
        days.length,

      theater_count:
        uniqueTheaters.size,

      session_count:
        allSessions.length,

      lisbon_session_count:
        lisbonSessions.length,

      algarve_session_count:
        algarveSessions.length,
    },


    theaters:
      Array.from(
        uniqueTheaters.values()
      ),


    /*
     * Enough samples to verify that the
     * normalization is working without
     * returning an enormous response.
     */

    session_sample:
      allSessions.slice(
        0,
        25
      ),


    lisbon_session_sample:
      lisbonSessions.slice(
        0,
        25
      ),


    algarve_session_sample:
      algarveSessions.slice(
        0,
        25
      ),


    /*
     * Helpful for understanding future
     * schema changes without dumping the
     * entire response.
     */

    raw_sessions_top_level_fields:
      Object.keys(
        sessionsResult.data ||
        {}
      ),


    success_criteria: {
      catalogue_loaded:
        movies.length > 0,

      aggregate_id_discovered_automatically:
        Boolean(
          selectedAggregateId
        ),

      sessions_response_loaded:
        Boolean(
          sessionsResult.data
        ),

      days_parsed:
        days.length > 0,

      sessions_parsed:
        allSessions.length > 0,
    },


    next_step:
      allSessions.length > 0
        ? "NOS end-to-end pipeline is proven. Back-test Colombo and Algarve, then design the production NOS provider adapter."
        : "Catalogue-to-session request worked, but no sessions were parsed. Inspect the returned sessions schema before production work.",
  });
}
