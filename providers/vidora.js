// Vidora scraper for Nuvio (QuickJS).
// Chain: shegu.hls.lol/resolve/{movie/<id> | tv/<season>/<episode>/<id>} -> { found, url, maxHeight }
//        url = HLS master (audio + variants); its playlists and segments live on totallyacdn.cc
// Logs start with [Vidora]. The version tag shows which file Nuvio is really running.

var VERSION = "v8";
var SHOW_VERSION = true;     // append the version to the stream title (turn off once stable)
var DEBUG = true;            // log variant/segment probes made from the phone
var TEST_VARIANT = false;    // extra video-only entry for header experiments
var MAX_RESOLVE_TRIES = 3;   // re-resolve when the master points at an unexpected host
var GOOD_HOSTS = ["totallyacdn.cc", "shegu.hls.lol"];

// If set, streams go through vidora_proxy.py (adds the Origin/Referer headers the CDN checks).
// Example: "http://192.168.1.50:8787"
var PROXY_BASE = "";

var BASE = "https://vidora.ac";
var RESOLVE = "https://shegu.hls.lol";
var VIDBOX = "https://stream.hls.lol/vidbox"; // last-resort fallback (transcode.cfd proxy URLs)

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
    var title = ("Vidora " + (label || "") + " " + q).replace(/\s+/g, " ");
    if (SHOW_VERSION) title += " [" + VERSION + "]";
    return { name: "Vidora", title: title, url: url, quality: q, headers: STREAM_HEADERS };
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

function hostsOf(text) {
    var re = /https?:\/\/([A-Za-z0-9.-]+)/g;
    var seen = {};
    var out = [];
    var m;
    while ((m = re.exec(text)) !== null) {
        var h = m[1].toLowerCase();
        if (!seen[h]) { seen[h] = true; out.push(h); }
    }
    return out;
}

function allKnownGood(hosts) {
    for (var i = 0; i < hosts.length; i++) {
        if (GOOD_HOSTS.indexOf(hosts[i]) === -1) return false;
    }
    return true;
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

// Fetch the master from the phone, log which hosts it points to, and (DEBUG) probe the
// first variant playlist and segment. Returns the host list, or null if the master can't be read.
async function inspectMaster(url) {
    var m = await probe("master", url, STREAM_HEADERS);
    if (!m || m.status !== 200 || m.text.indexOf("#EXTM3U") !== 0) return null;

    var hosts = hostsOf(m.text);
    console.log("[Vidora] master hosts: " + hosts.join(", "));

    if (DEBUG) {
        var video = firstLineAfter(m.text, "#EXT-X-STREAM-INF");
        if (video) {
            video = absUrl(url, video);
            await probe("variant WITHOUT referer", video, { "User-Agent": UA });
            var v = await probe("variant with headers", video, STREAM_HEADERS);
            if (v && v.status === 200) {
                var seg = firstSegment(v.text);
                if (seg) {
                    var h = {};
                    Object.keys(STREAM_HEADERS).forEach(function (k) { h[k] = STREAM_HEADERS[k]; });
                    h.Range = "bytes=0-1023";
                    await probe("segment with headers", absUrl(video, seg), h);
                }
            }
        }
    }
    return hosts;
}

// Test stream: the best <=1080p variant playlist itself, video only.
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

// For S1E1 we can't tell which of the two numbers in the TV path is the season, so we check
// the season/episode in the reply and fall back to the swapped order.
function matchesEpisode(data, season, episode) {
    if (data.season === undefined || data.episode === undefined) return true;
    return String(data.season) === String(season) && String(data.episode) === String(episode);
}

async function resolveOnce(url, mediaType, season, episode) {
    var data = await getJson(url);
    if (!data) return null;
    if (!(data.found && data.url)) {
        console.log("[Vidora] shegu: found=" + data.found);
        return null;
    }
    if (mediaType === "tv" && !matchesEpisode(data, season, episode)) {
        console.log("[Vidora] wrong episode returned (S" + data.season + "E" + data.episode + "), trying next path");
        return null;
    }
    return data;
}

async function buildStreams(data) {
    console.log("[Vidora] shegu OK, maxHeight=" + data.maxHeight);
    var out = [makeStream(data.url, data.maxHeight, "")];
    if (TEST_VARIANT) {
        var vs = await variantStream(data.url);
        if (vs) out.push(vs);
    }
    return out;
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
        var last = null;
        for (var t = 1; t <= MAX_RESOLVE_TRIES; t++) {
            var data = null;
            try {
                data = await resolveOnce(candidates[i], mediaType, season, episode);
            } catch (e) {
                console.log("[Vidora] shegu error: " + e);
            }
            if (!data) break;   // not found / wrong episode: retrying the same path won't help
            last = data;

            var hosts = null;
            try {
                hosts = await inspectMaster(data.url);
            } catch (e2) {
                console.log("[Vidora] inspect error: " + e2);
            }
            if (!hosts || allKnownGood(hosts)) return await buildStreams(data);
            console.log("[Vidora] master points at unexpected host(s): " + hosts.join(", ") +
            " (try " + t + "/" + MAX_RESOLVE_TRIES + ")");
        }
        if (last) {
            console.log("[Vidora] no clean master after retries, returning the last one");
            return await buildStreams(last);
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
    console.log("[Vidora] " + VERSION + " getStreams called " + tmdbId + " " + mediaType + " " + season + " " + episode);

    if (PROXY_BASE) {
        var root = PROXY_BASE.replace(/\/+$/, "");
        var path = mediaType === "tv"
        ? "/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1) + "/index.m3u8"
        : "/movie/" + tmdbId + "/index.m3u8";
        console.log("[Vidora] using proxy " + root + path);
        return [{ name: "Vidora", title: "Vidora (via local proxy)", url: root + path, quality: "Auto" }];
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
