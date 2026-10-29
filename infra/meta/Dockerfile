# Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
# The Meta container image: the pinned runtime base plus resvg (SVG → PNG for the Messenger receipt picture and offer
# animation frames) and sharp (Muse Image answers WebP, which resvg cannot read; sharp turns it into PNG).
# resvg and sharp are installed beside the base's node_modules and linked in, so the base's own packages stay untouched.
# Build on the OCI host: docker build -t bitpos-meta-base:20261029-r2 -f infra/meta/Dockerfile infra/meta
FROM bitpos-meta-base:20261029
USER root
RUN mkdir -p /opt/meta-deps && cd /opt/meta-deps && npm init -y >/dev/null \
 && npm install --no-audit --no-fund --omit=dev @resvg/resvg-js@2.6.2 sharp@0.33.5 \
 && mkdir -p /app/node_modules/@resvg && for p in /opt/meta-deps/node_modules/@resvg/*; do ln -sfn "$p" /app/node_modules/@resvg/; done \
 && ln -sfn /opt/meta-deps/node_modules/sharp /app/node_modules/sharp \
 && node -e "require('/app/node_modules/@resvg/resvg-js');require('/app/node_modules/sharp')"
USER 1001:1001
