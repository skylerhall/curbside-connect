// Restores the fictional Kestrel Ridge demo data. Usage: npm run demo:reset
import { existsSync } from 'node:fs';
import { loadConfig } from '../server/config.ts';
import { openDatabase } from '../server/db/database.ts';
import { DEMO_HAULER, seedTenant } from '../server/db/seed.ts';
import { ProviderRouter } from '../server/providers/index.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = { ...loadConfig(), smsProvider: 'simulated' as const, emailProvider: 'simulated' as const };
const db = openDatabase(config.databasePath);
await seedTenant({ db, config, providers: new ProviderRouter(config), now: () => new Date() }, DEMO_HAULER, { history: true });
console.log(`Demo data reset in ${config.databasePath}. Restart the server if it is running.`);
