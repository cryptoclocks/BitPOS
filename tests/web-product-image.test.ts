import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { imageProblem, imageStorageNote, maxProductImageBytes, productImagePathPattern } from '../apps/web/src/lib/product-image';
import { apiRoutes } from '../apps/web/src/lib/api-routes';

test('client image rules: JPEG/PNG/WebP only, 1 MiB cap, no SVG, no empty file', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(imageProblem({ type, size: 10 }), null);
  assert.equal(imageProblem({ type: 'image/svg+xml', size: 10 }), 'type');
  assert.equal(imageProblem({ type: 'image/gif', size: 10 }), 'type');
  assert.equal(imageProblem({ type: 'image/png', size: maxProductImageBytes }), null);
  assert.equal(imageProblem({ type: 'image/png', size: maxProductImageBytes + 1 }), 'size');
  assert.equal(imageProblem({ type: 'image/png', size: 0 }), 'empty');
  assert.ok(productImagePathPattern.test('/images/products/0f8fad5b-d9cb-469f-a165-70867728950e'));
  assert.ok(!productImagePathPattern.test('/images/menu/latte.jpg'));
});
test('storage statement is shown in both languages and the form renders it', () => {
  assert.equal(imageStorageNote('en'), 'Stored in the BitPOS database (product_images), served at /images/products/…, max 1 MB JPEG/PNG/WebP');
  assert.match(imageStorageNote('th'), /product_images.*\/images\/products\/…/);
  const form = readFileSync('apps/web/src/components/CatalogEditor.tsx', 'utf8');
  assert.match(form, /imageStorageNote\(language\)/);
  assert.match(form, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(form, /Remove photo/);
});
test('proxy forwards only POST /product-images; public image route is immutable and nosniff', () => {
  const route = apiRoutes.find(([pattern]) => pattern.test('product-images'));
  assert.deepEqual(route?.[1], ['POST']);
  assert.ok(!apiRoutes.some(([pattern]) => pattern.test('product-images/abc')));
  const page = readFileSync('apps/web/src/pages/images/products/[id].ts', 'utf8');
  assert.match(page, /public, max-age=31536000, immutable/);
  assert.match(page, /X-Content-Type-Options': 'nosniff'/);
  assert.match(page, /export const prerender = false/);
});
