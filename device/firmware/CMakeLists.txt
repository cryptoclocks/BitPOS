cmake_minimum_required(VERSION 3.16)
# NEAR HACKATHON work: BITPOS_PRODUCT=near builds the separate NEAR product (own name, version and sdkconfig layer,
# see tools/firmware/build-near.sh); the default build is the standard terminal, unchanged.
if("$ENV{BITPOS_PRODUCT}" STREQUAL "near")
    set(PROJECT_VER "0.5.0-near")
    set(SDKCONFIG_DEFAULTS "sdkconfig.defaults;sdkconfig.near")
    include($ENV{IDF_PATH}/tools/cmake/project.cmake)
    project(bitpos_terminal_near)
else()
    set(PROJECT_VER "0.3.14")
    include($ENV{IDF_PATH}/tools/cmake/project.cmake)
    project(bitpos_terminal)
endif()
