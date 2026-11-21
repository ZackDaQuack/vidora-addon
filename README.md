# Vidora for Nuvio

A scraper plugin that pulls streams from [vidora.ac](https://vidora.ac) for [Nuvio](https://github.com/tapframe/NuvioTV).

I made this to see if it was possible. It was. That does not mean it was a good idea.

## Read this before you get excited

- **It is extremely unstable.** It depends on undocumented endpoints of a free streaming site. It can break whenever they feel like it, and it already has, several times.
- **TV shows don't work.** The code is there. In practice, it doesn't.
- **Some movies don't work either.** If the site doesn't have a title, or the lookup gives up, you get nothing.
- **The streams are worse than what you'd get with a debrid service.** Expect lower quality: often capped at 1080p, sometimes far lower, with whatever audio they happened to have.
- **I will not be providing support.** Not in issues, not in DMs. If it's broken, it's broken. See the first bullet.

If you want something that works reliably, use a debrid service. This is the budget-bin, no-warranty alternative.

## Install

1. In Nuvio, open the plugin settings and add this repository URL:

   ```
   https://raw.githubusercontent.com/ZackDaQuack/vidora-addon/refs/heads/main/manifest.json
   ```

2. Enable the scraper, then open a movie and look for **Vidora** in the stream list.

## How it works

For a movie, the scraper:

1. asks Vidora's resolver for the movie's TMDB id,
2. gets back an HLS playlist URL,
3. hands that URL to Nuvio, with the headers the CDN wants.

If you're curious, the code logs to Nuvio with lines starting with `[Vidora]`. That's the only debugging help you'll get from me, and it's more than the site's owners offer.

## Why this is annoying

Getting a link out of this site was a full-blown scavenger hunt. The player is a wall of obfuscated JavaScript where the interesting strings, like endpoints and header names, are scrambled and only decoded at runtime, so searching it for "api" or "m3u8" gets you nothing. The one config blob that looked promising turned out to be an ad tag. The video "segments" are named like `.png` and `.jpg` files but are actually video. Every URL is signed, and the CDN wants an `Origin` or `Referer` from the right site, or it redirects you to a random YouTube video instead of telling you what's wrong (lmao). Several backends sit behind the player, some of which refuse to talk to anything that isn't a real browser. The working path was eventually found by watching what the site's own player requested in the browser's network tab and copying it. Then, at some point, it started working, I don't know why. That is also roughly the level of stability you should expect going forward.

## Help
If you want to help get this to be more stable, feel free to make a pull request.

## Disclaimer

Not affiliated with Vidora, Nuvio, or anyone else. This repo hosts no media. It contains a few dozen lines of JavaScript that ask a website for a link.
