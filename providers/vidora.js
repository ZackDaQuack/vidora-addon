// Vidora scraper for Nuvio (QuickJS).
// Calls the same endpoint the vidora.ac player uses and returns its HLS sources.
// Watch the app's logs for lines starting with [Vidora].

var API = "https://stream.hls.lol/vidbox";
var BASE = "https://vidora.ac";
var UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

async function getStreams(tmdbId, mediaType, season, episode) {
    console.log("[Vidora] getStreams called", tmdbId, mediaType, season, episode);
    try {
        var url = API + "?tmdbId=" + tmdbId + "&type=" + (mediaType === "tv" ? "tv" : "movie");
        // NOTE: the season/episode parameter names are a guess. Confirm them in
        // the Network tab by playing a TV episode on vidora.ac.
        if (mediaType === "tv") {
            url += "&season=" + season + "&episode=" + episode;
        }

        var res = await fetch(url, {
            headers: {
                "Accept": "*/*",
                "Origin": BASE,
                "Referer": BASE + "/",
                "User-Agent": UA
            }
        });
        var text = await res.text();
        console.log("[Vidora] GET " + url + " -> " + res.status + " (" + text.length + " bytes)");
        if (!res.ok) return [];

        var data = JSON.parse(text);
        var sources = data && data.sources ? data.sources : {};
        var streams = [];

        Object.keys(sources).forEach(function (key) {
            var s = sources[key];
            if (!s || !s.url) return;
            streams.push({
                name: "Vidora",
                title: (s.server || key) + " " + (s.label || "AUTO") + (s.type ? " (" + s.type + ")" : ""),
                         url: s.url,
                         quality: s.label && s.label !== "AUTO" ? s.label : "Auto",
                         headers: { "Referer": BASE + "/", "Origin": BASE, "User-Agent": UA }
            });
        });

        console.log("[Vidora] returning " + streams.length + " stream(s)");
        return streams;
    } catch (err) {
        console.log("[Vidora] error: " + err);
        return [];
    }
}

module.exports = { getStreams };
