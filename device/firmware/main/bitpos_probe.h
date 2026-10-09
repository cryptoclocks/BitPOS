#pragma once

/* Optional, public-pixel-only USB probe for ESP-IDF 5.5.1 / LVGL 9.2.2.
 * Parent integration: add bitpos_probe.c to main SRCS and
 * esp_driver_usb_serial_jtag to REQUIRES; call once immediately AFTER
 * display_engine_start and BEFORE first physical_render/consumer/media/network
 * startup. The completion observer is registered synchronously; driver startup
 * runs on the optional low-priority task. Keep USB Serial/JTAG console on its
 * SIMPLE VFS (never usb_serial_jtag_vfs_use_driver), dynamic tag levels enabled,
 * all tags NONE except BitPOS/BitPOSMedia. No other USB driver/stdin owner,
 * direct printf/ROM printing, log callback replacement, or concurrent init.
 * The probe installs/uninstalls its exclusive driver on one pinned CPU core.
 * Close capture.py/provision/install helpers before capture-frame.py opens USB.
 * It only reads BITPOS_CAPTURE_FRAME_V1\n, never mutates UI/payment/touch state.
 *
 * Completion event provenance: this display engine is single-buffer RGB565,
 * FULL render mode and synchronous row DMA; its flush counter advances ONLY
 * after all LCD DMA callbacks succeeded. LVGL FLUSH_FINISH alone is not proof.
 * Capture is a logical LVGL framebuffer after successful LCD transfer, before
 * panel software rotation/byte swap/flip, NOT a camera or touch-test result.
 * No extra refresh is forced; an unsafe/failed/unobserved flush rejects capture.
 * Observer registration checks the actual CLIB allocator (monitor unsupported)
 * or builtin free/largest blocks under the display lock before lv_event_add,
 * which asserts on OOM. No-space allocation disables this optional probe.
 *
 * Allocation caveat: the pinned SDK install checks rx_ring_buf twice instead
 * of checking tx_ring_buf (usb_serial_jtag.c:185-186). Conservative internal
 * free/largest-block checks reduce but cannot eliminate a concurrent allocation
 * race. No SDK patch or hard no-heap installation guarantee is claimed.
 * Snapshot allocation failure is nonfatal. On transmit failure/unplug the probe
 * discards its driver queue, restores logging and disables itself, without retry.
 */
void bitpos_probe_init(void);
