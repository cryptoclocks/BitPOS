cmake_minimum_required(VERSION 3.16)
# BITPOS_PRODUCT=meta builds the separate Meta product (own name, version and sdkconfig layer); the default
# build is the standard terminal, unchanged.
if("$ENV{BITPOS_PRODUCT}" STREQUAL "meta")
    set(PROJECT_VER "0.4.0-meta")
    set(SDKCONFIG_DEFAULTS "sdkconfig.defaults;sdkconfig.meta")
    include($ENV{IDF_PATH}/tools/cmake/project.cmake)
    project(bitpos_terminal_meta)
else()
    set(PROJECT_VER "0.3.14")
    include($ENV{IDF_PATH}/tools/cmake/project.cmake)
    project(bitpos_terminal)
endif()
