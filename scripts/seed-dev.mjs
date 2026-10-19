#!/usr/bin/env node
// Development-only seed: 2 farmers, 2 buyers and a few products.
//
// Usage (Node 22):
//   ALLOW_SEED=1 SEED_CONFIRM_URL="$NEXT_PUBLIC_SUPABASE_URL" \
//     node --env-file=.env.local scripts/seed-dev.mjs
//
// Safety rails (all must hold or the script exits without touching the database):
//   * NODE_ENV must not be "production".
//   * ALLOW_SEED=1 must be set explicitly.
//   * SEED_CONFIRM_URL must exactly equal NEXT_PUBLIC_SUPABASE_URL, so you have to
//     consciously name the project you are about to write to.
//
// Passwords are random, generated per run, hashed with bcrypt before storage and
// printed ONCE to the console. Nothing is hardcoded. Never run this against a
// production project.

import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

function fail(message) {
  console.error(`seed-dev: ${message}`);
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') fail('refusing to run with NODE_ENV=production.');
if (process.env.ALLOW_SEED !== '1') fail('set ALLOW_SEED=1 to confirm this is a development project.');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
if (process.env.SEED_CONFIRM_URL !== url) {
  fail('SEED_CONFIRM_URL must exactly match NEXT_PUBLIC_SUPABASE_URL.');
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const randomPassword = () => randomBytes(15).toString('base64url');

const people = [
  { name: 'Seed Farmer One', email: 'seed-farmer-1@example.test', phone_number: '5550100001', role: 'farmer' },
  { name: 'Seed Farmer Two', email: 'seed-farmer-2@example.test', phone_number: '5550100002', role: 'farmer' },
  { name: 'Seed Buyer One', email: 'seed-buyer-1@example.test', phone_number: '5550100003', role: 'buyer' },
  { name: 'Seed Buyer Two', email: 'seed-buyer-2@example.test', phone_number: '5550100004', role: 'buyer' },
];

const productTemplates = [
  { name: 'Tomatoes', category: 'vegetables', quantity: 200, price_single: 30, price_multiple: 26, location: 'Pune' },
  { name: 'Basmati Rice', category: 'grains', quantity: 500, price_single: 70, price_multiple: 64, location: 'Karnal' },
  { name: 'Alphonso Mangoes', category: 'fruits', quantity: 120, price_single: 180, price_multiple: 160, location: 'Ratnagiri' },
];

const credentials = [];
const ids = new Map();

for (const person of people) {
  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id')
    .eq('email', person.email)
    .maybeSingle();
  if (lookupError) fail(`lookup failed for ${person.email}: ${lookupError.code ?? 'error'}`);

  if (existing) {
    ids.set(person.email, existing.id);
    credentials.push({ email: person.email, role: person.role, password: '(already exists, unchanged)' });
    continue;
  }

  const password = randomPassword();
  const hash = await bcrypt.hash(password, 12);
  const { data: created, error } = await supabase
    .from('users')
    .insert({ ...person, password: hash })
    .select('id')
    .single();
  if (error || !created) fail(`could not create ${person.email}: ${error?.code ?? 'error'}`);

  ids.set(person.email, created.id);
  credentials.push({ email: person.email, role: person.role, password });
}

let productCount = 0;
for (const person of people.filter((p) => p.role === 'farmer')) {
  const sellerId = ids.get(person.email);
  const { count, error: countError } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('seller_id', sellerId);
  if (countError) fail(`product count failed: ${countError.code ?? 'error'}`);
  if (count && count > 0) continue;

  const rows = productTemplates.map((t) => ({ ...t, seller_id: sellerId, status: 'active', photos: [] }));
  const { error } = await supabase.from('products').insert(rows);
  if (error) fail(`could not create products: ${error.code ?? 'error'}`);
  productCount += rows.length;
}

console.log('\nSeed complete. Passwords are shown once and are not stored anywhere in plain text.\n');
console.table(credentials);
console.log(`Products created: ${productCount}`);
