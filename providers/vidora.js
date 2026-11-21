// Vidora scraper for Nuvio (QuickJS).
// Chain: shegu.hls.lol/resolve/movie/<tmdbId> -> { found, url, maxHeight }
//        url = HLS master (audio + variants) on shegu.hls.lol/m/<token>.m3u8
// Logs start with [Vidora].

var DEBUG = true; // also fetches the master once and logs its status; set false when it works

var BASE = "https://vidora.ac";
var RESOLVE = "https://shegu.hls.lol";
var VIDBOX = "https://stream.hls.lol/vidbox"; // fallback (transcode.cfd proxy URLs)

// Same UA/headers as the curl + mpv runs that worked.
var UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

var API_HEADERS = {
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": BASE,
    "Referer": BASE + "/",
    "User-Agent": UA,
    "sec-ch-ua": "\"Not:A-Brand\";v=\"8\", \"Chromium\";v=\"156\", \"Google Chrome\";v=\"156\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Linux\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site"
};

var STREAM_HEADERS = {
    "Origin": BASE,
    "Referer": BASE + "/",
    "User-Agent": UA
};

function okStatus(res) {
    // Don't rely on res.ok: some QuickJS fetch polyfills don't implement it.
    return res.status >= 200 && res.status < 300;
}

async function getJson(url) {
    var res = await fetch(url, { headers: API_HEADERS });
    var text = await res.text();
    console.log("[Vidora] GET " + url + " -> " + res.status + " (" + text.length + " bytes)");
    if (!okStatus(res)) {
        console.log("[Vidora] body: " + text.slice(0, 200));
        return null;
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        console.log("[Vidora] bad JSON: " + e + " body: " + text.slice(0, 200));
        return null;
    }
}

function makeStream(url, height, label) {
    var q = height ? height + "p" : "Auto";
    return {
        name: "Vidora",
        title: ("Vidora " + (label || "") + " " + q).replace("  ", " "),
        url: url,
        quality: q,
        headers: STREAM_HEADERS
    };
}

async function debugMaster(url) {
    try {
        var res = await fetch(url, { headers: STREAM_HEADERS });
        var text = await res.text();
        console.log("[Vidora] master check -> " + res.status + ", starts: " + text.slice(0, 20).replace(/\n/g, " "));
    } catch (e) {
        console.log("[Vidora] master check failed: " + e);
    }
}

// TV URL shapes are a guess: try a few, log which one answers.
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
                if (DEBUG) await debugMaster(data.url);
                return [makeStream(data.url, data.maxHeight, "")];
            }
            if (data) console.log("[Vidora] shegu: found=" + data.found);
        } catch (e) {
            console.log("[Vidora] shegu error: " + e);
        }
    }
    return [];
}

async function viaVidbox(tmdbId, mediaType, season, episode) {
    var url = VIDBOX + "?tmdbId=" + tmdbId + "&type=" + (mediaType === "tv" ? "tv" : "movie");
    if (mediaType === "tv") url += "&season=" + season + "&episode=" + episode;
    try {
        var data = await getJson(url);
        var sources = data && data.sources ? data.sources : {};
        var out = [];
        Object.keys(sources).forEach(function (k) {
            var s = sources[k];
            if (s && s.url) out.push(makeStream(s.url, null, "(" + (s.server || k) + ")"));
        });
            return out;
    } catch (e) {
        console.log("[Vidora] vidbox error: " + e);
        return [];
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    console.log("[Vidora] getStreams called " + tmdbId + " " + mediaType + " " + season + " " + episode);
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
