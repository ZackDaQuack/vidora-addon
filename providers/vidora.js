// Vidora scraper for Nuvio (QuickJS).
// Chain: shegu.hls.lol/resolve/movie/<tmdbId> -> { found, url, maxHeight }
//        url = HLS master (audio + variants) on shegu.hls.lol/m/<token>.m3u8
// Logs start with [Vidora].

var TEST_VARIANT = false; // also list the 1080p video playlist on its own (no audio) to test header handling
var DEBUG = false; // also fetches the master once and logs its status; set false when it works

// If set, streams go through vidora_proxy.py (which adds the Origin/Referer headers the CDN
// checks), so the player needs no custom headers. Example: "http://192.168.1.50:8787"
var PROXY_BASE = "";

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

// Mirrors the mpv run that played the stream (Referer, Origin, UA, Sec-Fetch-*).
var STREAM_HEADERS = {
    "Accept": "*/*",
    "Origin": BASE,
    "Referer": BASE + "/",
    "User-Agent": UA,
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Dest": "empty"
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

async function probe(label, url, headers) {
    try {
        var res = await fetch(url, { headers: headers });
        var text = await res.text();
        console.log("[Vidora] " + label + " -> " + res.status + " (" + text.length + " bytes)");
        return { status: res.status, text: text };
    } catch (e) {
        console.log("[Vidora] " + label + " failed: " + e);
        return null;
    }
}

function absUrl(base, u) {
    if (/^https?:\/\//i.test(u)) return u;
        return base.replace(/\?.*$/, "").replace(/[^\/]*$/, "") + u;
}

function firstLineAfter(text, marker) {
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf(marker) === 0) return (lines[i + 1] || "").trim();
    }
    return null;
}

function firstSegment(text) {
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (l && l.charAt(0) !== "#") return l;
    }
    return null;
}

// Debug chain: master -> variant playlist (with and without Referer) -> first segment.
// This shows what the phone sees, and what a player that drops Referer would see.
async function debugMaster(url) {
    var m = await probe("master", url, STREAM_HEADERS);
    if (!m || m.status !== 200) return;

    var video = firstLineAfter(m.text, "#EXT-X-STREAM-INF");
    if (!video) { console.log("[Vidora] no variant found in master"); return; }
    video = absUrl(url, video);

    await probe("variant WITHOUT referer", video, { "User-Agent": UA });
    var v = await probe("variant with headers", video, STREAM_HEADERS);
    if (!v || v.status !== 200) return;

    var seg = firstSegment(v.text);
    if (!seg) { console.log("[Vidora] no segment found in variant"); return; }
    var h = {};
    Object.keys(STREAM_HEADERS).forEach(function (k) { h[k] = STREAM_HEADERS[k]; });
    h.Range = "bytes=0-1023";
    await probe("segment with headers", absUrl(video, seg), h);
}

// Test stream: the best <=1080p variant playlist itself (host totallyacdn.cc), video only.
async function variantStream(masterUrl) {
    try {
        var res = await fetch(masterUrl, { headers: STREAM_HEADERS });
        var text = await res.text();
        if (res.status !== 200) return null;
        var lines = text.split(/\r?\n/);
        var best = null;
        var bestH = 0;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf("#EXT-X-STREAM-INF") !== 0) continue;
            var m = /RESOLUTION=\d+x(\d+)/.exec(lines[i]);
            var h = m ? parseInt(m[1], 10) : 0;
            var u = (lines[i + 1] || "").trim();
            if (u && h <= 1080 && h > bestH) { best = u; bestH = h; }
        }
        if (!best) return null;
        return makeStream(absUrl(masterUrl, best), bestH, "video-only (test)");
    } catch (e) {
        console.log("[Vidora] variantStream failed: " + e);
        return null;
    }
}

// TV path (seen in the player): /resolve/tv/<a>/<b>/<tmdbId>. For S1E1 we can't tell whether
// <a> is the season or the episode, so we try season/episode first and verify the response's
// season/episode fields, then fall back to the swapped order.
function matchesEpisode(data, season, episode) {
    if (data.season === undefined || data.episode === undefined) return true;
    return String(data.season) === String(season) && String(data.episode) === String(episode);
}

async function viaShegu(tmdbId, mediaType, season, episode) {
    var candidates = [];
    if (mediaType === "tv") {
        candidates.push(RESOLVE + "/resolve/tv/" + season + "/" + episode + "/" + tmdbId);
        if (String(season) !== String(episode)) {
            candidates.push(RESOLVE + "/resolve/tv/" + episode + "/" + season + "/" + tmdbId);
        }
    } else {
        candidates.push(RESOLVE + "/resolve/movie/" + tmdbId);
    }

    for (var i = 0; i < candidates.length; i++) {
        try {
            var data = await getJson(candidates[i]);
            if (data && data.found && data.url) {
                if (mediaType === "tv" && !matchesEpisode(data, season, episode)) {
                    console.log("[Vidora] wrong episode returned (S" + data.season + "E" + data.episode + "), trying next path");
                    continue;
                }
                console.log("[Vidora] shegu OK, maxHeight=" + data.maxHeight);
                if (DEBUG) await debugMaster(data.url);
                var out = [makeStream(data.url, data.maxHeight, "")];
                if (TEST_VARIANT) {
                    var vs = await variantStream(data.url);
                    if (vs) out.push(vs);
                }
                return out;
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

    if (PROXY_BASE) {
        var root = PROXY_BASE.replace(/\/+$/, "");
        var path = mediaType === "tv"
        ? "/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1) + "/index.m3u8"
        : "/movie/" + tmdbId + "/index.m3u8";
        console.log("[Vidora] using proxy " + root + path);
        return [{
            name: "Vidora",
            title: "Vidora (via local proxy)",
            url: root + path,
            quality: "Auto"
        }];
    }
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
