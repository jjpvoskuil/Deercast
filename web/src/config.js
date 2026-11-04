// Supabase project address + its PUBLISHABLE (anon) key. Both are meant to be public: on their own they unlock
// nothing — the row-level security rules in supabase/schema.sql decide who sees what.
// Never put a "secret" / "service_role" key here (or anywhere in web/).
export const SUPABASE_URL = "https://gzxobsvhzscouehlrxeg.supabase.co";
export const SUPABASE_KEY = "sb_publishable_9EiV7Ezzy3jRCzHI5eszhQ_p0CgW5jo";
