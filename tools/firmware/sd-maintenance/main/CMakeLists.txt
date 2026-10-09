idf_component_register(SRCS "sd_maintenance.c" INCLUDE_DIRS "."
    PRIV_REQUIRES esp_driver_usb_serial_jtag esp_driver_sdmmc fatfs sdmmc
                  esp_hw_support esp_timer mbedtls)
