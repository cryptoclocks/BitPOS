# Animated Noto Emoji attribution

Party popper, sparkles, hot beverage and confetti animations by Google Noto Emoji. Downloaded from Google Fonts CDN, linked from official Noto Emoji animation documentation. Source https://googlefonts.github.io/noto-emoji-files/?view=docs and https://googlefonts.github.io/noto-emoji-animation/ . Licensed CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ .

Original512px GIFs retained unmodified. Device candidates technically resized128×128,12fps,64-color palette with FFmpeg; modified dimensions/frame rate/palette only. manifest.json records sources and hashes. Attribution must be retained in BitPOS About/docs and video credits when these assets are used.

General LVGL9.2 docs report4×width×height at16-bit. The actual pinned9.2.2 gifdec.c allocates sizeof(gd_GIF)+5×width×height and outputs ARGB8888, so128×128 requires81,920 pixel bytes plus gd_GIF and LZW overhead. Actual source takes precedence over general documentation. Framebuffers/file/network overhead are additional. 512px sources require at least1.25MiB pixel decode memory; do not load those into demo firmware. https://lvgl.io/docs/open/9.2/libs/gif
