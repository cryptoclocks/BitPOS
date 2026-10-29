# Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
# The Meta container image: the pinned runtime base plus resvg (SVG → PNG for the Messenger receipt picture).
# resvg is installed beside the base's node_modules and linked in, so the base's own packages stay untouched.
# Build on the OCI host: docker build -t bitpos-meta-base:20261029-r1 -f infra/meta/Dockerfile infra/meta
FROM bitpos-meta-base:20261029
USER root
RUN mkdir -p /opt/meta-deps && cd /opt/meta-deps && npm init -y >/dev/null \
 && npm install --no-audit --no-fund --omit=dev @resvg/resvg-js@2.6.2 \
 && mkdir -p /app/node_modules/@resvg && for p in /opt/meta-deps/node_modules/@resvg/*; do ln -sfn "$p" /app/node_modules/@resvg/; done \
 && node -e "require('/app/node_modules/@resvg/resvg-js')"
USER 1001:1001
