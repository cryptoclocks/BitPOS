# Mobile map provider configuration

The customer address-pin screen supports a configurable XYZ raster tile source. It does not default to a public tile server. Choose a provider whose terms permit this product's use, set its attribution, and confirm privacy, caching, rate limits, and any key restrictions before enabling it.

Pass these compile-time values to the customer Flutter build:

```sh
--dart-define=BITPOS_MAP_TILE_URL=https://YOUR_TILE_HOST/{z}/{x}/{y}.png
--dart-define=BITPOS_MAP_ATTRIBUTION='Map data © YOUR_PROVIDER'
```

The URL must use HTTPS and include `{z}`, `{x}`, and `{y}`. Attribution must be non-empty and is rendered on the map. Do not put private credentials in a mobile app. If a provider requires a secret, use a provider-approved restricted public token or a server-side tile proxy. With either value missing or malformed, the address-pin screen keeps the explicit manual-coordinate fallback and does not issue tile requests.

The map centers on the selected saved coordinate, or an approximate Bangkok center when no coordinate exists. It does not request GPS permission. Dragging the map selects the center pin; confirming returns latitude and longitude as signed E7 integers to the existing address form.

Current implementation includes the configurable map layer, attribution, saved-coordinate centering, center-pin selection, and manual fallback. A tile provider has not been selected or configured for actual app builds, so live map rendering remains pending provider configuration and AVD verification against that provider.
