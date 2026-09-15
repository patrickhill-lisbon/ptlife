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

    const jsonLdBlocks = [];

    const regex =
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match;

    while ((match = regex.exec(html)) !== null) {
      const raw = match[1].trim();

      try {
        jsonLdBlocks.push(JSON.parse(raw));
      } catch {
        jsonLdBlocks.push({
          parse_error: true,
          raw_preview: raw.slice(0, 500)
        });
      }
    }

    return Response.json({
      ok: response.ok,
      status: response.status,
      source_url: url,
      bytes_received: html.length,
      json_ld_blocks_found: jsonLdBlocks.length,
      json_ld: jsonLdBlocks
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
