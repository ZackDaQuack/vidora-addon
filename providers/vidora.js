// Vidora scraper for Nuvio (QuickJS).
// Chain (confirmed for movies):
//   shegu.hls.lol/resolve/movie/<tmdbId>  ->  { found, url, maxHeight, expiresAt }
//   url = https://shegu.hls.lol/m/<token>.m3u8  (HLS master with audio + variants)
// Watch the app's logs for lines starting with [Vidora].

var BASE = "https://vidora.ac";
var RESOLVE = "https://shegu.hls.lol";
var VIDBOX = "https://stream.hls.lol/vidbox"; // fallback, returns transcode.cfd proxy URLs
var UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

var API_HEADERS = {
    "Accept": "*/*",
    "Origin": BASE,
    "Referer": BASE + "/",
    "User-Agent": UA
};

var STREAM_HEADERS = {
    "Origin": BASE,
    "Referer": BASE + "/",
    "User-Agent": UA
};

async function getJson(url) {
    var res = await fetch(url, { headers: API_HEADERS });
    var text = await res.text();
    console.log("[Vidora] GET " + url + " -> " + res.status + " (" + text.length + " bytes)");
    if (!res.ok) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        console.log("[Vidora] bad JSON from " + url + ": " + e);
        return null;
    }
}

function makeStream(url, height, label) {
    var q = height ? height + "p" : "Auto";
    return {
        name: "Vidora",
        title: "Vidora " + (label || "") + " " + q,
        url: url,
        quality: q,
        headers: STREAM_HEADERS
    };
}

// Primary: shegu resolver. The TV URL shape is a GUESS, so we try a few and log which works.
async function viaShegu(tmdbId, mediaType, season, episode) {
    var candidates = [];
    if (mediaType === "tv") {
        candidates.push(RESOLVE + "/resolve/tv/" + tmdbId + "/" + season + "/" + episode);
        candidates.push(RESOLVE + "/resolve?tmdbId=" + tmdbId + "&type=tv&season=" + season + "&episode=" + episode);
    } else {
        candidates.push(RESOLVE + "/resolve/movie/" + tmdbId);
    }

    for (var i = 0; i < candidates.length; i++) {
        try {
            var data = await getJson(candidates[i]);
            if (data && data.found && data.url) {
                console.log("[Vidora] shegu OK, maxHeight=" + data.maxHeight);
                return [makeStream(data.url, data.maxHeight, "")];
            }
        } catch (e) {
            console.log("[Vidora] shegu error: " + e);
        }
    }
    return [];
}

// Fallback: vidbox returns { sources: { Name: { url, type, label } } }
async function viaVidbox(tmdbId, mediaType, season, episode) {
    var url = VIDBOX + "?tmdbId=" + tmdbId + "&type=" + (mediaType === "tv" ? "tv" : "movie");
    if (mediaType === "tv") url += "&season=" + season + "&episode=" + episode;
    try {
        var data = await getJson(url);
        var sources = data && data.sources ? data.sources : {};
        return Object.keys(sources).map(function (k) {
            var s = sources[k];
            return s && s.url ? makeStream(s.url, null, "(" + (s.server || k) + ")") : null;
        }).filter(Boolean);
    } catch (e) {
        console.log("[Vidora] vidbox error: " + e);
        return [];
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    console.log("[Vidora] getStreams called", tmdbId, mediaType, season, episode);
    var s = season || 1;
    var e = episode || 1;
    try {
        var streams = await viaShegu(tmdbId, mediaType, s, e);
        if (streams.length === 0) {
            console.log("[Vidora] shegu gave nothing, trying vidbox");
            streams = await viaVidbox(tmdbId, mediaType, s, e);
        }
        console.log("[Vidora] returning " + streams.length + " stream(s)");
        return streams;
    } catch (err) {
        console.log("[Vidora] error: " + err);
        return [];
    }
}

module.exports = { getStreams };
