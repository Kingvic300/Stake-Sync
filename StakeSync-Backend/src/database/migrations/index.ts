// Every migration, in order. Add new ones here after generating them (npm run migration:generate).
import { Init1791522257396 } from './1791522257396-Init.js';
import { SecurityAndLogs1791523199967 } from './1791523199967-SecurityAndLogs.js';
import { FeesAndTerms1791546238189 } from './1791546238189-FeesAndTerms.js';
import { PlatformRevenue1791700000000 } from './1791700000000-PlatformRevenue.js';
import { OnrampMoneyHistory1791707480940 } from './1791707480940-OnrampMoneyHistory.js';
import { UserDataExport1791709955189 } from './1791709955189-UserDataExport.js';

export const MIGRATIONS = [
  Init1791522257396,
  SecurityAndLogs1791523199967,
  FeesAndTerms1791546238189,
  PlatformRevenue1791700000000,
  OnrampMoneyHistory1791707480940,
  UserDataExport1791709955189,
];
