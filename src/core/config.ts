// Business rules used by decideOutcome. Stored in the `config` table (db/seed.sql) and
// editable on the Settings page; these defaults must match the seed.

export interface RubricConfig {
  /** Completion needed in fewer weeks than this = timeline fail (services.md). Unconfirmed. */
  minLeadTimeWeeksFail: number;
  /** From the fail threshold up to this many weeks = pass, flagged as tight. Unconfirmed. */
  leadTimeWeeksFlag: number;
  /** Site available later than this = pass, flagged as a future project. Unconfirmed. */
  futureProjectFlagWeeks: number;
  /** Commercial projects below this are declined. Only source is T18; unconfirmed. */
  minCommercialSqft: number;
  maxCommercialSqft: number;
  outOfScopeProjectTypes: string[];
  serviceAreaAllow: string[];
  serviceAreaDeny: string[];
  serviceAreaBorderline: string[];
  /** Named deadlines ("Diwali 2026") → ISO date. Resolved by code, never by the LLM. */
  festivalDates: Record<string, string>;
}

export const DEFAULT_CONFIG: RubricConfig = {
  minLeadTimeWeeksFail: 6,
  leadTimeWeeksFlag: 10,
  futureProjectFlagWeeks: 10,
  minCommercialSqft: 500,
  maxCommercialSqft: 3000,
  outOfScopeProjectTypes: ['restaurant', 'hotel', 'cafe', 'retail', 'gym'],
  serviceAreaAllow: [
    'Kothrud', 'Baner', 'Aundh', 'Wakad', 'Koregaon Park', 'Kalyani Nagar', 'Viman Nagar',
    'Hadapsar', 'Magarpatta', 'NIBM', 'Kondhwa', 'Undri', 'Shivane', 'Warje', 'Erandwane',
    'Deccan', 'Pimpri', 'Chinchwad', 'Pimple Saudagar', 'Pimple Nilakh', 'Ravet', 'Hinjewadi',
    'Kharadi', 'Nanded City', 'Bavdhan', 'Pashan', 'Balewadi', 'Sus', 'Sinhagad Road',
    'Shivajinagar', 'Camp', 'Wanowrie', 'Yerawada', 'Dhanori', 'Vishrantwadi', 'Akurdi',
    'Nigdi', 'Thergaon', 'Bhosari', 'Sangvi',
  ],
  serviceAreaDeny: ['Talegaon', 'Lonavala', 'Nashik', 'Mumbai', 'Navi Mumbai', 'Thane', 'Satara', 'Nagpur'],
  serviceAreaBorderline: [
    'Wagholi', 'Moshi', 'Chakan', 'Pirangut', 'Hinjewadi Phase 3', 'Khadakwasla', 'Lohegaon',
    'Manjri', 'Loni Kalbhor',
  ],
  festivalDates: { 'Diwali 2026': '2026-11-08', 'Diwali 2027': '2027-10-29' },
};

/** Maps `config` table rows (snake_case keys, jsonb values) onto RubricConfig. Unknown keys are ignored. */
export function configFromRows(rows: { key: string; value: unknown }[]): RubricConfig {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const pick = <T>(key: string, fallback: T): T => (byKey.has(key) ? (byKey.get(key) as T) : fallback);
  const d = DEFAULT_CONFIG;
  return {
    minLeadTimeWeeksFail: pick('min_lead_time_weeks_fail', d.minLeadTimeWeeksFail),
    leadTimeWeeksFlag: pick('lead_time_weeks_flag', d.leadTimeWeeksFlag),
    futureProjectFlagWeeks: pick('future_project_flag_weeks', d.futureProjectFlagWeeks),
    minCommercialSqft: pick('min_commercial_sqft', d.minCommercialSqft),
    maxCommercialSqft: pick('max_commercial_sqft', d.maxCommercialSqft),
    outOfScopeProjectTypes: pick('out_of_scope_project_types', d.outOfScopeProjectTypes),
    serviceAreaAllow: pick('service_area_allow', d.serviceAreaAllow),
    serviceAreaDeny: pick('service_area_deny', d.serviceAreaDeny),
    serviceAreaBorderline: pick('service_area_borderline', d.serviceAreaBorderline),
    festivalDates: pick('festival_dates', d.festivalDates),
  };
}
