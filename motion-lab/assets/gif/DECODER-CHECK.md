# Actual pinned LVGL GIF decode check

Pinned LVGL9.2.2 gifdec.c matches official v9.2.2 source exactly. Host-only test compiles its unmodified decoder function bodies with libc file/allocation shims, AddressSanitizer and UBSan.

All four optimized GIFs fail on the first frame with LV_GIF_CACHE_DECODE_DATA=0: the non-cache branch rejects exact-end frame decoding at `frm_off + str_len >= frm_size`. All four decode three complete loops successfully with LV_GIF_CACHE_DECODE_DATA=1, changing frames and returning tracked allocations to zero. No dependency source patch needed for the proposed cached configuration.

Host tracked peak decoder allocation is99,976bytes per asset, including persistent LZW cache. ESP32 struct alignment and other system allocations may differ. This is actual decoder compatibility evidence, not observed SD/widget/hardware evidence. Firmware must enable CONFIG_LV_GIF_CACHE_DECODE_DATA=y, reserve at least~128KiB of decoder headroom plus source cache, and test actual heap margins. Stop idle GIF before payment-critical render.
