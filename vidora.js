// Vidora probe scraper for Nuvio (QuickJS).
// Goal: find out whether vidora.ac exposes direct stream URLs that a scraper can use.
// Watch the app's logs for lines starting with [Vidora].

var BASE = "https://vidora.ac";
var UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

var MEDIA_RE = /https?:\\?\/\\?\/[^"'\s\\<>]+?\.(?:m3u8|mp4)(?:\?[^"'\s\\<>]*)?/gi;
var API_RE = /(?:https?:\\?\/\\?\/[^"'\s\\<>]+)?\\?\/api\\?\/[^"'\s\\<>]*/gi;

function unescapeUrl(u) {
    return u.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
}

function uniq(arr) {
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        if (!seen[arr[i]]) { seen[arr[i]] = true; out.push(arr[i]); }
    }
    return out;
}

function findAll(re, text) {
    var m = text.match(re) || [];
    return uniq(m.map(unescapeUrl));
}

async function get(url, referer) {
    var res = await fetch(url, {
        headers: { "User-Agent": UA, "Referer": referer || BASE + "/", "Accept": "*/*" }
    });
    var text = await res.text();
    console.log("[Vidora] GET " + url + " -> " + res.status + " (" + text.length + " bytes)");
    return text;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        var embedUrl = mediaType === "tv"
        ? BASE + "/tv/" + tmdbId + "/" + season + "/" + episode
        : BASE + "/movie/" + tmdbId;

        var html = await get(embedUrl);
        var media = findAll(MEDIA_RE, html);
        var apis = findAll(API_RE, html);

        // Also check same-origin scripts (player logic often lives there)
        var scriptSrcs = [];
        var scriptRe = /<script[^>]+src=["']([^"']+)["']/gi;
        var m;
        while ((m = scriptRe.exec(html)) !== null) scriptSrcs.push(m[1]);
        scriptSrcs = uniq(scriptSrcs).slice(0, 4);

        for (var i = 0; i < scriptSrcs.length; i++) {
            var src = scriptSrcs[i];
            if (src.indexOf("//") === 0) src = "https:" + src;
                else if (src.charAt(0) === "/") src = BASE + src;
                if (src.indexOf(BASE) !== 0) continue; // same-origin only
                try {
                    var js = await get(src, embedUrl);
                    media = uniq(media.concat(findAll(MEDIA_RE, js)));
                    apis = uniq(apis.concat(findAll(API_RE, js)));
                } catch (e) {
                    console.log("[Vidora] script fetch failed: " + src + " " + e);
                }
        }

        console.log("[Vidora] iframes in page: " + ((html.match(/<iframe/gi) || []).length));
        console.log("[Vidora] API-looking paths: " + JSON.stringify(apis.slice(0, 10)));
        console.log("[Vidora] direct media URLs: " + JSON.stringify(media.slice(0, 10)));

        if (media.length === 0) {
            console.log("[Vidora] No direct streams in static HTML/JS. Stream is likely fetched at runtime via an API or token. Check the API paths above.");
            return [];
        }

        return media.map(function (url, idx) {
            return {
                name: "Vidora (probe)",
                         title: "Vidora " + (url.indexOf(".m3u8") !== -1 ? "HLS" : "MP4") + " #" + (idx + 1),
                         url: url,
                         quality: "Unknown",
                         headers: { "Referer": BASE + "/", "User-Agent": UA }
            };
        });
    } catch (err) {
        console.log("[Vidora] error: " + err);
        return [];
    }
}

module.exports = { getStreams };
