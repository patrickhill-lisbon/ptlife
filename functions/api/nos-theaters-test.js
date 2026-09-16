/*
 * PTLife — NOS Theater Mapping Diagnostic
 *
 * READ ONLY.
 * NO D1 WRITES.
 *
 * Fetches the official Cinemas NOS theater inventory
 * and shows how each theater would map into PTLife.
 */

const NOS_ORIGIN = "https://www.cinemas.nos.pt";

const THEATERS_URL =
  NOS_ORIGIN +
  "/graphql/execute.json/cinemas/getAllTheatersWithoutRegion";

function respond(data, status = 200) {
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


function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


function parseLocation(location) {
  if (!location) {
    return {
      latitude: null,
      longitude: null
    };
  }

  const parts =
    String(location).split(",");

  if (parts.length !== 2) {
    return {
      latitude: null,
      longitude: null
    };
  }

  const latitude =
    Number(parts[0].trim());

  const longitude =
    Number(parts[1].trim());

  return {
    latitude:
      Number.isFinite(latitude)
        ? latitude
        : null,

    longitude:
      Number.isFinite(longitude)
        ? longitude
        : null
  };
}


function inferCity(theater) {
  /*
   * Diagnostic only.
   *
   * NOS does not appear to give us a clean
   * city property in the theater object we
   * inspected, so do NOT pretend we know it.
   *
   * We'll improve locality normalization
   * separately.
   */

  const address =
    theater?.address?.plaintext || "";

  const knownCities = [
    "Lisboa",
    "Porto",
    "Coimbra",
    "Faro",
    "Funchal",
    "Braga",
    "Évora",
    "Aveiro",
    "Leiria",
    "Viseu",
    "Montijo",
    "Odivelas",
    "Oeiras",
    "Almada",
    "Matosinhos",
    "Portimao",
    "Portimão",
    "Torres Vedras",
    "Ponta Delgada",
    "Vila Real",
    "Figueira da Foz",
    "Gaia",
    "Gondomar",
    "Paços de Ferreira"
  ];

  for (const city of knownCities) {
    if (
      address
        .toLowerCase()
        .includes(city.toLowerCase())
    ) {
      return city === "Portimao"
        ? "Portimão"
        : city;
    }
  }

  return null;
}


export async function onRequestGet(context) {
  const started = Date.now();

  let response;

  try {
    response = await fetch(
      THEATERS_URL,
      {
        headers: {
          accept: "application/json"
        }
      }
    );
  } catch (error) {
    return respond({
      ok: false,
      graceful_failure: true,
      stage: "theater_fetch_exception",
      error: String(error),
      writes_to_d1: false
    });
  }


  const text =
    await response.text();


  if (!response.ok) {
    return respond({
      ok: false,
      graceful_failure: true,
      stage: "theater_http_failure",
      http_status: response.status,
      preview: text.slice(0, 1500),
      writes_to_d1: false
    });
  }


  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    return respond({
      ok: false,
      graceful_failure: true,
      stage: "theater_json_failure",
      error: String(error),
      preview: text.slice(0, 1500),
      writes_to_d1: false
    });
  }


  const theaters =
    data?.data?.theaterList?.items;


  if (!Array.isArray(theaters)) {
    return respond({
      ok: false,
      graceful_failure: true,
      stage: "theater_array_not_found",
      top_fields:
        Object.keys(data || {}),
      data_fields:
        Object.keys(data?.data || {}),
      preview:
        JSON.stringify(data)
          .slice(0, 3000),
      writes_to_d1: false
    });
  }


  const proposed =
    theaters.map(theater => {

      const coordinates =
        parseLocation(
          theater.location
        );

      const city =
        inferCity(theater);

      return {
        nos: {
          theater_uuid:
            theater.uuid || null,

          region_uuid:
            theater.regionuuid || null,

          name:
            theater.name || null,

          address:
            theater?.address?.plaintext ||
            null,

          location:
            theater.location || null,

          rooms:
            theater.rooms || null
        },

        proposed_ptlife_place: {
          slug:
            slugify(theater.name),

          place_type:
            "cinema",

          official_name:
            theater.name || null,

          original_language:
            "pt-PT",

          neighborhood:
            null,

          city:
            city,

          country_code:
            "PT",

          address:
            theater?.address?.plaintext ||
            null,

          postal_code:
            null,

          latitude:
            coordinates.latitude,

          longitude:
            coordinates.longitude,

          official_website:
            NOS_ORIGIN,

          status:
            "active",

          parent_place_id:
            null,

          locality_id:
            null
        },

        unresolved: {
          city:
            city === null,

          postal_code:
            true,

          neighborhood:
            true,

          locality_id:
            true,

          parent_place_id:
            true
        }
      };
    });


  const missingCity =
    proposed.filter(
      item =>
        item.proposed_ptlife_place.city === null
    );


  return respond({
    ok: true,

    diagnostic_test: true,

    writes_to_d1: false,

    fetched_at:
      new Date().toISOString(),

    duration_ms:
      Date.now() - started,

    source: {
      provider:
        "Cinemas NOS",

      endpoint:
        THEATERS_URL,

      http_status:
        response.status
    },

    inventory: {
      theater_count:
        theaters.length,

      mapped_count:
        proposed.length,

      missing_city_count:
        missingCity.length
    },

    schema_observation:
      "PTLife currently has no dedicated place-provider external ID field. NOS theater UUIDs are therefore shown in the diagnostic but are NOT assigned to a PTLife column.",

    proposed_places:
      proposed,

    missing_city:
      missingCity.map(
        item => ({
          theater_uuid:
            item.nos.theater_uuid,

          name:
            item.nos.name,

          address:
            item.nos.address
        })
      ),

    next_step:
      "Inspect the mapping, especially place_type, city, address, coordinates and unresolved localities. Do not insert records yet."
  });
}
