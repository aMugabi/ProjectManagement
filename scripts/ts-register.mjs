// Usage: node --import ./scripts/ts-register.mjs scripts/<script>.ts  (see scripts/ts-loader.mjs)
import { register } from 'node:module';

register('./ts-loader.mjs', import.meta.url);
