export async function onRequestGet(context) {
  const url =
    "https://www.ccb.pt/en/evento/the-dog-days-are-over-2-0/2026-09-20/";

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "WorthAGo/1.0"
      }
    });

    const html = await response.text();

    return Response.json({
      ok: response.ok,
      status: response.status,
      source_url: url,
      content_type: response.headers.get("content-type"),
      bytes_received: html.length,
      contains_title: html
        .toLowerCase()
        .includes("the dog days are over"),
      preview: html.slice(0, 500)
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        source_url: url,
        error: error.message
      },
      { status: 500 }
    );
  }
}
